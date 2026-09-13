// The evening check-in (db/checkins.ts) in the one shape the counselor,
// the journal writer and the extractor all read. Pure — unit-tested in
// checkin.test.ts.

import type { CheckIn } from "../db/types";

export interface CheckInSummary {
  mood: number | null;
  energy: number | null;
  sleepHours: number | null;
  feeling: string | null;
  onMind: string | null;
  habits: Record<string, boolean>; // pinned habit key → done today
  /** Sleep diary, the night before — each null when left blank. */
  bedtime: string | null;
  wakeTime: string | null;
  sleepLatencyMin: number | null;
  sleepQuality: number | null;
}

export function isEmptyCheckIn(c: CheckInSummary): boolean {
  return (
    c.mood === null &&
    c.energy === null &&
    c.sleepHours === null &&
    !c.feeling &&
    !c.onMind &&
    Object.keys(c.habits).length === 0 &&
    !c.bedtime &&
    !c.wakeTime &&
    c.sleepLatencyMin === null &&
    c.sleepQuality === null
  );
}

/** Row → summary. A row with nothing filled in counts as no check-in. */
export function toCheckInSummary(row: CheckIn | null): CheckInSummary | null {
  if (!row) return null;
  const habits: Record<string, boolean> = {};
  try {
    const parsed: unknown = JSON.parse(row.habits || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "boolean" && k.trim()) habits[k.trim()] = v;
      }
    }
  } catch {
    // unreadable habits JSON — keep the rest of the check-in
  }
  const summary: CheckInSummary = {
    mood: row.mood,
    energy: row.energy,
    sleepHours: row.sleep_hours,
    feeling: row.feeling?.trim() || null,
    onMind: row.on_mind?.trim() || null,
    habits,
    bedtime: row.bedtime || null,
    wakeTime: row.wake_time || null,
    sleepLatencyMin: row.sleep_latency_min ?? null,
    sleepQuality: row.sleep_quality ?? null,
  };
  return isEmptyCheckIn(summary) ? null : summary;
}

/** The check-in as prompt lines. Their own words are quoted so the model
 * can't mistake them for its own reading of the day. */
export function formatCheckInForPrompt(c: CheckInSummary | null): string {
  if (!c) return "(not filled in today)";
  const lines: string[] = [];
  if (c.mood !== null) lines.push(`- mood: ${c.mood}/10`);
  if (c.energy !== null) lines.push(`- energy: ${c.energy}/10`);
  if (c.sleepHours !== null) lines.push(`- slept last night: ${c.sleepHours}h`);
  if (c.bedtime || c.wakeTime) {
    lines.push(`- in bed ${c.bedtime ?? "?"}, up ${c.wakeTime ?? "?"}`);
  }
  if (c.sleepLatencyMin !== null) lines.push(`- took ${c.sleepLatencyMin} min to fall asleep`);
  if (c.sleepQuality !== null) lines.push(`- sleep quality: ${c.sleepQuality}/5`);
  if (c.feeling) lines.push(`- feeling, in their words: "${c.feeling}"`);
  if (c.onMind) lines.push(`- on their mind: "${c.onMind}"`);
  const habits = Object.entries(c.habits);
  if (habits.length > 0) {
    lines.push(`- habits today: ${habits.map(([k, done]) => `${k} ${done ? "done" : "not done"}`).join(", ")}`);
  }
  return lines.join("\n");
}

/** "tired, a bit anxious and hopeful" → ["tired", "a bit anxious", "hopeful"].
 * Pieces longer than three words are sentences, not feeling words — dropped. */
export function feelingWords(feeling: string | null): string[] {
  if (!feeling) return [];
  return feeling
    .toLowerCase()
    .split(/[,;/\n]|\band\b/)
    .map((s) => s.trim().replace(/[.!?]+$/, ""))
    .filter((s) => s.length > 0 && s.split(/\s+/).length <= 3);
}
