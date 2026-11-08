import "server-only";
import { createClient, type Client } from "@libsql/client";

let client: Client | undefined;

/** Lazy initialization keeps public info and module evaluation independent of Turso. */
export function getDatabase(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url || !authToken) throw new Error("Database configuration unavailable");
    client = createClient({ url, authToken, intMode: "number" });
  }
  return client;
}

// Preserve the copied helper's export for existing server imports, without eagerly
// accessing runtime configuration during Next's static module evaluation.
export const db: Client = new Proxy({} as Client, {
  get(_target, property) {
    const instance = getDatabase();
    const value = Reflect.get(instance, property, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
