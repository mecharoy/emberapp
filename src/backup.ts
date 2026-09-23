import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { androidBridge } from "./androidBridge";
import { closeDb } from "./db/client";
import { noteJournalRestore } from "./lan/syncEvents";
import { hasJournalData, readStagedBackup, snapshotDatabase, type BackupSummary } from "./db/backup";
import { getSetting, setSetting } from "./db/settings";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Backups to Documents/Elytra work on this phone. */
export function backupCopySupported(): boolean {
  return androidBridge()?.backupCopySupported() ?? false;
}

/** Writes Documents/Elytra/Elytra backup.db now. Throws with a readable message. */
export async function backupNow(): Promise<void> {
  const bridge = androidBridge();
  if (!bridge?.backupCopySupported()) throw new Error("Backup copies need Android 10 or newer.");
  await snapshotDatabase(bridge.backupSnapshotPath());
  const problem = bridge.saveBackupCopy();
  if (problem) throw new Error(problem);
  await setSetting("backup_last_at", new Date().toISOString());
}

/** Once a day, when Elytra opens: refresh the copy if it's switched on and
 *  there is something to keep. Failures wait for the next day. */
export async function backupIfDue(): Promise<void> {
  try {
    if (!backupCopySupported()) return;
    if ((await getSetting("backup_copy")) !== "1") return;
    const last = Date.parse(await getSetting("backup_last_at"));
    if (!Number.isNaN(last) && Date.now() - last < DAY_MS) return;
    if (!(await hasJournalData())) return;
    await backupNow();
  } catch {
    // A missed backup shouldn't interrupt anything.
  }
}

/** On Android the picker opens in Documents/Elytra and MainActivity copies the
 *  file aside, answering through window.__emberBackupPicked. */
function pickOnAndroid(bridge: NonNullable<ReturnType<typeof androidBridge>>): Promise<string> {
  const w = window as unknown as { __emberBackupPicked?: (result: string) => void };
  return new Promise((resolve) => {
    w.__emberBackupPicked = (result) => {
      delete w.__emberBackupPicked;
      resolve(result);
    };
    bridge.pickBackup();
  });
}

/** Asks for a backup file, copies it aside and says what's in it. Nothing is
 *  replaced yet. Returns null if nothing was picked; throws on a bad file. */
export async function pickBackup(): Promise<BackupSummary | null> {
  const bridge = androidBridge();
  if (bridge) {
    const result = await pickOnAndroid(bridge);
    if (result === "cancel") return null;
    if (result) throw new Error(result);
  } else {
    const picked = await open({ multiple: false, directory: false, title: "Pick your Elytra backup" });
    if (!picked) return null;
    const bytes = await readFile(picked);
    try {
      await invoke("backup_stage", bytes);
    } catch (e) {
      throw new Error(String(e));
    }
  }
  return readStagedBackup();
}

/** Puts the picked backup in place of the current journal and restarts Elytra. */
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
  const bridge = androidBridge();
  if (bridge) bridge.restartApp();
  else window.location.reload();
}
