import { listUnjournaledCaptures, localDateKey } from "../db/captures";
import { getSetting } from "../db/settings";
import { latestEntryDateBefore } from "../db/entries";
import { getDayMetrics, listRecentDayMetrics } from "../db/metrics";
import { listObservations, listTopObservations } from "../db/observations";
import { getProfileSummary } from "../db/profile";
import { listEnabledDocuments } from "../db/documents";
import { formatDocumentsForPrompt } from "./documents";
import { getCheckIn } from "../db/checkins";
import { latestWeeklyReview } from "../db/reviews";
import { listEntries } from "../db/entries";
import { listMemorySummaries } from "../db/memorySummaries";
import { formatJournalsSince, formatSummaryForPrompt } from "./fortnightly";
import { formatCheckInForPrompt, toCheckInSummary } from "./checkin";
import type { WeeklyReview } from "../db/types";
import {
  counselorSystemPrompt,
  counselorTurnPreamble,
  EMPTY_MEMORY_SUMMARY,
  EMPTY_PROFILE_SUMMARY,
} from "./prompts/counselor";
import { addDays, daysBetween } from "../insights/stats";
import {
  computeNeglectedDomains,
  formatOpenThreads,
  formatTopObservations,
  selectOpenThreads,
} from "./memory";
import { formatCaptureDaysForPrompt } from "../captureDays";

export { EMPTY_PROFILE_SUMMARY };

/** "Thursday, 2026-07-09" — the model has no clock of its own. */
export function formatTodayLine(dateKey: string): string {
  const weekday = new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  return `${weekday}, ${dateKey}`;
}

/** "HH:MM" local — the reminder marker needs a reference clock. */
function nowTimeLine(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The week's letter opens the next evening's chat. It's handed over
 * only while it's news — written after their last journal entry and within
 * the past week — so it isn't brought up night after night.
 */
export function letterForTonight(
  review: Pick<WeeklyReview, "letter" | "created_at"> | null,
  lastEntryDate: string | null,
  todayKey: string,
): string {
  if (!review) return "(none)";
  const written = review.created_at.slice(0, 10);
  if (lastEntryDate && written <= lastEntryDate) return "(none)";
  if (daysBetween(written, todayKey) > 7) return "(none)";
  return review.letter.trim() || "(none)";
}

/**
 * The per-turn state that used to live in the system prompt — the clock and
 * the exchange counter — carried on the user turn instead. Anything in here
 * changes between turns by definition, and anything that changes between
 * turns invalidates the cached prefix, so it must stay out of the system
 * prompt. See prompts/counselor.ts for the full reasoning.
 */
export async function buildCounselorTurnPreamble(
  opts: { exchangeCount?: number } = {},
): Promise<string> {
  const lengthSetting = await getSetting("chat_length_preference");
  return counselorTurnPreamble({
    nowTime: nowTimeLine(),
    exchangeCount: opts.exchangeCount ?? 0,
    lengthPreference: lengthSetting === "quick" ? "quick" : "standard",
  });
}

/**
 * Assembles the counselor system prompt from the three
 * compact memory layers: profile summary, top observations, and
 * today + yesterday — never the raw history — plus the user's enabled
 * reference documents and the session-stable state (date, days since the
 * last entry). Every layer is empty-safe, so a
 * brand-new install degrades gracefully.
 *
 * Deliberately stable for the whole session: the caller builds this once and
 * reuses the exact string every turn, which is what makes the prefix a cache
 * read rather than a re-write. Volatile state goes in
 * buildCounselorTurnPreamble() instead.
 *
 * `dayKey` is the day being talked about: today, or an earlier day picked
 * from the Journal calendar, in which case the prompt says so (lookingBack).
 */
export async function buildCounselorSystemPrompt(dayKey: string = localDateKey()): Promise<string> {
  const today = dayKey;
  const realToday = localDateKey();
  const [
    userNameSetting,
    pendingCaptures,
    profile,
    topObservations,
    yesterdayMetrics,
    recentMetrics,
    allObservations,
    lastEntryDate,
    documents,
    checkInRow,
    latestReview,
    entries,
    summaries,
  ] = await Promise.all([
    getSetting("user_name"),
    listUnjournaledCaptures(today),
    getProfileSummary(),
    listTopObservations(today, 15),
    getDayMetrics(addDays(today, -1)),
    listRecentDayMetrics(5),
    listObservations(),
    latestEntryDateBefore(today),
    listEnabledDocuments(),
    getCheckIn(today),
    latestWeeklyReview(),
    listEntries(),
    listMemorySummaries(),
  ]);

  // Summary n-1 plus every entry since. For a past day, only the
  // summaries and entries that existed before it make sense, so a summary
  // that folded in later days is skipped in favour of an earlier one.
  const summariesBefore = summaries.filter((s) => s.period_end < today);
  const latestSummary = summariesBefore[summariesBefore.length - 1];

  const neglected = computeNeglectedDomains(recentMetrics);
  const openThreads = selectOpenThreads(allObservations, today);

  return counselorSystemPrompt({
    userName: userNameSetting.trim(),
    todayLine: formatTodayLine(today),
    profileSummary: profile?.trim() || EMPTY_PROFILE_SUMMARY,
    memorySummary: latestSummary ? formatSummaryForPrompt(latestSummary) : EMPTY_MEMORY_SUMMARY,
    recentJournals: formatJournalsSince(entries, summariesBefore, today),
    checkIn: formatCheckInForPrompt(toCheckInSummary(checkInRow)),
    // The week's letter opens a real evening, not a look back at an old one.
    weeklyLetter: today === realToday ? letterForTonight(latestReview, lastEntryDate, today) : "(none)",
    topObservations: formatTopObservations(topObservations),
    yesterdaySummaryLine: yesterdayMetrics?.summary_line ?? "(no entry from yesterday)",
    pendingCaptures: formatCaptureDaysForPrompt(pendingCaptures, today),
    neglectedDomains: neglected.length > 0 ? neglected.join("; ") : "(nothing stands out)",
    openThreads: formatOpenThreads(openThreads),
    documents: formatDocumentsForPrompt(documents),
    daysSinceLastEntry: lastEntryDate ? daysBetween(lastEntryDate, today) : null,
    lookingBack:
      today < realToday
        ? { realTodayLine: formatTodayLine(realToday), daysAgo: daysBetween(today, realToday) }
        : undefined,
  });
}
