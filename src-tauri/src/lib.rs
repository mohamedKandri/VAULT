//! VAULT backend.
//!
//! The Rust side owns everything that touches the disk: the encrypted
//! database and the application lock. The webview has no filesystem or
//! network access; it can only call the commands registered here.
//!
//!   crypto    Argon2id key derivation, XChaCha20-Poly1305 sealing
//!   vault     in-memory SQLite, sealed to one file; lock / unlock
//!   db        schema, migrations, validated queries
//!   commands  the IPC surface

mod commands;
mod crypto;
mod db;
mod error;
mod vault;

use std::sync::Mutex;

use tauri::Manager;

const VAULT_FILE: &str = "vault.db.enc";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Development builds can point at a throwaway folder so testing
            // never touches the real vault. Ignored in release builds.
            let dir = match std::env::var_os("VAULT_DATA_DIR") {
                Some(dir) if cfg!(debug_assertions) => std::path::PathBuf::from(dir),
                _ => app.path().app_data_dir()?,
            };
            app.manage(Mutex::new(vault::Vault::new(dir.join(VAULT_FILE))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_status,
            commands::vault_create,
            commands::vault_unlock,
            commands::vault_lock,
            commands::vault_change_passphrase,
            commands::ledger_load,
            commands::account_save,
            commands::account_set_archived,
            commands::account_delete,
            commands::category_save,
            commands::category_set_archived,
            commands::transaction_save,
            commands::transaction_delete,
            commands::schedule_save,
            commands::schedule_delete,
            commands::schedule_post_due,
            commands::goal_save,
            commands::goal_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VAULT");
}
