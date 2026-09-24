// The AI providers this edition offers, as the setup page and Settings show
// them in their drop-down.

import { IS_WEB } from "../edition";

const ALL_PROVIDERS = [
  { id: "cloud", name: "Free hosted model", blurb: "Groq, Gemini or OpenRouter. Needs a free key." },
  { id: "anthropic", name: "Anthropic API", blurb: "Claude, pay as you go. Needs a key." },
  { id: "openai", name: "OpenAI API", blurb: "ChatGPT's models, pay as you go. Needs a key." },
  { id: "pc", name: "Computer", blurb: "Whatever AI provider your paired computer uses." },
] as const;

/** The web edition has no computer link: a page can't reach the home network. */
export const PROVIDER_OPTIONS: readonly (typeof ALL_PROVIDERS)[number][] = IS_WEB
  ? ALL_PROVIDERS.filter((p) => p.id !== "pc")
  : ALL_PROVIDERS;

export function isKnownProvider(id: string): boolean {
  return PROVIDER_OPTIONS.some((p) => p.id === id);
}
