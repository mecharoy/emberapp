import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { backupCopySupported as nativeCopySupported, backupSnapshotPath, saveBackupCopy } from "./nativeBridge";
import { closeDb } from "./db/client";
import { noteJournalRestore } from "./lan/syncEvents";
import { hasJournalData, readStagedBackup, snapshotDatabase, type BackupSummary } from "./db/backup";
import { getSetting, setSetting } from "./db/settings";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where the copy lands, in the words the Files app uses. */
export const BACKUP_LOCATION = "Files › On My iPhone › Ember";

/** Backup copies always work on iPhone: every one has the Files app. */
export function backupCopySupported(): boolean {
  return nativeCopySupported();
}

/** Writes "Ember backup.db" into Ember's folder in the Files app now.
 *  Throws with a readable message. */
export async function backupNow(): Promise<void> {
  const path = await backupSnapshotPath();
  await snapshotDatabase(path);
  const problem = await saveBackupCopy();
  if (problem) throw new Error(problem);
  await setSetting("backup_last_at", new Date().toISOString());
}

/** Once a day, when Ember opens: refresh the copy if it's switched on and
 *  there is something to keep. Failures wait for the next day. */
export async function backupIfDue(): Promise<void> {
  try {
    if ((await getSetting("backup_copy")) !== "1") return;
    const last = Date.parse(await getSetting("backup_last_at"));
    if (!Number.isNaN(last) && Date.now() - last < DAY_MS) return;
    if (!(await hasJournalData())) return;
    await backupNow();
  } catch {
    // A missed backup shouldn't interrupt anything.
  }
}

/**
 * Asks for a backup file, copies it aside and says what's in it. Nothing is
 * replaced yet. Returns null if nothing was picked; throws on a bad file.
 *
 * iOS answers the picker with a `file://` URI, which the fs plugin reads like
 * any other path.
 */
export async function pickBackup(): Promise<BackupSummary | null> {
  const picked = await open({ multiple: false, directory: false, title: "Pick your Ember backup" });
  if (!picked) return null;
  const bytes = await readFile(picked);
  try {
    await invoke("backup_stage", bytes);
  } catch (e) {
    throw new Error(String(e));
  }
  return readStagedBackup();
}

/**
 * Puts the picked backup in place of the current journal.
 *
 * iOS apps may not close and open themselves, so unlike the Android edition
 * this simply returns: the caller asks the user to close Ember and open it
 * again, which is when the migrations run on the restored file.
 */
export async function restorePickedBackup(): Promise<void> {
  noteJournalRestore();
  await closeDb();
  try {
    await invoke("backup_restore");
  } catch (e) {
    // The old journal is still in place; reopen it.
    window.location.reload();
    throw new Error(String(e));
  }
}
