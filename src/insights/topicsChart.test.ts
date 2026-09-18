import { describe, expect, it } from "vitest";
import { topicWeeks } from "./topicsChart";
import type { DayRow } from "./stats";

function day(date: string, themes: string[], people: string[] = []): DayRow {
  return {
    date,
    mood: 6,
    energy: 6,
    summary: null,
    x: {
      themes: themes.map((key) => ({ key })),
      people: people.map((key) => ({ key })),
      habits: [],
      activities: [],
    },
  } as unknown as DayRow;
}

describe("topicWeeks", () => {
  // 2026-09-30 is a Wednesday; its week starts Monday 2026-09-28.
  const today = "2026-09-30";

  it("counts the days each week a name came up, oldest week first", () => {
    const rows = [
      day("2026-09-15", ["Work"]), // week of 09-14
      day("2026-09-16", ["work"]),
      day("2026-09-29", ["Work", "sleep"]), // this week
    ];
    const { weeks, series } = topicWeeks(rows, today, "themes", 3);
    expect(weeks).toEqual(["2026-09-14", "2026-09-21", "2026-09-28"]);
    const work = series.find((s) => s.key === "Work")!;
    expect(work.weekly).toEqual([2, 0, 1]);
    expect(work.total).toBe(3);
    expect(series.map((s) => s.key)).toEqual(["Work", "sleep"]);
  });

  it("counts a name once per day and leaves out days before the window", () => {
    const rows = [day("2026-08-01", ["old"]), day("2026-09-29", ["Work", "work"])];
    const { series } = topicWeeks(rows, today, "themes", 3);
    expect(series.map((s) => s.key)).toEqual(["Work"]);
    expect(series[0].total).toBe(1);
  });

  it("charts people separately from themes", () => {
    const rows = [day("2026-09-29", ["Work"], ["Sam"])];
    expect(topicWeeks(rows, today, "people", 2).series.map((s) => s.key)).toEqual(["Sam"]);
  });
});
