import { useEffect, useState } from "react";
import { getCheckIn, saveCheckIn } from "../db/checkins";
import { listObservations } from "../db/observations";
import { listDismissedHabitKeys } from "../db/habitPrefs";
import { localDateKey } from "../time";
import { sleepHoursFrom, toCheckInSummary, type DayPoint } from "../ai/checkin";
import { listAssessments } from "../db/assessments";
import { getAllSettings, setSetting } from "../db/settings";
import { dueInstruments, INSTRUMENTS, parseEnabledInstruments } from "../insights/assessments";
import { addDays } from "../insights/stats";
import type { Instrument } from "../db/types";
import WellbeingCheck from "./WellbeingCheck";
import FaceSlider from "./FaceSlider";

const Optional = () => <span className="font-normal text-fg-faint"> (optional)</span>;

/** "mood 6/10 · energy 4/10 · slept 3/5", for the folded check-in. */
function describeSaved(mood: number | null, energy: number | null, sleepQuality: number | null): string {
  const parts: string[] = [];
  if (mood !== null) parts.push(`mood ${mood}/10`);
  if (energy !== null) parts.push(`energy ${energy}/10`);
  if (sleepQuality !== null) parts.push(`slept ${sleepQuality}/5`);
  return parts.length > 0 ? parts.join(" · ") : "saved";
}

/**
 * The check-in before a conversation: mood, energy, last night's sleep,
 * what is on their mind, pinned habits. Every field is optional; the answers
 * are the user's own and beat anything the AI would infer.
 *
 * It starts FOLDED. The Today page is opened many times a day, and a long
 * form at the top of the talk made every visit look like paperwork; people
 * said so. Folded, it is one line and the button that starts the talk; the
 * form opens only when asked for.
 *
 * It no longer asks when lunch, a break or dinner happened: the clock did
 * not matter to the people answering it. Times an older check-in already
 * holds are kept as they are when it is saved again.
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
  // Kept from an older check-in that gave hours but no bed and wake times.
  const [storedSleep, setStoredSleep] = useState<number | null>(null);
  const [feeling, setFeeling] = useState("");
  const [onMind, setOnMind] = useState("");
  const [pinned, setPinned] = useState<string[]>([]);
  const [habits, setHabits] = useState<Record<string, boolean>>({});
  const [bedtime, setBedtime] = useState("");
  const [wakeTime, setWakeTime] = useState("");
  const [latency, setLatency] = useState("");
  const [quality, setQuality] = useState<number | null>(null);
  // From an older check-in that still asked about meal times: kept, not shown.
  const [kept, setKept] = useState<{
    lunch: DayPoint;
    eveningBreak: DayPoint;
    dinner: DayPoint;
    dayNotes: Record<string, string>;
  }>({ lunch: null, eveningBreak: null, dinner: null, dayNotes: {} });
  // Whether anything was saved for this day already, for the folded line.
  const [savedLine, setSavedLine] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Once the form has been open, anything typed into it is saved on start,
  // even if it was folded away again first.
  const [opened, setOpened] = useState(false);
  // Questionnaires due today, and the ones being answered right now.
  const [due, setDue] = useState<Instrument[]>([]);
  const [answering, setAnswering] = useState<Instrument[] | null>(null);

  useEffect(() => {
    (async () => {
      const [existing, habitObs, dismissed, taken, settings] = await Promise.all([
        getCheckIn(date),
        listObservations("habit"),
        listDismissedHabitKeys(),
        listAssessments(),
        getAllSettings(),
      ]);
      // Offered only for today: a questionnaire about "the last two weeks"
      // means nothing when dated to a day being looked back on.
      if (date === localDateKey()) {
        setDue(
          dueInstruments(
            parseEnabledInstruments(settings.assessments_enabled),
            taken,
            date,
            settings.assessments_snoozed_until,
          ),
        );
      }
      setPinned(
        habitObs.filter((o) => o.pinned === 1 && !dismissed.has(o.key.trim().toLowerCase())).map((o) => o.key),
      );
      const s = toCheckInSummary(existing);
      if (s) {
        setMood(s.mood);
        setEnergy(s.energy);
        setStoredSleep(s.sleepHours);
        setFeeling(s.feeling ?? "");
        setOnMind(s.onMind ?? "");
        setHabits(s.habits);
        setBedtime(s.bedtime ?? "");
        setWakeTime(s.wakeTime ?? "");
        setLatency(s.sleepLatencyMin === null ? "" : String(s.sleepLatencyMin));
        setQuality(s.sleepQuality);
        setKept({ lunch: s.lunch, eveningBreak: s.eveningBreak, dinner: s.dinner, dayNotes: s.dayNotes });
        setSavedLine(describeSaved(s.mood, s.energy, s.sleepQuality));
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

  const minutes = Number.parseInt(latency, 10);
  const latencyMin = Number.isFinite(minutes) && minutes >= 0 && minutes <= 600 ? minutes : null;
  const hoursAsleep = sleepHoursFrom(bedtime || null, wakeTime || null, latencyMin);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    await saveAndStart();
  }

  async function saveAndStart() {
    await saveCheckIn({
      date,
      mood,
      energy,
      sleepHours: hoursAsleep ?? (bedtime || wakeTime ? null : storedSleep),
      feeling: feeling.trim() || null,
      onMind: onMind.trim() || null,
      habits,
      bedtime: bedtime || null,
      wakeTime: wakeTime || null,
      sleepLatencyMin: latencyMin,
      sleepQuality: quality,
      lunch: kept.lunch,
      eveningBreak: kept.eveningBreak,
      dinner: kept.dinner,
      dayNotes: kept.dayNotes,
    });
    onStart();
  }

  async function snoozeChecks() {
    await setSetting("assessments_snoozed_until", addDays(date, 1));
    setDue([]);
  }

  if (!loaded) return <p className="p-8 text-[13px] text-fg-faint">Loading&hellip;</p>;

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

  const dueNotice = due.length > 0 && (
    <div className="flex max-w-xl flex-col gap-2 border-l-2 border-moss/60 pl-4">
      <p className="text-[13.5px] leading-relaxed text-fg">
        Wellbeing check due: {due.map((i) => INSTRUMENTS[i].name).join(" and ")}. About a minute.
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
  );

  // Folded: one line, and the way into the talk.
  if (!open) {
    return (
      <div className="fade-up flex flex-col gap-5">
        <p className="max-w-xl text-[15px] leading-relaxed text-fg-dim">
          {isToday
            ? "When you're ready, Elytra asks about your day and writes it up for you. Your notes above are where it starts."
            : `Talk ${weekday} through, and Elytra writes it up for you.`}
        </p>
        {savedLine && (
          <p className="text-[13.5px] text-fg-faint">
            Checked in &middot; {savedLine}
          </p>
        )}
        {due.length > 0 && (
          <p className="text-[13.5px] leading-relaxed text-fg-dim">
            A one-minute wellbeing check is due ({due.map((i) => INSTRUMENTS[i].name).join(" and ")}).{" "}
            <button type="button" onClick={() => setAnswering(due)} className="text-moss underline underline-offset-2">
              Take it
            </button>{" "}
            &middot;{" "}
            <button type="button" onClick={snoozeChecks} className="text-fg-faint underline underline-offset-2">
              Not today
            </button>
          </p>
        )}
        <div className="flex flex-col items-stretch gap-2 md:max-w-md">
          <button type="button" onClick={opened ? saveAndStart : onSkip} disabled={busy} className="btn-primary">
            {busy ? "Starting…" : isToday ? "Start the conversation" : `Start talking about ${weekday}`}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setOpened(true);
            }}
            disabled={busy}
            className="btn-ghost"
          >
            {savedLine ? "Change the check-in" : "Check in first: mood, sleep, habits"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleStart} className="fade-up flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto pb-6 pt-1">
      <h2 className="section-title">{isToday ? "Check-in" : `Check-in · ${weekday}`}</h2>

      {dueNotice}

      <div className="grid max-w-2xl grid-cols-1 gap-6 md:grid-cols-2">
        <FaceSlider
          kind="mood"
          label={isToday ? "Mood (optional)" : `Mood on ${weekday} (optional)`}
          value={mood}
          onChange={setMood}
        />
        <FaceSlider kind="energy" label="Energy (optional)" value={energy} onChange={setEnergy} />
      </div>

      <label className="flex max-w-md flex-col gap-1.5">
        <span className="label">
          In a word or two, how {isToday ? "do" : "did"} you feel?
          <Optional />
        </span>
        <input className="input" value={feeling} onChange={(e) => setFeeling(e.target.value)} placeholder="drained, a bit hopeful" />
      </label>

      <div className="flex max-w-xl flex-col gap-2">
        <span className="label">
          {isToday ? "Last night" : "The night before"}
          <Optional />
        </span>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-fg-faint">
            Got into bed
            <input type="time" className="input w-full" value={bedtime} onChange={(e) => setBedtime(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-fg-faint">
            Got up
            <input type="time" className="input w-full" value={wakeTime} onChange={(e) => setWakeTime(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-fg-faint">
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
          <div className="flex flex-col gap-1 text-[12px] text-fg-faint">
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
                    quality === n ? "border-moss bg-moss text-ground" : "border-line text-fg-dim"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
        {hoursAsleep !== null && <p className="text-[12.5px] text-fg-faint">About {hoursAsleep} hours asleep.</p>}
      </div>

      <label className="flex max-w-md flex-col gap-1.5">
        <span className="label">
          Anything on your mind?
          <Optional />
        </span>
        <textarea className="input min-h-[64px] resize-y" value={onMind} onChange={(e) => setOnMind(e.target.value)} />
      </label>

      {pinned.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="label">
            {isToday ? "Habits today" : `Habits on ${weekday}`}
            <Optional />
          </span>
          <ul className="flex flex-col gap-1.5">
            {pinned.map((key) => (
              <li key={key} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[15px] text-fg">{key}</span>
                {([true, false] as const).map((done) => (
                  <button
                    key={String(done)}
                    type="button"
                    onClick={() => setHabit(key, done)}
                    aria-pressed={habits[key] === done}
                    className={`min-h-[36px] rounded-full border px-3.5 py-1 text-[13.5px] transition-colors duration-200 ${
                      habits[key] === done
                        ? "border-moss bg-moss text-ground"
                        : "border-line text-fg-dim hover:border-fg-faint hover:text-fg"
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

      <div className="flex flex-col items-stretch gap-2 pt-1 md:max-w-md">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "Starting…" : isToday ? "Start the conversation" : `Start talking about ${weekday}`}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="btn-ghost">
          Fold it away
        </button>
      </div>
    </form>
  );
}
