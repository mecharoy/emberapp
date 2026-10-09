import { useEffect, useState, type ReactNode } from "react";
import Beetle from "../mascot/Beetle";
import { NavIcon, TABS } from "./Dock";
import { SCIENCE_HIGHLIGHTS } from "../insights/science";

/**
 * The first-run tour: the beetle shows how Elytra works, one page at a time,
 * pointing at the plate in the dock where each thing lives. It replaced a
 * single page of three lines and a list of studies, which told people what
 * the app believed but not what to press.
 *
 * Every step names a real button in the words the app uses for it. If one is
 * renamed, change it here too (and in mascot/tips.ts).
 *
 * The same file in elytra-desktop and elytra-mobile; what differs comes in as
 * props.
 */

interface Step {
  title: string;
  text: string;
  /** The dock plate this step is about; "note" is the + button. */
  plate: string | null;
}

export default function Tour({
  noteHow,
  device,
  onDone,
  footer,
}: {
  /** How to take a note on this device, as the end of a sentence. */
  noteHow: string;
  /** "computer" or "phone". */
  device: string;
  onDone: () => void;
  /** Under the first step: restoring a backup, pairing the other device. */
  footer?: ReactNode;
}) {
  const steps: Step[] = [
    {
      title: "Hi, I'm Elytra.",
      text: "A journal that does the writing for you. You jot a line when something happens. In the evening I ask you about it, then write the day up.",
      plate: null,
    },
    {
      title: "Note it as it happens",
      text: `${noteHow} A few words is enough: "argued with Sam", "good run", "can't focus".`,
      plate: "note",
    },
    {
      title: "Talk it through in the evening",
      text: "Open Today and press Start the conversation. I ask about your notes, one question at a time, and write the entry when you're done. A quick check-in on mood and sleep is there if you want it.",
      plate: "today",
    },
    {
      title: "Chat any time",
      text: "Chat is for everything else: venting, thinking out loud, a rough moment at 2 a.m. Pick how I talk: like a friend, a coach, or a therapist. It never goes into your journal.",
      plate: "chat",
    },
    {
      title: "See what comes back",
      text: "Journal keeps every day as a card. Patterns shows what your days have in common: mood, people, sleep, habits, and a short letter from me each week.",
      plate: "insights",
    },
    {
      title: "Private, and yours",
      text: `Everything stays on this ${device}. You choose the AI that does the reading, and can change it any time. Tap me whenever you want a tip.`,
      plate: null,
    },
  ];

  const [at, setAt] = useState(0);
  const [why, setWhy] = useState(false);
  const step = steps[at];
  const last = at === steps.length - 1;

  // Arrow keys and Enter move through it, so it never needs a mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") setAt((i) => Math.min(i + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setAt((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps.length]);

  return (
    <div className="page mx-auto flex min-h-full max-w-[600px] flex-col px-6 pb-10 pt-10">
      <div className="flex items-center justify-between">
        <span className="spec">
          {at + 1} of {steps.length}
        </span>
        {!last && (
          <button onClick={onDone} className="btn-ghost -mr-3">
            Skip the tour
          </button>
        )}
      </div>

      {/* The beetle speaks; the green card is always Elytra talking. */}
      <div key={at} className="fade-up mt-8 flex items-start gap-4">
        <Beetle size={64} state={at === 0 ? "celebrate" : "idle"} className="shrink-0" />
        <div className="min-w-0 flex-1 rounded-[16px] bg-speak px-5 pb-4 pt-3.5 text-speak-fg">
          <span className="block font-mono text-[9.5px] uppercase leading-none tracking-[0.16em] text-speak-fg/80">
            Elytra
          </span>
          <h1 className="mt-2 font-serif text-[27px] leading-[1.1] tracking-[-0.01em]">{step.title}</h1>
          <p className="mt-2 text-[15.5px] leading-relaxed text-speak-fg/90">{step.text}</p>
        </div>
      </div>

      {/* Where it lives: the dock, with that plate lit. */}
      {step.plate && (
        <div className="fade-up mt-7 flex flex-col items-center gap-2" aria-hidden="true">
          <div className="dock pointer-events-none">
            <ul className="flex items-stretch justify-center gap-0.5">
              {TABS.map((tab) => (
                <li key={tab.id} className="flex">
                  <span className={`dock-tab${step.plate === tab.id ? " on" : ""}`}>
                    <NavIcon id={tab.id} />
                    <span className="dock-label">{tab.label}</span>
                  </span>
                </li>
              ))}
            </ul>
            <span className="dock-seam" />
            <span className={`dock-end dock-note ${step.plate === "note" ? "!bg-moss !text-ground" : ""}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M12 6v12M6 12h12" />
              </svg>
            </span>
          </div>
          <span className="spec">at the bottom of every page</span>
        </div>
      )}

      {last && (
        <div className="mt-6">
          <button onClick={() => setWhy((v) => !v)} aria-expanded={why} className="text-[13.5px] text-moss underline-offset-2 hover:underline">
            {why ? "Hide" : "Where the reading comes from"}
          </button>
          {why && (
            <ul className="fade-up mt-3 flex flex-col divide-y divide-line border-y border-line">
              {SCIENCE_HIGHLIGHTS.map((h) => (
                <li key={h.title} className="flex flex-col gap-1 py-3">
                  <span className="spec-strong">{h.title}</span>
                  <span className="text-[13.5px] leading-snug text-fg-dim">{h.line}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-8 flex items-center justify-center gap-1.5" aria-hidden="true">
        {steps.map((_, i) => (
          <span key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === at ? "w-5 bg-moss" : "w-1.5 bg-line-strong"}`} />
        ))}
      </div>

      <div className="mt-6 flex gap-2">
        {at > 0 && (
          <button onClick={() => setAt(at - 1)} className="btn-subtle flex-1">
            Back
          </button>
        )}
        <button onClick={() => (last ? onDone() : setAt(at + 1))} className="btn-primary flex-[2]">
          {last ? "Set it up" : "Next"}
        </button>
      </div>

      {at === 0 && footer && <div className="mt-3 flex flex-col text-center">{footer}</div>}
    </div>
  );
}
