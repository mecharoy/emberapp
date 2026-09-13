import { useEffect, useState } from "react";
import { buildCounselorSystemPrompt } from "../ai/context";
import { JOURNAL_SYSTEM_PROMPT } from "../ai/prompts/journal";
import { EXTRACTOR_SYSTEM_PROMPT } from "../ai/prompts/extractor";
import { REVIEW_SYSTEM_PROMPT } from "../ai/prompts/review";
import { MONTHLY_SYSTEM_PROMPT } from "../ai/prompts/monthly";
import { FORTNIGHT_SYSTEM_PROMPT } from "../ai/prompts/fortnightly";

const PROMPTS = [
  { id: "counselor", label: "Conversation", note: "Exactly what tonight's conversation starts from, including what Ember knows about you." },
  { id: "journal", label: "Journal entry", note: "How Ember writes the entry from your notes and the conversation." },
  { id: "extractor", label: "Insights", note: "How Ember reads an entry for mood, themes, habits and more." },
  { id: "weekly", label: "Weekly letter", note: "The weekly review." },
  { id: "monthly", label: "Monthly report", note: "The monthly report." },
  { id: "memory", label: "Memory", note: "The two-weekly summary Ember remembers you by." },
] as const;

type PromptId = (typeof PROMPTS)[number]["id"];

const FIXED: Record<Exclude<PromptId, "counselor">, string> = {
  journal: JOURNAL_SYSTEM_PROMPT,
  extractor: EXTRACTOR_SYSTEM_PROMPT,
  weekly: REVIEW_SYSTEM_PROMPT,
  monthly: MONTHLY_SYSTEM_PROMPT,
  memory: FORTNIGHT_SYSTEM_PROMPT,
};

/** Settings → Ember's instructions: the system prompts, read-only. */
export default function PromptViewer() {
  const [id, setId] = useState<PromptId>("counselor");
  const [counselor, setCounselor] = useState<string | null>(null);

  useEffect(() => {
    if (id !== "counselor" || counselor !== null) return;
    buildCounselorSystemPrompt()
      .then(setCounselor)
      .catch(() => setCounselor("Couldn't put the conversation prompt together right now."));
  }, [id, counselor]);

  const raw = id === "counselor" ? (counselor ?? "Loading…") : FIXED[id];
  // The prompts are wrapped at ~80 columns in code; rejoin those lines so the
  // text flows on a narrow screen. Lists and headings keep their breaks.
  const text = raw.replace(/([^\n:])\n(?=[a-z("'“])/g, "$1 ");
  const current = PROMPTS.find((p) => p.id === id)!;

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-1 flex flex-wrap gap-1" role="group" aria-label="Which instructions">
        {PROMPTS.map((p) => (
          <button key={p.id} onClick={() => setId(p.id)} aria-pressed={id === p.id} className="seg">
            {p.label}
          </button>
        ))}
      </div>
      <p className="hint">{current.note}</p>
      <pre className="selectable max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-rule bg-sheet p-3 font-mono text-[11.5px] leading-relaxed text-ink-soft">
        {text}
      </pre>
    </div>
  );
}
