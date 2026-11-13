//! The vault: an SQLite database that exists in plaintext only in memory.
//!
//! On disk there is a single sealed file (see `crypto`). Unlocking decrypts
//! it into an in-memory SQLite connection; every committed change re-seals
//! the whole database and atomically replaces the file. Locking drops the
//! connection and the key. No plaintext database, journal or temp file is
//! ever written to disk.
//!
//! This trades SQLCipher's page-level encryption for a build with no C crypto
//! dependency (see DEVLOG, Phase 3). It suits a personal ledger: the file is
//! well under a megabyte per year of records, so rewriting it takes
//! milliseconds.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{Connection, MAIN_DB};

use crate::crypto::{self, KdfParams, Key, SALT_LEN};
use crate::db;
use crate::error::{AppError, AppResult};

pub const MIN_PASSPHRASE_CHARS: usize = 8;

struct Unlocked {
    conn: Connection,
    key: Key,
    salt: [u8; SALT_LEN],
    params: KdfParams,
}

pub struct Vault {
    path: PathBuf,
    kdf: KdfParams,
    state: Option<Unlocked>,
    failed_attempts: u32,
}

fn check_new_passphrase(passphrase: &str) -> AppResult<()> {
    if passphrase.chars().count() < MIN_PASSPHRASE_CHARS {
        return Err(AppError::invalid(format!(
            "Use a passphrase of at least {MIN_PASSPHRASE_CHARS} characters."
        )));
    }
    Ok(())
}

/// Write `bytes` to `path` so that a crash leaves either the old file or the
/// new one, never a partial file.
fn write_atomically(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let tmp = path.with_extension("tmp");
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

impl Vault {
    pub fn new(path: PathBuf) -> Self {
        Vault { path, kdf: KdfParams::STANDARD, state: None, failed_attempts: 0 }
    }

    #[cfg(test)]
    pub fn with_params(path: PathBuf, kdf: KdfParams) -> Self {
        Vault { path, kdf, state: None, failed_attempts: 0 }
    }

    pub fn exists(&self) -> bool {
        self.path.is_file()
    }

    pub fn is_unlocked(&self) -> bool {
        self.state.is_some()
    }

    /// Create a new, empty vault protected by `passphrase` and leave it unlocked.
    pub fn create(&mut self, passphrase: &str) -> AppResult<()> {
        if self.exists() {
            return Err(AppError::VaultExists);
        }
        check_new_passphrase(passphrase)?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut conn = Connection::open_in_memory()?;
        db::migrate(&mut conn)?;
        let salt = crypto::random_salt();
        let key = crypto::derive_key(passphrase, &salt, self.kdf)?;
        self.state = Some(Unlocked { conn, key, salt, params: self.kdf });
        if let Err(error) = self.persist() {
            self.state = None;
            return Err(error);
        }
        Ok(())
    }

    /// Decrypt the vault file into memory. Repeated failures are slowed down,
    /// on top of the cost of the key derivation itself.
    pub fn unlock(&mut self, passphrase: &str) -> AppResult<()> {
        if self.is_unlocked() {
            return Ok(());
        }
        if !self.exists() {
            return Err(AppError::NoVault);
        }
        if self.failed_attempts >= 3 {
            let seconds = 1u64 << (self.failed_attempts - 3).min(4); // 1, 2, 4, 8, 16
            std::thread::sleep(Duration::from_secs(seconds));
        }

        let file = fs::read(&self.path)?;
        let (salt, params) = crypto::read_header(&file)?;
        let key = crypto::derive_key(passphrase, &salt, params)?;
        let plaintext = match crypto::open(&key, &file) {
            Ok(plaintext) => plaintext,
            Err(error) => {
                if matches!(error, AppError::WrongPassphrase) {
                    self.failed_attempts += 1;
                }
                return Err(error);
            }
        };

        let mut conn = Connection::open_in_memory()?;
        conn.deserialize_read_exact(MAIN_DB, plaintext.as_slice(), plaintext.len(), false)
            .map_err(|_| AppError::Corrupt)?;
        db::migrate(&mut conn)?;

        self.failed_attempts = 0;
        self.state = Some(Unlocked { conn, key, salt, params });
        // Persist in case migrations changed the schema.
        self.persist()
    }

    /// Drop the decrypted database and the key from memory.
    pub fn lock(&mut self) {
        self.state = None; // Key is zeroised on drop; the connection frees its pages.
    }

    /// Read access to the decrypted database.
    pub fn read<T>(&self, query: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let state = self.state.as_ref().ok_or(AppError::Locked)?;
        query(&state.conn)
    }

    /// Run `change` in a transaction, then seal the result to disk. If the
    /// change fails nothing is modified. The call returns only after the new
    /// state is durable.
    pub fn write<T>(&mut self, change: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let state = self.state.as_mut().ok_or(AppError::Locked)?;
        let tx = state.conn.transaction()?;
        let value = change(&tx)?;
        tx.commit()?;
        self.persist()?;
        Ok(value)
    }

    fn sealed_image(&self) -> AppResult<Vec<u8>> {
        let state = self.state.as_ref().ok_or(AppError::Locked)?;
        let data = state.conn.serialize(MAIN_DB)?;
        crypto::seal(&state.key, &state.salt, state.params, &data)
    }

    fn persist(&self) -> AppResult<()> {
        write_atomically(&self.path, &self.sealed_image()?)
    }

    /// The current vault as an encrypted image, for a backup file. It is
    /// protected by the same passphrase as the vault at the time of backup.
    pub fn backup_image(&self) -> AppResult<Vec<u8>> {
        self.sealed_image()
    }

    /// Replace the vault with a backup image. The image is fully decrypted,
    /// loaded and integrity-checked in memory before anything on disk is
    /// touched, and the previous vault file is kept beside the new one.
    /// The restored vault keeps the backup's passphrase.
    pub fn restore(&mut self, image: &[u8], passphrase: &str) -> AppResult<()> {
        let (salt, params) = crypto::read_header(image)?;
        let key = crypto::derive_key(passphrase, &salt, params)?;
        let plaintext = crypto::open(&key, image)?;
        let mut conn = Connection::open_in_memory()?;
        conn.deserialize_read_exact(MAIN_DB, plaintext.as_slice(), plaintext.len(), false)
            .map_err(|_| AppError::Corrupt)?;
        let check: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(|_| AppError::Corrupt)?;
        if check != "ok" {
            return Err(AppError::Corrupt);
        }
        db::migrate(&mut conn)?;

        if self.exists() {
            fs::copy(&self.path, self.previous_path())?;
        } else if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        self.state = Some(Unlocked { conn, key, salt, params });
        self.failed_attempts = 0;
        self.persist()
    }

    fn previous_path(&self) -> PathBuf {
        self.path.with_extension("before-restore")
    }

    /// Permanently delete the vault and everything kept beside it. Requires
    /// the passphrase, so a walk-up click on an unlocked screen is not enough.
    pub fn destroy(&mut self, passphrase: &str) -> AppResult<()> {
        if !self.exists() {
            return Err(AppError::NoVault);
        }
        let file = fs::read(&self.path)?;
        let (salt, params) = crypto::read_header(&file)?;
        crypto::open(&crypto::derive_key(passphrase, &salt, params)?, &file)?;
        self.lock();
        fs::remove_file(&self.path)?;
        for leftover in [self.previous_path(), self.path.with_extension("tmp")] {
            if leftover.exists() {
                fs::remove_file(leftover)?;
            }
        }
        Ok(())
    }

    /// Re-encrypt under a new passphrase (new salt, new key). The current
    /// passphrase is verified against the file first.
    pub fn change_passphrase(&mut self, current: &str, new: &str) -> AppResult<()> {
        check_new_passphrase(new)?;
        let state = self.state.as_ref().ok_or(AppError::Locked)?;
        let check = crypto::derive_key(current, &state.salt, state.params)?;
        if *check != *state.key {
            return Err(AppError::WrongPassphrase);
        }
        let salt = crypto::random_salt();
        let key = crypto::derive_key(new, &salt, self.kdf)?;
        let kdf = self.kdf;
        let state = self.state.as_mut().ok_or(AppError::Locked)?;
        let previous = (std::mem::replace(&mut state.key, key), state.salt, state.params);
        state.salt = salt;
        state.params = kdf;
        if let Err(error) = self.persist() {
            let state = self.state.as_mut().ok_or(AppError::Locked)?;
            (state.key, state.salt, state.params) = previous;
            return Err(error);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::TEST_PARAMS;
    use crate::db::{AccountInput, TransactionInput};

    const PASS: &str = "correct horse battery";

    fn temp_vault() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::with_params(dir.path().join("data").join("vault.db.enc"), TEST_PARAMS);
        (dir, vault)
    }

    fn add_account(vault: &mut Vault, name: &str) -> String {
        vault
            .write(|conn| {
                db::save_account(conn, None, &AccountInput {
                    name: name.into(), kind: "current".into(), opening_balance: 840_000, opening_date: "2026-01-01".into(),
                })
            })
            .unwrap()
    }

    #[test]
    fn data_survives_lock_and_reopen() {
        let (_dir, mut vault) = temp_vault();
        assert!(!vault.exists());
        vault.create(PASS).unwrap();
        let account = add_account(&mut vault, "Current account");
        vault
            .write(|conn| {
                db::save_transaction(conn, None, &TransactionInput {
                    account_id: account.clone(), date: "2026-11-12".into(), kind: "expense".into(), amount: 24_990,
                    category_id: Some("cat-food".into()), transfer_account_id: None,
                    description: "Dinner".into(), notes: String::new(), is_fixed: false,
                })
            })
            .unwrap();
        vault.lock();
        assert!(!vault.is_unlocked());
        assert!(matches!(vault.read(db::load_ledger), Err(AppError::Locked)));

        // A brand-new Vault value, as after restarting the application.
        let mut reopened = Vault::with_params(vault.path.clone(), TEST_PARAMS);
        reopened.unlock(PASS).unwrap();
        let ledger = reopened.read(db::load_ledger).unwrap();
        assert_eq!(ledger.accounts[0].name, "Current account");
        assert_eq!(ledger.transactions[0].amount, 24_990);
        assert_eq!(ledger.categories.len(), 10);
    }

    #[test]
    fn wrong_passphrase_is_rejected_and_reveals_nothing() {
        let (_dir, mut vault) = temp_vault();
        vault.create(PASS).unwrap();
        vault.lock();
        assert!(matches!(vault.unlock("not the passphrase"), Err(AppError::WrongPassphrase)));
        assert!(!vault.is_unlocked());
        assert!(matches!(vault.read(db::load_ledger), Err(AppError::Locked)));
        vault.unlock(PASS).unwrap();
        assert!(vault.is_unlocked());
    }

    #[test]
    fn nothing_readable_is_written_to_disk() {
        let (dir, mut vault) = temp_vault();
        vault.create(PASS).unwrap();
        add_account(&mut vault, "Compte Attijariwafa secret");
        let folder = dir.path().join("data");
        let files: Vec<_> = fs::read_dir(&folder).unwrap().map(|e| e.unwrap().path()).collect();
        assert_eq!(files.len(), 1, "only the sealed file may exist: {files:?}");
        let bytes = fs::read(&files[0]).unwrap();
        for needle in [&b"SQLite format"[..], b"Attijariwafa", b"CREATE TABLE", b"Salary", b"accounts"] {
            assert!(!bytes.windows(needle.len()).any(|w| w == needle), "plaintext found on disk");
        }
        assert_eq!(&bytes[..8], crypto::MAGIC);
    }

    #[test]
    fn failed_changes_leave_no_trace() {
        let (_dir, mut vault) = temp_vault();
        vault.create(PASS).unwrap();
        let result: AppResult<()> = vault.write(|conn| {
            db::save_account(conn, None, &AccountInput {
                name: "Half-made".into(), kind: "cash".into(), opening_balance: 0, opening_date: "2026-01-01".into(),
            })?;
            Err(AppError::invalid("something went wrong afterwards"))
        });
        assert!(result.is_err());
        assert!(vault.read(db::list_accounts).unwrap().is_empty());
        vault.lock();
        vault.unlock(PASS).unwrap();
        assert!(vault.read(db::list_accounts).unwrap().is_empty());
    }

    #[test]
    fn tampered_file_is_refused() {
        let (_dir, mut vault) = temp_vault();
        vault.create(PASS).unwrap();
        vault.lock();
        let mut bytes = fs::read(&vault.path).unwrap();
        let last = bytes.len() - 20;
        bytes[last] ^= 0x40;
        fs::write(&vault.path, &bytes).unwrap();
        assert!(vault.unlock(PASS).is_err());
        assert!(!vault.is_unlocked());
    }

    #[test]
    fn passphrase_can_be_changed() {
        let (_dir, mut vault) = temp_vault();
        vault.create(PASS).unwrap();
        add_account(&mut vault, "Current");
        assert!(matches!(vault.change_passphrase("wrong current", "a new passphrase"), Err(AppError::WrongPassphrase)));
        assert!(matches!(vault.change_passphrase(PASS, "short"), Err(AppError::Invalid(_))));
        vault.change_passphrase(PASS, "a new passphrase").unwrap();
        vault.lock();
        assert!(matches!(vault.unlock(PASS), Err(AppError::WrongPassphrase)));
        vault.unlock("a new passphrase").unwrap();
        assert_eq!(vault.read(db::list_accounts).unwrap().len(), 1);
    }

    #[test]
    fn backup_and_restore_round_trip() {
        let (_dir, mut vault) = temp_vault();
        vault.create(PASS).unwrap();
        add_account(&mut vault, "Before backup");
        let backup = vault.backup_image().unwrap();
        add_account(&mut vault, "After backup");
        assert_eq!(vault.read(db::list_accounts).unwrap().len(), 2);

        // A wrong passphrase or a damaged backup changes nothing.
        assert!(matches!(vault.restore(&backup, "wrong passphrase"), Err(AppError::WrongPassphrase)));
        let mut damaged = backup.clone();
        let middle = damaged.len() / 2;
        damaged[middle] ^= 0xFF;
        assert!(vault.restore(&damaged, PASS).is_err());
        assert!(vault.restore(b"not a backup at all", PASS).is_err());
        assert_eq!(vault.read(db::list_accounts).unwrap().len(), 2);

        vault.restore(&backup, PASS).unwrap();
        let names: Vec<String> = vault.read(db::list_accounts).unwrap().into_iter().map(|a| a.name).collect();
        assert_eq!(names, ["Before backup"]);
        assert!(vault.previous_path().is_file(), "the replaced vault must be kept");

        // The restored state is what is on disk.
        vault.lock();
        vault.unlock(PASS).unwrap();
        assert_eq!(vault.read(db::list_accounts).unwrap().len(), 1);
    }

    #[test]
    fn restore_into_an_empty_installation() {
        let (_dir, mut source) = temp_vault();
        source.create(PASS).unwrap();
        add_account(&mut source, "Travelling account");
        let backup = source.backup_image().unwrap();

        let (_dir2, mut fresh) = temp_vault();
        assert!(!fresh.exists());
        fresh.restore(&backup, PASS).unwrap();
        assert!(fresh.exists() && fresh.is_unlocked());
        assert_eq!(fresh.read(db::list_accounts).unwrap()[0].name, "Travelling account");
    }

    #[test]
    fn destroy_requires_the_passphrase_and_leaves_nothing() {
        let (dir, mut vault) = temp_vault();
        vault.create(PASS).unwrap();
        let backup = vault.backup_image().unwrap();
        vault.restore(&backup, PASS).unwrap(); // creates the "before-restore" copy
        assert!(matches!(vault.destroy("wrong passphrase"), Err(AppError::WrongPassphrase)));
        assert!(vault.exists() && vault.is_unlocked());

        vault.destroy(PASS).unwrap();
        assert!(!vault.exists() && !vault.is_unlocked());
        let left: Vec<_> = fs::read_dir(dir.path().join("data")).unwrap().collect();
        assert!(left.is_empty(), "files left behind: {left:?}");
        assert!(matches!(vault.destroy(PASS), Err(AppError::NoVault)));
    }

    #[test]
    fn creation_rules() {
        let (_dir, mut vault) = temp_vault();
        assert!(matches!(vault.unlock(PASS), Err(AppError::NoVault)));
        assert!(matches!(vault.create("short"), Err(AppError::Invalid(_))));
        assert!(!vault.exists());
        vault.create(PASS).unwrap();
        assert!(matches!(vault.create(PASS), Err(AppError::VaultExists)));
    }
}
