import { useState } from "react";
import { APPROACHES, TONES, type ConversationStyle } from "../ai/prompts/style";

const PROMPTS = [
  { id: "counselor", label: "Conversation" },
  { id: "journal", label: "Journal entry" },
  { id: "extractor", label: "Insights" },
  { id: "weekly", label: "Weekly letter" },
  { id: "monthly", label: "Monthly report" },
  { id: "memory", label: "Memory" },
] as const;

type PromptId = (typeof PROMPTS)[number]["id"];

/** Plain-words summaries of what each prompt asks for. Kept next to the
 *  prompts' meaning, not their wording: update them when a prompt's job changes. */
const SUMMARIES: Record<Exclude<PromptId, "counselor">, string[]> = {
  journal: [
    "Turns your notes, check-in and conversation into the entry: the day in order, how it felt, what mattered, and a short note from Ember.",
    "It only uses what you actually wrote or said. A short evening gets a short entry, never made-up detail.",
  ],
  extractor: [
    "Reads each entry for mood, energy, sleep, themes, people, habits, feeling words and thinking traps, so Insights can chart them.",
    "Your own check-in answers always win over its reading. Anything unclear is left blank rather than guessed.",
  ],
  weekly: [
    "Once a week, writes you a short letter about the week: its main note, one concrete moment and a gentle look ahead.",
    "Every strength or thing to watch has to point to real days, and it updates the short portrait Ember keeps of you.",
  ],
  monthly: [
    "When a month ends, writes a short month-in-review: the main theme, the best week and what changed.",
    "It also sums up what made things hard, what kept them going and what helped, using only what you told Ember.",
  ],
  memory: [
    "Every two weeks, folds your newest entries into a running summary, which is how Ember remembers older days.",
    "It keeps what still matters and drops what's over. No diagnoses, labels or made-up detail.",
  ],
};

function conversationSummary(style: ConversationStyle): string[] {
  const tone = TONES.find((t) => t.id === style.tone)!;
  const approach = APPROACHES.find((a) => a.id === style.approach)!;
  return [
    "Walks you through the day in order: waking up to lunch, lunch to your evening break, then to dinner and to now, one stretch at a time, using your notes and check-in.",
    "After that it goes deeper on the one thing that mattered most, asks about something good, and offers to write the entry.",
    `Your style: ${tone.label.toLowerCase()} (${tone.blurb.toLowerCase().replace(/\.$/, "")}), ${approach.label.toLowerCase()} (${approach.blurb.charAt(0).toLowerCase()}${approach.blurb.slice(1).replace(/\.$/, "")}).`,
    "It gives advice only when you ask, sets reminders only when you agree, and points you to real help if you're in crisis.",
  ];
}

/** Settings → Ember's instructions: what each prompt asks for, in short. */
export default function PromptViewer({ style }: { style: ConversationStyle }) {
  const [id, setId] = useState<PromptId>("counselor");
  const lines = id === "counselor" ? conversationSummary(style) : SUMMARIES[id];

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-1 flex flex-wrap gap-1" role="group" aria-label="Which instructions">
        {PROMPTS.map((p) => (
          <button key={p.id} onClick={() => setId(p.id)} aria-pressed={id === p.id} className="seg">
            {p.label}
          </button>
        ))}
      </div>
      <ul className="flex flex-col gap-2 border-l-2 border-rule pl-4">
        {lines.map((line) => (
          <li key={line} className="text-[14px] leading-relaxed text-ink-soft">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
