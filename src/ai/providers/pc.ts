import { Channel, invoke } from "@tauri-apps/api/core";
import { ProviderError } from "../types";
import { linesFromEvents, type ChatEvent, type OllamaTransport } from "./ollama";

// The computer's AI, reached through Elytra there (lan_client.rs): its local
// model, or whatever provider it uses. The computer picks the model; the
// phone sends the conversation and gets Ollama-style reply lines back.

function statusError(status: number, detail: string | null): ProviderError {
  if (status === 409) {
    return new ProviderError("The computer's AI provider isn't set up.", "On the computer, check Settings > AI provider.");
  }
  if (status === 404) return new ProviderError("The computer's model isn't downloaded.", detail || undefined);
  if (status === 502) return new ProviderError("The computer couldn't reach Ollama.", "Check Settings > AI provider on the computer.");
  return new ProviderError(`The computer's model answered with an error (${status}).`, detail || undefined);
}

function failure(message: string): ProviderError {
  if (message.startsWith("unpaired:")) {
    return new ProviderError("This phone is no longer paired.", "Pair again in Settings > Sync with computer.");
  }
  return new ProviderError(message);
}

export function computerTransport(): OllamaTransport {
  return (body) => {
    const requestId = crypto.randomUUID();
    return linesFromEvents({
      start: (onEvent) => {
        const channel = new Channel<ChatEvent>();
        channel.onmessage = onEvent;
        return invoke("lan_chat", { requestId, body, onEvent: channel });
      },
      // Hanging up makes the computer stop the model.
      cancel: () => void invoke("lan_chat_cancel", { requestId }).catch(() => {}),
      statusError,
      failure,
    });
  };
}
