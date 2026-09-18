import { beforeEach, describe, expect, it, vi } from "vitest";
import { pinHabit } from "./observations";

// A real SQLite database in memory, built from the app's own migrations.
const h = vi.hoisted(() => {
  function bind(sql: string, params: unknown[]): Record<string, unknown> {
    const named: Record<string, unknown> = {};
    for (const m of new Set(sql.match(/\$\d+/g) ?? [])) named[m] = params[Number(m.slice(1)) - 1];
    return named;
  }
  return { db: null as any, bind };
});

vi.mock("./client", () => ({
  getDb: async () => ({
    select: async (sql: string, params: unknown[] = []) => h.db.prepare(sql).all(h.bind(sql, params)),
    execute: async (sql: string, params: unknown[] = []) => h.db.prepare(sql).run(h.bind(sql, params)),
  }),
}));

const migrations = import.meta.glob("../../src-tauri/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

beforeEach(async () => {
  const sqliteModule = "node:sqlite";
  const { DatabaseSync } = await import(/* @vite-ignore */ sqliteModule);
  h.db = new DatabaseSync(":memory:");
  for (const file of Object.keys(migrations).sort()) h.db.exec(migrations[file]);
});

function seedHabitDay(date: string, key: string) {
  h.db
    .prepare("INSERT INTO day_metrics (date, mood, energy, raw_json) VALUES (?, 5, 5, ?)")
    .run(date, JSON.stringify({ habits: [{ key, done: true }] }));
}

const pinned = () =>
  h.db.prepare("SELECT key, pinned, occurrences FROM observations WHERE kind = 'habit'").all().map((r: object) => ({ ...r }));

describe("pinHabit", () => {
  it("pins a habit the observations table hasn't caught up with yet", async () => {
    seedHabitDay("2026-09-10", "Doomscrolling");
    seedHabitDay("2026-09-11", "doomscrolling");
    expect(pinned()).toEqual([]);

    await pinHabit("doomscrolling");

    expect(pinned()).toEqual([{ key: "Doomscrolling", pinned: 1, occurrences: 2 }]);
  });

  it("pins an existing observation without rebuilding, whatever the case", async () => {
    h.db.exec(
      "INSERT INTO observations (kind, key, occurrences, first_seen, last_seen) VALUES ('habit', 'Gym', 7, '2026-09-01', '2026-09-12')",
    );
    await pinHabit("  gym ");
    expect(pinned()).toEqual([{ key: "Gym", pinned: 1, occurrences: 7 }]);
  });

  it("says so when the habit isn't in any entry", async () => {
    await expect(pinHabit("juggling")).rejects.toThrow("No habit");
  });
});
