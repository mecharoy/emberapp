import type { DayRow } from "../../insights/stats";
import { addDays } from "../../insights/stats";
import { CHROME, WING_RAMP } from "./palette";

/** Mood 1-10 to a shade of the mood ramp, blended between its steps so a 4
 *  and a 5 look different. Magnitude, so one hue, running the way the theme
 *  reads "more" (palette.ts). */
function shade(mood: number): string {
  const t = (Math.max(1, Math.min(10, mood)) - 1) / 9;
  const x = t * (WING_RAMP.length - 1);
  const i = Math.min(Math.floor(x), WING_RAMP.length - 2);
  const k = x - i;
  const rgb = (hex: string) => [1, 3, 5].map((j) => parseInt(hex.slice(j, j + 2), 16));
  const [a, b] = [rgb(WING_RAMP[i]), rgb(WING_RAMP[i + 1])];
  return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * k)).join(", ")})`;
}

/**
 * The last seven days as a strip of cells, each shaded by that day's mood,
 * with the number written under it so the shade is never the only way to
 * read it. A day without an entry is an empty, dashed cell. Tap a day to
 * open its entry.
 */
export default function WeekStrip({
  rows,
  entries,
  today,
  onOpen,
}: {
  rows: DayRow[];
  entries: { date: string; title: string }[];
  today: string;
  onOpen: (date: string) => void;
}) {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const titles = new Map(entries.map((e) => [e.date, e.title]));
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));

  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-7 gap-[3px]">
        {days.map((date) => {
          const row = byDate.get(date);
          const title = titles.get(date);
          const mood = row?.mood ?? null;
          const d = new Date(`${date}T12:00:00`);
          const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
          const label = `${d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}${
            mood !== null ? `, mood ${mood} of 10` : ""
          }${title ? `: ${title}` : title === undefined ? ", no entry" : ""}`;
          return (
            <div key={date} className="flex min-w-0 flex-col items-center gap-1.5">
              <button
                onClick={() => title !== undefined && onOpen(date)}
                disabled={title === undefined}
                title={row?.summaryLine ? `${label}\n${row.summaryLine}` : label}
                aria-label={label}
                className={`h-11 w-full rounded-[6px] transition-transform duration-150 enabled:hover:-translate-y-0.5 ${
                  title === undefined ? "border border-dashed border-line-strong" : ""
                } ${date === today ? "ring-1 ring-fg/40 ring-offset-2 ring-offset-ground" : ""}`}
                style={{ background: mood !== null ? shade(mood) : CHROME.emptyCell }}
              />
              <span className="text-[13px] font-semibold tabular-nums leading-none text-fg">{mood ?? "–"}</span>
              <span className="text-[11px] leading-none text-fg-faint">{weekday}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-1.5 text-[11.5px] text-fg-faint" aria-hidden="true">
        <span>lower mood</span>
        {WING_RAMP.map((c) => (
          <span key={c} className="h-2.5 w-4 rounded-[3px]" style={{ background: c }} />
        ))}
        <span>higher</span>
      </div>
    </div>
  );
}
