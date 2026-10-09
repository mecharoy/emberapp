import { createContext, useContext } from "react";
import { CHAPTER_COLORS } from "./palette";

/**
 * The five chapters of Patterns, each with its own colour and drawing, so a
 * glance says which part of the page you are in (2026-10-09, after people
 * found the page one long run of the same text).
 *
 * The colour is identity, never text: it marks the icon, the tab's dot and
 * the bar beside a section title, always next to the chapter's name. Values
 * live in palette.ts, which swaps them with the theme.
 */

export type ChapterId = "mood" | "days" | "body" | "mind" | "letters";

export const chapterColor = (id: ChapterId): string => CHAPTER_COLORS[id];

/** Field-guide drawings: one stroke weight, nothing filled. */
export function ChapterIcon({ id, size = 20, color }: { id: ChapterId; size?: number; color?: string }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color ?? chapterColor(id),
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (id) {
    case "mood": // a pulse line: how the days have been running
      return (
        <svg {...common}>
          <path d="M3 12.5h4l2.2-5.5 4.2 11 2.3-5.5H21" />
        </svg>
      );
    case "days": // two people: who is in your days, and what comes up with them
      return (
        <svg {...common}>
          <circle cx="9" cy="8.2" r="3" />
          <path d="M3.5 19.5c.4-3.3 2.6-5.3 5.5-5.3s5.1 2 5.5 5.3" />
          <circle cx="16.8" cy="9.4" r="2.3" />
          <path d="M16.6 14.3c2.3.2 3.7 1.8 4 4.6" />
        </svg>
      );
    case "body": // a moon: sleep and the shape of the day
      return (
        <svg {...common}>
          <path d="M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.2 6.2 0 0 0 10.1 10.1z" />
        </svg>
      );
    case "mind": // a thought: the words you use and the stories you tell
      return (
        <svg {...common}>
          <path d="M7.4 15.2a3.7 3.7 0 0 1-.4-7.3 4.9 4.9 0 0 1 9.4-.8 3.8 3.8 0 0 1 .8 7.5 2.9 2.9 0 0 1-4.1.9 3.6 3.6 0 0 1-5.7-.3z" />
          <circle cx="6.8" cy="18.6" r="1.1" />
          <circle cx="4.6" cy="21" r=".6" />
        </svg>
      );
    default: // letters: an envelope
      return (
        <svg {...common}>
          <rect x="3" y="5.6" width="18" height="13" rx="2" />
          <path d="M3.8 7.2l8.2 6 8.2-6" />
        </svg>
      );
  }
}

/** The chapter a section is drawn inside, so ModuleCard can wear its colour. */
export const ChapterContext = createContext<ChapterId | null>(null);

export function useChapter(): ChapterId | null {
  return useContext(ChapterContext);
}
