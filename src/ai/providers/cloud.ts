import type { AIProvider } from "../types";
import { ProviderError } from "../types";
import { createOpenAiCompatibleProvider } from "./openaiCompatible";

export interface CloudConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  maxTokens?: number;
}

/** Used when a custom endpoint has no preset to take a ceiling from. Low
 *  enough to clear the tightest free tier seen so far (Groq: 1000 output
 *  tokens a minute), at the cost of truncating a long weekly-review letter. */
export const DEFAULT_CLOUD_MAX_TOKENS = 900;

/**
 * A hosted OpenAI-compatible endpoint reached with a bearer token — used for
 * the providers that give away a standing free tier, so Ember can run at no
 * cost without a local model. Text does leave the machine here, which is why
 * it is a separate choice from `local` and never the default.
 *
 * Only the hosts below are reachable: every one of them is also listed in the
 * http allowlist in src-tauri/capabilities/default.json, and Tauri blocks the
 * rest. Adding a provider means editing both places.
 */
export interface CloudPreset {
  id: string;
  /** What the user sees in the picker. */
  label: string;
  baseUrl: string;
  /** A model that was free at the time of writing; editable in Settings. */
  model: string;
  /** Where to get a key. */
  keysUrl: string;
  /** One line on the free tier, shown under the picker. */
  note: string;
  /** Ceiling on one reply. Must stay under the tier's output-per-minute
   *  allowance, which the provider checks *before* generating anything. */
  maxTokens: number;
  /** Provider-specific body fields, e.g. switching a reasoning model's
   *  scratchpad off so it neither shows up in chat nor spends the reply's
   *  tokens. Only sent to this endpoint. */
  extraBody?: Record<string, unknown>;
}

export const CLOUD_PRESETS: CloudPreset[] = [
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    model: "qwen/qwen3.6-27b",
    keysUrl: "https://console.groq.com/keys",
    maxTokens: 900,
    // qwen3.6 is a reasoning model: without this it streams its scratchpad as
    // the reply and spends most of the 900-token ceiling on it.
    extraBody: { reasoning_effort: "none" },
    note: "Free tier, no card. Very fast; capped per minute and per day. Groq retires model names on a schedule — check console.groq.com/docs/models if one stops working.",
  },
  {
    id: "gemini",
    label: "Google AI Studio (Gemini)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    // Flash-Lite: the bigger Flash models run out of free capacity (503) far more often.
    model: "gemini-3.5-flash-lite",
    keysUrl: "https://aistudio.google.com/apikey",
    maxTokens: 4096,
    note: "Free tier, no card. Uses Flash-Lite, which is busy less often than the bigger models; free requests may be used to improve Google's models.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    model: "openrouter/free",
    keysUrl: "https://openrouter.ai/keys",
    maxTokens: 2048,
    note: "Free tier, no card. `openrouter/free` picks a free model for you; roughly 50 requests a day.",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1/chat/completions",
    model: "qwen-3.8-27b",
    keysUrl: "https://cloud.cerebras.ai",
    maxTokens: 2048,
    note: "Free tier, no card. Fast, with a daily token allowance.",
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1/chat/completions",
    model: "mistral-small-latest",
    keysUrl: "https://console.mistral.ai/api-keys",
    maxTokens: 4096,
    note: "Free experimentation tier, no card.",
  },
];

export function presetForBaseUrl(baseUrl: string): CloudPreset | undefined {
  return CLOUD_PRESETS.find((p) => p.baseUrl === baseUrl);
}

export function createCloudProvider(config: CloudConfig): AIProvider {
  if (!config.baseUrl) {
    throw new ProviderError(
      "No free-provider endpoint configured.",
      "Pick a provider in Settings > AI provider.",
    );
  }
  if (!config.apiKey) {
    throw new ProviderError(
      "No API key for the free provider.",
      "Paste the key from the provider's site in Settings > AI provider.",
    );
  }
  const preset = presetForBaseUrl(config.baseUrl);
  return createOpenAiCompatibleProvider({
    ...config,
    kind: "cloud",
    maxTokens: config.maxTokens || preset?.maxTokens || DEFAULT_CLOUD_MAX_TOKENS,
    extraBody: preset?.extraBody,
  });
}
