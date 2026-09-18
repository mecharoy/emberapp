// Scheduler, iPhone edition. On the desktop a timer in the always-running
// tray app fired every notification itself. iOS stops an app's timers as soon
// as it leaves the screen, so the notification system rings instead: whenever
// the app is left, reopened, or a reminder or the evening settings change, the
// next week of evening reminders, the next week of day reminders and every
// pending task reminder are handed over (tauri-plugin-notification schedules
// them). The timer below only does bookkeeping while the app is open.

import { emit, listen } from "@tauri-apps/api/event";
import {
  cancel,
  isPermissionGranted,
  onAction,
  pending,
  requestPermission,
  Schedule,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { localDateKey } from "./time";
import { getEntryForDate } from "./db/entries";
import { listDueReminders, listPendingReminders, markReminderFired } from "./db/reminders";
import { getSessionForDate, markMissedDaysSkipped } from "./db/sessions";
import { getSetting, setSetting } from "./db/settings";
import { runReviewJobsAndNotify } from "./ai/reviewJobs";
import { addDays } from "./insights/stats";
import { handleDayReminderAction, registerDayReminderActions, syncDayReminders } from "./dayReminders";
import { drainInboxIntoJournal } from "./inbox";

const CHECK_MS = 30_000;

/** Notification ids: the evening reminder for today+i is EVENING_ID + i; a
 *  task reminder is TASK_ID + its row id. Both fit a 32-bit integer. */
const EVENING_ID = 7000;
const EVENING_DAYS = 7;
const TASK_ID = 100_000;

// ---------- pure decision logic (unit-tested) ----------

export interface ReminderState {
  now: string; // "YYYY-MM-DDTHH:MM" local
  reminderTime: string; // "HH:MM"
  entrySavedToday: boolean;
  sessionWrapped: boolean;
  snoozedUntil: string; // "YYYY-MM-DDTHH:MM" or ""
  skipDate: string; // "YYYY-MM-DD" or ""
  lastFired: string; // "YYYY-MM-DDTHH:MM" or ""
}

/**
 * Fire at most once per arming: once when the reminder time passes, and once
 * more after each snooze elapses. Never after the entry is saved, the session
 * wrapped, or tonight was skipped. (Same-format ISO-local strings compare
 * correctly as plain strings.)
 */
export function shouldFireReminder(s: ReminderState): boolean {
  const today = s.now.slice(0, 10);
  if (s.entrySavedToday || s.sessionWrapped) return false;
  if (s.skipDate === today) return false;
  if (s.now.slice(11, 16) < s.reminderTime) return false;
  if (s.snoozedUntil && s.now < s.snoozedUntil) return false;

  const firedToday = s.lastFired.slice(0, 10) === today;
  if (!firedToday) return true;
  // already fired today — only a snooze that has since elapsed re-arms it
  return Boolean(s.snoozedUntil && s.lastFired < s.snoozedUntil && s.now >= s.snoozedUntil);
}

/** The Today-tab banner shows whenever the evening slot is open (independent
 * of whether the one-shot notification already fired), but respects snooze/skip. */
export function shouldShowReminderBanner(s: Omit<ReminderState, "lastFired">): boolean {
  const today = s.now.slice(0, 10);
  if (s.entrySavedToday || s.sessionWrapped) return false;
  if (s.skipDate === today) return false;
  if (s.now.slice(11, 16) < s.reminderTime) return false;
  if (s.snoozedUntil && s.now < s.snoozedUntil) return false;
  return true;
}

/**
 * When the evening reminder should ring over the next `days` days, as
 * "YYYY-MM-DDTHH:MM" local times, soonest first. Tonight is left out once the
 * entry is saved, the conversation wrapped or tonight skipped, and a snooze
 * moves tonight's ring later. Times already past are left out: the app is
 * open at that moment, and the Today banner is the reminder.
 */
export function planEveningReminders(s: Omit<ReminderState, "lastFired">, days = EVENING_DAYS): string[] {
  const today = s.now.slice(0, 10);
  const times: string[] = [];
  for (let i = 0; i < days; i++) {
    let at = `${addDays(today, i)}T${s.reminderTime}`;
    if (i === 0) {
      if (s.entrySavedToday || s.sessionWrapped || s.skipDate === today) continue;
      if (s.snoozedUntil && s.snoozedUntil > at) at = s.snoozedUntil;
    }
    if (at <= s.now) continue;
    times.push(at);
  }
  return times;
}

export function nowLocalMinute(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:MM" local → Date. */
function atLocal(minute: string): Date {
  return new Date(`${minute}:00`);
}

// ---------- runtime ----------

async function readReminderState(): Promise<ReminderState> {
  const today = localDateKey();
  const [reminderTime, snoozedUntil, skipDate, lastFired, entry, session] = await Promise.all([
    getSetting("reminder_time"),
    getSetting("reminder_snoozed_until"),
    getSetting("reminder_skip_date"),
    getSetting("reminder_last_fired"),
    getEntryForDate(today),
    getSessionForDate(today),
  ]);
  return {
    now: nowLocalMinute(),
    reminderTime: reminderTime || "21:30",
    entrySavedToday: entry !== null,
    sessionWrapped: session?.status === "wrapped",
    snoozedUntil,
    skipDate,
    lastFired,
  };
}

/** Asks iOS once for permission to post notifications. Without it, every
 *  reminder is silently dropped, so it is asked for as soon as setup ends. */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    return (await isPermissionGranted()) || (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

let syncing: Promise<void> | null = null;

/**
 * Hands iOS the reminders it should ring while Ember is closed. Replaces
 * whatever was handed over before, so it is safe to call as often as needed.
 * Notification text is only ever the fixed evening line or the reminder the
 * user asked for — never captures or entries.
 */
export function syncNotifications(): Promise<void> {
  if (!syncing) {
    syncing = doSync().finally(() => {
      syncing = null;
    });
  }
  return syncing;
}

async function doSync(): Promise<void> {
  if (!(await isPermissionGranted().catch(() => false))) return;
  await syncDayReminders(nowLocalMinute()).catch(() => {});
  const [state, reminders, scheduled] = await Promise.all([
    readReminderState(),
    listPendingReminders(),
    pending().catch(() => []),
  ]);

  const stale = new Set<number>();
  for (let i = 0; i < EVENING_DAYS; i++) stale.add(EVENING_ID + i);
  for (const n of scheduled) if (n.id >= TASK_ID) stale.add(n.id);
  await cancel([...stale]).catch(() => {});

  planEveningReminders(state).forEach((at, i) => {
    sendNotification({
      id: EVENING_ID + i,
      title: "Ember",
      body: "Ready to talk about today?",
      schedule: Schedule.at(atLocal(at), false, true),
      autoCancel: true,
    });
  });

  let firedNow = false;
  for (const r of reminders) {
    if (r.due_at > state.now) {
      sendNotification({
        id: TASK_ID + r.id,
        title: "Ember reminder",
        body: r.text,
        schedule: Schedule.at(atLocal(r.due_at), false, true),
        autoCancel: true,
      });
    } else {
      // Due already (set for a time that has passed): ring now, once.
      await markReminderFired(r.id);
      sendNotification({ id: TASK_ID + r.id, title: "Ember reminder", body: r.text, autoCancel: true });
      firedNow = true;
    }
  }
  if (firedNow) await emit("reminders:changed");
}

/** While the app is open: reminders whose time came have already rung through
 *  iOS, so they are only marked as done here (at most once each). */
async function markDueTaskReminders(): Promise<void> {
  const due = await listDueReminders(nowLocalMinute());
  for (const r of due) await markReminderFired(r.id);
  if (due.length > 0) await emit("reminders:changed");
}

/** For the Today tab's in-app reminder banner. */
export async function isReminderBannerVisible(): Promise<boolean> {
  const s = await readReminderState();
  return shouldShowReminderBanner(s);
}

export async function snoozeReminder(minutes: number): Promise<void> {
  const until = nowLocalMinute(new Date(Date.now() + minutes * 60_000));
  await setSetting("reminder_snoozed_until", until);
  await emit("reminder:changed");
}

export async function skipTonight(): Promise<void> {
  await setSetting("reminder_skip_date", localDateKey());
  await emit("reminder:changed");
}

let started = false;

/** Idempotent; called once from App mount. */
export function startScheduler(): void {
  if (started) return;
  started = true;

  // catch-up work on launch: mark missed days as skipped sessions and
  // run the weekly review if one is due — both idempotent, both quiet
  markMissedDaysSkipped(localDateKey()).catch(() => {});
  runReviewJobsAndNotify().catch(() => {});

  // Anything caught while Ember was away: the widget, the share sheet, or a
  // reminder answered in the notification itself.
  drainInboxIntoJournal().catch(() => {});

  const sync = () => void syncNotifications().catch(() => {});
  getSetting("onboarded")
    .then(async (onboarded) => {
      if (onboarded === "1") await ensureNotificationPermission();
      await registerDayReminderActions().catch(() => {});
      sync();
    })
    .catch(() => {});
  markDueTaskReminders().catch(() => {});

  // A day reminder answered while Ember is on screen is saved here; one
  // answered while it isn't goes through the inbox instead.
  onAction(async (payload) => {
    const saved = await handleDayReminderAction(payload as unknown as Record<string, unknown>).catch(() => false);
    if (saved) sync();
  }).catch(() => {});

  // Leaving the app is the moment iOS needs an up-to-date plan: the entry
  // may have just been saved, or the reminder time changed.
  document.addEventListener("visibilitychange", () => {
    sync();
    if (document.visibilityState === "visible") {
      // Notes caught while Ember was away are only saved now.
      drainInboxIntoJournal().catch(() => {});
      markMissedDaysSkipped(localDateKey()).catch(() => {});
      runReviewJobsAndNotify().catch(() => {});
    }
  });
  listen("reminder:changed", sync).catch(() => {});
  listen("reminders:changed", sync).catch(() => {});

  let ticks = 0;
  setInterval(() => {
    markDueTaskReminders().catch(() => {});
    if (++ticks % 60 === 0) runReviewJobsAndNotify().catch(() => {});
  }, CHECK_MS);
}
