// The parts of Ember's core that differ on iPhone: keeping the API keys out
// of iCloud, the notes waiting in the shared inbox, and backup copies into
// the Files app.

use std::path::{Path, PathBuf};
use tauri::Manager;

// ---------- Keeping files out of iCloud ----------
//
// iOS backs the whole app container up to iCloud unless a file or folder is
// marked otherwise. Foundation's NSURLIsExcludedFromBackupKey sets the
// `com.apple.MobileBackup` extended attribute; setting that attribute from
// Rust does the same job without a Foundation binding.
//
// What must never leave the phone: the API keys, and install_id, which tells
// this install apart from the one a restored journal came from (src/install.ts).
// Also the staged and set-aside copies of the journal, which are scratch space.

/// Marks a file or folder "don't back this up". Best effort: a failure here
/// must never stop Ember from saving a key.
#[cfg(target_os = "ios")]
pub fn exclude_from_backup(path: &Path) {
    use std::ffi::CString;
    let Ok(c_path) = CString::new(path.as_os_str().as_encoded_bytes()) else {
        return;
    };
    let Ok(name) = CString::new("com.apple.MobileBackup") else {
        return;
    };
    let value: [u8; 1] = [1];
    // SAFETY: both strings are NUL-terminated and outlive the call, and the
    // value pointer covers exactly the length passed.
    unsafe {
        libc::setxattr(
            c_path.as_ptr(),
            name.as_ptr(),
            value.as_ptr() as *const libc::c_void,
            value.len(),
            0,
            0,
        );
    }
}

#[cfg(not(target_os = "ios"))]
pub fn exclude_from_backup(_path: &Path) {}

// ---------- Notes waiting in the inbox ----------
//
// A widget, a Control Center control and the share sheet are separate
// processes on iOS: no Rust, no webview, no way into ember.db. Anything they
// catch is appended as one JSON line to a file both they and Ember can reach,
// and Ember empties it whenever it opens or comes back to the screen. The
// same file catches a reply typed into a reminder while Ember wasn't running.
//
// The app-group folder is only reachable through Foundation, so the Swift
// side puts its path in EMBER_INBOX_PATH before Tauri starts (see
// BUILDING-ON-A-MAC.md). Without it, replies handled inside the app still
// work; they just use the app's own folder.

const INBOX_FILE: &str = "inbox.jsonl";
const INBOX_DRAINING: &str = "inbox-draining.jsonl";

fn inbox_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(shared) = std::env::var("EMBER_INBOX_PATH") {
        if !shared.is_empty() {
            return Ok(PathBuf::from(shared));
        }
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not find the app's data folder: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create the app's data folder: {e}"))?;
    Ok(dir.join(INBOX_FILE))
}

/// Takes everything waiting and empties the inbox, as one JSON string per
/// line. The file is moved aside first, so a note written while Ember reads
/// it is kept for the next round instead of being lost.
#[tauri::command]
pub fn inbox_drain(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let inbox = inbox_path(&app)?;
    let draining = inbox.with_file_name(INBOX_DRAINING);

    let mut lines: Vec<String> = Vec::new();
    // Twice: a round that was interrupted last time left its file behind, and
    // that one is older, so it is read before this round's.
    for _ in 0..2 {
        if draining.exists() {
            match std::fs::read_to_string(&draining) {
                Ok(text) => {
                    lines.extend(
                        text.lines()
                            .map(str::trim)
                            .filter(|l| !l.is_empty())
                            .map(str::to_owned),
                    );
                    let _ = std::fs::remove_file(&draining);
                }
                // Unreadable: drop it rather than retrying it forever.
                Err(_) => {
                    let _ = std::fs::remove_file(&draining);
                }
            }
        }
        if !inbox.exists() {
            break;
        }
        if std::fs::rename(&inbox, &draining).is_err() {
            break;
        }
    }
    Ok(lines)
}

/// Adds one line to the inbox. Used by the Swift notification handler, and by
/// the app itself when a reply arrives with no database open yet.
#[tauri::command]
pub fn inbox_append(app: tauri::AppHandle, line: String) -> Result<(), String> {
    use std::io::Write;
    if line.trim().is_empty() {
        return Ok(());
    }
    let path = inbox_path(&app)?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Could not open the inbox: {e}"))?;
    writeln!(file, "{}", line.replace('\n', " ")).map_err(|e| format!("Could not write the note: {e}"))
}

// ---------- Backup copies ----------
//
// Android put the copy in Documents/Ember through MediaStore. iOS has no
// shared Documents folder: the app's own Documents folder is what the Files
// app shows, because Info.plist sets UIFileSharingEnabled (see
// BUILDING-ON-A-MAC.md). So "Ember backup.db" simply lives there.

const BACKUP_NAME: &str = "Ember backup.db";

fn documents_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| format!("Could not find the Files folder: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create the Files folder: {e}"))?;
    Ok(dir)
}

fn snapshot_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Could not find the app's cache folder: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create the app's cache folder: {e}"))?;
    Ok(dir.join("ember-backup-snapshot.db"))
}

/// An empty path for VACUUM INTO, which refuses to write over a file. Any
/// leftover from an interrupted backup is cleared away first.
#[tauri::command]
pub fn backup_snapshot_path(app: tauri::AppHandle) -> Result<String, String> {
    let path = snapshot_file(&app)?;
    let _ = std::fs::remove_file(&path);
    path.into_os_string()
        .into_string()
        .map_err(|_| "That folder's name can't be written down.".to_string())
}

/// Moves the snapshot into the Files app, over any copy already there.
/// Returns "" on success, or what went wrong.
#[tauri::command]
pub fn backup_save_copy(app: tauri::AppHandle) -> String {
    let snapshot = match snapshot_file(&app) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !snapshot.exists() {
        return "There was no copy to save.".into();
    }
    let dir = match documents_dir(&app) {
        Ok(d) => d,
        Err(e) => return e,
    };
    let target = dir.join(BACKUP_NAME);
    // Rename first: within one device it is a move, so the file is never
    // half-written where the Files app can show it.
    match std::fs::rename(&snapshot, &target) {
        Ok(()) => String::new(),
        Err(_) => match std::fs::copy(&snapshot, &target) {
            Ok(_) => {
                let _ = std::fs::remove_file(&snapshot);
                String::new()
            }
            Err(e) => format!("Could not save the copy: {e}"),
        },
    }
}
