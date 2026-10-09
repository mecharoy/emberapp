// What the casual chat (windows/Chat.tsx) sends the model: the system prompt
// from prompts/chat.ts, filled in, and the part of the chat that fits.
//
// This file is the same in elytra-desktop and elytra-mobile: change both.

import { getSetting } from "../db/settings";
import { getProfileSummary } from "../db/profile";
import { listMemoryFiles } from "../db/memoryFiles";
import { listRecentDayMetrics } from "../db/metrics";
import { localDateKey } from "../time";
import { formatTodayLine } from "./context";
import { contextBudget, type ContextBudget } from "./budget";
import { estimateTokens } from "./tokens";
import { formatMemoryFiles, memoryPool } from "./memoryFiles";
import { clip, pickRelevant } from "./relevance";
import { parseStyle, styleInstructions, type ConversationApproach } from "./prompts/style";
import { casualChatPrompt } from "./prompts/chat";
import { EMPTY_PROFILE_SUMMARY } from "./prompts/counselor";
import type { ChatMessage } from "./types";

/** The approach a chat uses: its own, when it was started in one, otherwise
 *  the one picked in Settings. */
export async function chatApproach(threadApproach: string): Promise<ConversationApproach> {
  const fromSettings = await getSetting("conversation_approach");
  return parseStyle("", threadApproach || fromSettings).approach;
}

function nowLine(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${formatTodayLine(localDateKey(d))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The system prompt for one chat. Built once when the chat opens and reused
 * for every turn, so a provider's cached prefix survives the whole chat.
 * `opening` is what they said first; a small model gets only the memory
 * lines that match it.
 */
export async function buildChatSystem(approach: ConversationApproach, opening: string): Promise<string> {
  const [budget, userName, toneSetting, profile, files, recent] = await Promise.all([
    contextBudget(),
    getSetting("user_name"),
    getSetting("conversation_tone"),
    getProfileSummary(),
    listMemoryFiles(),
    listRecentDayMetrics(4),
  ]);
  const compact = budget.mode === "compact";
  const lately = recent
    .filter((m) => m.summary_line)
    .reverse()
    .map((m) => `- ${m.date}: ${m.summary_line}`)
    .join("\n");
  const memory = compact
    ? pickRelevant(await memoryPool(localDateKey()), opening, 500)
    : formatMemoryFiles(files);
  return casualChatPrompt({
    userName: userName.trim(),
    nowLine: nowLine(),
    tone: styleInstructions(parseStyle(toneSetting, approach)).tone,
    approach,
    about: profile?.trim() ? (compact ? clip(profile.trim(), 250) : profile.trim()) : EMPTY_PROFILE_SUMMARY,
    memory,
    lately: lately || "(no entries yet)",
  });
}

/**
 * The newest part of the chat that fits beside the system prompt, starting
 * on something they said (some providers refuse a chat that opens with the
 * assistant). Pure; tested in casualChat.test.ts.
 */
export function fitChat(history: ChatMessage[], system: string, budget: ContextBudget): ChatMessage[] {
  const room = Math.max(600, budget.totalTokens - budget.replyTokens - estimateTokens(system) - 200);
  const cap = budget.mode === "compact" ? 16 : 60;
  const kept: ChatMessage[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0 && kept.length < cap; i--) {
    const cost = estimateTokens(history[i].content) + 4;
    if (kept.length > 0 && used + cost > room) break;
    kept.unshift(history[i]);
    used += cost;
  }
  while (kept.length > 1 && kept[0].role !== "user") kept.shift();
  return kept;
}
