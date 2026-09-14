import { useEffect, useRef, useState } from "react";
import { localDateKey } from "../db/captures";
import {
  addMessage,
  getOrCreateTodaySession,
  linkCapturesToSession,
  listMessages,
  reopenSession,
  restartConversation,
  wrapSession,
} from "../db/sessions";
import type { Message, Session } from "../db/types";
import { createReminder } from "../db/reminders";
import { buildCounselorSystemPrompt, buildCounselorTurnPreamble } from "../ai/context";
import { getProvider } from "../ai/factory";
import { extractReminders, hideMarkersWhileStreaming } from "../ai/reminders";
import { extractJournalRequest } from "../ai/journalMarker";
import { ProviderError } from "../ai/types";
import { nowLocalMinute } from "../scheduler";
import { emit } from "@tauri-apps/api/event";
import EntryReview from "./EntryReview";
import CheckInForm from "./CheckInForm";

// A synthetic first turn so the API (which expects the conversation to open
// with a user message) has something to respond to for the AI's own opening
// line. Filtered out of the rendered transcript — the user never typed it.
const KICKOFF = "Let's begin tonight's check-in.";
const KICKOFF_PAST = "Let's look back on that day.";
const KICKOFFS = new Set([KICKOFF, KICKOFF_PAST]);

const MAX_INPUT_HEIGHT_PX = 160;

type View = "notes" | "conversation" | "journal";

interface DisplayError {
  message: string;
  hint?: string;
}

function toDisplayError(e: unknown): DisplayError {
  if (e instanceof ProviderError) return { message: e.message, hint: e.hint };
  if (e instanceof Error) return { message: e.message };
  return { message: "Something went wrong talking to the AI provider." };
}

type Turn = { history: { role: "user" | "assistant"; content: string }[]; sessionId: number };

/** The evening conversation for one day: today, or an earlier day picked from
 * the Journal calendar. Everything below keys off `date`, never the clock. */
export default function CounselorChat({
  date,
  notes,
  notesCount = 0,
}: {
  date: string;
  /** The day's notes, shown as the first of the three pages on a phone. Gets a
   *  callback that turns to the conversation. */
  notes?: (goTalk: () => void) => React.ReactNode;
  notesCount?: number;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [view, setView] = useState<View>("conversation");
  // Set when the user — or the counselor, on their say-so — asks for the
  // journal; EntryReview writes and saves it, then clears this.
  const [writeNow, setWriteNow] = useState(false);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  // A partial reply kept on provider failure, so streamed text never vanishes.
  const [stalled, setStalled] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Two-step, because starting over discards the exchange for good.
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const lastTurnRef = useRef<Turn | null>(null);
  // Messages already saved when the chat opened appear as they are; only the
  // ones sent while it's open settle in with the ink animation.
  const firstNewIdRef = useRef(Number.POSITIVE_INFINITY);
  // Assembled once per session and then reused verbatim. Rebuilding it would
  // usually produce the same string, but "usually" is not good enough: any
  // difference (a capture added mid-conversation, a setting changed) throws
  // away the cached prefix for the rest of the night. A stable view of the
  // day is also the more sensible thing for the counselor to reason from.
  const systemPromptRef = useRef<{ sessionId: number; prompt: string } | null>(null);

  useEffect(() => {
    (async () => {
      const s = await getOrCreateTodaySession(date);
      setSession(s);
      const loaded = await listMessages(s.id);
      // A day with nothing said yet opens on its notes; the check-in waits
      // under Talk.
      setView(s.status === "wrapped" ? "journal" : loaded.length > 0 || !notes ? "conversation" : "notes");
      firstNewIdRef.current = loaded.reduce((max, m) => Math.max(max, m.id), 0) + 1;
      setMessages(loaded);
    })();
  }, [date]);

  // Autoscroll only when the user is already near the bottom — never yank
  // the view away from something they scrolled up to reread.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: streaming !== null ? "auto" : "smooth" });
    }
  }, [messages, streaming, stalled]);

  // Auto-grow the input with its content, capped so it never eats the chat.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
  }, [draft]);

  async function counselorSystemFor(sessionId: number): Promise<string> {
    const cached = systemPromptRef.current;
    if (cached && cached.sessionId === sessionId) return cached.prompt;
    const prompt = await buildCounselorSystemPrompt(date);
    systemPromptRef.current = { sessionId, prompt };
    return prompt;
  }

  /** Wrap the session, switch to the day's journal, and have it written + saved. */
  async function requestWrite() {
    if (!session) return;
    if (session.status !== "wrapped") {
      await wrapSession(session.id);
      setSession({ ...session, status: "wrapped" });
    }
    setView("journal");
    setWriteNow(true);
  }

  async function runTurn(historyForModel: Turn["history"], sessionId: number) {
    lastTurnRef.current = { history: historyForModel, sessionId };
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
    let journalRequested = false;
    try {
      const exchangeCount = historyForModel.filter((m) => m.role === "user").length;
      const [system, preamble] = await Promise.all([
        counselorSystemFor(sessionId),
        buildCounselorTurnPreamble({ exchangeCount }),
      ]);
      const provider = await getProvider();
      // conversationId lets a provider resume its own session for turn 2+
      // instead of replaying the transcript; providers that can't just ignore
      // it. turnPreamble is applied by the provider, not here, so the history
      // it sees stays exactly what's in the database.
      const iterator = provider
        .chatStream(historyForModel, system, {
          conversationId: String(sessionId),
          turnPreamble: preamble,
        })
        [Symbol.asyncIterator]();

      while (true) {
        const next = await Promise.race([
          iterator.next(),
          stopPromise.then(() => "stopped" as const),
        ]);
        if (next === "stopped") {
          // Closing the iterator runs the providers' cleanup (kills the CLI
          // process / cancels the HTTP stream).
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
        if (stopRequested) return; // stopped before anything arrived — no-op
        throw new ProviderError("The model returned an empty reply.");
      }
      // Markers come out before anything is stored or shown; the reply itself
      // is never lost to a bad marker (they're just stripped).
      const { clean, reminders } = extractReminders(full, nowLocalMinute());
      for (const r of reminders) await createReminder(r.dueAt, r.text);
      if (reminders.length > 0) await emit("reminders:changed");
      // A stopped-midway reply is still what the user read — keep it, but a
      // write request inside a cut-off reply isn't trusted.
      const journal = extractJournalRequest(clean.length > 0 ? clean : full);
      journalRequested = journal.requested && !stopRequested;
      await addMessage(sessionId, "assistant", journal.clean || "Writing the entry now.");
      setMessages(await listMessages(sessionId));
    } catch (e) {
      // An interrupted reply is display-only: hide marker syntax but don't
      // act on it — a half-arrived marker can't be trusted.
      if (full.trim().length > 0) setStalled(hideMarkersWhileStreaming(full));
      setError(toDisplayError(e));
    } finally {
      stopRef.current = null;
      setStreaming(null);
      setBusy(false);
    }
    if (journalRequested) await requestWrite();
  }

  async function handleStart() {
    if (!session || busy) return;
    const kickoff = date === localDateKey() ? KICKOFF : KICKOFF_PAST;
    await linkCapturesToSession(session.id, date);
    await addMessage(session.id, "user", kickoff);
    setMessages(await listMessages(session.id));
    await runTurn([{ role: "user", content: kickoff }], session.id);
  }

  async function handleSend() {
    if (!session || busy || !draft.trim()) return;
    const userText = draft.trim();
    setDraft("");
    await addMessage(session.id, "user", userText);
    const updated = await listMessages(session.id);
    setMessages(updated);
    await runTurn(
      updated.map((m) => ({ role: m.role, content: m.content })),
      session.id,
    );
  }

  function handleStop() {
    stopRef.current?.();
  }

  async function handleRetry() {
    const turn = lastTurnRef.current;
    if (!turn || busy) return;
    await runTurn(turn.history, turn.sessionId);
  }

  /** Wipes tonight's exchange. With `redoCheckIn` it goes back to the check-in
   *  form (filled in with the saved scores, to change); otherwise it opens a
   *  fresh conversation from the same check-in and notes. */
  async function handleRestart(redoCheckIn: boolean) {
    if (!session || busy) return;
    setConfirmRestart(false);
    await restartConversation(session.id);
    // The system prompt is cached per session id — it has to forget the old
    // thread, or the "fresh" conversation carries it on.
    systemPromptRef.current = null;
    lastTurnRef.current = null;
    firstNewIdRef.current = Number.POSITIVE_INFINITY;
    setMessages([]);
    setStreaming(null);
    setStalled(null);
    setError(null);
    setDraft("");
    setWriteNow(false);
    setView("conversation");
    setSession({ ...session, status: "open" });
    if (!redoCheckIn) await handleStart();
  }

  async function handleReopen() {
    if (!session) return;
    await reopenSession(session.id);
    setSession({ ...session, status: "open" });
    setView("conversation");
  }

  if (!session) {
    return <p className="py-2 text-[13px] text-ink-faint">Loading&hellip;</p>;
  }

  const isToday = date === localDateKey();
  const visibleMessages = messages.filter((m) => !(m.role === "user" && KICKOFFS.has(m.content)));
  const started = messages.length > 0;
  const wrapped = session.status === "wrapped";

  const tabs: { id: View; label: string }[] = [
    ...(notes ? [{ id: "notes" as const, label: notesCount > 0 ? `Notes · ${notesCount}` : "Notes" }] : []),
    { id: "conversation", label: "Talk" },
    { id: "journal", label: isToday ? "Journal" : "The entry" },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* The day's pages: its notes, the conversation, the entry it produces. */}
      <div className="flex border-b border-rule px-5" role="group" aria-label="Show">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            aria-pressed={view === t.id}
            className={`-mb-px flex-1 border-b-2 pb-2.5 pt-1 text-[14.5px] transition-colors duration-200 ${
              view === t.id ? "border-ember text-ink" : "border-transparent text-ink-faint"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === "conversation" && started && (
        <div className="flex min-h-[44px] flex-wrap items-center justify-end gap-1 px-3 pt-1">
          {!wrapped && !confirmRestart && (
            <>
              <button onClick={() => setConfirmRestart(true)} disabled={busy} className="btn-ghost">
                Start over
              </button>
              <button onClick={requestWrite} disabled={busy} className="btn-subtle min-h-[36px] py-1.5">
                Wrap up &amp; write
              </button>
            </>
          )}
          {!wrapped && confirmRestart && (
            <span className="flex flex-wrap items-center justify-end gap-1 text-[13.5px] text-ink-faint">
              Clear this conversation and start again from
              <button onClick={() => handleRestart(true)} className="btn-ghost text-ember">
                The check-in
              </button>
              <button onClick={() => handleRestart(false)} className="btn-ghost text-ember">
                Just the talk
              </button>
              <button onClick={() => setConfirmRestart(false)} className="btn-ghost">
                Keep it
              </button>
            </span>
          )}
          {wrapped && (
            <button onClick={handleReopen} className="btn-ghost">
              Keep talking
            </button>
          )}
        </div>
      )}

      {view === "notes" && notes ? (
        <div className="min-h-0 flex-1 overflow-y-auto">{notes(() => setView("conversation"))}</div>
      ) : view === "journal" ? (
        <EntryReview
          sessionId={session.id}
          date={date}
          transcript={visibleMessages.map((m) => ({ role: m.role, content: m.content }))}
          writeNow={writeNow}
          onWriteHandled={() => setWriteNow(false)}
          onRequestWrite={requestWrite}
        />
      ) : !started && !wrapped ? (
        <CheckInForm date={date} busy={busy} onStart={handleStart} onSkip={handleStart} />
      ) : (
        <>
          <div ref={scrollerRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {visibleMessages.length === 0 && (
              <p className="py-6 text-center font-serif text-[15px] italic text-ink-faint">
                No conversation this time. The entry was written from your notes.
              </p>
            )}
            {visibleMessages.map((m) => (
              <Bubble key={m.id} role={m.role} content={m.content} settle={m.role === "user" && m.id >= firstNewIdRef.current} />
            ))}
            {streaming !== null &&
              (streaming.length > 0 ? (
                <Bubble role="assistant" content={hideMarkersWhileStreaming(streaming)} streaming settle />
              ) : (
                <ThinkingIndicator />
              ))}
            {stalled !== null && streaming === null && <Bubble role="assistant" content={stalled} interrupted />}
            <div ref={bottomRef} />
          </div>
          {wrapped ? (
            <p className="border-t border-rule px-5 py-3 text-[13px] leading-relaxed text-ink-faint">
              {isToday
                ? "Tonight’s conversation is wrapped up and the entry is under Today’s journal."
                : "This conversation is wrapped up and the entry is saved."}{" "}
              Keep talking to add more, and Ember can rewrite the entry.
            </p>
          ) : (
            <div className="border-t border-rule/60 bg-paper px-3 pb-3 pt-2">
              <div className="flex items-end gap-2 rounded-2xl border border-rule bg-sheet py-1.5 pl-4 pr-1.5 transition-colors duration-200 focus-within:border-rule-strong">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  // A phone keyboard's Enter is a new line; Send sends.
                  placeholder="Write back…"
                  disabled={busy}
                  className="flex-1 resize-none overflow-y-auto bg-transparent py-2 font-serif text-[17px] leading-[1.45] text-ink outline-none placeholder:text-ink-faint/80 focus-visible:outline-none disabled:opacity-60"
                  style={{ maxHeight: MAX_INPUT_HEIGHT_PX }}
                />
                {busy ? (
                  <button onClick={handleStop} className="btn-subtle rounded-full">
                    Stop
                  </button>
                ) : (
                  <button onClick={handleSend} disabled={!draft.trim()} className="btn-primary rounded-full px-4">
                    Send
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {error && view === "conversation" && (
        <div className="fade-up mx-3 mb-2 flex items-start justify-between gap-3 rounded-lg bg-danger-wash px-3 py-2.5 text-[13.5px] text-danger">
          <div>
            {error.message}
            {error.hint && <span className="mt-0.5 block opacity-80">{error.hint}</span>}
          </div>
          <button
            onClick={handleRetry}
            disabled={busy}
            className="min-h-[36px] shrink-0 rounded-md border border-danger/40 px-3 py-1 transition-colors active:bg-paper/60 disabled:opacity-40"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

/** Shown between sending and the first visible token — thinking models can
 * take a while before any text arrives, and an empty page reads as a dead
 * chat. The ember breathes until words arrive. */
function ThinkingIndicator() {
  return (
    <div className="fade-up flex items-center py-1.5" role="status">
      <span className="ember-dot live" aria-hidden="true" />
      <span className="sr-only">Ember is writing a reply</span>
    </div>
  );
}

/** Ember writes on the page in the serif; your replies sit to the right like
 * notes in a margin. No bubbles. */
function Bubble({
  role,
  content,
  streaming = false,
  interrupted = false,
  settle = false,
}: {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  interrupted?: boolean;
  settle?: boolean;
}) {
  if (role === "user") {
    return (
      <div className={`flex justify-end ${settle ? "ink-in" : ""}`}>
        <div className="selectable max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-paper-deep px-4 py-2.5 text-[15.5px] leading-relaxed text-ink-soft">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div
      className={`selectable whitespace-pre-wrap font-serif text-[17.5px] leading-[1.6] text-ink ${settle ? "ink-in" : ""} ${
        interrupted ? "opacity-75" : ""
      }`}
    >
      {content}
      {streaming && <span className="stream-caret" aria-hidden="true" />}
      {interrupted && (
        <span className="mt-1.5 block font-sans text-[11.5px] italic text-ink-faint">Cut off here. Press Retry for the rest.</span>
      )}
    </div>
  );
}
