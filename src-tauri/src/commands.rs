//! The only surface the webview can call. Each command is a thin wrapper:
//! take the vault lock, delegate to `vault` / `db`, return typed data.
//! The webview cannot send SQL, read files or reach the network.

use std::sync::Mutex;

use serde::Serialize;
use tauri::State;
use zeroize::Zeroizing;

use crate::db::{self, AccountInput, CategoryInput, DueOccurrence, Ledger, ScheduleInput, TransactionInput};
use crate::error::{AppError, AppResult};
use crate::ai;
use crate::files;
use crate::vault::Vault;

pub type VaultState = Mutex<Vault>;

fn locked<'a>(state: &'a State<VaultState>) -> AppResult<std::sync::MutexGuard<'a, Vault>> {
    state.lock().map_err(|_| AppError::Internal("vault state poisoned".into()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    exists: bool,
    unlocked: bool,
}

#[tauri::command]
pub fn vault_status(state: State<VaultState>) -> AppResult<VaultStatus> {
    let vault = locked(&state)?;
    Ok(VaultStatus { exists: vault.exists(), unlocked: vault.is_unlocked() })
}

#[tauri::command]
pub fn vault_create(state: State<VaultState>, passphrase: String) -> AppResult<()> {
    let passphrase = Zeroizing::new(passphrase);
    locked(&state)?.create(&passphrase)
}

#[tauri::command]
pub fn vault_unlock(state: State<VaultState>, passphrase: String) -> AppResult<()> {
    let passphrase = Zeroizing::new(passphrase);
    locked(&state)?.unlock(&passphrase)
}

#[tauri::command]
pub fn vault_lock(state: State<VaultState>) -> AppResult<()> {
    locked(&state)?.lock();
    Ok(())
}

#[tauri::command]
pub fn vault_change_passphrase(state: State<VaultState>, current: String, new: String) -> AppResult<()> {
    let (current, new) = (Zeroizing::new(current), Zeroizing::new(new));
    locked(&state)?.change_passphrase(&current, &new)
}

#[tauri::command]
pub fn ledger_load(state: State<VaultState>) -> AppResult<Ledger> {
    locked(&state)?.read(db::load_ledger)
}

#[tauri::command]
pub fn account_save(state: State<VaultState>, id: Option<String>, input: AccountInput) -> AppResult<String> {
    locked(&state)?.write(|conn| db::save_account(conn, id.as_deref(), &input))
}

#[tauri::command]
pub fn account_set_archived(state: State<VaultState>, id: String, archived: bool) -> AppResult<()> {
    locked(&state)?.write(|conn| db::set_account_archived(conn, &id, archived))
}

#[tauri::command]
pub fn account_delete(state: State<VaultState>, id: String) -> AppResult<()> {
    locked(&state)?.write(|conn| db::delete_account(conn, &id))
}

#[tauri::command]
pub fn category_save(state: State<VaultState>, id: Option<String>, input: CategoryInput) -> AppResult<String> {
    locked(&state)?.write(|conn| db::save_category(conn, id.as_deref(), &input))
}

#[tauri::command]
pub fn category_set_archived(state: State<VaultState>, id: String, archived: bool) -> AppResult<()> {
    locked(&state)?.write(|conn| db::set_category_archived(conn, &id, archived))
}

#[tauri::command]
pub fn transaction_save(state: State<VaultState>, id: Option<String>, input: TransactionInput) -> AppResult<String> {
    locked(&state)?.write(|conn| db::save_transaction(conn, id.as_deref(), &input))
}

#[tauri::command]
pub fn schedule_save(state: State<VaultState>, id: Option<String>, input: ScheduleInput) -> AppResult<String> {
    locked(&state)?.write(|conn| db::save_schedule(conn, id.as_deref(), &input))
}

#[tauri::command]
pub fn schedule_delete(state: State<VaultState>, id: String) -> AppResult<()> {
    locked(&state)?.write(|conn| db::delete_schedule(conn, &id))
}

/// Post the occurrences the engine found due, up to and including `through`.
#[tauri::command]
pub fn schedule_post_due(state: State<VaultState>, due: Vec<DueOccurrence>, through: String) -> AppResult<usize> {
    locked(&state)?.write(|conn| db::post_due(conn, &due, &through))
}

#[tauri::command]
pub fn goal_save(state: State<VaultState>, id: Option<String>, input: db::GoalInput) -> AppResult<String> {
    locked(&state)?.write(|conn| db::save_goal(conn, id.as_deref(), &input))
}

#[tauri::command]
pub fn goal_delete(state: State<VaultState>, id: String) -> AppResult<()> {
    locked(&state)?.write(|conn| db::delete_goal(conn, &id))
}

#[tauri::command]
pub fn transaction_delete(state: State<VaultState>, id: String) -> AppResult<()> {
    locked(&state)?.write(|conn| db::delete_transaction(conn, &id))
}

// ------------------------------------------------- files, backup, deletion

/// Save all transactions as CSV where the user chooses. Returns the file name, or null if cancelled.
#[tauri::command]
pub fn data_export_csv(state: State<VaultState>) -> AppResult<Option<String>> {
    let ledger = locked(&state)?.read(db::load_ledger)?;
    files::save_text("Export transactions", "vault-transactions.csv", ("CSV", &["csv"]), &files::transactions_csv(&ledger)?)
}

/// Save everything as readable JSON. The file is NOT encrypted; the interface warns before calling this.
#[tauri::command]
pub fn data_export_json(state: State<VaultState>) -> AppResult<Option<String>> {
    let ledger = locked(&state)?.read(db::load_ledger)?;
    let json = serde_json::to_string_pretty(&ledger).map_err(|e| AppError::Internal(e.to_string()))?;
    files::save_text("Export all data (not encrypted)", "vault-export.json", ("JSON", &["json"]), &json)
}

/// Let the user pick a CSV file and return its cells for preview. Nothing is imported yet.
#[tauri::command]
pub fn data_pick_csv(state: State<VaultState>) -> AppResult<Option<files::CsvFile>> {
    if !locked(&state)?.is_unlocked() {
        return Err(AppError::Locked);
    }
    match files::pick_bytes("Import transactions", ("CSV", &["csv", "txt"]))? {
        Some((name, bytes)) => files::parse_csv(name, &bytes).map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn transactions_import(state: State<VaultState>, inputs: Vec<TransactionInput>) -> AppResult<usize> {
    locked(&state)?.write(|conn| db::import_transactions(conn, &inputs))
}

/// Save an encrypted backup where the user chooses.
#[tauri::command]
pub fn backup_export(state: State<VaultState>) -> AppResult<Option<String>> {
    let image = locked(&state)?.backup_image()?;
    files::save_bytes("Save encrypted backup", "vault.vaultbackup", ("VAULT backup", &[files::BACKUP_EXTENSION]), &image)
}

/// Let the user pick a backup and replace the vault with it. `passphrase` is the backup's.
#[tauri::command]
pub fn backup_restore(state: State<VaultState>, passphrase: String) -> AppResult<Option<String>> {
    let passphrase = Zeroizing::new(passphrase);
    let Some((name, image)) = files::pick_bytes("Restore from backup", ("VAULT backup", &[files::BACKUP_EXTENSION]))? else {
        return Ok(None);
    };
    locked(&state)?.restore(&image, &passphrase)?;
    Ok(Some(name))
}

/// Permanently delete the vault. Requires the passphrase.
#[tauri::command]
pub fn vault_destroy(state: State<VaultState>, passphrase: String) -> AppResult<()> {
    let passphrase = Zeroizing::new(passphrase);
    locked(&state)?.destroy(&passphrase)
}

// ------------------------------------------------------- optional local AI

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    settings: ai::AiSettings,
    /// Models installed on the local server; null when no server is running.
    installed_models: Option<Vec<String>>,
}

#[tauri::command]
pub fn ai_status(state: State<VaultState>) -> AppResult<AiStatus> {
    let settings = locked(&state)?.read(ai::settings)?;
    // Only look for a local server once the user has turned the feature on.
    let installed_models = if settings.enabled { ai::installed_models(ai::LOCAL_ENDPOINT) } else { None };
    Ok(AiStatus { settings, installed_models })
}

#[tauri::command]
pub fn ai_configure(state: State<VaultState>, enabled: bool, model: String) -> AppResult<()> {
    locked(&state)?.write(|conn| ai::configure(conn, enabled, &model))
}

#[tauri::command]
pub fn ai_log(state: State<VaultState>) -> AppResult<Vec<ai::AiLogEntry>> {
    locked(&state)?.read(ai::log)
}

/// One round with the local model. Refused unless the user enabled it.
#[tauri::command]
pub fn ai_chat(state: State<VaultState>, messages: serde_json::Value, tools: serde_json::Value) -> AppResult<ai::ChatReply> {
    let settings = locked(&state)?.read(ai::settings)?;
    if !settings.enabled {
        return Err(AppError::invalid("The local model is turned off."));
    }
    // The vault lock is not held while waiting for the model.
    let outcome = ai::chat(ai::LOCAL_ENDPOINT, &settings.model, &messages, &tools);
    let sent = messages.to_string().len() + tools.to_string().len();
    let offered = tools.as_array().map_or(0, Vec::len);
    locked(&state)?.write(|conn| ai::record(conn, &settings.model, outcome.as_ref().map_or(sent, |(_, bytes)| *bytes), offered, outcome.is_ok()))?;
    outcome.map(|(reply, _)| reply)
}
