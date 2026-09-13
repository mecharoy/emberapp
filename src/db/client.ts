import Database from "@tauri-apps/plugin-sql";

let dbPromise: Promise<Database> | null = null;

/**
 * Singleton connection to ember.db (sqlite, via tauri-plugin-sql).
 * Migrations run automatically on load — see src-tauri/migrations/.
 * This is the ONLY module that should import "@tauri-apps/plugin-sql".
 * Everything else goes through the typed functions in src/db/*.
 */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:ember.db");
  }
  return dbPromise;
}
