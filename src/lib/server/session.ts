import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/db";
import { ensureNotesSchema } from "@/lib/db/notes-schema";
import { invalid, json, readBody, requireOrigin, unavailableSession, validateQuery } from "./http";

export type Session = { id: string; session_ref: string };
const COOKIE = "ndb_session";

function cookieSecret(request: Request): string | null {
  const matches = (request.headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim())
    .filter((part) => part.split("=", 1)[0] === COOKIE);
  if (!matches.length) return null;
  if (matches.length !== 1) unavailableSession();
  const raw = matches[0].slice(COOKIE.length + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) unavailableSession();
  return raw;
}

async function lookup(secret: string): Promise<Session | null> {
  await ensureNotesSchema();
  const result = await getDatabase().execute({
    sql: "SELECT id, public_ref FROM sessions WHERE secret_hash = ?",
    args: [createHash("sha256").update(secret).digest("hex")],
  });
  const row = result.rows[0];
  return row ? { id: String(row.id), session_ref: String(row.public_ref) } : null;
}

export async function requireSession(request: Request): Promise<Session> {
  const secret = cookieSecret(request);
  if (!secret) unavailableSession();
  const session = await lookup(secret);
  if (!session) unavailableSession();
  return session;
}

export async function establishSession(request: Request): Promise<Response> {
  const origin = requireOrigin(request);
  validateQuery(request);
  const body = await readBody(request, ["action"]);
  const action = body.action ?? "initialize";
  if (body.action === null || !["initialize", "verify", "restart"].includes(action as string)) {
    invalid({ action: "Elige initialize, verify o restart." });
  }
  if (action !== "restart") {
    const secret = cookieSecret(request);
    if (secret) {
      const existing = await lookup(secret);
      if (!existing) unavailableSession();
      return json({ session_ref: existing.session_ref });
    }
    if (action === "verify") unavailableSession();
  }
  // Only absent-cookie initialize or explicitly requested restart can create.
  await ensureNotesSchema();
  const secret = randomBytes(32).toString("base64url");
  const sessionRef = randomUUID();
  await getDatabase().execute({
    sql: "INSERT INTO sessions (id, secret_hash, public_ref, created_at) VALUES (?, ?, ?, ?)",
    args: [randomUUID(), createHash("sha256").update(secret).digest("hex"), sessionRef, new Date().toISOString()],
  });
  const secure = origin.startsWith("https://");
  const cookie = `${COOKIE}=${secret}; Path=/; HttpOnly; Max-Age=31536000; ${
    secure ? "Secure; SameSite=None; Partitioned" : "SameSite=Lax"
  }`;
  return json({ session_ref: sessionRef }, 200, { "Set-Cookie": cookie });
}
