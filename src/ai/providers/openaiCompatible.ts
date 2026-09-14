import { fetch } from "@tauri-apps/plugin-http";
import type { AIProvider, ChatMessage } from "../types";
import { applyTurnPreamble, ProviderError } from "../types";
import { createReasoningFilter, stripReasoning } from "./reasoning";
import { fetchWithRetry, TRANSIENT_STATUSES } from "./retry";

export interface OpenAiCompatibleConfig {
  /** Full chat-completions URL, e.g. http://localhost:11434/v1/chat/completions */
  baseUrl: string;
  model: string;
  /** Sent as `Authorization: Bearer …`. Omitted for localhost, which needs none. */
  apiKey?: string;
  /** Ceiling on the reply, sent as `max_tokens`. Omitted when unset, which
   *  lets the endpoint use its own default — fine locally, but hosted free
   *  tiers refuse a request whose *expected* output exceeds their per-minute
   *  output allowance, so for those it must be set and kept under the cap. */
  maxTokens?: number;
  /** Extra body fields for this endpoint only — provider-specific switches
   *  such as Groq's `reasoning_effort`. Never sent to an endpoint that was
   *  not declared with them, since an unknown field is a 400 on some. */
  extraBody?: Record<string, unknown>;
  /** Only changes the wording of the errors, never the request. */
  kind: "local" | "cloud";
}

const UNREACHABLE_HINT: Record<OpenAiCompatibleConfig["kind"], string> = {
  local:
    "Is Ollama/LM Studio running? Note: Ember's security policy only allows " +
    "localhost endpoints (http://localhost:… or http://127.0.0.1:…) — LAN or " +
    "remote URLs are blocked. Check Settings > Local endpoint base URL.",
  cloud:
    "Check the endpoint address in Settings. Ember's network policy only allows " +
    "the providers listed there — any other host is blocked, even with a valid key.",
};

function toOpenAiMessages(messages: ChatMessage[], system: string) {
  return [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))];
}

async function callEndpoint(
  config: OpenAiCompatibleConfig,
  messages: ChatMessage[],
  system: string,
  stream: boolean,
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

  const body = JSON.stringify({
    model: config.model,
    stream,
    ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
    ...(config.extraBody ?? {}),
    messages: toOpenAiMessages(messages, system),
  });
  let res: Response;
  let attempts = 1;
  try {
    ({ res, attempts } = await fetchWithRetry(() => fetch(config.baseUrl, { method: "POST", headers, body })));
  } catch {
    throw new ProviderError(`Could not reach the endpoint at ${config.baseUrl}.`, UNREACHABLE_HINT[config.kind]);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error?.message ?? body?.error ?? "";
    } catch {
      // non-JSON error body — the status code alone will have to do
    }

    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(
        `The endpoint rejected the API key (${res.status}).`,
        detail ? String(detail) : "Paste a fresh key in Settings, and check it belongs to this provider.",
      );
    }
    if (res.status === 429) {
      // Two different 429s: "you have used your quota, wait" and "this single
      // request asks for more output than your tier allows". Only the first
      // one is worth waiting out, so they must not read the same.
      if (/request too large|max_tokens|expected output/i.test(String(detail))) {
        throw new ProviderError(
          "The free tier refused the request for asking for too long a reply (429).",
          `${String(detail)} — lower "Longest reply" in Settings > AI provider.`,
        );
      }
      throw new ProviderError(
        "The provider's free-tier limit was hit (429).",
        detail
          ? String(detail)
          : "Free tiers cap requests per minute and per day. Wait a bit, or switch model/provider in Settings.",
      );
    }
    if (TRANSIENT_STATUSES.has(res.status)) {
      // Busy on the provider's side (Gemini's free tier answers 503 when a
      // model is out of capacity). Already retried with backoff by now.
      const gemini = config.baseUrl.includes("generativelanguage.googleapis.com");
      throw new ProviderError(
        `The provider is overloaded right now (${res.status}), still after ${attempts} tries.`,
        [
          detail ? String(detail) : "",
          "This is on their side and usually passes within a minute. Press Retry",
          gemini
            ? "or pick another service in Settings > AI provider."
            : "or switch model or service in Settings > AI provider.",
        ]
          .filter(Boolean)
          .join(" "),
      );
    }
    if (res.status === 404) {
      // Nearly always the model name, not the URL: hosted providers retire
      // model ids on a schedule, so a preset that worked last month 404s.
      throw new ProviderError(
        `The endpoint returned 404 — the model "${config.model}" may not exist there.`,
        String(detail) ||
          (config.kind === "local"
            ? `Try \`ollama pull ${config.model}\`, or fix the model name in Settings.`
            : "Hosted providers retire model names. Check the provider's model list and fix the name in Settings."),
      );
    }
    throw new ProviderError(
      `Endpoint error (${res.status}).`,
      String(detail) || "Check the endpoint address and model name in Settings.",
    );
  }

  return res;
}

/**
 * Any OpenAI-compatible /v1/chat/completions endpoint. Two providers are
 * built on it: `local` (Ollama/LM Studio, no key, fully offline) and `cloud` (a hosted free tier reached with a bearer token).
 */
export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): AIProvider {
  return {
    async *chatStream(messages, system, options) {
      const res = await callEndpoint(
        config,
        applyTurnPreamble(messages, options?.turnPreamble),
        system,
        true,
      );
      const body = res.body;
      if (!body) throw new ProviderError("The endpoint's response had no stream body.");

      const reader = body.getReader();
      const decoder = new TextDecoder();
      const reasoning = createReasoningFilter();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // OpenAI-style SSE: one `data: {...}` JSON per line, `data: [DONE]` ends.
          let nl = buffer.indexOf("\n");
          while (nl !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            nl = buffer.indexOf("\n");
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const event = JSON.parse(payload);
              const text = event?.choices?.[0]?.delta?.content;
              if (typeof text === "string" && text.length > 0) {
                const shown = reasoning.push(text);
                if (shown.length > 0) yield shown;
              }
            } catch {
              // partial JSON split across chunks — rare with line-delimited SSE,
              // but skipping a malformed line beats killing the stream
            }
          }
        }
        const tail = reasoning.flush();
        if (tail.length > 0) yield tail;
      } finally {
        // Consumer stopped early (user hit Stop) — close the HTTP stream.
        reader.cancel().catch(() => {});
      }
    },

    async complete(messages, system, options) {
      const res = await callEndpoint(
        config,
        applyTurnPreamble(messages, options?.turnPreamble),
        system,
        false,
      );
      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text === "string" && text.length > 0) return stripReasoning(text);
      throw new ProviderError("The endpoint's response did not contain text content.");
    },
  };
}
