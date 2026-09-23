import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getSetting } from "../db/settings";
import { finishSyncRound, forgetPeer, prepareSyncRequest, savePeer, type ApplyResult, type SyncReply } from "../db/sync";
import { claimJournal } from "../install";
import { getLocalInstallId, setApiKey, setCloudApiKey } from "../secrets";
import { announceSync, settleRestoredJournal } from "./syncEvents";

// The phone's side of the link with Elytra on a computer. Rust (lan_client.rs)
// finds the computer, pairs and seals every request; the journal is read and
// written here, through src/db/sync.ts.

export interface ComputerLink {
  desktopId: string;
  desktopName: string;
  address: string;
  pairedAt: number;
}

export interface FoundComputer {
  id: string;
  name: string;
  address: string;
}

export interface ComputerStatus {
  localModel: boolean;
  model: string | null;
  state: string;
  message: string;
}

export type SyncOutcome = { ok: true; changed: boolean } | { ok: false; error: string; unpaired: boolean };

export function computerLink(): Promise<ComputerLink | null> {
  return invoke<ComputerLink | null>("lan_link");
}

export function findComputers(): Promise<FoundComputer[]> {
  return invoke<FoundComputer[]>("lan_discover");
}

/** "Pixel 8" from the webview's user agent, or "Phone". */
function phoneName(): string {
  const m = /Android [\d.]+; ([^;)]+)/.exec(navigator.userAgent);
  const name = m?.[1]?.replace(/ Build\/.*/, "").trim();
  return name && name !== "K" ? name : "Phone";
}

async function phoneId(): Promise<string> {
  let id = await getLocalInstallId();
  if (!id) {
    await claimJournal();
    id = await getLocalInstallId();
  }
  return id;
}

export async function pairWithComputer(address: string, code: string): Promise<ComputerLink> {
  const link = await invoke<ComputerLink>("lan_pair", {
    address,
    code,
    phoneId: await phoneId(),
    phoneName: phoneName(),
  });
  // A fresh pairing starts from nothing, so both journals are offered in full.
  await forgetPeer(link.desktopId);
  await savePeer(link.desktopId, link.desktopName);
  await emit("lan:linked");
  void syncWithComputer();
  return link;
}

/** Forgets the computer. Both journals stay as they are. */
export async function unpairComputer(): Promise<void> {
  const link = await computerLink();
  await invoke("lan_unlink");
  if (link) await forgetPeer(link.desktopId);
  await emit("lan:linked");
}

export function computerStatus(): Promise<ComputerStatus> {
  return invoke<ComputerStatus>("lan_call", { kind: "status", payload: {} });
}

export function isUnpairedError(message: string): boolean {
  return message.startsWith("unpaired:");
}

export function readableLinkError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return isUnpairedError(text) ? text.slice("unpaired:".length).trim() : text;
}

let running: Promise<SyncOutcome> | null = null;

async function runSync(): Promise<SyncOutcome> {
  const link = await computerLink();
  if (!link) return { ok: false, error: "Not paired with a computer.", unpaired: true };
  await settleRestoredJournal();
  await savePeer(link.desktopId, link.desktopName);
  const merged: ApplyResult = { tables: [], dates: [] };
  let reset = false;
  try {
    for (let round = 0; round < 50; round++) {
      const prepared = await prepareSyncRequest(link.desktopId, 200);
      const reply = await invoke<SyncReply>("lan_call", { kind: "sync", payload: prepared.request });
      const done = await finishSyncRound(link.desktopId, prepared, reply);
      reset ||= done.reset;
      merged.tables = [...new Set([...merged.tables, ...done.applied.tables])];
      merged.dates = [...new Set([...merged.dates, ...done.applied.dates])];
      if (!done.more) break;
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, error: readableLinkError(error), unpaired: isUnpairedError(error) };
  } finally {
    if (reset) {
      // The computer was reset: so is this phone, keys included. Start fresh.
      await setApiKey("").catch(() => {});
      await setCloudApiKey("").catch(() => {});
      window.location.reload();
    } else {
      await announceSync(merged).catch(() => {});
    }
  }
  await emit("lan:synced").catch(() => {});
  return { ok: true, changed: merged.tables.length > 0 };
}

/** Swaps what changed with the computer. One at a time; a call while one
 *  runs gets that one's result. Never throws. */
export function syncWithComputer(): Promise<SyncOutcome> {
  if (!running) {
    running = runSync()
      .catch((e): SyncOutcome => ({ ok: false, error: String(e), unpaired: false }))
      .finally(() => {
        running = null;
      });
  }
  return running;
}

let started = false;

/** Syncs when Elytra opens or comes back to the screen, and every minute
 *  while it's on screen, if a computer is paired. */
export function startComputerSync(): void {
  if (started) return;
  started = true;
  const maybeSync = async () => {
    if (document.visibilityState !== "visible") return;
    if (await computerLink().catch(() => null)) await syncWithComputer();
  };
  void maybeSync();
  document.addEventListener("visibilitychange", () => void maybeSync());
  setInterval(() => void maybeSync(), 60_000);
}

/** While the conversation is open with the computer's model chosen, sync
 *  every few seconds, so both screens show the same evening. */
export function startLiveSync(): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped || document.visibilityState !== "visible") return;
    if ((await getSetting("provider")) !== "pc") return;
    await syncWithComputer();
  };
  void tick();
  const timer = setInterval(() => void tick(), 4000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
