// Every background review job in one call. Used by the scheduler's timer,
// by the hook after each saved entry is extracted, and by the Insights
// refresh button. Each job is a cheap no-op when nothing is due.

import { emit } from "@tauri-apps/api/event";
import { getSetting, setSetting } from "../db/settings";
import { runWeeklyReviewIfDue, type ReviewResult } from "./review";
import { runMonthlyReportIfDue, type MonthlyResult } from "./monthly";
import { runFortnightlySummaryIfDue, type FortnightResult } from "./fortnightly";
import { refreshMemoryFilesIfDue, type MemoryFilesResult } from "./memoryFiles";

export interface ReviewJobsResult {
  weekly: ReviewResult | null;
  monthly: MonthlyResult | null;
  /** The fortnightly memory summary the evening chat reads. */
  fortnightly: FortnightResult | null;
  /** The memory files (people, behaviours, patterns, goals). */
  memory: MemoryFilesResult | null;
}

export async function runReviewJobsAndNotify(): Promise<ReviewJobsResult> {
  // With the computer's model, the computer writes these and they sync over:
  // run here they would fail whenever the two aren't on the same Wi-Fi.
  if ((await getSetting("provider")) === "pc") return { weekly: null, monthly: null, fortnightly: null, memory: null };
  const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });
  const weekly = await runWeeklyReviewIfDue().catch(fail);
  const monthly = await runMonthlyReportIfDue().catch(fail);
  const fortnightly = await runFortnightlySummaryIfDue().catch(fail);
  const memory = await refreshMemoryFilesIfDue().catch(fail);

  // Remembered so Insights can say so; these run unseen and would otherwise
  // just never appear. Cleared by the next run with no failure.
  const failed = (
    [
      ["weekly letter", weekly],
      ["monthly report", monthly],
      ["memory summary", fortnightly],
      ["memory files", memory],
    ] as const
  ).flatMap(([name, r]) => (r && !r.ok ? [`${name}: ${r.error}`] : []));
  await setSetting("jobs_last_error", failed.length > 0 ? failed.join(" · ") : "").catch(() => {});

  if (weekly || monthly || fortnightly || memory) await emit("reviews:updated").catch(() => {});
  return { weekly, monthly, fortnightly, memory };
}
