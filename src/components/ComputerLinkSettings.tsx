import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  computerLink,
  computerStatus,
  findComputers,
  pairWithComputer,
  readableLinkError,
  syncWithComputer,
  unpairComputer,
  type ComputerLink,
  type ComputerStatus,
  type FoundComputer,
} from "../lan/phoneLink";
import { getPeer } from "../db/sync";
import { sinceLabel } from "../lan/syncEvents";

/** Pairing with Elytra on a computer on the same network. */
export default function ComputerLinkSettings() {
  const [link, setLink] = useState<ComputerLink | null | undefined>(undefined);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [found, setFound] = useState<FoundComputer[] | null>(null);
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"find" | "pair" | "sync" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function refresh() {
    const l = await computerLink().catch(() => null);
    setLink(l);
    if (!l) return;
    setLastSync((await getPeer(l.desktopId))?.last_sync_at ?? null);
    try {
      setStatus(await computerStatus());
      setStatusError(null);
    } catch (e) {
      setStatus(null);
      setStatusError(readableLinkError(e));
    }
  }

  useEffect(() => {
    refresh();
    const unlisten = listen("lan:synced", async () => {
      const l = await computerLink().catch(() => null);
      if (l) setLastSync((await getPeer(l.desktopId))?.last_sync_at ?? null);
    });
    return () => {
      unlisten.then((u) => u());
    };
  }, []);

  async function find() {
    setBusy("find");
    setMessage(null);
    try {
      const list = await findComputers();
      setFound(list);
      if (list.length === 1) setAddress(list[0].address);
    } finally {
      setBusy(null);
    }
  }

  async function pair() {
    setBusy("pair");
    setMessage(null);
    try {
      const l = await pairWithComputer(address, code);
      setCode("");
      setFound(null);
      setMessage({ ok: true, text: `Paired with ${l.desktopName}.` });
      await refresh();
    } catch (e) {
      setMessage({ ok: false, text: readableLinkError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function syncNow() {
    setBusy("sync");
    setMessage(null);
    const result = await syncWithComputer();
    setBusy(null);
    setMessage(result.ok ? { ok: true, text: "Synced." } : { ok: false, text: result.error });
    await refresh();
  }

  async function unpair() {
    await unpairComputer();
    setStatus(null);
    setMessage(null);
    await refresh();
  }

  if (link === undefined) return <p className="hint">Loading&hellip;</p>;

  if (link) {
    const model = statusError
      ? statusError
      : status === null
        ? "Checking…"
        : status.localModel
          ? `Local model: ${status.model ?? "unknown"}${status.state === "ready" ? "" : ` (${status.state})`}`
          : "Uses the computer's AI provider.";
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[15px] text-fg">
          {link.desktopName}
          <span className="block text-[13px] text-fg-faint">
            {link.address} &middot; last synced {sinceLabel(lastSync)}
          </span>
        </p>
        <p className="hint">{model}</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={syncNow} disabled={busy !== null} className="btn-subtle">
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
          <button onClick={unpair} disabled={busy !== null} className="btn-ghost">
            Unpair
          </button>
        </div>
        {message && <p className={`text-[13.5px] ${message.ok ? "text-moss" : "text-danger"}`}>{message.text}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="hint">On the computer: Settings &rsaquo; Sync with phone &rsaquo; Pair a phone.</p>
      <div className="flex flex-col gap-2">
        <button onClick={find} disabled={busy !== null} className="btn-subtle self-start">
          {busy === "find" ? "Searching…" : "Find computer"}
        </button>
        {found !== null && found.length === 0 && <p className="hint">None found. Enter the address shown on the computer.</p>}
        {found !== null && found.length > 1 && (
          <div className="flex flex-col gap-1.5">
            {found.map((f) => (
              <label key={f.id} className="flex items-center gap-3 text-[15px] text-fg">
                <input
                  type="radio"
                  name="computer"
                  checked={address === f.address}
                  onChange={() => setAddress(f.address)}
                  className="h-5 w-5 accent-moss"
                />
                {f.name} <span className="text-[13px] text-fg-faint">{f.address}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="label">Address</span>
        <input
          className="input"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="192.168.1.20:47821"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Pairing code</span>
        <input
          className="input font-serif tracking-[0.12em]"
          autoCapitalize="characters"
          autoCorrect="off"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCDE-FGHJK"
        />
      </label>
      <button onClick={pair} disabled={busy !== null || !address.trim() || code.replace(/[^0-9A-Za-z]/g, "").length < 10} className="btn-primary self-start">
        {busy === "pair" ? "Pairing…" : "Pair"}
      </button>
      {message && <p className={`text-[13.5px] ${message.ok ? "text-moss" : "text-danger"}`}>{message.text}</p>}
    </div>
  );
}
