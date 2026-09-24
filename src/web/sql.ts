// Web edition: stands in for @tauri-apps/plugin-sql (vite.web.config.ts aliases it).
//
// The journal is the same SQLite database as on the phone, run in the page by
// sql.js (SQLite compiled to WebAssembly) and kept in IndexedDB. The same
// numbered migrations as src-tauri/migrations/ run on load, so a backup file
// from the phone or the computer opens here unchanged, and one saved here opens
// there. Nothing leaves the browser.

import initSqlJs, { type Database as SqlDb, type SqlJsStatic, type SqlValue } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { takeStaged } from "./staging";

const MIGRATIONS = import.meta.glob("../../src-tauri/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const IDB_NAME = "elytra";
const IDB_STORE = "files";
const MAIN = "sqlite:ember.db";

let sqlPromise: Promise<SqlJsStatic> | null = null;
function sqlJs(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({ locateFile: () => wasmUrl });
  return sqlPromise;
}

// ---------- IndexedDB: one record per database file ----------

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readFileBytes(name: string): Promise<Uint8Array | null> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(name);
    req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function writeFileBytes(name: string, bytes: Uint8Array): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(bytes, name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- migrations ----------

function migrationList(): { version: number; sql: string }[] {
  return Object.entries(MIGRATIONS)
    .map(([path, sql]) => ({ version: Number(/\/(\d+)_[^/]+\.sql$/.exec(path)?.[1] ?? NaN), sql }))
    .filter((m) => Number.isFinite(m.version))
    .sort((a, b) => a.version - b.version);
}

function tableExists(db: SqlDb, name: string): boolean {
  return db.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", [name]).length > 0;
}

/** Runs every migration not yet applied. A database made by the phone or the
 *  computer records its migrations in _sqlx_migrations; one made here in
 *  _web_migrations. Either counts. */
function migrate(db: SqlDb): void {
  db.exec("CREATE TABLE IF NOT EXISTS _web_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set<number>();
  for (const r of db.exec("SELECT version FROM _web_migrations")[0]?.values ?? []) applied.add(Number(r[0]));
  if (tableExists(db, "_sqlx_migrations")) {
    for (const r of db.exec("SELECT version FROM _sqlx_migrations WHERE success = 1")[0]?.values ?? []) {
      applied.add(Number(r[0]));
    }
  }
  for (const m of migrationList()) {
    if (applied.has(m.version)) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      db.run("INSERT INTO _web_migrations (version, applied_at) VALUES (?, ?)", [m.version, new Date().toISOString()]);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`Could not update the journal's structure (step ${m.version}): ${String(e)}`);
    }
  }
}

// ---------- the plugin-sql surface the app uses ----------

type Params = unknown[] | undefined;

/** plugin-sql writes $1, $2…; SQLite reads those as named parameters. */
function bindings(values: Params): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  (values ?? []).forEach((v, i) => {
    out[`$${i + 1}`] = v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : (v as SqlValue);
  });
  return out;
}

const open = new Map<string, Database>();

export default class Database {
  path: string;
  private db: SqlDb;
  persisted: boolean;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(path: string, db: SqlDb, persisted: boolean) {
    this.path = path;
    this.db = db;
    this.persisted = persisted;
  }

  static async load(path: string): Promise<Database> {
    const existing = open.get(path);
    if (existing) return existing;
    const SQL = await sqlJs();
    let instance: Database;
    if (path === MAIN) {
      const bytes = await readFileBytes(path);
      const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
      db.exec("PRAGMA foreign_keys = ON");
      migrate(db);
      instance = new Database(path, db, true);
      await instance.flush();
      // Ask the browser not to clear this site's storage when space runs low.
      void navigator.storage?.persist?.();
      const flushSoon = () => {
        if (document.visibilityState === "hidden") void instance.flush();
      };
      document.addEventListener("visibilitychange", flushSoon);
      window.addEventListener("pagehide", () => void instance.flush());
    } else {
      // A picked backup, held in memory until it is restored or dropped.
      const staged = takeStaged(path);
      if (!staged) throw new Error("There is no backup waiting to be read.");
      instance = new Database(path, new SQL.Database(staged), false);
    }
    open.set(path, instance);
    return instance;
  }

  async execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number; lastInsertId?: number }> {
    this.db.run(query, bindings(bindValues));
    const rowsAffected = this.db.getRowsModified();
    const last = this.db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0];
    this.scheduleSave();
    return { rowsAffected, lastInsertId: typeof last === "number" ? last : Number(last ?? 0) };
  }

  async select<T>(query: string, bindValues?: unknown[]): Promise<T> {
    const stmt = this.db.prepare(query);
    try {
      stmt.bind(bindings(bindValues));
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows as T;
    } finally {
      stmt.free();
    }
  }

  async close(db?: string): Promise<boolean> {
    const target = db ?? this.path;
    const inst = open.get(target);
    if (!inst) return true;
    await inst.flush();
    // Closed means closed: a late visibility or pagehide flush must never write
    // this copy back — after a restore it would overwrite the restored journal.
    inst.persisted = false;
    inst.db.close();
    open.delete(target);
    return true;
  }

  /** The whole database as a file (for backups). */
  exportBytes(): Uint8Array {
    const bytes = this.db.export();
    // sql.js reopens the database to export it, which resets pragmas.
    this.db.exec("PRAGMA foreign_keys = ON");
    return bytes;
  }

  private scheduleSave(): void {
    if (!this.persisted) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), 400);
  }

  async flush(): Promise<void> {
    if (!this.persisted) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await writeFileBytes(this.path, this.exportBytes());
  }
}

/** The open journal, for the backup download. */
export async function mainDatabase(): Promise<Database> {
  return Database.load(MAIN);
}

/** Puts restored bytes in place of the journal; the page reloads afterwards. */
export async function replaceMainDatabase(bytes: Uint8Array): Promise<void> {
  const current = open.get(MAIN);
  if (current) {
    current.persisted = false;
    open.delete(MAIN);
  }
  await writeFileBytes(MAIN, bytes);
}
