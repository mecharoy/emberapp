// The evening check-in form (migration 0007): mood, energy, sleep, a feeling
// word, what's on their mind, pinned habits and (0010) lunch, evening break
// and dinner, (0013) what they did between those — filled in before the
// conversation starts. Their own ratings, so they beat anything inferred.

import { getDb } from "./client";
import type { CheckIn } from "./types";
import { localStamp } from "../time";

export interface CheckInInput {
  date: string;
  mood: number | null;
  energy: number | null;
  sleepHours: number | null;
  feeling: string | null;
  onMind: string | null;
  habits: Record<string, boolean>;
  /** Sleep diary (migration 0008): the night before `date`. */
  bedtime?: string | null;
  wakeTime?: string | null;
  sleepLatencyMin?: number | null;
  sleepQuality?: number | null;
  /** Where the day splits (migration 0010): "HH:MM", "not-yet" or "skipped". */
  lunch?: string | null;
  eveningBreak?: string | null;
  dinner?: string | null;
  /** What they did in each stretch of the day (migration 0013). */
  dayNotes?: Record<string, string> | null;
}

export async function getCheckIn(date: string): Promise<CheckIn | null> {
  const db = await getDb();
  const rows = await db.select<CheckIn[]>("SELECT * FROM checkins WHERE date = $1", [date]);
  return rows[0] ?? null;
}

export async function listCheckIns(): Promise<CheckIn[]> {
  const db = await getDb();
  return db.select<CheckIn[]>("SELECT * FROM checkins ORDER BY date ASC");
}

/** One per day; saving again replaces the day's answers. */
export async function saveCheckIn(input: CheckInInput): Promise<void> {
  const db = await getDb();
  const now = localStamp();
  await db.execute(
    `INSERT INTO checkins (date, mood, energy, sleep_hours, feeling, on_mind, habits, created_at, updated_at,
                           bedtime, wake_time, sleep_latency_min, sleep_quality, lunch, evening_break, dinner, day_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT(date) DO UPDATE SET
       mood = excluded.mood,
       energy = excluded.energy,
       sleep_hours = excluded.sleep_hours,
       feeling = excluded.feeling,
       on_mind = excluded.on_mind,
       habits = excluded.habits,
       updated_at = excluded.updated_at,
       bedtime = excluded.bedtime,
       wake_time = excluded.wake_time,
       sleep_latency_min = excluded.sleep_latency_min,
       sleep_quality = excluded.sleep_quality,
       lunch = excluded.lunch,
       evening_break = excluded.evening_break,
       dinner = excluded.dinner,
       day_notes = excluded.day_notes`,
    [
      input.date,
      input.mood,
      input.energy,
      input.sleepHours,
      input.feeling,
      input.onMind,
      JSON.stringify(input.habits),
      now,
      now,
      input.bedtime ?? null,
      input.wakeTime ?? null,
      input.sleepLatencyMin ?? null,
      input.sleepQuality ?? null,
      input.lunch ?? null,
      input.eveningBreak ?? null,
      input.dinner ?? null,
      input.dayNotes && Object.keys(input.dayNotes).length > 0 ? JSON.stringify(input.dayNotes) : null,
    ],
  );
}

/** The three points of the day the reminders ask about, and the stretch of
 *  the day each one closes. */
export const DAY_POINTS = [
  { id: "lunch", column: "lunch", stretch: "morning" },
  { id: "break", column: "evening_break", stretch: "afternoon" },
  { id: "dinner", column: "dinner", stretch: "evening" },
] as const;

export type DayPointId = (typeof DAY_POINTS)[number]["id"];

export function dayPoint(id: string): (typeof DAY_POINTS)[number] | undefined {
  return DAY_POINTS.find((p) => p.id === id);
}

/** Whether that day already has an answer for this point, so its reminder can
 *  be left out. "not-yet" counts as unanswered. */
export function isDayPointAnswered(checkIn: CheckIn | null, id: DayPointId): boolean {
  const point = dayPoint(id);
  if (!checkIn || !point) return false;
  const value = (checkIn as unknown as Record<string, string | null>)[point.column];
  return Boolean(value) && value !== "not-yet";
}

/**
 * Writes one answer from a day reminder into that day's check-in: the time it
 * was answered (or "skipped"), unless something is already there, and what
 * they say they did in the stretch before it, added after anything already
 * written for that stretch. Everything else on the check-in is left alone —
 * this runs while the form itself may be half-filled.
 */
export async function recordDayPoint(
  date: string,
  id: DayPointId,
  text: string | null,
  skipped: boolean,
  at: Date = new Date(),
): Promise<void> {
  const point = dayPoint(id);
  if (!point) return;
  const db = await getDb();
  const now = localStamp(at);
  const value = skipped ? "skipped" : now.slice(11, 16);
  const trimmed = (text ?? "").trim();

  const existing = await getCheckIn(date);
  let notes: Record<string, string> = {};
  if (existing?.day_notes) {
    try {
      const parsed = JSON.parse(existing.day_notes);
      if (parsed && typeof parsed === "object") notes = parsed as Record<string, string>;
    } catch {
      // Unreadable notes are replaced rather than losing the new line.
    }
  }
  if (trimmed) {
    const before = (notes[point.stretch] ?? "").trim();
    notes[point.stretch] = before ? `${before}\n${trimmed}` : trimmed;
  }
  const notesJson = Object.keys(notes).length === 0 ? null : JSON.stringify(notes);

  if (existing) {
    await db.execute(
      `UPDATE checkins
          SET day_notes = COALESCE($1, day_notes),
              ${point.column} = CASE
                WHEN ${point.column} IS NULL OR ${point.column} = '' OR ${point.column} = 'not-yet'
                THEN $2 ELSE ${point.column} END,
              updated_at = $3
        WHERE date = $4`,
      [notesJson, value, now, date],
    );
  } else {
    await db.execute(
      `INSERT INTO checkins (date, habits, created_at, updated_at, ${point.column}, day_notes)
       VALUES ($1, '{}', $2, $2, $3, $4)`,
      [date, now, value, notesJson],
    );
  }
}
