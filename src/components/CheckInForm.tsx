import { useEffect, useState } from "react";
import { getCheckIn, saveCheckIn } from "../db/checkins";
import { listObservations } from "../db/observations";
import { listDismissedHabitKeys } from "../db/habitPrefs";
import { localDateKey } from "../db/captures";
import { toCheckInSummary } from "../ai/checkin";
import { listAssessments } from "../db/assessments";
import { getSetting, setSetting } from "../db/settings";
import { dueInstruments, INSTRUMENTS, parseEnabledInstruments } from "../insights/assessments";
import { addDays } from "../insights/stats";
import type { Instrument } from "../db/types";
import WellbeingCheck from "./WellbeingCheck";

const SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function ScaleRow({
  label,
  ends,
  value,
  onChange,
}: {
  label: string;
  ends: [string, string];
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="label">{label}</span>
      <div className="w-full">
        <div className="grid grid-cols-10 gap-1" role="group" aria-label={label}>
          {SCALE.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange(value === n ? null : n)}
              aria-pressed={value === n}
              className={`aspect-square w-full rounded-full border text-[13.5px] tabular-nums transition duration-200 ease-settle active:scale-90 ${
                value === n
                  ? "border-ember bg-ember text-paper"
                  : "border-rule text-ink-soft"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="mt-1 flex justify-between px-1 font-serif text-[12px] italic text-ink-faint">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      </div>
    </div>
  );
}

/** One point in the day: a time, or "not yet" / "skipped". Picking one clears
 *  the other; tapping the active choice again clears it. */
function DayPointRow({
  label,
  value,
  allowNotYet,
  onChange,
}: {
  label: string;
  value: string;
  allowNotYet: boolean;
  onChange: (v: string) => void;
}) {
  const choice = (id: "not-yet" | "skipped", text: string) => (
    <button
      type="button"
      onClick={() => onChange(value === id ? "" : id)}
      aria-pressed={value === id}
      className={`min-h-[36px] rounded-full border px-3 py-1 text-[13px] transition-colors duration-200 ${
        value === id ? "border-ember bg-ember text-paper" : "border-rule text-ink-soft"
      }`}
    >
      {text}
    </button>
  );
  const isTime = /^\d{2}:\d{2}$/.test(value);
  return (
    <div className="flex flex-col gap-1 text-[12px] text-ink-faint">
      <span>{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="time"
          aria-label={`${label} time`}
          className="input w-[9.5rem]"
          value={isTime ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
        {allowNotYet && choice("not-yet", "not yet")}
        {choice("skipped", "skipped")}
      </div>
    </div>
  );
}

/**
 * The evening check-in: the plain daily questions — how you
 * feel, energy, sleep, pinned habits — answered in ten seconds before the
 * conversation, so the counselor can spend the conversation on what matters
 * instead of asking them. Every field is optional; the answers are the
 * user's own ratings and override anything the AI would infer.
 */
export default function CheckInForm({
  date,
  busy,
  onStart,
  onSkip,
}: {
  date: string;
  busy: boolean;
  onStart: () => void;
  onSkip: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [mood, setMood] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [sleep, setSleep] = useState("");
  const [feeling, setFeeling] = useState("");
  const [onMind, setOnMind] = useState("");
  const [pinned, setPinned] = useState<string[]>([]);
  const [habits, setHabits] = useState<Record<string, boolean>>({});
  const [bedtime, setBedtime] = useState("");
  const [wakeTime, setWakeTime] = useState("");
  const [latency, setLatency] = useState("");
  const [quality, setQuality] = useState<number | null>(null);
  const [lunch, setLunch] = useState("");
  const [eveningBreak, setEveningBreak] = useState("");
  const [dinner, setDinner] = useState("");
  // Questionnaires due today, and the ones being answered right now.
  const [due, setDue] = useState<Instrument[]>([]);
  const [answering, setAnswering] = useState<Instrument[] | null>(null);

  useEffect(() => {
    (async () => {
      const [existing, habitObs, dismissed, taken, enabledCsv, snoozedUntil] = await Promise.all([
        getCheckIn(date),
        listObservations("habit"),
        listDismissedHabitKeys(),
        listAssessments(),
        getSetting("assessments_enabled"),
        getSetting("assessments_snoozed_until"),
      ]);
      // Offered only for tonight: a questionnaire about "the last two weeks"
      // means nothing when dated to a day being looked back on.
      if (date === localDateKey()) {
        setDue(dueInstruments(parseEnabledInstruments(enabledCsv), taken, date, snoozedUntil));
      }
      setPinned(
        habitObs.filter((o) => o.pinned === 1 && !dismissed.has(o.key.trim().toLowerCase())).map((o) => o.key),
      );
      const s = toCheckInSummary(existing);
      if (s) {
        setMood(s.mood);
        setEnergy(s.energy);
        setSleep(s.sleepHours === null ? "" : String(s.sleepHours));
        setFeeling(s.feeling ?? "");
        setOnMind(s.onMind ?? "");
        setHabits(s.habits);
        setBedtime(s.bedtime ?? "");
        setWakeTime(s.wakeTime ?? "");
        setLatency(s.sleepLatencyMin === null ? "" : String(s.sleepLatencyMin));
        setQuality(s.sleepQuality);
        setLunch(s.lunch ?? "");
        setEveningBreak(s.eveningBreak ?? "");
        setDinner(s.dinner ?? "");
      }
      setLoaded(true);
    })();
  }, [date]);

  function setHabit(key: string, done: boolean) {
    setHabits((prev) => {
      const next = { ...prev };
      if (next[key] === done) delete next[key]; // clicking the active answer clears it
      else next[key] = done;
      return next;
    });
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    const hours = Number.parseFloat(sleep);
    const minutes = Number.parseInt(latency, 10);
    await saveCheckIn({
      date,
      mood,
      energy,
      sleepHours: Number.isFinite(hours) && hours >= 0 && hours <= 24 ? hours : null,
      feeling: feeling.trim() || null,
      onMind: onMind.trim() || null,
      habits,
      bedtime: bedtime || null,
      wakeTime: wakeTime || null,
      sleepLatencyMin: Number.isFinite(minutes) && minutes >= 0 && minutes <= 600 ? minutes : null,
      sleepQuality: quality,
      lunch: lunch || null,
      eveningBreak: eveningBreak || null,
      dinner: dinner || null,
    });
    onStart();
  }

  async function snoozeChecks() {
    await setSetting("assessments_snoozed_until", addDays(date, 1));
    setDue([]);
  }

  if (!loaded) return <p className="p-8 text-[13px] text-ink-faint">Loading&hellip;</p>;

  if (answering && answering.length > 0) {
    const [current, ...rest] = answering;
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-5">
        <WellbeingCheck
          key={current}
          instrument={current}
          date={date}
          onDone={() => {
            setDue((prev) => prev.filter((i) => i !== current));
            setAnswering(rest.length > 0 ? rest : null);
          }}
          onCancel={() => setAnswering(null)}
        />
      </div>
    );
  }

  const isToday = date === localDateKey();
  const weekday = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" });

  return (
    <form onSubmit={handleStart} className="fade-up flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 pb-10 pt-5">
      <div>
        <h2 className="section-title">{isToday ? "Before we talk" : `Before we talk about ${weekday}`}</h2>
        <p className="hint mt-1 max-w-md">
          Ten seconds, and all of it optional. Ember uses your answers instead of guessing, and won&rsquo;t ask
          them again.
        </p>
      </div>

      {due.length > 0 && (
        <div className="flex max-w-xl flex-col gap-2 border-l-2 border-ember/60 pl-4">
          <p className="text-[13.5px] leading-relaxed text-ink">
            Your fortnightly wellbeing check is due: {due.map((i) => INSTRUMENTS[i].name).join(" and ")}. About a
            minute, and it shows how the last two weeks have really been.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAnswering(due)} className="btn-subtle">
              Take it now
            </button>
            <button type="button" onClick={snoozeChecks} className="btn-ghost">
              Not today
            </button>
          </div>
        </div>
      )}

      <ScaleRow
        label={isToday ? "How are you feeling overall today?" : `How did you feel overall on ${weekday}?`}
        ends={["rough", "great"]}
        value={mood}
        onChange={setMood}
      />
      <ScaleRow label="Energy" ends={["drained", "buzzing"]} value={energy} onChange={setEnergy} />

      <div className="flex flex-col gap-2.5">
        <div>
          <span className="label">{isToday ? "Your day so far" : `Your ${weekday}`}</span>
          <p className="hint mt-0.5">Ember walks through the day in the stretches between these.</p>
        </div>
        <DayPointRow label="Lunch" value={lunch} allowNotYet={isToday} onChange={setLunch} />
        <DayPointRow label="Evening break" value={eveningBreak} allowNotYet={isToday} onChange={setEveningBreak} />
        <DayPointRow label="Dinner" value={dinner} allowNotYet={isToday} onChange={setDinner} />
      </div>

      <label className="flex max-w-xs flex-col gap-1.5">
        <span className="label">{isToday ? "Hours slept last night" : "Hours slept the night before"}</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={24}
          step={0.5}
          className="input w-28"
          value={sleep}
          onChange={(e) => setSleep(e.target.value)}
          placeholder="7"
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="label">
          Sleep diary <span className="font-normal text-ink-faint">(optional)</span>
        </span>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-ink-faint">
            Got into bed
            <input type="time" className="input w-full" value={bedtime} onChange={(e) => setBedtime(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-ink-faint">
            Got up
            <input type="time" className="input w-full" value={wakeTime} onChange={(e) => setWakeTime(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-ink-faint">
            Minutes to fall asleep
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={600}
              step={5}
              className="input w-full"
              value={latency}
              onChange={(e) => setLatency(e.target.value)}
              placeholder="15"
            />
          </label>
          <div className="flex flex-col gap-1 text-[12px] text-ink-faint">
            How well you slept
            <div className="flex gap-1" role="group" aria-label="How well you slept, 1 to 5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setQuality(quality === n ? null : n)}
                  aria-pressed={quality === n}
                  title={n === 1 ? "very poorly" : n === 5 ? "very well" : undefined}
                  className={`h-9 w-9 rounded-full border text-[13.5px] tabular-nums transition duration-200 ease-settle active:scale-90 ${
                    quality === n
                      ? "border-ember bg-ember text-paper"
                      : "border-rule text-ink-soft"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <label className="flex max-w-md flex-col gap-1.5">
        <span className="label">{isToday ? "In a word or two, how do you feel?" : "In a word or two, how did you feel?"}</span>
        <input className="input" value={feeling} onChange={(e) => setFeeling(e.target.value)} placeholder="drained, a bit hopeful" />
      </label>

      <label className="flex max-w-md flex-col gap-1.5">
        <span className="label">Anything on your mind before we start?</span>
        <textarea
          className="input min-h-[64px] resize-y"
          value={onMind}
          onChange={(e) => setOnMind(e.target.value)}
          placeholder="Optional"
        />
      </label>

      {pinned.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="label">{isToday ? "Habits today" : `Habits on ${weekday}`}</span>
          <ul className="flex flex-col gap-1.5">
            {pinned.map((key) => (
              <li key={key} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{key}</span>
                {([true, false] as const).map((done) => (
                  <button
                    key={String(done)}
                    type="button"
                    onClick={() => setHabit(key, done)}
                    aria-pressed={habits[key] === done}
                    className={`min-h-[36px] rounded-full border px-3.5 py-1 text-[13.5px] transition-colors duration-200 ${
                      habits[key] === done
                        ? "border-ember bg-ember text-paper"
                        : "border-rule text-ink-soft hover:border-ink-faint hover:text-ink"
                    }`}
                  >
                    {done ? "done" : isToday ? "not today" : "not that day"}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col items-stretch gap-2 pt-1">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "Starting…" : isToday ? "Start tonight's conversation" : `Start talking about ${weekday}`}
        </button>
        <button type="button" onClick={onSkip} disabled={busy} className="btn-ghost">
          Skip the check-in
        </button>
      </div>
    </form>
  );
}
