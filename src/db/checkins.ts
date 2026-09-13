// The evening check-in form (migration 0007): mood, energy, sleep, a feeling
// word, what's on their mind, and pinned habits — filled in before the
// conversation starts. Their own ratings, so they beat anything inferred.

import { getDb } from "./client";
import type { CheckIn } from "./types";

/** ISO 8601 local, same shape review.ts uses. */
function localStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

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
                           bedtime, wake_time, sleep_latency_min, sleep_quality)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
       sleep_quality = excluded.sleep_quality`,
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
    ],
  );
}
