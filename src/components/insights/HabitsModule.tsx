import { useState } from "react";
import {
  daysBetween,
  discoveredHabits,
  habitDetail,
  habitMonthCells,
  type DayRow,
  type HabitDayState,
} from "../../insights/stats";
import type { HabitPref, Observation } from "../../db/types";
import { ModuleCard } from "./ModuleCard";
import { CHROME, EMBER_RAMP, HABIT_LESS } from "./palette";

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const canon = (k: string) => k.trim().toLowerCase();

/** How each kind of day is drawn on the paper. Four states, four looks. */
const CELL = {
  doneText: CHROME.surface,
  skipped: { boxShadow: `inset 0 0 0 1.5px ${CHROME.muted}`, color: "#564e45" },
  unmentioned: { background: CHROME.emptyCell, color: CHROME.muted },
  noEntry: { boxShadow: "inset 0 0 0 1px #ddd3c1", color: "#a0968a" },
  future: { color: "#c7baa3" },
} as const;

function monthLabel(month: string): string {
  return new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const STATE_TEXT: Record<HabitDayState, string> = {
  done: "done",
  skipped: "you said you skipped it",
  unmentioned: "journaled, not mentioned",
  "no-entry": "no journal that day",
  future: "",
};

/** One calendar month for one habit. Every day says which of four things is
 * true — the old 15-week strip drew "didn't do it", "didn't mention it" and
 * "didn't journal" as the same grey square. */
function MonthHeatMap({
  cells,
  less,
}: {
  cells: ReturnType<typeof habitMonthCells>;
  less: boolean;
}) {
  const doneColor = less ? HABIT_LESS : EMBER_RAMP[3];
  return (
    <div className="grid w-fit grid-cols-7 gap-1 text-center text-[10.5px] tabular-nums">
      {WEEKDAY_LABELS.map((d, i) => (
        <span key={i} className="text-ink-faint">
          {d}
        </span>
      ))}
      {cells.map((c, i) => {
        if (!c) return <span key={`blank-${i}`} />;
        const style: React.CSSProperties =
          c.state === "done"
            ? { background: doneColor, color: CELL.doneText }
            : c.state === "skipped"
              ? CELL.skipped
              : c.state === "unmentioned"
                ? CELL.unmentioned
                : c.state === "no-entry"
                  ? CELL.noEntry
                  : CELL.future;
        return (
          <span
            key={c.date}
            title={c.state === "future" ? c.date : `${c.date}: ${STATE_TEXT[c.state]}`}
            className="flex h-6 w-6 items-center justify-center rounded-[5px]"
            style={style}
          >
            {c.day}
          </span>
        );
      })}
    </div>
  );
}

function Legend() {
  const swatch = (style: React.CSSProperties) => <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={style} />;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-faint">
      <span className="flex items-center gap-1.5">{swatch({ background: EMBER_RAMP[3] })} done</span>
      <span className="flex items-center gap-1.5">{swatch({ boxShadow: CELL.skipped.boxShadow })} said skipped</span>
      <span className="flex items-center gap-1.5">{swatch({ background: CELL.unmentioned.background })} journaled, not mentioned</span>
      <span className="flex items-center gap-1.5">{swatch({ boxShadow: CELL.noEntry.boxShadow })} no journal</span>
    </div>
  );
}

export default function HabitsModule({
  rows,
  todayKey,
  journaledDates,
  habitObservations,
  habitPrefs,
  onPin,
  onPinDiscovered,
  onDismiss,
  onDirection,
}: {
  rows: DayRow[];
  todayKey: string;
  journaledDates: Set<string>;
  habitObservations: Observation[]; // kind='habit'
  habitPrefs: HabitPref[];
  onPin: (obs: Observation, pinned: boolean) => void;
  onPinDiscovered: (key: string) => void;
  onDismiss: (key: string, dismissed: boolean) => void;
  onDirection: (key: string, direction: "less" | null) => void;
}) {
  const [month, setMonth] = useState(todayKey.slice(0, 7));
  const [showAllDiscovered, setShowAllDiscovered] = useState(false);

  const prefByKey = new Map(habitPrefs.map((p) => [p.key, p]));
  const dismissed = new Set(habitPrefs.filter((p) => p.dismissed === 1).map((p) => p.key));
  const pinned = habitObservations.filter((o) => o.pinned === 1 && !dismissed.has(canon(o.key)));
  const pinnedKeys = new Set(pinned.map((o) => canon(o.key)));
  const discovered = discoveredHabits(rows, dismissed).filter((h) => !pinnedKeys.has(canon(h.key)));
  const visibleDiscovered = showAllDiscovered ? discovered : discovered.slice(0, 6);
  const isCurrentMonth = month >= todayKey.slice(0, 7);

  return (
    <ModuleCard
      title="Habits"
      aside={
        pinned.length > 0 ? (
          <div className="flex items-center gap-1 text-[12.5px] text-ink-soft">
            <button onClick={() => setMonth(shiftMonth(month, -1))} className="btn-ghost px-2" aria-label="Previous month">
              &lsaquo;
            </button>
            <span className="w-32 text-center font-serif text-[15px] text-ink">{monthLabel(month)}</span>
            <button
              onClick={() => setMonth(shiftMonth(month, 1))}
              disabled={isCurrentMonth}
              className="btn-ghost px-2"
              aria-label="Next month"
            >
              &rsaquo;
            </button>
          </div>
        ) : undefined
      }
    >
      {pinned.length === 0 && (
        <p className="hint mb-4 max-w-xl">Pin one to track it day by day.</p>
      )}

      <div className="flex flex-col divide-y divide-rule">
        {pinned.map((obs) => {
          const key = canon(obs.key);
          const less = prefByKey.get(key)?.direction === "less";
          const d = habitDetail(rows, obs.key, todayKey);
          const cells = habitMonthCells(d, journaledDates, month, todayKey);
          const inMonth = cells.filter((c) => c && c.state !== "future" && c.state !== "no-entry");
          const doneInMonth = inMonth.filter((c) => c!.state === "done").length;
          const sinceLast = d.lastDone ? daysBetween(d.lastDone, todayKey) : null;
          return (
            <div key={obs.id} className="py-4 first:pt-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-serif text-[16px] text-ink">{obs.key}</span>
                  <div className="flex gap-0.5 rounded-md border border-rule p-0.5">
                    {(["more", "less"] as const).map((dir) => (
                      <button
                        key={dir}
                        onClick={() => onDirection(obs.key, dir === "less" ? "less" : null)}
                        aria-pressed={(dir === "less") === less}
                        className="seg"
                        title={dir === "less" ? "Something you want to do less of" : "Something you want to do more of"}
                      >
                        want {dir}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[12px] text-ink-faint">
                  {less ? (
                    <span>{sinceLast === null ? "not recorded yet" : sinceLast === 0 ? "today" : `last ${sinceLast}d ago`}</span>
                  ) : (
                    d.currentStreak > 0 && (
                      <span>
                        {d.currentStreak} {d.currentStreak === 1 ? "day" : "days"} in a row
                      </span>
                    )
                  )}
                  <span>
                    {doneInMonth} of {inMonth.length} journaled day{inMonth.length === 1 ? "" : "s"}
                  </span>
                  <button onClick={() => onPin(obs, false)} className="hover:text-ink">
                    unpin
                  </button>
                  <button
                    onClick={() => {
                      onPin(obs, false);
                      onDismiss(obs.key, true);
                    }}
                    className="hover:text-danger"
                    title="Stop tracking this and never count it as a habit"
                  >
                    not a habit
                  </button>
                </div>
              </div>
              <MonthHeatMap cells={cells} less={less} />
              {d.effect && (
                <p className="mt-3 text-[12.5px] text-ink-soft">
                  Days with {obs.key} average mood {d.effect.withAvg.toFixed(1)}, against {d.effect.withoutAvg.toFixed(1)}{" "}
                  without (n={d.effect.nWith}/{d.effect.nWithout}). Worth watching, not proof.
                </p>
              )}
            </div>
          );
        })}
      </div>
      {pinned.length > 0 && (
        <div className="mt-1">
          <Legend />
        </div>
      )}

      {discovered.length > 0 && (
        <div className="mt-5">
          <p className="hint mb-2">Spotted in your entries. Pin it, or &times; if it isn&rsquo;t a habit.</p>
          <ul className="flex flex-wrap gap-1.5">
            {visibleDiscovered.map((h) => {
              return (
                <li key={h.key} className="flex items-center overflow-hidden rounded-full border border-rule text-[12.5px]">
                  <button
                    onClick={() => onPinDiscovered(h.key)}
                    className="py-1 pl-3 pr-1.5 text-ink-soft transition-colors hover:text-ember"
                    title="Pin this habit"
                  >
                    + {h.key} <span className="tabular-nums text-ink-faint">{h.count}&times;</span>
                  </button>
                  <button
                    onClick={() => onDismiss(h.key, true)}
                    className="border-l border-rule px-2 py-1 text-ink-faint transition-colors hover:text-danger"
                    aria-label={`${h.key} is not a habit`}
                    title="Not a habit. Hide it and stop counting it."
                  >
                    &times;
                  </button>
                </li>
              );
            })}
          </ul>
          {discovered.length > 6 && (
            <button onClick={() => setShowAllDiscovered((v) => !v)} className="btn-ghost -ml-2.5 mt-1.5">
              {showAllDiscovered ? "Show fewer" : `Show all ${discovered.length}`}
            </button>
          )}
        </div>
      )}

      {dismissed.size > 0 && (
        <p className="mt-4 text-[12px] text-ink-faint">
          Not habits:{" "}
          {Array.from(dismissed).map((k, i) => (
            <span key={k}>
              {i > 0 && " · "}
              {k}{" "}
              <button onClick={() => onDismiss(k, false)} className="underline-offset-2 hover:text-ink hover:underline">
                restore
              </button>
            </span>
          ))}
        </p>
      )}

      {pinned.length === 0 && discovered.length === 0 && dismissed.size === 0 && (
        <p className="hint">No habits found yet. They show up as your entries are read.</p>
      )}
    </ModuleCard>
  );
}
