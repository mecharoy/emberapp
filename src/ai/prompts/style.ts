// How the evening conversation sounds, picked by the user at setup or in
// Settings: a tone and an approach. Each choice has the words shown to the
// user and the instruction the counselor prompt carries.

export type ConversationTone = "gentle" | "balanced" | "blunt";
export type ConversationApproach = "friend" | "coach" | "therapist";

export interface ConversationStyle {
  tone: ConversationTone;
  approach: ConversationApproach;
}

export const DEFAULT_STYLE: ConversationStyle = { tone: "balanced", approach: "coach" };

export const TONES: { id: ConversationTone; label: string; blurb: string; instruction: string }[] = [
  {
    id: "gentle",
    label: "Gentle",
    blurb: "Soft and patient.",
    instruction: `Gentle. Soft, unhurried, patient wording. Acknowledge how something
felt before anything else. Never blunt, never sarcastic, never rushed.`,
  },
  {
    id: "balanced",
    label: "Warm and direct",
    blurb: "Kind, plain-spoken, no fluff.",
    instruction: `Warm and direct. Kind and plain-spoken, no fluff. Say what you notice
clearly and simply.`,
  },
  {
    id: "blunt",
    label: "Blunt",
    blurb: "Short and straight to the point.",
    instruction: `Blunt. Short sentences, no cushioning, no pleasantries, no gushing. Say
things straight. Kind in intent, never harsh about them as a person.`,
  },
];

export const APPROACHES: { id: ConversationApproach; label: string; blurb: string; instruction: string }[] = [
  {
    id: "friend",
    label: "Friend",
    blurb: "Mostly listens and reflects. Almost no pushback.",
    instruction: `Friend. Mostly listen and reflect back what you heard. Follow-ups are
about what happened and how it felt. Don't challenge their view of things
and don't point out patterns unless they ask what you think.`,
  },
  {
    id: "coach",
    label: "Coach",
    blurb: "Curious follow-ups, gentle pushback when something doesn't add up.",
    instruction: `Coach. Curious follow-ups. When something doesn't add up (their notes
and their story disagree, or they say "always" or "never"), point it out
gently, at most once or twice a session, and ask before challenging. When
they ask for advice, offer one small concrete step.`,
  },
  {
    id: "therapist",
    label: "Therapist-style",
    blurb: "Asks what's underneath, names patterns, questions unhelpful thinking.",
    instruction: `Therapist-style. Reflective and exploratory. Ask what sits underneath a
feeling, notice patterns across their days, and question unhelpful thinking
(catastrophising, mind-reading, all-or-nothing) the way cognitive
behavioural therapy does: ask what the evidence is, offer another way to
see it, and let them decide. Push back more readily, always with care. You
are still not their therapist: never diagnose or use clinical labels.`,
  },
];

export function parseStyle(tone: string, approach: string): ConversationStyle {
  return {
    tone: TONES.some((t) => t.id === tone) ? (tone as ConversationTone) : DEFAULT_STYLE.tone,
    approach: APPROACHES.some((a) => a.id === approach) ? (approach as ConversationApproach) : DEFAULT_STYLE.approach,
  };
}

export function styleInstructions(style: ConversationStyle): { tone: string; approach: string } {
  return {
    tone: TONES.find((t) => t.id === style.tone)!.instruction,
    approach: APPROACHES.find((a) => a.id === style.approach)!.instruction,
  };
}
