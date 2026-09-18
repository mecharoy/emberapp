// Builds every AI prompt Ember sends, with representative data, and writes
// prompt-review/PROMPTS.md — the prompts as a model actually receives them.
// Read-only: it imports the prompt builders and never touches the database.
//
//   npm run prompts:review
//
// Regenerate it after changing anything under src/ai/prompts/.

import { writeFileSync } from "node:fs";
import { counselorSystemPrompt, counselorTurnPreamble } from "../src/ai/prompts/counselor";
import { JOURNAL_SYSTEM_PROMPT, buildJournalUserPrompt } from "../src/ai/prompts/journal";
import { EXTRACTOR_SYSTEM_PROMPT, buildExtractorUserPrompt } from "../src/ai/prompts/extractor";
import { REVIEW_SYSTEM_PROMPT, buildReviewUserPrompt } from "../src/ai/prompts/review";
import { FORTNIGHT_SYSTEM_PROMPT, buildFortnightUserPrompt } from "../src/ai/prompts/fortnightly";
import { MONTHLY_SYSTEM_PROMPT, buildMonthlyUserPrompt } from "../src/ai/prompts/monthly";
import { APPROACHES, TONES, DEFAULT_STYLE, type ConversationStyle } from "../src/ai/prompts/style";
import { DEFAULT_NUM_CTX } from "../src/ai/providers/ollama";
import { JOB_REPLY_TOKENS } from "../src/ai/replySizes";

/** Rough token estimate. Good enough for budget arithmetic, not exact. */
const tok = (s: string) => Math.ceil(s.length / 3.7);

const layers = {
  userName: "Amy",
  todayLine: "Thursday, 2026-07-09",
  profileSummary:
    "Amy is a third-year PhD student in materials science, living alone in Pune. Thesis submission is the dominant thread; her supervisor is slow to respond and she reads the silence as disapproval. Close to her mother, who calls most evenings. Runs to clear her head, less often since May.",
  memorySummary: [
    "Summary #2, covering entries from 2026-06-10 to 2026-06-23.",
    "Overview: Two exam weeks. Sleep slipped to around six hours and stayed there.",
    "Life context: Thesis chapter 4 is the current work; a vendor is late with samples.",
    "Threads: thesis chapter 4 (ongoing), sleep (worsening), running (resolved).",
  ].join("\n"),
  recentJournals: [
    "2026-07-07 — The vendor call",
    "Spent the morning chasing the supplier again. Felt like the day was gone by eleven.",
    "",
    "2026-07-08 — A long writing day",
    "Got two sections drafted before lunch, which almost never happens.",
  ].join("\n"),
  checkIn: [
    "- mood: 4/10",
    "- energy: 3/10",
    "- sleep last night: 5.5 h",
    '- feeling, in their words: "drained"',
    "- lunch 13:00, evening break 18:30, dinner not yet",
  ].join("\n"),
  dayParts: [
    "1. waking up (07:10) → lunch (13:00)",
    "2. lunch (13:00) → evening break (18:30)",
    "3. evening break (18:30) → now — dinner not yet",
  ].join("\n"),
  style: DEFAULT_STYLE as ConversationStyle,
  topObservations: [
    "- habit:gym — 12×, last 2026-07-04, positive",
    "- theme:thesis — 21×, last 2026-07-08, negative",
    "- person:supervisor — 9×, last 2026-07-07, negative",
  ].join("\n"),
  yesterdaySummaryLine: "Quiet day, mostly writing, ended better than it started.",
  pendingCaptures: [
    "2026-07-09 (today)",
    "- 09:12: bus late again, missed the lab slot",
    "- 14:02: argued with vendor, ugh",
    "- 19:40: went for a short run, first in weeks",
  ].join("\n"),
  neglectedDomains: "body (sleep, food, movement)",
  openThreads: "- ruminating after work hours (last came up 2026-07-07)",
  weeklyLetter: "Dear Amy, a steadier week than it felt from inside it.",
  documents: [
    "--- about-me.md ---",
    "I run to clear my head. I get snappy when I haven't eaten.",
    "--- end of about-me.md ---",
  ].join("\n"),
  daysSinceLastEntry: 1,
};

const transcript = [
  { role: "assistant" as const, content: "You noted the bus was late around 9 — how did the morning go from there?" },
  { role: "user" as const, content: "Badly. Missed my lab slot so the whole plan for the day went out the window." },
  { role: "assistant" as const, content: "That's a rough start. And after lunch, up to your break at 6?" },
  { role: "user" as const, content: "The vendor call. I always end up the one chasing. Felt drained after." },
];

const entry = {
  title: "The bus, the vendor, and one short run",
  narrative:
    "The morning went sideways before it started. The bus was late again and the lab slot went with it.\n\nBy the afternoon the vendor call had taken whatever was left. You said you always end up the one chasing, and it landed heavier than usual.\n\nThen, after dinner, you ran. First in weeks.",
  highlights: ["Missed the lab slot when the bus ran late", "First run in weeks, after a draining day"],
  counselorNote: "You called the run small, but it is the first in weeks and it came on your hardest day this week.",
};

const dayJson = (date: string, mood: number) =>
  JSON.stringify({
    mood,
    mood_source: "user",
    energy: 3,
    summary_line: "Draining vendor conflict, redeemed by a short run.",
    themes: [{ key: "thesis", sentiment: -0.6 }],
    habits: [{ key: "running", done: true }],
    people: [{ key: "supervisor", sentiment: -0.3 }],
    emotions: ["frustrated", "relieved"],
    emotions_named: ["drained"],
    sleep_hours: 5.5,
  });

const days = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09"].map((date, i) => ({
  date,
  rawJson: dayJson(date, 4 + (i % 3)),
}));

interface Section {
  title: string;
  note: string;
  /** Sent once per session and cached, or on every call. */
  cadence: string;
  text: string;
}

const sections: Section[] = [
  {
    title: "1. Counselor — system prompt (default style: warm and direct / coach)",
    note: "The evening conversation. Built once per session by src/ai/context.ts and reused verbatim every turn so the provider's prefix cache holds.",
    cadence: "once per session, cached",
    text: counselorSystemPrompt(layers),
  },
  {
    title: "2. Counselor — system prompt (gentle / friend)",
    note: "Same prompt, the other end of the style range. Only the two style lines and the pattern limit move.",
    cadence: "once per session, cached",
    text: counselorSystemPrompt({ ...layers, style: { tone: "gentle", approach: "friend" } }),
  },
  {
    title: "3. Counselor — system prompt (blunt / therapist-style)",
    note: "The most permissive approach: two pattern references instead of one, and CBT-style challenge.",
    cadence: "once per session, cached",
    text: counselorSystemPrompt({ ...layers, style: { tone: "blunt", approach: "therapist" } }),
  },
  {
    title: "4. Counselor — system prompt (looking back at an earlier day)",
    note: "Picked from the Journal calendar. Adds the LOOKING BACK block, which re-points every 'today' in the rest of the prompt.",
    cadence: "once per session, cached",
    text: counselorSystemPrompt({
      ...layers,
      lookingBack: { realTodayLine: "Sunday, 2026-07-12", daysAgo: 3 },
    }),
  },
  {
    title: "5. Counselor — turn preamble",
    note: "Prepended to each user message. Holds only what changes per turn, so the cached system prefix stays intact.",
    cadence: "every turn",
    text: counselorTurnPreamble({ nowTime: "21:15", exchangeCount: 3, lengthPreference: "standard" }),
  },
  {
    title: "6. Counselor — turn preamble (quick session)",
    note: "The other length preference.",
    cadence: "every turn",
    text: counselorTurnPreamble({ nowTime: "21:15", exchangeCount: 0, lengthPreference: "quick" }),
  },
  {
    title: "7. Journal writer — system prompt",
    note: "Turns the day into the saved entry. Structured output: title, narrative, highlights, counselor_note.",
    cadence: "once per entry",
    text: JOURNAL_SYSTEM_PROMPT,
  },
  {
    title: "8. Journal writer — user prompt",
    note: "The day's material. Shown here in second-person voice with no regeneration feedback.",
    cadence: "once per entry",
    text: buildJournalUserPrompt({
      date: "2026-07-09",
      captures: [],
      transcript,
      profileSummary: layers.profileSummary,
      checkIn: layers.checkIn,
      voice: "second",
    }),
  },
  {
    title: "9. Journal writer — user prompt (regenerating with feedback)",
    note: "What the rewrite path sends: the previous entry plus the user's feedback.",
    cadence: "on regenerate",
    text: buildJournalUserPrompt({
      date: "2026-07-09",
      captures: [],
      transcript,
      profileSummary: layers.profileSummary,
      checkIn: layers.checkIn,
      voice: "first",
      feedbackNote: "make it shorter and less dramatic",
      previousEntry: entry,
    }),
  },
  {
    title: "10. Extractor — system prompt",
    note: "The widest schema in the app: twelve keys, eleven thinking-trap enum values, and the naming rules Insights depends on.",
    cadence: "once per entry",
    text: EXTRACTOR_SYSTEM_PROMPT,
  },
  {
    title: "11. Extractor — user prompt",
    note: "The saved entry plus the conversation it came from, plus the known-name lists that keep keys stable across days.",
    cadence: "once per entry",
    text: buildExtractorUserPrompt({
      date: "2026-07-09",
      entry,
      transcript,
      checkIn: layers.checkIn,
      knownNames: {
        themes: ["thesis", "vendor conflict", "sleep"],
        habits: ["gym", "running", "meditation"],
        people: ["supervisor", "mom", "Priya"],
        activities: ["walk", "writing", "lab work"],
      },
      dismissedHabits: ["coffee"],
    }),
  },
  {
    title: "12. Weekly reviewer — system prompt",
    note: "Sunday's letter, the two evidence-backed insight card lists, and the rewritten profile summary, in one call.",
    cadence: "weekly",
    text: REVIEW_SYSTEM_PROMPT,
  },
  {
    title: "13. Weekly reviewer — user prompt",
    note: "The week's extracted days as raw JSON, one per line, plus the cards being replaced.",
    cadence: "weekly",
    text: buildReviewUserPrompt({
      weekStart: "2026-07-06",
      weekEnd: "2026-07-12",
      days,
      currentProfile: layers.profileSummary,
      currentStrengths: '[{"claim":"Keeps going on low-sleep days","evidence":"drafted two sections on 5.5h","dates":["2026-07-08"]}]',
      currentFocusAreas: "[]",
      userName: "Amy",
    }),
  },
  {
    title: "14. Memory keeper (fortnightly) — system prompt",
    note: "Eleven named sections plus three lists. What it drops leaves Ember's memory for good.",
    cadence: "every two weeks",
    text: FORTNIGHT_SYSTEM_PROMPT,
  },
  {
    title: "15. Memory keeper (fortnightly) — user prompt",
    note: "The previous summary, app-computed numbers, questionnaire totals, and every entry since.",
    cadence: "every two weeks",
    text: buildFortnightUserPrompt({
      userName: "Amy",
      number: 3,
      previous: layers.memorySummary,
      numbers: { from: "2026-06-24", to: "2026-07-09", entries: 11, avgMood: 4.8, avgEnergy: 3.9, avgSleepHours: 5.8 },
      entries: [
        { date: "2026-07-08", title: "A long writing day", narrative: "Got two sections drafted before lunch.", highlights: ["Two sections drafted"], summaryLine: "A rare productive morning." },
        { date: "2026-07-09", title: entry.title, narrative: entry.narrative, highlights: entry.highlights, summaryLine: "Draining day, one short run." },
      ],
      assessments: [{ instrument: "who5", date: "2026-07-01", score: 44 } as never],
    }),
  },
  {
    title: "16. Monthly reviewer — system prompt",
    note: "The month letter plus the clinical '5 Ps' formulation, every point tied to dated days.",
    cadence: "monthly",
    text: MONTHLY_SYSTEM_PROMPT,
  },
  {
    title: "17. Monthly reviewer — user prompt",
    note: "App-computed numbers for this month and last, plus every extracted day of the month.",
    cadence: "monthly",
    text: buildMonthlyUserPrompt({
      userName: "Amy",
      stats: {
        month: "2026-07",
        daysJournaled: 18,
        avgMood: 4.9,
        avgEnergy: 4.1,
        topTheme: { key: "thesis", count: 14 },
        bestWeek: { weekStart: "2026-07-13", avgMood: 6.2, days: 5 },
      } as never,
      previous: {
        month: "2026-06",
        daysJournaled: 21,
        avgMood: 5.4,
        avgEnergy: 4.8,
        topTheme: { key: "exams", count: 11 },
        bestWeek: { weekStart: "2026-06-01", avgMood: 6.8, days: 6 },
      } as never,
      days,
      assessments: [{ instrument: "phq9", date: "2026-07-05", score: 11 } as never],
    }),
  },
];

/** Tone and approach fragments, shown on their own because they are the only
 *  part of any prompt the user chooses. */
const styleRows = [
  ...TONES.map((t) => ["Tone", t.label, t.instruction] as const),
  ...APPROACHES.map((a) => ["Approach", a.label, a.instruction] as const),
];

function render(): string {
  const out: string[] = [];
  out.push("# Ember's prompts, as the model receives them");
  out.push("");
  out.push(
    "Generated by `prompt-review/generate.ts` — do not edit by hand. Every prompt below is",
    "built by the real code in `src/ai/prompts/` with representative data standing in for a",
    "user's own. Regenerate after any prompt change.",
  );
  out.push("");
  out.push(`Ollama context default: **${DEFAULT_NUM_CTX} tokens** (\`DEFAULT_NUM_CTX\`, src/ai/providers/ollama.ts).`);
  out.push("A prompt longer than the context window is silently cut from the front by Ollama.");
  out.push("");
  out.push("## Size at a glance");
  out.push("");
  out.push("| Section | Cadence | Chars | ~Tokens | Reply budget | ~% of 8k ctx |");
  out.push("| --- | --- | ---: | ---: | ---: | ---: |");

  const replyFor = (title: string): number | null => {
    if (/Journal writer/.test(title)) return JOB_REPLY_TOKENS.journal;
    if (/Extractor/.test(title)) return JOB_REPLY_TOKENS.extract;
    if (/Weekly/.test(title)) return JOB_REPLY_TOKENS.weekly;
    if (/Monthly/.test(title)) return JOB_REPLY_TOKENS.monthly;
    if (/Memory keeper/.test(title)) return JOB_REPLY_TOKENS.memory;
    return null;
  };

  for (const s of sections) {
    const t = tok(s.text);
    const reply = replyFor(s.title);
    const pct = Math.round(((t + (reply ?? 0)) / DEFAULT_NUM_CTX) * 100);
    out.push(
      `| ${s.title} | ${s.cadence} | ${s.text.length} | ${t} | ${reply ?? "—"} | ${pct}% |`,
    );
  }
  out.push("");
  out.push(
    "The percentage counts the prompt plus the reply the job asks for, against the default",
    "8192-token window. System and user prompts of the same job are sent together, so add",
    "their rows to see what one call really costs.",
  );
  out.push("");

  out.push("## The style fragments the user picks");
  out.push("");
  out.push("These are the only prompt text a user chooses. They drop into the counselor prompt's");
  out.push("HOW YOU SOUND block.");
  out.push("");
  for (const [kind, label, instruction] of styleRows) {
    out.push(`**${kind} — ${label}**`);
    out.push("");
    out.push("```text");
    out.push(instruction);
    out.push("```");
    out.push("");
  }

  for (const s of sections) {
    out.push(`## ${s.title}`);
    out.push("");
    out.push(`*${s.note}*`);
    out.push("");
    out.push(`Sent ${s.cadence}. ${s.text.length} chars, roughly ${tok(s.text)} tokens.`);
    out.push("");
    out.push("```text");
    out.push(s.text);
    out.push("```");
    out.push("");
  }
  return out.join("\n");
}

const target = "prompt-review/PROMPTS.md"; // relative to the repo root, where npm runs it
writeFileSync(target, render(), "utf8");
console.log(`wrote ${target}`);
for (const s of sections) {
  console.log(`${s.title.slice(0, 52).padEnd(54)} ${String(s.text.length).padStart(6)} chars  ~${String(tok(s.text)).padStart(5)} tok`);
}
