import { getAllSettings } from "../db/settings";
import { getApiKey, getCloudApiKey } from "../secrets";
import { createAnthropicProvider } from "./providers/anthropic";
import { createCloudProvider, presetForBaseUrl, DEFAULT_CLOUD_MAX_TOKENS } from "./providers/cloud";
import type { AIProvider } from "./types";

/** Both providers are plain HTTPS with an API key. */
export const MOBILE_PROVIDERS = ["cloud", "anthropic"] as const;

/**
 * Reads Settings and returns the configured provider.
 * - "cloud": a hosted OpenAI-compatible endpoint with a free tier (Groq,
 *   Gemini, OpenRouter…). The default: free, needs only a key.
 * - "anthropic": console.anthropic.com API key, billed pay-as-you-go.
 * A setting left over from anything else falls back to "cloud", so the chat
 * says "add a key" instead of naming a provider the phone doesn't have.
 */
export async function getProvider(): Promise<AIProvider> {
  const settings = await getAllSettings();

  switch (settings.provider) {
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
