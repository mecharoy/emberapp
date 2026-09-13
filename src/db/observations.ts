import { getDb } from "./client";
import { listAllDayMetrics } from "./metrics";
import { canonicalKey, foldMetricsIntoObservations, observationScore } from "./observationFold";
import type { Observation } from "./types";

/**
 * Rebuilds the observations table from every day_metrics row (see
 * observationFold.ts for why derive-and-replace beats incremental updates).
 * User-set pinned flags survive the rebuild, matched case-insensitively.
 */
export async function rebuildObservations(): Promise<void> {
  const db = await getDb();
  const metrics = await listAllDayMetrics();
  const aggregates = foldMetricsIntoObservations(metrics);

  const existing = await db.select<Observation[]>("SELECT kind, key, pinned FROM observations");
  const pinnedIdentities = new Set(
    existing.filter((o) => o.pinned === 1).map((o) => `${o.kind} ${canonicalKey(o.key)}`),
  );

  await db.execute("DELETE FROM observations");
  for (const a of aggregates) {
    const pinned = pinnedIdentities.has(`${a.kind} ${canonicalKey(a.key)}`) ? 1 : 0;
    await db.execute(
      `INSERT INTO observations (kind, key, detail, sentiment, occurrences, first_seen, last_seen, pinned)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7)`,
      [a.kind, a.key, a.sentiment, a.occurrences, a.first_seen, a.last_seen, pinned],
    );
  }
}

export async function listObservations(kind?: Observation["kind"]): Promise<Observation[]> {
  const db = await getDb();
  if (kind) {
    return db.select<Observation[]>(
      "SELECT * FROM observations WHERE kind = $1 ORDER BY last_seen DESC, occurrences DESC",
      [kind],
    );
  }
  return db.select<Observation[]>(
    "SELECT * FROM observations ORDER BY last_seen DESC, occurrences DESC",
  );
}

/** Up to `limit` observations ranked by recency × occurrences. */
export async function listTopObservations(todayKey: string, limit = 15): Promise<Observation[]> {
  const all = await listObservations();
  return all
    .slice()
    .sort((a, b) => observationScore(b, todayKey) - observationScore(a, todayKey))
    .slice(0, limit);
}

/** User promotes/demotes a discovered habit to a tracked one. */
export async function setObservationPinned(id: number, pinned: boolean): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE observations SET pinned = $1 WHERE id = $2", [pinned ? 1 : 0, id]);
}
