import { useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { countCapturesForDate, createCapture, localDateKey } from "../db/captures";

const MOODS = ["😞", "😕", "😐", "🙂", "😄"];

/**
 * The phone's quick capture (the desktop's Ctrl+Shift+J bar): a sheet that
 * rises from the bottom with the keyboard already up. Save keeps the note;
 * tapping outside or Close keeps a half-typed draft for next time.
 */
export default function QuickNote({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const [mood, setMood] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    countCapturesForDate(localDateKey()).then(setCount).catch(() => {});
    // After the rise animation starts, so Android opens the keyboard for it.
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await createCapture(trimmed, mood);
      await emit("captures:updated");
      setText("");
      setMood(null);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button aria-label="Close" onClick={onClose} className="fade-in absolute inset-0 bg-ink/25" />
      <div className="sheet-up relative rounded-t-2xl border-t border-rule bg-sheet px-5 pb-5 pt-3 shadow-[0_-8px_30px_-12px_rgba(40,35,30,0.35)]">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-rule-strong" aria-hidden="true" />
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-serif text-[19px] text-ink">A quick note</h2>
          <span className="text-[12.5px] tabular-nums text-ink-faint">
            {count} {count === 1 ? "note" : "notes"} today
          </span>
        </div>
        <textarea
          ref={inputRef}
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's on your mind?"
          className="selectable block w-full resize-none bg-transparent font-serif text-[18px] leading-[1.5] text-ink outline-none placeholder:text-ink-faint/80 focus-visible:outline-none"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1" role="group" aria-label="Mood">
            {MOODS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setMood((current) => (current === emoji ? null : emoji))}
                aria-pressed={mood === emoji}
                className={`flex h-10 w-10 items-center justify-center rounded-full text-[21px] leading-none transition duration-150 active:scale-90 ${
                  mood === emoji ? "bg-paper-deep" : "opacity-45 grayscale"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
          <button onClick={handleSave} disabled={!text.trim() || saving} className="btn-primary">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
