// Web edition: a picked backup waits here, in memory, between "pick" and
// "restore" — the browser's version of the file the phone copies aside.

const staged = new Map<string, Uint8Array>();
export const STAGED_NAME = "sqlite:ember-restore-candidate.db";

export function stage(bytes: Uint8Array): void {
  staged.set(STAGED_NAME, bytes);
}

/** Reads without removing: the summary opens it, then restore needs it again. */
export function takeStaged(name: string): Uint8Array | null {
  return staged.get(name) ?? null;
}

export function dropStaged(): void {
  staged.delete(STAGED_NAME);
}
