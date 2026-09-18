// The iPhone side of Ember, reached through Tauri commands (src-tauri/src/
// ios_extras.rs). The Android edition had window.EmberAndroid, a set of
// methods a Kotlin class added to the webview; WKWebView has no way to answer
// JavaScript straight away, so every one of these is a promise instead.

import { invoke } from "@tauri-apps/api/core";

/** Backup copies always work: every iPhone has the Files app. */
export function backupCopySupported(): boolean {
  return true;
}

/** An empty file path for VACUUM INTO. */
export function backupSnapshotPath(): Promise<string> {
  return invoke<string>("backup_snapshot_path");
}

/** Moves the snapshot into Ember's folder in the Files app.
 *  Answers "" on success, otherwise what went wrong. */
export function saveBackupCopy(): Promise<string> {
  return invoke<string>("backup_save_copy");
}

/** Everything left waiting outside the app: notes from the widget, the share
 *  sheet, or a reminder answered while Ember wasn't running. Reading empties
 *  the inbox, so each line is handed over exactly once. */
export function drainInbox(): Promise<string[]> {
  return invoke<string[]>("inbox_drain");
}

/** Puts one line back in the inbox, for a note that couldn't be saved yet. */
export function appendInbox(line: string): Promise<void> {
  return invoke("inbox_append", { line });
}
