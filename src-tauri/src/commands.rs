//! The only surface the webview can call. Each command is a thin wrapper:
//! take the vault lock, delegate to `vault` / `db`, return typed data.
//! The webview cannot send SQL, read files or reach the network.

use std::sync::Mutex;

use serde::Serialize;
use tauri::State;
use zeroize::Zeroizing;

use crate::db::{self, AccountInput, CategoryInput, DueOccurrence, Ledger, ScheduleInput, TransactionInput};
use crate::error::{AppError, AppResult};
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
