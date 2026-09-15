import { getAllSettings } from "../db/settings";
import { getApiKey, getCloudApiKey } from "../secrets";
import { createAnthropicProvider } from "./providers/anthropic";
import { createCloudProvider, presetForBaseUrl, DEFAULT_CLOUD_MAX_TOKENS } from "./providers/cloud";
import { createOllamaProvider } from "./providers/ollama";
import { computerTransport } from "./providers/pc";
import type { AIProvider } from "./types";

export const MOBILE_PROVIDERS = ["cloud", "anthropic", "pc"] as const;

/**
 * Reads Settings and returns the configured provider.
 * - "cloud": a hosted OpenAI-compatible endpoint with a free tier (Groq,
 *   Gemini, OpenRouter…). The default: free, needs only a key.
 * - "anthropic": console.anthropic.com API key, billed pay-as-you-go.
 * - "pc": the local model on a paired computer, through Ember there, while
 *   both are on the same Wi-Fi. The computer picks the model.
 * A setting left over from anything else falls back to "cloud", so the chat
 * says "add a key" instead of naming a provider the phone doesn't have.
 */
export async function getProvider(): Promise<AIProvider> {
  const settings = await getAllSettings();

  switch (settings.provider) {
    case "pc":
      // The computer replaces the model name and context size with its own.
      return createOllamaProvider({ model: "computer", transport: computerTransport() });
    case "anthropic":
      return createAnthropicProvider({
        apiKey: await getApiKey(),
        model: settings.model || "claude-sonnet-5",
      });
    case "cloud":
    default:
      return createCloudProvider({
        baseUrl: settings.cloud_api_base,
        model: settings.model || "qwen/qwen3.6-27b",
        apiKey: await getCloudApiKey(),
        maxTokens:
          Number(settings.cloud_max_tokens) ||
          presetForBaseUrl(settings.cloud_api_base)?.maxTokens ||
          DEFAULT_CLOUD_MAX_TOKENS,
      });
  }
}
