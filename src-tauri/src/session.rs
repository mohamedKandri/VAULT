//! Lock the vault when Windows locks the session or the computer goes to sleep.
//!
//! A hidden, never-shown window on its own thread registers for session
//! notifications (WTSRegisterSessionNotification) and receives the power
//! broadcast sent before sleep. On either, the vault is locked in Rust - the
//! key and decrypted data are dropped - and the interface is told so it can
//! clear its copy and show the lock screen. This works even if the
//! interface is frozen, because the decision is made here.

use std::sync::OnceLock;

use tauri::{AppHandle, Emitter, Manager};

use crate::commands::VaultState;

/// Event sent to the interface after the vault was locked by the system.
pub const LOCKED_EVENT: &str = "vault-locked";
/// Class name of the hidden window (also used by tests to find it).
pub const WINDOW_CLASS: &str = "VaultSessionWatcher";

static APP: OnceLock<AppHandle> = OnceLock::new();

/// Lock the vault if it is open, and tell the interface why.
fn lock_now(reason: &'static str) {
    let Some(app) = APP.get() else { return };
    let state = app.state::<VaultState>();
    let was_unlocked = match state.lock() {
        Ok(mut vault) if vault.is_unlocked() => {
            vault.lock();
            true
        }
        _ => false,
    };
    if was_unlocked {
        let _ = app.emit(LOCKED_EVENT, reason);
    }
}

#[cfg(windows)]
pub fn watch(app: AppHandle) {
    if APP.set(app).is_ok() {
        std::thread::Builder::new()
            .name("session-watcher".into())
            .spawn(|| unsafe { windows::run() })
            .expect("could not start the session watcher");
    }
}

#[cfg(not(windows))]
pub fn watch(app: AppHandle) {
    let _ = APP.set(app);
}

#[cfg(windows)]
mod windows {
    use std::ptr::null;

    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::RemoteDesktop::{NOTIFY_FOR_THIS_SESSION, WTSRegisterSessionNotification};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CW_USEDEFAULT, CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, MSG, PBT_APMSUSPEND, RegisterClassW,
        TranslateMessage, WM_POWERBROADCAST, WM_WTSSESSION_CHANGE, WNDCLASSW, WS_EX_TOOLWINDOW, WS_OVERLAPPED, WTS_SESSION_LOCK,
    };

    use super::{WINDOW_CLASS, lock_now};

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match msg {
            WM_WTSSESSION_CHANGE if wparam as u32 == WTS_SESSION_LOCK => lock_now("windows-locked"),
            WM_POWERBROADCAST if wparam as u32 == PBT_APMSUSPEND => lock_now("sleep"),
            _ => {}
        }
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    }

    /// Create the hidden window and pump its messages for the life of the app.
    pub unsafe fn run() {
        unsafe {
            let class = wide(WINDOW_CLASS);
            let instance = GetModuleHandleW(null());
            let mut wc: WNDCLASSW = std::mem::zeroed();
            wc.lpfnWndProc = Some(window_proc);
            wc.hInstance = instance;
            wc.lpszClassName = class.as_ptr();
            if RegisterClassW(&wc) == 0 {
                return;
            }
            // A normal top-level window that is never shown: unlike a message-only
            // window it also receives the power broadcast sent before sleep.
            let hwnd = CreateWindowExW(
                WS_EX_TOOLWINDOW,
                class.as_ptr(),
                class.as_ptr(),
                WS_OVERLAPPED,
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                0,
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                instance,
                null(),
            );
            if hwnd.is_null() {
                return;
            }
            WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
}
