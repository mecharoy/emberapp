// Ember for Android: database migrations, plugins, and a private file store
// for API keys.

use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: include_str!("../migrations/0001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add entries.title",
            sql: include_str!("../migrations/0002_add_entry_title.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "indexes for captures and messages",
            sql: include_str!("../migrations/0003_indexes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "task reminders",
            sql: include_str!("../migrations/0004_reminders.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "capture external_id for mobile inbox sync",
            sql: include_str!("../migrations/0005_capture_external_id.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "user reference documents",
            sql: include_str!("../migrations/0006_documents.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "check-ins, habit prefs, review sources, monthly reports",
            sql: include_str!("../migrations/0007_checkins_reviews.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "questionnaires, sleep diary, monthly formulation, memory summaries",
            sql: include_str!("../migrations/0008_wellbeing_memory.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "paper colour per journal entry",
            sql: include_str!("../migrations/0009_entry_paper.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

// ---------- API keys ----------
//
// Android has no keychain the `keyring` crate can reach, so each key is a file
// in the app's private data directory (/data/data/<package>/secrets/). Android
// gives every app its own Linux user, so no other app can read it. The backup
// rules in res/xml only take ember.db, so keys never leave the phone that way
// either, and they never go into ember.db.

/// Only whitelisted names — the webview can't use this as a general file store.
fn secret_path(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    if !matches!(name, "anthropic_api_key" | "cloud_api_key") {
        return Err(format!("Unknown secret name: {name}"));
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not find the app's data folder: {e}"))?
        .join("secrets");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create the key folder: {e}"))?;
    Ok(dir.join(name))
}

#[tauri::command]
fn secret_get(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let path = secret_path(&app, &name)?;
    match std::fs::read_to_string(&path) {
        Ok(v) if !v.is_empty() => Ok(Some(v)),
        Ok(_) => Ok(None),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_set(app: tauri::AppHandle, name: String, value: String) -> Result<(), String> {
    let path = secret_path(&app, &name)?;
    if value.is_empty() {
        return match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    std::fs::write(&path, value).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

// ---------- Restoring a backup ----------

/// Puts a backup in place of ember.db. The webview closes its connection
/// first and restarts the app afterwards, so migrations run on the restored
/// file. The replaced files are kept next to it as *.before-restore.
#[tauri::command]
fn backup_restore(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the backup file's bytes.".into());
    };
    if !bytes.starts_with(b"SQLite format 3\x00") {
        return Err("That file isn't an Ember backup.".into());
    }
    if !bytes.windows(20).any(|w| w == b"CREATE TABLE entries") {
        return Err("That database has no journal in it.".into());
    }
    // tauri-plugin-sql opens sqlite:ember.db in the app config dir.
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Could not find the app's data folder: {e}"))?;
    let db = dir.join("ember.db");
    let incoming = dir.join("ember.db.restoring");
    std::fs::write(&incoming, bytes).map_err(|e| format!("Could not write the backup: {e}"))?;
    for suffix in ["", "-wal", "-shm"] {
        let file = dir.join(format!("ember.db{suffix}"));
        if file.exists() {
            std::fs::rename(&file, dir.join(format!("ember.db{suffix}.before-restore")))
                .map_err(|e| format!("Could not set the current journal aside: {e}"))?;
        }
    }
    std::fs::rename(&incoming, &db).map_err(|e| format!("Could not put the backup in place: {e}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:ember.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![secret_get, secret_set, backup_restore])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
