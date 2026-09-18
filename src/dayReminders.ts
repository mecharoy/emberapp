// Reminders at their usual lunch, break and dinner times (Settings > You):
// "Lunch time? What did you do this morning?". The answer is typed straight
// into the notification and goes into that day's check-in, as what they did in
// that stretch of the day, with the time of the meal or break.
//
// On Android this was AlarmManager and a Kotlin broadcast receiver
// (DayReminders.kt). On iPhone the notification system does it: the three
// reminders are scheduled a week ahead like the evening one, each carrying a
// text field. A reply while Ember is running is handled here; a reply while it
// isn't is written to the inbox by the Swift handler and saved next time Ember
// opens (src/inbox.ts).

import { cancel, registerActionTypes, Schedule, sendNotification } from "@tauri-apps/plugin-notification";
import { emit } from "@tauri-apps/api/event";
import { getCheckIn, isDayPointAnswered, recordDayPoint, type DayPointId } from "./db/checkins";
import { getSetting } from "./db/settings";
import { addDays } from "./insights/stats";
import { localDateKey } from "./time";

/** One notification id per point per day: 5100 + point*10 + day. Well clear
 *  of the evening reminder (7000+) and task reminders (100000+). */
const DAY_ID = 5100;
const DAY_REMINDER_DAYS = 7;

/** The action type every day reminder carries, registered once at startup. */
export const DAY_ACTION_TYPE = "ember-day-point";
export const REPLY_ACTION = "reply";
export const SKIP_ACTION = "skip";

export interface DayPointCopy {
  id: DayPointId;
  /** The settings key holding their usual time for it. */
  setting: "usual_lunch" | "usual_break" | "usual_dinner";
  title: string;
  question: string;
  skipLabel: string;
}

export const DAY_POINT_COPY: DayPointCopy[] = [
  {
    id: "lunch",
    setting: "usual_lunch",
    title: "Lunch time?",
    question: "What did you do this morning?",
    skipLabel: "Skipped lunch",
  },
  {
    id: "break",
    setting: "usual_break",
    title: "Taking a break?",
    question: "What did you do since lunch?",
    skipLabel: "No break today",
  },
  {
    id: "dinner",
    setting: "usual_dinner",
    title: "Dinner time?",
    question: "What did you do since the break?",
    skipLabel: "Skipped dinner",
  },
];

function copyFor(id: string): DayPointCopy | undefined {
  return DAY_POINT_COPY.find((p) => p.id === id);
}

// ---------- pure decision logic (unit-tested) ----------

export interface DayReminderPlanInput {
  /** "YYYY-MM-DDTHH:MM" local. */
  now: string;
  enabled: boolean;
  /** "HH:MM" per point; an empty or malformed time means "don't ring". */
  times: Partial<Record<DayPointId, string>>;
  /** Points today's check-in already has an answer for. */
  answeredToday: DayPointId[];
}

export interface PlannedDayReminder {
  id: number;
  point: DayPointId;
  /** "YYYY-MM-DDTHH:MM" local. */
  at: string;
}

const HHMM = /^\d{2}:\d{2}$/;

/**
 * When each day reminder should ring over the next `days` days, soonest
 * first. A point whose time has already passed today is left out, as is one
 * today's check-in already answers — the same two rules the Android alarm
 * applied when it woke up.
 */
export function planDayReminders(input: DayReminderPlanInput, days = DAY_REMINDER_DAYS): PlannedDayReminder[] {
  if (!input.enabled) return [];
  const today = input.now.slice(0, 10);
  const answered = new Set(input.answeredToday);
  const planned: PlannedDayReminder[] = [];

  DAY_POINT_COPY.forEach((point, index) => {
    const time = input.times[point.id] ?? "";
    if (!HHMM.test(time)) return;
    for (let day = 0; day < days; day++) {
      if (day === 0 && answered.has(point.id)) continue;
      const at = `${addDays(today, day)}T${time}`;
      if (at <= input.now) continue;
      planned.push({ id: DAY_ID + index * 10 + day, point: point.id, at });
    }
  });

  planned.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return planned;
}

/** Every id the day reminders may occupy, so a stale one can be cancelled. */
export function allDayReminderIds(): number[] {
  const ids: number[] = [];
  DAY_POINT_COPY.forEach((_, index) => {
    for (let day = 0; day < DAY_REMINDER_DAYS; day++) ids.push(DAY_ID + index * 10 + day);
  });
  return ids;
}

// ---------- runtime ----------

/** "YYYY-MM-DDTHH:MM" local → Date. */
function atLocal(minute: string): Date {
  return new Date(`${minute}:00`);
}

/** Tells iOS what a day reminder's buttons are. Registering again replaces
 *  the definition, so this is safe to call on every start. */
export async function registerDayReminderActions(): Promise<void> {
  await registerActionTypes([
    {
      id: DAY_ACTION_TYPE,
      actions: [
        {
          id: REPLY_ACTION,
          title: "Jot it down",
          input: true,
          inputButtonTitle: "Save",
          inputPlaceholder: "What have you been up to?",
        },
        { id: SKIP_ACTION, title: "Not today", foreground: false, destructive: true },
      ],
    },
  ]);
}

/** Hands iOS the next week of day reminders, replacing whatever was handed
 *  over before. Notification text is only ever the fixed question — never a
 *  note, a check-in answer or anything else the user wrote. */
export async function syncDayReminders(now: string): Promise<void> {
  const today = localDateKey();
  const [enabled, lunch, breakTime, dinner, checkIn] = await Promise.all([
    getSetting("day_reminders"),
    getSetting("usual_lunch"),
    getSetting("usual_break"),
    getSetting("usual_dinner"),
    getCheckIn(today).catch(() => null),
  ]);

  const answeredToday = (["lunch", "break", "dinner"] as DayPointId[]).filter((id) =>
    isDayPointAnswered(checkIn, id),
  );

  const plan = planDayReminders({
    now,
    enabled: enabled === "1",
    times: { lunch, break: breakTime, dinner },
    answeredToday,
  });

  await cancel(allDayReminderIds()).catch(() => {});
  for (const item of plan) {
    const copy = copyFor(item.point);
    if (!copy) continue;
    sendNotification({
      id: item.id,
      title: copy.title,
      body: copy.question,
      actionTypeId: DAY_ACTION_TYPE,
      extra: { emberDayPoint: item.point },
      schedule: Schedule.at(atLocal(item.at), false, true),
      autoCancel: true,
    });
  }
}

/** Which point a tapped notification belongs to: from the note Ember attached
 *  when scheduling it, or failing that from the id it was given. */
export function pointFromNotification(payload: Record<string, unknown>): DayPointId | null {
  const extra = payload.extra as Record<string, unknown> | undefined;
  const tagged = extra?.emberDayPoint;
  if (typeof tagged === "string" && copyFor(tagged)) return tagged as DayPointId;

  const id = typeof payload.id === "number" ? payload.id : null;
  if (id === null) return null;
  const offset = id - DAY_ID;
  if (offset < 0 || offset >= DAY_POINT_COPY.length * 10) return null;
  return DAY_POINT_COPY[Math.floor(offset / 10)]?.id ?? null;
}

/**
 * A day reminder answered while Ember is running. Anything typed goes into
 * today's check-in; "Not today" marks the point skipped.
 */
export async function handleDayReminderAction(payload: Record<string, unknown>): Promise<boolean> {
  const point = pointFromNotification(payload);
  if (!point) return false;
  const actionId = typeof payload.actionId === "string" ? payload.actionId : "";
  const typed = typeof payload.inputValue === "string" ? payload.inputValue : "";

  if (actionId === SKIP_ACTION) {
    await recordDayPoint(localDateKey(), point, null, true);
  } else if (actionId === REPLY_ACTION && typed.trim()) {
    await recordDayPoint(localDateKey(), point, typed, false);
  } else {
    // The notification itself was tapped: that just opens Ember.
    return false;
  }
  await emit("checkin:updated");
  return true;
}
