import { useEffect, useRef, useState, type ReactNode } from "react";
import { SCIENCE, UNLOCK } from "../../insights/science";
import { chapterColor, useChapter } from "./chapters";

/** Section titles (open and locked) → their entry in insights/science.ts. */
const SCIENCE_BY_TITLE: Record<string, string> = {
  "Mood & energy": "mood",
  "Mood & energy over time": "mood",
  "Week rhythm": "rhythm",
  Themes: "themes",
  People: "people",
  Habits: "habits",
  "What moves your mood": "movers",
  "Emotional vocabulary": "emotions",
  "Wellbeing checks": "wellbeing",
  Sleep: "sleep",
  "Daily routine": "routine",
  "Activities & mood": "activities",
  "Thinking patterns": "thinking",
  Reviews: "reviews",
};

/** The ⓘ next to a section title and the note it opens: how to read the
 *  section and the study behind it. The note spans the section's width. */
function useInfo(title: string) {
  const id = SCIENCE_BY_TITLE[title] ?? "";
  const science = SCIENCE[id];
  const unlock = UNLOCK[id];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const button = science ? (
    <button
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      aria-label={`About ${title}`}
      className={`ml-2.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border font-serif text-[11px] italic leading-none transition-colors duration-150 ${
        open ? "border-moss bg-moss text-ground" : "border-line-strong text-fg-faint"
      }`}
    >
      i
    </button>
  ) : null;

  const note =
    science && open ? (
      <div
        role="dialog"
        className="fade-up absolute inset-x-0 top-full z-30 mt-2 flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 shadow-[0_14px_34px_-14px_rgba(29,34,29,0.4)]"
      >
        <p className="text-[14px] leading-relaxed text-fg">{science.read}</p>
        <p className="text-[13.5px] leading-relaxed text-fg-dim">{science.basis}</p>
        {science.caution && <p className="text-[13.5px] leading-relaxed text-fg-dim">{science.caution}</p>}
        {unlock && <p className="text-[13.5px] font-medium leading-relaxed text-moss">{unlock}</p>}
        <p className="border-t border-line pt-2 font-mono text-[11px] leading-snug text-fg-faint">{science.source}</p>
      </div>
    ) : null;

  return { ref, button, note };
}

/**
 * Shared chrome for a Patterns section. The heading is Epilogue, semibold,
 * beside a bar in its chapter's colour (chapters.tsx). It used to be the small
 * monospaced drawer label, which, with serif sentences under it, made the page
 * hard to read (2026-10-09). Instrument Serif stays for page titles and the
 * big numbers.
 */
export function ModuleCard({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const info = useInfo(title);
  const chapter = useChapter();
  return (
    <section className="fade-up border-t border-line pt-5">
      <div ref={info.ref} className="relative mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="flex items-center text-[16px] font-semibold leading-tight text-fg">
          {chapter && (
            <span className="mr-2.5 h-[18px] w-[3px] shrink-0 rounded-full" style={{ background: chapterColor(chapter) }} aria-hidden="true" />
          )}
          {title}
          {info.button}
        </h2>
        {aside}
        {info.note}
      </div>
      {children}
    </section>
  );
}

/** A section still gathering days: what it will show, and how far along it is. */
export function LockedModule({
  title,
  teaser,
  have,
  need,
}: {
  title: string;
  teaser: string;
  have?: number;
  need?: number;
}) {
  const counted = have !== undefined && need !== undefined;
  const pct = counted ? Math.min(100, Math.round((have / need) * 100)) : 0;
  const info = useInfo(title);
  return (
    <section className="border-t border-dashed border-line-strong pt-5">
      <div ref={info.ref} className="relative flex items-center justify-between gap-3">
        {info.note}
        <h2 className="flex items-center text-[15px] font-semibold leading-tight text-fg-dim">
          {title}
          {info.button}
        </h2>
        {counted && (
          <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-fg-faint">
            {Math.min(have, need)}/{need}
          </span>
        )}
      </div>
      <p className="mt-2 text-[14.5px] leading-snug text-fg-dim">{teaser}</p>
      {counted && (
        <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-surface-high" aria-hidden="true">
          <div className="h-full rounded-full bg-moss/70 transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}
    </section>
  );
}
