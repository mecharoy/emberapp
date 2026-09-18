import { useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DayRow } from "../../insights/stats";
import { topicWeeks, type TopicGroup } from "../../insights/topicsChart";
import { shortDate } from "../../insights/format";
import { ModuleCard } from "./ModuleCard";
import { CHROME, REDUCED_MOTION, TOPIC_COLORS } from "./palette";

const RANGES = [
  { label: "8w", weeks: 8 },
  { label: "12w", weeks: 12 },
  { label: "6m", weeks: 26 },
  { label: "1y", weeks: 52 },
] as const;

/** How many names start switched on; the rest can be added from the chips. */
const START_ON = 4;

interface TooltipPayload {
  active?: boolean;
  payload?: { dataKey: string; value: number; color: string; name: string }[];
  label?: string;
}

function ChartTooltip({ active, payload, label }: TooltipPayload) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="max-w-60 rounded-md border border-rule bg-sheet px-3 py-2 text-[12px] shadow-[0_4px_14px_rgba(40,35,30,0.12)]">
      <div className="text-ink">Week of {label ? shortDate(label) : ""}</div>
      <ul className="mt-1 flex flex-col gap-0.5 text-ink-soft">
        {payload.map((p) => (
          <li key={p.dataKey}>
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: p.color }} />
            {p.name}: {p.value} {p.value === 1 ? "day" : "days"}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Themes and people over time, drawn like the mood chart: one line per name,
 * the days each week it came up. Switch between themes and people, pick the
 * names to compare, and change how far back to look.
 */
export default function TopicsChart({
  rows,
  todayKey,
  showThemes,
  showPeople,
}: {
  rows: DayRow[];
  todayKey: string;
  showThemes: boolean;
  showPeople: boolean;
}) {
  const [group, setGroup] = useState<TopicGroup>(showThemes ? "themes" : "people");
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[1]);
  // Names switched off by the user, per group; a name not listed is on if it is
  // among the first few.
  const [off, setOff] = useState<Record<TopicGroup, Set<string>>>({ themes: new Set(), people: new Set() });
  const [on, setOn] = useState<Record<TopicGroup, Set<string>>>({ themes: new Set(), people: new Set() });

  const data = useMemo(() => topicWeeks(rows, todayKey, group, range.weeks), [rows, todayKey, group, range]);

  const isOn = (key: string, index: number): boolean =>
    on[group].has(key) || (index < START_ON && !off[group].has(key));

  const shown = data.series.map((s, i) => ({ ...s, index: i, on: isOn(s.key, i) }));
  const colorFor = (i: number) => TOPIC_COLORS[i % TOPIC_COLORS.length];

  const points = data.weeks.map((week, w) => {
    const p: Record<string, string | number> = { week };
    for (const s of shown) p[`s${s.index}`] = s.weekly[w];
    return p;
  });

  function toggle(key: string, currentlyOn: boolean) {
    setOn((prev) => {
      const next = new Set(prev[group]);
      if (currentlyOn) next.delete(key);
      else next.add(key);
      return { ...prev, [group]: next };
    });
    setOff((prev) => {
      const next = new Set(prev[group]);
      if (currentlyOn) next.add(key);
      else next.delete(key);
      return { ...prev, [group]: next };
    });
  }

  const anyOn = shown.some((s) => s.on);
  const title = showThemes && showPeople ? "Themes & people over time" : showThemes ? "Themes over time" : "People over time";

  return (
    <ModuleCard
      title={title}
      aside={
        <div className="flex flex-wrap items-center gap-3">
          {showThemes && showPeople && (
            <div className="flex gap-0.5" role="group" aria-label="What to chart">
              {(["themes", "people"] as const).map((g) => (
                <button key={g} onClick={() => setGroup(g)} aria-pressed={g === group} className="seg">
                  {g === "themes" ? "Themes" : "People"}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-0.5" role="group" aria-label="How far back">
            {RANGES.map((r) => (
              <button key={r.label} onClick={() => setRange(r)} aria-pressed={r.label === range.label} className="seg">
                {r.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {shown.length === 0 ? (
        <p className="hint max-w-xl">Nothing in this stretch yet.</p>
      ) : (
        <>
          <ul className="mb-3 flex flex-wrap gap-1.5">
            {shown.map((s) => (
              <li key={s.key}>
                <button
                  onClick={() => toggle(s.key, s.on)}
                  aria-pressed={s.on}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] transition-colors ${
                    s.on ? "border-rule-strong text-ink" : "border-rule text-ink-faint"
                  }`}
                  title={s.on ? "Hide from the chart" : "Show on the chart"}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: s.on ? colorFor(s.index) : "transparent", boxShadow: `inset 0 0 0 1.5px ${colorFor(s.index)}` }}
                    aria-hidden="true"
                  />
                  {s.key}
                  <span className="tabular-nums text-ink-faint">{s.total}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="h-56">
            {anyOn ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                  <XAxis
                    dataKey="week"
                    tick={{ fill: CHROME.muted, fontSize: 10.5 }}
                    tickFormatter={(d: string) => shortDate(d)}
                    stroke={CHROME.axis}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={48}
                  />
                  <YAxis
                    domain={[0, 7]}
                    ticks={[0, 2, 4, 6]}
                    allowDecimals={false}
                    tick={{ fill: CHROME.muted, fontSize: 10.5 }}
                    stroke="transparent"
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHROME.axis, strokeDasharray: "2 3" }} />
                  {shown
                    .filter((s) => s.on)
                    .map((s) => (
                      <Line
                        key={s.key}
                        name={s.key}
                        dataKey={`s${s.index}`}
                        stroke={colorFor(s.index)}
                        strokeWidth={2}
                        dot={{ r: 2, fill: colorFor(s.index), strokeWidth: 0 }}
                        isAnimationActive={!REDUCED_MOTION}
                        animationDuration={700}
                        animationEasing="ease-out"
                      />
                    ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="hint">Pick a name above to see it.</p>
            )}
          </div>
        </>
      )}
    </ModuleCard>
  );
}
