import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  addChatMessage,
  createChatThread,
  deleteChatThread,
  getChatThread,
  listChatMessages,
  listChatThreads,
  setChatApproach,
} from "../db/chats";
import type { ChatMessage, ChatThread } from "../db/types";
import type { ApplyResult } from "../db/sync";
import { getSetting } from "../db/settings";
import { getProvider } from "../ai/factory";
import { ProviderError } from "../ai/types";
import { buildChatSystem, chatApproach, fitChat } from "../ai/casualChat";
import { contextBudget } from "../ai/budget";
import { APPROACHES, parseStyle, type ConversationApproach } from "../ai/prompts/style";
import Beetle from "../mascot/Beetle";
import Wingbeat from "../components/Wingbeat";
import { typing, useMascotClaim } from "../mascot/pulse";
import { useBackButton } from "../useBackButton";

/**
 * The casual chat: talk about anything, at any hour, in the style picked in
 * Settings (or another one, just for this chat). It is kept apart from the
 * day — no check-in, no checklist, nothing to wrap up and no entry written —
 * so opening it never feels like starting the evening's homework.
 *
 * Chats are saved on this device and sync to a paired one (db/chats.ts).
 * A chat starts when they say something: the greeting is written here, not by
 * a model, so an empty chat costs nothing and leaves nothing behind.
 *
 * The same page is in elytra-desktop, which also keeps its local model clear
 * for the reply and sends on Enter.
 */

const MAX_INPUT_HEIGHT_PX = 160;
/** Coming back within this long carries on the last chat instead of a new one. */
const CARRY_ON_MS = 6 * 60 * 60 * 1000;

const STARTERS = [
  "I just need to vent.",
  "Something good happened.",
  "Help me think something through.",
  "I can't switch my head off.",
];

const SHORT: Record<ConversationApproach, string> = {
  friend: "a friend",
  coach: "a coach",
  therapist: "a therapist",
};

interface DisplayError {
  message: string;
  hint?: string;
}

function toDisplayError(e: unknown): DisplayError {
  if (e instanceof ProviderError) return { message: e.message, hint: e.hint };
  if (e instanceof Error) return { message: e.message };
  return { message: "Something went wrong talking to the AI provider." };
}

/** "Today 14:32", "Tue 09:10", "3 Oct" — for the list of earlier chats. */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  if (now.getTime() - d.getTime() < 6 * 86_400_000) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function Chat() {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // The style a chat not yet started will use.
  const [choice, setChoice] = useState<ConversationApproach>("coach");
  const [approach, setApproach] = useState<ConversationApproach>("coach");
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [stalled, setStalled] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [userName, setUserName] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const threadRef = useRef<ChatThread | null>(null);
  threadRef.current = thread;
  // Built once per chat and style, so the provider's cached prefix lasts.
  const systemRef = useRef<{ key: string; prompt: string } | null>(null);

  useMascotClaim("casual-chat", "thinking", busy);

  async function openThread(t: ChatThread | null) {
    setThread(t);
    setMessages(t ? await listChatMessages(t.uid) : []);
    setStreaming(null);
    setStalled(null);
    setError(null);
    setPicking(false);
    systemRef.current = null;
    const fromSettings = parseStyle("", await getSetting("conversation_approach")).approach;
    setChoice(fromSettings);
    setApproach(t ? await chatApproach(t.approach) : fromSettings);
  }

  // First visit: carry on a chat from the last few hours, or start fresh.
  useEffect(() => {
    (async () => {
      setUserName((await getSetting("user_name")).trim());
      const all = await listChatThreads();
      setThreads(all);
      const latest = all[0];
      const recent = latest && Date.now() - new Date(latest.updated_at).getTime() < CARRY_ON_MS;
      await openThread(recent ? latest : null);
      setLoaded(true);
    })();
  }, []);

  // The other device wrote to the chats: show it, unless a reply is arriving here.
  useEffect(() => {
    const unlisten = listen<ApplyResult>("sync:applied", async (event) => {
      if (!event.payload.tables.some((t) => t.startsWith("chat_")) || busyRef.current) return;
      setThreads(await listChatThreads());
      const current = threadRef.current;
      if (!current) return;
      const still = await getChatThread(current.uid);
      if (!still) await openThread(null);
      else setMessages(await listChatMessages(current.uid));
    });
    return () => {
      unlisten.then((u) => u());
    };
  }, []);

  // Autoscroll only when already near the bottom.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      bottomRef.current?.scrollIntoView({ behavior: streaming !== null ? "auto" : "smooth" });
    }
  }, [messages, streaming, stalled]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
  }, [draft]);

  // Back closes the list of earlier chats first.
  useBackButton(listOpen, () => setListOpen(false));

  async function systemFor(t: ChatThread, style: ConversationApproach, opening: string): Promise<string> {
    const key = `${t.uid}:${style}`;
    if (systemRef.current?.key === key) return systemRef.current.prompt;
    const prompt = await buildChatSystem(style, opening);
    systemRef.current = { key, prompt };
    return prompt;
  }

  async function runTurn(t: ChatThread, history: ChatMessage[]) {
    setBusy(true);
    setError(null);
    setStalled(null);
    setStreaming("");
    let stopRequested = false;
    const stopPromise = new Promise<void>((resolve) => {
      stopRef.current = () => {
        stopRequested = true;
        resolve();
      };
    });
    let full = "";
    try {
      const firstSaid = history.find((m) => m.role === "user")?.content ?? "";
      const system = await systemFor(t, approach, firstSaid);
      const provider = await getProvider();
      const fitted = fitChat(
        history.map((m) => ({ role: m.role, content: m.content })),
        system,
        await contextBudget(),
      );
      const iterator = provider.chatStream(fitted, system, { conversationId: `chat:${t.uid}` })[Symbol.asyncIterator]();
      while (true) {
        const next = await Promise.race([iterator.next(), stopPromise.then(() => "stopped" as const)]);
        if (next === "stopped") {
          try {
            await iterator.return?.();
          } catch {
            // cleanup is best-effort
          }
          break;
        }
        if (next.done) break;
        full += next.value;
        setStreaming(full);
      }
      if (full.trim().length === 0) {
        if (stopRequested) return;
        throw new ProviderError("The model returned an empty reply.");
      }
      await addChatMessage(t.uid, "assistant", full.trim());
      setMessages(await listChatMessages(t.uid));
      setThreads(await listChatThreads());
    } catch (e) {
      if (full.trim().length > 0) setStalled(full);
      setError(toDisplayError(e));
    } finally {
      stopRef.current = null;
      setStreaming(null);
      setBusy(false);
    }
  }

  async function handleSend(text = draft) {
    const said = text.trim();
    if (busy || !said) return;
    setDraft("");
    let t = thread;
    if (!t) {
      t = await createChatThread(choice);
      setThread(t);
      setApproach(choice);
    }
    await addChatMessage(t.uid, "user", said);
    const updated = await listChatMessages(t.uid);
    setMessages(updated);
    setThreads(await listChatThreads());
    await runTurn(t, updated);
  }

  async function handleRetry() {
    if (!thread || busy) return;
    const history = await listChatMessages(thread.uid);
    // Retry only answers an unanswered message.
    if (history.length === 0 || history[history.length - 1].role !== "user") return;
    await runTurn(thread, history);
  }

  async function pickApproach(a: ConversationApproach) {
    setPicking(false);
    if (!thread) {
      setChoice(a);
      setApproach(a);
      return;
    }
    await setChatApproach(thread.uid, a);
    setThread({ ...thread, approach: a });
    setApproach(a);
  }

  async function handleDelete(uid: string) {
    setConfirmDelete(null);
    await deleteChatThread(uid);
    setThreads(await listChatThreads());
    if (thread?.uid === uid) await openThread(null);
  }

  const started = messages.length > 0;
  const showing = started ? approach : choice;

  return (
    <div className="flex h-full flex-col">
      <header className="px-5 pb-2 pt-4">
        <div className="flex items-end justify-between gap-3">
          <h1 className="page-title">Chat</h1>
          <div className="flex shrink-0 items-center gap-1 pb-1">
            {threads.length > 0 && (
              <button onClick={() => setListOpen(true)} className="btn-ghost min-h-[34px] whitespace-nowrap py-1">
                Earlier chats
              </button>
            )}
            {started && (
              <button onClick={() => openThread(null)} disabled={busy} className="btn-chip whitespace-nowrap">
                New chat
              </button>
            )}
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-fg-dim">
          <span>Talking with you like {SHORT[showing]}.</span>
          <button
            onClick={() => setPicking((v) => !v)}
            aria-expanded={picking}
            className="text-moss underline-offset-2 hover:underline"
          >
            {picking ? "Keep it" : "Change"}
          </button>
        </div>
        {picking && (
          <div className="fade-up mt-3 flex flex-col gap-1.5" role="group" aria-label="How Elytra talks in this chat">
            {APPROACHES.map((a) => (
              <button
                key={a.id}
                onClick={() => pickApproach(a.id)}
                aria-pressed={showing === a.id}
                className={`flex flex-col items-start rounded-xl border px-3.5 py-2.5 text-left transition-colors duration-200 ${
                  showing === a.id ? "border-moss bg-surface-high" : "border-line hover:bg-surface-high"
                }`}
              >
                <span className="text-[14.5px] text-fg">{a.label}</span>
                <span className="text-[12.5px] leading-snug text-fg-faint">{chatBlurb(a.id)}</span>
              </button>
            ))}
            <p className="hint px-1">For this chat only. The default is in Settings &rsaquo; Conversation.</p>
          </div>
        )}
      </header>

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 px-5 pb-8 pt-3">
          {!started && loaded && (
            <div className="fade-up flex flex-col gap-5 pt-2">
              <div className="flex items-end gap-3">
                <Beetle size={56} state="idle" />
                <div className="max-w-[30rem] rounded-[14px] bg-speak px-4 pb-3 pt-2.5">
                  <span className="block font-mono text-[9.5px] uppercase leading-none tracking-[0.16em] text-speak-fg/80">
                    Elytra
                  </span>
                  <p className="mt-1.5 text-[16.5px] leading-[1.5] text-speak-fg">
                    Hi{userName ? `, ${userName}` : ""}. What&rsquo;s on your mind? Anything goes &mdash; this
                    doesn&rsquo;t go into your journal.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setDraft(s);
                      inputRef.current?.focus();
                    }}
                    className="btn-chip"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <Line key={m.uid} role={m.role} content={m.content} />
          ))}
          {streaming !== null &&
            (streaming.length > 0 ? (
              <Line role="assistant" content={streaming} streaming />
            ) : (
              <div className="fade-up flex w-fit items-center gap-2.5 rounded-[14px] bg-speak px-4 py-3" role="status">
                <Wingbeat tone="cream" />
                <span className="sr-only">Elytra is writing a reply</span>
              </div>
            ))}
          {stalled !== null && streaming === null && <Line role="assistant" content={stalled} interrupted />}
          <div ref={bottomRef} />
        </div>
      </div>

      {error && (
        <div className="fade-up mx-3 mb-2 flex items-start justify-between gap-3 rounded-lg bg-danger-wash px-3 py-2.5 text-[13.5px] text-danger">
          <div>
            {error.message}
            {error.hint && <span className="mt-0.5 block opacity-80">{error.hint}</span>}
          </div>
          <button
            onClick={handleRetry}
            disabled={busy}
            className="min-h-[36px] shrink-0 rounded-md border border-danger/40 px-3 py-1 transition-colors active:bg-ground/60 disabled:opacity-40"
          >
            Retry
          </button>
        </div>
      )}

      <div className="border-t border-line/60 bg-ground px-3 pb-3 pt-2">
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface py-1.5 pl-3.5 pr-1.5 transition-colors duration-200 focus-within:border-line-strong">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              typing();
            }}
            // A phone keyboard's Enter is a new line; Send sends.
            placeholder="Say anything…"
            disabled={busy}
            className="flex-1 resize-none overflow-y-auto bg-transparent py-2 font-serif text-[17px] leading-[1.45] text-fg outline-none placeholder:text-fg-faint/80 focus-visible:outline-none disabled:opacity-60"
            style={{ maxHeight: MAX_INPUT_HEIGHT_PX }}
          />
          {busy ? (
            <button onClick={() => stopRef.current?.()} className="btn-subtle rounded-full">
              Stop
            </button>
          ) : (
            <button onClick={() => handleSend()} disabled={!draft.trim()} className="btn-primary rounded-full px-4">
              Send
            </button>
          )}
        </div>
      </div>

      {listOpen && (
        <div
          className="fade-in fixed inset-0 z-40 flex items-end justify-center px-4 pb-[calc(var(--nav-h)+12px)] pt-6 sm:items-center sm:pb-6"
          style={{ background: "var(--scrim)" }}
          role="dialog"
          aria-modal="true"
          aria-label="Earlier chats"
          onClick={() => setListOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="part-open flex max-h-[70vh] w-full max-w-md flex-col rounded-2xl border border-line-strong bg-surface px-3 pb-3 pt-3 shadow-[var(--lift-3)]"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="spec text-fg">Earlier chats</span>
              <button
                onClick={() => {
                  setListOpen(false);
                  openThread(null);
                }}
                disabled={busy}
                className="btn-chip"
              >
                New chat
              </button>
            </div>
            <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto">
              {threads.map((t) => (
                <li key={t.uid} className="group flex items-center gap-1">
                  {confirmDelete === t.uid ? (
                    <span className="flex flex-1 flex-wrap items-center gap-1 px-2 py-2 text-[13.5px] text-fg-dim">
                      Delete this chat on every device?
                      <button onClick={() => handleDelete(t.uid)} className="btn-ghost text-danger">
                        Delete
                      </button>
                      <button onClick={() => setConfirmDelete(null)} className="btn-ghost">
                        Keep
                      </button>
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setListOpen(false);
                          openThread(t);
                        }}
                        disabled={busy}
                        className={`flex min-w-0 flex-1 flex-col items-start rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-high ${
                          thread?.uid === t.uid ? "bg-surface-high" : ""
                        }`}
                      >
                        <span className="w-full truncate text-[14.5px] text-fg">{t.title || "A chat"}</span>
                        <span className="font-mono text-[11px] text-fg-faint">{whenLabel(t.updated_at)}</span>
                      </button>
                      <button
                        onClick={() => setConfirmDelete(t.uid)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center text-[18px] leading-none text-fg-faint opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`Delete "${t.title || "A chat"}"`}
                      >
                        &times;
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <button onClick={() => setListOpen(false)} className="btn-subtle mt-2 w-full">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The approach blurbs in style.ts talk about the evening's checklist; a chat has none. */
function chatBlurb(id: ConversationApproach): string {
  switch (id) {
    case "friend":
      return "Listens and reacts. No advice unless you ask.";
    case "coach":
      return "Helps you get clear and find one next step.";
    default:
      return "Reflective. Helps you see what's underneath.";
  }
}

/** Elytra in the green card, you as plain text — the same rule as the day's talk. */
function Line({
  role,
  content,
  streaming = false,
  interrupted = false,
}: {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  interrupted?: boolean;
}) {
  if (role === "user") {
    return <div className="selectable ink-in whitespace-pre-wrap pl-1 text-[16.5px] leading-[1.6] text-fg">{content}</div>;
  }
  return (
    <div className={`max-w-[38rem] rounded-[14px] bg-speak px-4 pb-3 pt-2.5 ${interrupted ? "opacity-75" : ""}`}>
      <span className="block font-mono text-[9.5px] uppercase leading-none tracking-[0.16em] text-speak-fg/80">Elytra</span>
      <p className="selectable mt-1.5 whitespace-pre-wrap text-[16.5px] leading-[1.5] text-speak-fg">
        {content}
        {streaming && <span className="stream-caret" aria-hidden="true" />}
      </p>
      {interrupted && <span className="mt-1.5 block text-[11.5px] italic text-speak-fg/70">Cut off here. Press Retry for the rest.</span>}
    </div>
  );
}
