// Every background review job in one call. Used by the scheduler's timer,
// by the hook after each saved entry is extracted, and by the Insights
// refresh button. Each job is a cheap no-op when nothing is due.

import { emit } from "@tauri-apps/api/event";
import { runWeeklyReviewIfDue, type ReviewResult } from "./review";
import { runMonthlyReportIfDue, type MonthlyResult } from "./monthly";
import { runFortnightlySummaryIfDue, type FortnightResult } from "./fortnightly";

export interface ReviewJobsResult {
  weekly: ReviewResult | null;
  monthly: MonthlyResult | null;
  /** The fortnightly memory summary the evening chat reads. */
  fortnightly: FortnightResult | null;
}

export async function runReviewJobsAndNotify(): Promise<ReviewJobsResult> {
  const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });
  const weekly = await runWeeklyReviewIfDue().catch(fail);
  const monthly = await runMonthlyReportIfDue().catch(fail);
  const fortnightly = await runFortnightlySummaryIfDue().catch(fail);
  if (weekly?.ok || monthly?.ok || fortnightly?.ok) await emit("reviews:updated").catch(() => {});
  return { weekly, monthly, fortnightly };
}
