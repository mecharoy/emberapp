// Web edition: stands in for @tauri-apps/api/core (vite.web.config.ts).
//
// The phone's Rust side answers a handful of commands. In the browser the
// private-store ones are kept in this site's localStorage (the only place a
// web page has; it never leaves the browser), the backup ones work on the
// in-page database, and the computer link — which needs the home network — is
// simply not there.

import { dropStaged, stage, STAGED_NAME, takeStaged } from "./staging";
import { mainDatabase, replaceMainDatabase } from "./sql";
import { download } from "./plugins";

const SECRET_PREFIX = "elytra.secret.";
const SECRET_NAMES = new Set(["anthropic_api_key", "cloud_api_key", "openai_api_key", "install_id"]);

function bytesFrom(payload: unknown): Uint8Array {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (Array.isArray(payload)) return Uint8Array.from(payload as number[]);
  throw new Error("Expected the backup file's bytes.");
}

function checkBackup(bytes: Uint8Array): void {
  const head = new TextDecoder().decode(bytes.slice(0, 15));
  if (head !== "SQLite format 3") throw new Error("That file isn't an Elytra backup.");
}

export async function invoke<T>(cmd: string, args?: unknown): Promise<T> {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (cmd) {
    case "secret_get": {
      const name = String(a.name);
      if (!SECRET_NAMES.has(name)) throw new Error("Unknown secret.");
      return (localStorage.getItem(SECRET_PREFIX + name) ?? null) as T;
    }
    case "secret_set": {
      const name = String(a.name);
      if (!SECRET_NAMES.has(name)) throw new Error("Unknown secret.");
      const value = String(a.value ?? "");
      if (value) localStorage.setItem(SECRET_PREFIX + name, value);
      else localStorage.removeItem(SECRET_PREFIX + name);
      return undefined as T;
    }
    case "backup_stage": {
      const bytes = bytesFrom(args);
      checkBackup(bytes);
      stage(bytes);
      return undefined as T;
    }
    case "backup_restore": {
      const bytes = takeStaged(STAGED_NAME);
      if (!bytes) throw new Error("There is no backup waiting to be restored.");
      await replaceMainDatabase(bytes);
      dropStaged();
      return undefined as T;
    }
    case "backup_download": {
      const db = await mainDatabase();
      const day = new Date().toISOString().slice(0, 10);
      download(`Elytra backup ${day}.db`, db.exportBytes() as BlobPart, "application/vnd.sqlite3");
      return undefined as T;
    }
    case "lan_link":
      return null as T;
    default:
      throw new Error("That needs the Elytra app; it isn't available in the browser.");
  }
}

/** Only the computer link streams through a Channel, and the web has none. */
export class Channel<T = unknown> {
  onmessage: (message: T) => void = () => {};
}
