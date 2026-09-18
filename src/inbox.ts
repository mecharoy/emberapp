// Notes that were written while Ember wasn't on screen.
//
// On iPhone a widget, a Control Center button and the share sheet are separate
// programs: they can't open the journal. Nor can a reminder that is answered
// while Ember isn't running. So each of them writes one line of JSON to a
// shared file (src-tauri/src/ios_extras.rs), and Ember empties that file every
// time it opens or comes back to the screen.
//
// Reading the file empties it, so a line that can't be saved is put back
// rather than lost.

import { emit } from "@tauri-apps/api/event";
import { z } from "zod";
import { createCaptureAt } from "./db/captures";
import { recordDayPoint, type DayPointId } from "./db/checkins";
import { appendInbox, drainInbox } from "./nativeBridge";
import { isoNowLocal } from "./time";

/** `2026-09-19T13:04:22.511+05:30`, the shape every capture's time has. */
const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

const noteLine = z.object({
  v: z.literal(1),
  kind: z.literal("note"),
  at: localTime,
  text: z.string().min(1),
});

const dayLine = z.object({
  v: z.literal(1),
  kind: z.literal("day"),
  at: localTime,
  point: z.enum(["lunch", "break", "dinner"]),
  text: z.string().default(""),
  skipped: z.boolean().default(false),
});

/** The widget, the Control Centre button and the Shortcuts action all just
 *  ask for the note sheet; iOS opens Ember and this line says why. */
const openLine = z.object({
  v: z.literal(1),
  kind: z.literal("open"),
  at: localTime,
});

export const inboxLine = z.discriminatedUnion("kind", [noteLine, dayLine, openLine]);
export type InboxLine = z.infer<typeof inboxLine>;

/** Reads one line. Anything malformed is dropped: a line Ember can't
 *  understand would otherwise sit in the inbox failing forever. */
export function parseInboxLine(raw: string): InboxLine | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = inboxLine.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** What one line changes, so the open pages know what to read again. */
export type InboxEffect = "captures" | "checkins" | "open-note";

/** Saves one line. Throws if the database is unreachable, so the caller can
 *  put the line back. */
export async function applyInboxLine(line: InboxLine): Promise<InboxEffect> {
  if (line.kind === "open") return "open-note";
  if (line.kind === "note") {
    await createCaptureAt(line.at, line.text.trim());
    return "captures";
  }
  const date = line.at.slice(0, 10);
  await recordDayPoint(date, line.point as DayPointId, line.text, line.skipped, new Date(line.at));
  return "checkins";
}

/** Writes one note into the inbox, for the app's own use when the database
 *  isn't open yet. */
export function inboxNote(text: string, at: string = isoNowLocal()): string {
  return JSON.stringify({ v: 1, kind: "note", at, text });
}

export function inboxDayAnswer(point: DayPointId, text: string, skipped = false, at: string = isoNowLocal()): string {
  return JSON.stringify({ v: 1, kind: "day", at, point, text, skipped });
}

export function inboxOpenNote(at: string = isoNowLocal()): string {
  return JSON.stringify({ v: 1, kind: "open", at });
}

let draining: Promise<void> | null = null;

/**
 * Empties the inbox into the journal and tells the open pages what changed.
 * Safe to call as often as needed: overlapping calls share one round.
 */
export function drainInboxIntoJournal(): Promise<void> {
  if (!draining) {
    draining = runDrain().finally(() => {
      draining = null;
    });
  }
  return draining;
}

async function runDrain(): Promise<void> {
  let lines: string[];
  try {
    lines = await drainInbox();
  } catch {
    // No inbox yet (a fresh install, or the desktop dev window).
    return;
  }
  if (lines.length === 0) return;

  const effects = new Set<InboxEffect>();
  for (const raw of lines) {
    const line = parseInboxLine(raw);
    if (!line) continue;
    try {
      effects.add(await applyInboxLine(line));
    } catch {
      // The journal isn't ready (mid-restore, say). Keep the note for later.
      await appendInbox(raw).catch(() => {});
    }
  }
  if (effects.has("captures")) await emit("captures:updated");
  if (effects.has("checkins")) await emit("checkin:updated");
  // Last, so the sheet opens over a Today tab that already shows the note
  // that came with it.
  if (effects.has("open-note")) await emit("note:open");
}
