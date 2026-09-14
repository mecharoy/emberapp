import { getDb } from "./client";

/** Writes a consistent copy of the whole database to `path` (which must not
 *  exist yet), even while other writes are going on. */
export async function snapshotDatabase(path: string): Promise<void> {
  const db = await getDb();
  await db.execute("VACUUM INTO $1", [path]);
}

/** Whether there is anything worth backing up yet. */
export async function hasJournalData(): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    "SELECT (SELECT COUNT(*) FROM entries) + (SELECT COUNT(*) FROM captures) AS n",
  );
  return (rows[0]?.n ?? 0) > 0;
}
