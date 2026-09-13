/** window.EmberAndroid, added by MainActivity.kt (QuickNote.kt EmberBridge).
 *  Absent in the desktop dev window, so every caller must handle undefined. */
interface EmberAndroid {
  isQuickNoteEnabled(): boolean;
  setQuickNoteEnabled(enabled: boolean): void;
  refreshQuickNote(): void;
}

export function androidBridge(): EmberAndroid | undefined {
  return (window as unknown as { EmberAndroid?: EmberAndroid }).EmberAndroid;
}
