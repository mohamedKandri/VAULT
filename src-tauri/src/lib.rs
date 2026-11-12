//! VAULT backend.
//!
//! The Rust side owns everything that touches the disk or the network:
//! the encrypted database, the application lock, backup/restore and the
//! optional AI gateway. The webview never gets filesystem or network access;
//! it can only call the commands registered here.
//!
//! No commands exist yet - storage lands in Phase 3 (see docs/ARCHITECTURE.md).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running VAULT");
}
