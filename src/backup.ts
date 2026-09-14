import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { androidBridge } from "./androidBridge";
import { closeDb } from "./db/client";
import { hasJournalData, snapshotDatabase } from "./db/backup";
import { getSetting, setSetting } from "./db/settings";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Backups to Documents/Ember work on this phone. */
export function backupCopySupported(): boolean {
  return androidBridge()?.backupCopySupported() ?? false;
}

/** Writes Documents/Ember/Ember backup.db now. Throws with a readable message. */
export async function backupNow(): Promise<void> {
  const bridge = androidBridge();
  if (!bridge?.backupCopySupported()) throw new Error("Backup copies need Android 10 or newer.");
  await snapshotDatabase(bridge.backupSnapshotPath());
  const problem = bridge.saveBackupCopy();
  if (problem) throw new Error(problem);
  await setSetting("backup_last_at", new Date().toISOString());
}

/** Once a day, when Ember opens: refresh the copy if it's switched on and
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

/** Asks for a backup file, puts it in place of the current journal and
 *  restarts Ember. Returns false if nothing was picked; throws on a bad file. */
export async function restoreFromFile(): Promise<boolean> {
  const picked = await open({ multiple: false, directory: false, title: "Pick your Ember backup" });
  if (!picked) return false;
  const bytes = await readFile(picked);
  const header = new TextDecoder().decode(bytes.slice(0, 15));
  if (header !== "SQLite format 3") throw new Error("That file isn't an Ember backup. Look for \"Ember backup.db\" in Documents/Ember.");
  await closeDb();
  try {
    await invoke("backup_restore", bytes);
  } catch (e) {
    // The old journal is still in place; reopen it.
    window.location.reload();
    throw new Error(String(e));
  }
  const bridge = androidBridge();
  if (bridge) bridge.restartApp();
  else window.location.reload();
  return true;
}
