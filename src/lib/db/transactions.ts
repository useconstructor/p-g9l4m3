import "server-only";
import type { Transaction } from "@libsql/client";
import { getDatabase } from "@/lib/db";

function busy(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return ["SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT", "SQLITE_LOCKED"].includes(String(error.code));
}

/** BEGIN IMMEDIATE serializes writers across instances; retry only lock contention. */
export async function writeTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let transaction: Transaction | undefined;
    try {
      transaction = await getDatabase().transaction("write");
      const foreignKeys = await transaction.execute("PRAGMA foreign_keys");
      if (Number(foreignKeys.rows[0]?.foreign_keys) !== 1) {
        throw new Error("Foreign key enforcement unavailable");
      }
      const result = await work(transaction);
      await transaction.commit();
      return result;
    } catch (error) {
      transaction?.close();
      if (attempt >= 4 || !busy(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * 2 ** attempt));
    } finally {
      transaction?.close();
    }
  }
}
