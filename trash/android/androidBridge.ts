/** window.EmberAndroid, added by MainActivity.kt (QuickNote.kt EmberBridge).
 *  Absent in the desktop dev window, so every caller must handle undefined. */
interface EmberAndroid {
  isQuickNoteEnabled(): boolean;
  setQuickNoteEnabled(enabled: boolean): void;
  refreshQuickNote(): void;
  /** Reminders at the usual lunch, break and dinner times, answered in the
   *  notification (DayReminders.kt). JSON {enabled, lunch, break, dinner}. */
  setDayReminders?(config: string): void;
  /** Android 10+: copies can go to Documents/Ember without a permission. */
  backupCopySupported(): boolean;
  /** Empty file path in the app cache for VACUUM INTO. */
  backupSnapshotPath(): string;
  /** Moves the snapshot to Documents/Ember. "" on success, else the problem. */
  saveBackupCopy(): string;
  /** Closes Ember and starts it again. */
  restartApp(): void;
  /** Opens the file picker in Documents/Ember and copies the pick next to
   *  ember.db. Answers through window.__emberBackupPicked (see backup.ts). */
  pickBackup(): void;
}

export function androidBridge(): EmberAndroid | undefined {
  return (window as unknown as { EmberAndroid?: EmberAndroid }).EmberAndroid;
}
