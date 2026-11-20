//! Vault file encryption.
//!
//! The whole database is sealed as one authenticated blob:
//!
//! ```text
//! magic "VAULTDB1" (8) | m_cost KiB (u32 LE) | t_cost (u32 LE) | p_cost (u32 LE)
//! | salt (16) | nonce (24) | XChaCha20-Poly1305 ciphertext + tag
//! ```
//!
//! * Key: Argon2id(passphrase, salt) with the parameters stored in the header.
//! * Cipher: XChaCha20-Poly1305 with a fresh random 24-byte nonce per write.
//! * The header (magic, parameters, salt) is bound as associated data, so it
//!   cannot be altered without failing authentication.
//!
//! A wrong passphrase and a tampered file are indistinguishable by design:
//! both fail the authentication tag.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::RngCore;
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

pub const MAGIC: &[u8; 8] = b"VAULTDB1";
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 24;
pub const KEY_LEN: usize = 32;
const AAD_LEN: usize = 8 + 12 + SALT_LEN;
pub const HEADER_LEN: usize = AAD_LEN + NONCE_LEN;

pub type Key = Zeroizing<[u8; KEY_LEN]>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KdfParams {
    /// Memory in KiB.
    pub m_cost: u32,
    /// Passes.
    pub t_cost: u32,
    /// Lanes.
    pub p_cost: u32,
}

impl KdfParams {
    /// 64 MiB, 3 passes: above the OWASP minimum for Argon2id, roughly half a
    /// second on a typical laptop. This cost is what makes guessing slow.
    pub const STANDARD: KdfParams = KdfParams { m_cost: 64 * 1024, t_cost: 3, p_cost: 1 };

    /// Reject absurd values read from an untrusted file header.
    fn check(&self) -> AppResult<()> {
        let sane = (8..=1024 * 1024).contains(&self.m_cost)
            && (1..=16).contains(&self.t_cost)
            && (1..=8).contains(&self.p_cost);
        if sane { Ok(()) } else { Err(AppError::Corrupt) }
    }
}

pub fn random_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    salt
}

pub fn derive_key(passphrase: &str, salt: &[u8; SALT_LEN], params: KdfParams) -> AppResult<Key> {
    params.check()?;
    let argon_params = Params::new(params.m_cost, params.t_cost, params.p_cost, Some(KEY_LEN))
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon_params);
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    argon
        .hash_password_into(passphrase.as_bytes(), salt, key.as_mut())
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(key)
}

fn aad(salt: &[u8; SALT_LEN], params: KdfParams) -> [u8; AAD_LEN] {
    let mut out = [0u8; AAD_LEN];
    out[..8].copy_from_slice(MAGIC);
    out[8..12].copy_from_slice(&params.m_cost.to_le_bytes());
    out[12..16].copy_from_slice(&params.t_cost.to_le_bytes());
    out[16..20].copy_from_slice(&params.p_cost.to_le_bytes());
    out[20..].copy_from_slice(salt);
    out
}

/// Encrypt `plaintext` into a complete vault file image.
pub fn seal(key: &Key, salt: &[u8; SALT_LEN], params: KdfParams, plaintext: &[u8]) -> AppResult<Vec<u8>> {
    let header = aad(salt, params);
    let mut nonce = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce);

    let cipher = XChaCha20Poly1305::new_from_slice(key.as_ref())
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let nonce_ref = XNonce::try_from(&nonce[..]).map_err(|_| AppError::Internal("nonce".into()))?;
    let ciphertext = cipher
        .encrypt(&nonce_ref, Payload { msg: plaintext, aad: &header })
        .map_err(|_| AppError::Internal("encryption failed".into()))?;

    let mut out = Vec::with_capacity(HEADER_LEN + ciphertext.len());
    out.extend_from_slice(&header);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Salt and KDF parameters from a vault file image, without decrypting.
pub fn read_header(file: &[u8]) -> AppResult<([u8; SALT_LEN], KdfParams)> {
    if file.len() < HEADER_LEN + 16 || &file[..8] != MAGIC {
        return Err(AppError::Corrupt);
    }
    let word = |at: usize| u32::from_le_bytes([file[at], file[at + 1], file[at + 2], file[at + 3]]);
    let params = KdfParams { m_cost: word(8), t_cost: word(12), p_cost: word(16) };
    params.check()?;
    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&file[20..AAD_LEN]);
    Ok((salt, params))
}

/// Decrypt a vault file image. Fails with `WrongPassphrase` if the key does
/// not match or any byte of the file has been altered.
pub fn open(key: &Key, file: &[u8]) -> AppResult<Zeroizing<Vec<u8>>> {
    read_header(file)?;
    let (header, rest) = file.split_at(AAD_LEN);
    let (nonce, ciphertext) = rest.split_at(NONCE_LEN);
    let cipher = XChaCha20Poly1305::new_from_slice(key.as_ref())
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let nonce_ref = XNonce::try_from(nonce).map_err(|_| AppError::Corrupt)?;
    cipher
        .decrypt(&nonce_ref, Payload { msg: ciphertext, aad: header })
        .map(Zeroizing::new)
        .map_err(|_| AppError::WrongPassphrase)
}

#[cfg(test)]
pub const TEST_PARAMS: KdfParams = KdfParams { m_cost: 64, t_cost: 1, p_cost: 1 };

#[cfg(test)]
mod tests {
    use super::*;

    fn key(passphrase: &str, salt: &[u8; SALT_LEN]) -> Key {
        derive_key(passphrase, salt, TEST_PARAMS).unwrap()
    }

    #[test]
    fn round_trips() {
        let salt = random_salt();
        let k = key("correct horse", &salt);
        let sealed = seal(&k, &salt, TEST_PARAMS, b"ledger bytes").unwrap();
        assert_eq!(open(&k, &sealed).unwrap().as_slice(), b"ledger bytes");
        assert_eq!(read_header(&sealed).unwrap(), (salt, TEST_PARAMS));
    }

    #[test]
    fn ciphertext_does_not_contain_plaintext() {
        let salt = random_salt();
        let k = key("correct horse", &salt);
        let secret = b"salary 14000 rent 3800 CREATE TABLE transactions";
        let sealed = seal(&k, &salt, TEST_PARAMS, secret).unwrap();
        assert!(!sealed.windows(6).any(|w| w == b"salary" || w == b"CREATE"));
    }

    #[test]
    fn every_write_uses_a_fresh_nonce() {
        let salt = random_salt();
        let k = key("correct horse", &salt);
        let a = seal(&k, &salt, TEST_PARAMS, b"same").unwrap();
        let b = seal(&k, &salt, TEST_PARAMS, b"same").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn wrong_passphrase_is_rejected() {
        let salt = random_salt();
        let sealed = seal(&key("right", &salt), &salt, TEST_PARAMS, b"data").unwrap();
        assert!(matches!(open(&key("wrong", &salt), &sealed), Err(AppError::WrongPassphrase)));
    }

    #[test]
    fn any_tampering_is_detected() {
        let salt = random_salt();
        let k = key("right", &salt);
        let sealed = seal(&k, &salt, TEST_PARAMS, b"some ledger data").unwrap();
        // Flip one bit in the salt, the nonce, the ciphertext and the tag in turn.
        for index in [20, AAD_LEN + 1, HEADER_LEN + 2, sealed.len() - 1] {
            let mut bad = sealed.clone();
            bad[index] ^= 0x01;
            assert!(open(&k, &bad).is_err(), "tampering at byte {index} went unnoticed");
        }
    }

    #[test]
    fn rejects_foreign_and_truncated_files() {
        let salt = random_salt();
        let k = key("right", &salt);
        assert!(matches!(open(&k, b"SQLite format 3\0 plain database"), Err(AppError::Corrupt)));
        let sealed = seal(&k, &salt, TEST_PARAMS, b"data").unwrap();
        assert!(matches!(open(&k, &sealed[..HEADER_LEN]), Err(AppError::Corrupt)));
    }

    #[test]
    fn rejects_hostile_kdf_parameters() {
        let salt = random_salt();
        let k = key("right", &salt);
        let mut sealed = seal(&k, &salt, TEST_PARAMS, b"data").unwrap();
        sealed[8..12].copy_from_slice(&u32::MAX.to_le_bytes()); // 4 TiB of memory
        assert!(matches!(read_header(&sealed), Err(AppError::Corrupt)));
    }

    #[test]
    fn different_salts_give_different_keys() {
        let (a, b) = (random_salt(), random_salt());
        assert_ne!(*key("same", &a), *key("same", &b));
    }
}
