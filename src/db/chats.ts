import { getDb } from "./client";
import type { ChatMessage, ChatThread } from "./types";
import { isoNowLocal } from "../time";

// Casual chat (migration 0015): conversations about anything, any time, kept
// apart from the day's journal conversation. Both tables sync (db/sync.ts),
// keyed by uid, so a chat started on the phone carries on at the computer.
//
// This file is the same in elytra-desktop and elytra-mobile: change both.

/** A random id. The uid triggers of 0011 do this in SQL for the older tables;
 *  these rows are made with their uid already set. */
function newUid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A thread's title: the start of its first message, on one line. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

/** Newest first. */
export async function listChatThreads(): Promise<ChatThread[]> {
  const db = await getDb();
  return db.select<ChatThread[]>("SELECT * FROM chat_threads ORDER BY updated_at DESC");
}

export async function getChatThread(uid: string): Promise<ChatThread | null> {
  const db = await getDb();
  const rows = await db.select<ChatThread[]>("SELECT * FROM chat_threads WHERE uid = $1", [uid]);
  return rows[0] ?? null;
}

export async function createChatThread(approach: string): Promise<ChatThread> {
  const db = await getDb();
  const now = isoNowLocal();
  const thread: ChatThread = { uid: newUid(), title: "", approach, created_at: now, updated_at: now };
  await db.execute(
    "INSERT INTO chat_threads (uid, title, approach, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
    [thread.uid, thread.title, thread.approach, thread.created_at, thread.updated_at],
  );
  return thread;
}

export async function setChatApproach(uid: string, approach: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE chat_threads SET approach = $1 WHERE uid = $2", [approach, uid]);
}

/** Oldest first. */
export async function listChatMessages(threadUid: string): Promise<ChatMessage[]> {
  const db = await getDb();
  return db.select<ChatMessage[]>(
    "SELECT * FROM chat_messages WHERE thread_uid = $1 ORDER BY created_at ASC, rowid ASC",
    [threadUid],
  );
}

/** Adds a message and moves the thread to the top of the list. The first
 *  thing they say becomes the thread's title. */
export async function addChatMessage(threadUid: string, role: "user" | "assistant", content: string): Promise<void> {
  const db = await getDb();
  const now = isoNowLocal();
  await db.execute(
    "INSERT INTO chat_messages (uid, thread_uid, role, content, created_at) VALUES ($1, $2, $3, $4, $5)",
    [newUid(), threadUid, role, content, now],
  );
  if (role === "user") {
    await db.execute(
      "UPDATE chat_threads SET updated_at = $1, title = CASE WHEN title = '' THEN $2 ELSE title END WHERE uid = $3",
      [now, titleFrom(content), threadUid],
    );
  } else {
    await db.execute("UPDATE chat_threads SET updated_at = $1 WHERE uid = $2", [now, threadUid]);
  }
}

/** Removes a chat and everything said in it, on both devices at the next sync. */
export async function deleteChatThread(uid: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM chat_messages WHERE thread_uid = $1", [uid]);
  await db.execute("DELETE FROM chat_threads WHERE uid = $1", [uid]);
}
