// Themes and people over time: for each name, on how many days of each week
// it came up. Pure; unit-tested in topicsChart.test.ts.

import { addDays, canon, daysBetween, mondayOf, type DayRow } from "./stats";

export type TopicGroup = "themes" | "people";

export interface TopicSeries {
  key: string;
  /** Days it came up in each week, oldest first. */
  weekly: number[];
  total: number;
}

export interface TopicWeeks {
  /** Monday of each week, oldest first. */
  weeks: string[];
  series: TopicSeries[];
}

/** The names in a group, most days first, with their weekly counts over
 *  the last `weeks` weeks (this week included). Names with no day in the
 *  window are left out. */
export function topicWeeks(rows: DayRow[], todayKey: string, group: TopicGroup, weeks: number, limit = 8): TopicWeeks {
  const thisMonday = mondayOf(todayKey);
  const weekList = Array.from({ length: weeks }, (_, i) => addDays(thisMonday, -7 * (weeks - 1 - i)));
  const map = new Map<string, TopicSeries>();

  for (const r of rows) {
    const idx = weeks - 1 - Math.floor(daysBetween(mondayOf(r.date), thisMonday) / 7);
    if (idx < 0 || idx >= weeks) continue;
    const seen = new Set<string>();
    for (const item of r.x[group]) {
      const c = canon(item.key);
      if (!c || seen.has(c)) continue;
      seen.add(c);
      let s = map.get(c);
      if (!s) {
        s = { key: item.key.trim(), weekly: Array.from({ length: weeks }, () => 0), total: 0 };
        map.set(c, s);
      }
      s.weekly[idx]++;
      s.total++;
    }
  }

  const series = Array.from(map.values())
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
    .slice(0, limit);
  return { weeks: weekList, series };
}
