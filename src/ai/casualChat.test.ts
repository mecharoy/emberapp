import { describe, expect, it, vi } from "vitest";

vi.mock("../db/client", () => ({ getDb: async () => ({ select: async () => [], execute: async () => ({}) }) }));

import { fitChat } from "./casualChat";
import { casualChatPrompt, CHAT_APPROACHES } from "./prompts/chat";
import type { ChatMessage } from "./types";

const layers = {
  userName: "Amy",
  nowLine: "Thursday, 2026-10-09, 14:32",
  tone: "Warm and direct.",
  approach: "therapist" as const,
  about: "A PhD student juggling thesis deadlines.",
  memory: "People:\n- Dad: they argue about the move",
  lately: "- 2026-10-08: A long writing day",
};

describe("casualChatPrompt", () => {
  it("carries the chosen approach, the safety rules and what Elytra knows", () => {
    const p = casualChatPrompt(layers);
    expect(p).toContain("Amy's companion");
    expect(p).toContain(CHAT_APPROACHES.therapist);
    expect(p).toContain("findahelpline.com");
    expect(p).toContain("never advise on medication");
    expect(p).toContain("A long writing day");
  });

  it("never asks the chat to work through a checklist", () => {
    for (const approach of ["friend", "coach", "therapist"] as const) {
      expect(casualChatPrompt({ ...layers, approach })).not.toMatch(/work through the checklist/i);
    }
  });
});

describe("fitChat", () => {
  const msg = (role: "user" | "assistant", content: string): ChatMessage => ({ role, content });
  const big = { mode: "full" as const, totalTokens: 180000, replyTokens: 2000 };
  const small = { mode: "compact" as const, totalTokens: 1600, replyTokens: 300 };

  it("keeps the whole chat when it fits", () => {
    const history = [msg("user", "hi"), msg("assistant", "hello"), msg("user", "rough day")];
    expect(fitChat(history, "system", big)).toEqual(history);
  });

  it("drops the oldest turns first and always starts on something they said", () => {
    const history = Array.from({ length: 40 }, (_, i) => msg(i % 2 === 0 ? "user" : "assistant", `message ${i} ${"x".repeat(400)}`));
    const fitted = fitChat(history, "system", small);
    expect(fitted.length).toBeLessThan(history.length);
    expect(fitted[0].role).toBe("user");
    expect(fitted[fitted.length - 1]).toEqual(history[history.length - 1]);
  });

  it("always sends the newest message, even a long one", () => {
    const history = [msg("user", "y".repeat(20000))];
    expect(fitChat(history, "system", small)).toEqual(history);
  });
});
