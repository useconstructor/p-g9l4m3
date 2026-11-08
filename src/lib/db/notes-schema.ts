import "server-only";
import { getDatabase } from "@/lib/db";
import { writeTransaction } from "./transactions";

let readiness: Promise<void> | undefined;

async function migrate(): Promise<void> {
  const database = getDatabase();
  await database.execute("PRAGMA foreign_keys = ON");
  await writeTransaction(async (transaction) => {
    await transaction.batch([
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        secret_hash TEXT UNIQUE NOT NULL,
        public_ref TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        titulo TEXT NOT NULL,
        texto TEXT NOT NULL,
        fijada INTEGER NOT NULL CHECK (fijada IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        implementation_version TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS mutations (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        mutation_key TEXT NOT NULL,
        tipo TEXT NOT NULL,
        target_id TEXT,
        payload_json TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL,
        http_status INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, mutation_key)
      )`,
      `CREATE INDEX IF NOT EXISTS notes_owner_pinned_updated
        ON notes (session_id, fijada DESC, updated_at DESC, id ASC)`,
      `CREATE INDEX IF NOT EXISTS notes_owner_updated
        ON notes (session_id, updated_at DESC, id ASC)`,
    ]);
    // Reject an incompatible preexisting template table without changing records.
    await transaction.execute("SELECT id, secret_hash, public_ref, created_at FROM sessions LIMIT 0");
  });
}

/** No seeds, retention jobs, resets or destructive schema replacement. */
export function ensureNotesSchema(): Promise<void> {
  if (!readiness) {
    readiness = migrate().catch((error: unknown) => {
      readiness = undefined;
      throw error;
    });
  }
  return readiness;
}
