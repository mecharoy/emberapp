import { Channel, invoke } from "@tauri-apps/api/core";
import { ProviderError } from "../types";
import { linesFromEvents, type ChatEvent, type OllamaTransport } from "./ollama";

// The model on the computer, reached through Ember there (lan_client.rs).
// The computer picks the model and its context size; the phone sends the
// conversation and gets Ollama's reply lines back.

function statusError(status: number, detail: string | null): ProviderError {
  if (status === 409) {
    return new ProviderError("The computer isn't using a local model.", "On the computer, choose Local model in Settings > AI provider.");
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
