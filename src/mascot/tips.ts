import { IS_WEB } from "../edition";

/**
 * The beetle's tips: how to use Elytra and what is worth a look, one at a
 * time, under its line about the day (Dock.tsx, Perch).
 *
 * Written here, not by a model, for the same reasons as companion.ts: a tap
 * answers at once, offline, and cannot make anything up. The tip changes by
 * itself once a day, and "Next tip" moves on whenever they like; neither is
 * random, so the same tap on the same day shows the same tip.
 *
 * Each tip names a real place in the app, in the words the app uses for it.
 * If a button or a section is renamed, change its tip too.
 *
 * Shared by elytra-desktop and elytra-mobile except PLATFORM_TIPS.
 */

/** Phone only. The web edition (iPhone) has no reminders and no computer link. */
const PLATFORM_TIPS: string[] = IS_WEB
  ? ["Add Elytra to your home screen and it opens like an app, even offline."]
  : [
      "Settings › You can remind you to jot a note a few times a day. Answer right in the notification.",
      "Elytra on a computer too? Settings › Sync with computer pairs them on the same Wi-Fi.",
    ];

export const TIPS: string[] = [
  "Note things as they happen with the + at the end of the dock. A few words is plenty.",
  "In the evening, open Today and press Start the conversation. I ask about your notes, then write the entry for you.",
  "The check-in on Today is optional. Mood and sleep there make Patterns sharper.",
  "Want to talk without writing anything up? Chat is for that, at any hour.",
  "In Chat, press Change to pick how I talk: like a friend, a coach, or a therapist.",
  ...PLATFORM_TIPS,
  "Journal keeps every day as a card. Open one to read it, or to talk through a day you missed.",
  "Patterns opens with a recap of your week. Press Play.",
  "Patterns has a tab for each part: mood, your days, body and rhythm, mind, and the letters I write you.",
  "Most sections in Patterns have an i button: how to read them, and the research behind them.",
  "Each week I write you a short letter about it. Find it under Patterns › Letters & ideas.",
  "Settings › Conversation sets how long the evening talk runs and how I sound.",
  "Everything stays on this device. Back it up from Settings › Data.",
];

/** The tip for a day: moves on by one each day, plus however many times
 *  "Next tip" was pressed (`offset`, kept in settings as companion_tip). */
export function tipIndex(date: string, offset: number): number {
  const day = Math.floor(new Date(`${date}T12:00:00`).getTime() / 86_400_000);
  const n = TIPS.length;
  return (((day + offset) % n) + n) % n;
}

/** What the beetle says the very first time it speaks up by itself. */
export const INTRODUCTION =
  "Hi, I'm Elytra. Tap me any time: I'll tell you where your day is, and a tip on what to try.";
