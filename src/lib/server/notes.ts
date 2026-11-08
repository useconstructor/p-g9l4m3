import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Row } from "@libsql/client";
import { getDatabase } from "@/lib/db";
import { writeTransaction } from "@/lib/db/transactions";
import { ApiError, invalid, json, noteText, notFound, readBody, requireOrigin, revision, uuid, validateQuery, type Note } from "./http";
import { requireSession } from "./session";

const COLUMNS = "id, titulo, texto, fijada, created_at, updated_at, revision, implementation_version";

/** Whitelist all public properties; session_id never leaves this module. */
function publicNote(row: Row): Note {
  return {
    id: String(row.id),
    titulo: String(row.titulo),
    texto: String(row.texto),
    fijada: Number(row.fijada) === 1,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    revision: Number(row.revision),
    implementation_version: String(row.implementation_version),
  };
}

export async function summary(request: Request): Promise<Response> {
  const session = await requireSession(request);
  validateQuery(request);
  // One read snapshot keeps counters and recent activity mutually consistent.
  const [counts, recent] = await getDatabase().batch([
    { sql: "SELECT COUNT(*) AS total, COALESCE(SUM(fijada), 0) AS fijadas FROM notes WHERE session_id = ?", args: [session.id] },
    { sql: `SELECT ${COLUMNS} FROM notes WHERE session_id = ? ORDER BY updated_at DESC, id ASC LIMIT 8`, args: [session.id] },
  ], "read");
  return json({
    session_ref: session.session_ref,
    total: Number(counts.rows[0].total),
    fijadas: Number(counts.rows[0].fijadas),
    recientes: recent.rows.map(publicNote),
  });
}

export async function list(request: Request): Promise<Response> {
  const session = await requireSession(request);
  const query = validateQuery(request, ["q"]).get("q") ?? "";
  const needle = query.toLowerCase();
  const [counts, matches] = await getDatabase().batch([
    { sql: "SELECT COUNT(*) AS total FROM notes WHERE session_id = ?", args: [session.id] },
    {
      sql: `SELECT ${COLUMNS} FROM notes WHERE session_id = ?
        ORDER BY fijada DESC, updated_at DESC, id ASC`,
      args: [session.id],
    },
  ], "read");
  // SQLite LIKE folds ASCII only. Apply literal Unicode casing after the
  // owner-scoped ordered snapshot, without trimming/normalizing stored text.
  const notes = matches.rows.map(publicNote).filter(note =>
    (note.titulo + "\n" + note.texto).toLowerCase().includes(needle));
  return json({ total: Number(counts.rows[0].total), coincidencias: notes.length, notas: notes });
}

export async function detail(request: Request, id: string): Promise<Response> {
  const session = await requireSession(request);
  validateQuery(request);
  uuid(id, "id");
  const result = await getDatabase().execute({
    sql: `SELECT ${COLUMNS} FROM notes WHERE session_id = ? AND id = ?`,
    args: [session.id, id],
  });
  if (!result.rows[0]) notFound();
  return json({ nota: publicNote(result.rows[0]) });
}

type Operation = "crear" | "editar" | "fijar" | "eliminar";
type Intent = {
  tipo: Operation;
  target_id: string | null;
  expected_revision?: number;
  titulo?: string;
  texto?: string;
  fijada?: boolean;
};
type Result = { status: number; body: { nota: Note } | { id: string; revision: number; deleted_at: string } };

function canonical(intent: Intent): string {
  // Intent contains scalar fields only; sort keys without normalizing their values.
  return JSON.stringify(Object.fromEntries(Object.entries(intent).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
}

export async function mutate(request: Request, tipo: Operation, id?: string): Promise<Response> {
  requireOrigin(request);
  const session = await requireSession(request);
  validateQuery(request);
  const target = tipo === "crear" ? null : uuid(id, "id");
  const allowed = tipo === "crear" ? ["mutation_key", "titulo", "texto"]
    : tipo === "editar" ? ["mutation_key", "expected_revision", "titulo", "texto"]
    : tipo === "fijar" ? ["mutation_key", "expected_revision", "fijada"]
    : ["mutation_key", "expected_revision"];
  const body = await readBody(request, allowed);
  const key = uuid(body.mutation_key, "mutation_key");
  const intent: Intent = { tipo, target_id: target };
  if (tipo !== "crear") intent.expected_revision = revision(body.expected_revision);
  if (tipo === "crear" || tipo === "editar") Object.assign(intent, noteText(body));
  if (tipo === "fijar") {
    if (typeof body.fijada !== "boolean") invalid({ fijada: "Indica true o false para fijar la nota." });
    intent.fijada = body.fijada;
  }
  const payload = canonical(intent);
  const fingerprint = createHash("sha256").update(payload).digest("hex");

  const result = await writeTransaction<Result>(async (transaction) => {
    // Deduplication must precede existence/revision checks, including after delete.
    const replay = await transaction.execute({
      sql: "SELECT payload_json, fingerprint, result_json, http_status FROM mutations WHERE session_id = ? AND mutation_key = ?",
      args: [session.id, key],
    });
    if (replay.rows[0]) {
      const saved = replay.rows[0];
      if (saved.fingerprint !== fingerprint || saved.payload_json !== payload) {
        throw new ApiError(409, "idempotency_conflict", "Este envío ya se usó con otros datos. Recupera el envío original o inicia otro de forma explícita.");
      }
      return { status: Number(saved.http_status), body: JSON.parse(String(saved.result_json)) as Result["body"] };
    }

    let current: Note | undefined;
    if (target !== null) {
      const existing = await transaction.execute({
        sql: `SELECT ${COLUMNS} FROM notes WHERE session_id = ? AND id = ?`,
        args: [session.id, target],
      });
      if (!existing.rows[0]) notFound();
      current = publicNote(existing.rows[0]);
      if (current.revision !== intent.expected_revision) {
        throw new ApiError(409, "revision_conflict", "La nota cambió desde tu última confirmación. Compara los valores antes de continuar.", undefined, current);
      }
    }
    const nextRevision = current ? current.revision + 1 : 1;
    if (!Number.isSafeInteger(nextRevision)) throw new Error("Revision cannot be advanced");
    const now = new Date(Math.max(Date.now(), current ? Date.parse(current.updated_at) + 1 : 0)).toISOString();
    let response: Result;
    if (tipo === "crear") {
      const created = await transaction.execute({
        sql: `INSERT INTO notes (id, session_id, titulo, texto, fijada, created_at, updated_at, revision, implementation_version)
          VALUES (?, ?, ?, ?, 0, ?, ?, 1, '1') RETURNING ${COLUMNS}`,
        args: [randomUUID(), session.id, intent.titulo!, intent.texto!, now, now],
      });
      response = { status: 201, body: { nota: publicNote(created.rows[0]) } };
    } else if (tipo === "editar") {
      const updated = await transaction.execute({
        sql: `UPDATE notes SET titulo = ?, texto = ?, updated_at = ?, revision = revision + 1, implementation_version = '1'
          WHERE session_id = ? AND id = ? AND revision = ? RETURNING ${COLUMNS}`,
        args: [intent.titulo!, intent.texto!, now, session.id, target!, intent.expected_revision!],
      });
      if (!updated.rows[0]) throw new Error("Concurrent update unavailable");
      response = { status: 200, body: { nota: publicNote(updated.rows[0]) } };
    } else if (tipo === "fijar") {
      const updated = await transaction.execute({
        sql: `UPDATE notes SET fijada = ?, updated_at = ?, revision = revision + 1, implementation_version = '1'
          WHERE session_id = ? AND id = ? AND revision = ? RETURNING ${COLUMNS}`,
        args: [intent.fijada ? 1 : 0, now, session.id, target!, intent.expected_revision!],
      });
      if (!updated.rows[0]) throw new Error("Concurrent update unavailable");
      response = { status: 200, body: { nota: publicNote(updated.rows[0]) } };
    } else {
      const deleted = await transaction.execute({
        sql: "DELETE FROM notes WHERE session_id = ? AND id = ? AND revision = ?",
        args: [session.id, target!, intent.expected_revision!],
      });
      if (deleted.rowsAffected !== 1) throw new Error("Concurrent deletion unavailable");
      response = { status: 200, body: { id: target!, revision: nextRevision, deleted_at: now } };
    }
    await transaction.execute({
      sql: `INSERT INTO mutations (session_id, mutation_key, tipo, target_id, payload_json, fingerprint, result_json, http_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [session.id, key, tipo, target, payload, fingerprint, JSON.stringify(response.body), response.status, now],
    });
    return response;
  });
  return json(result.body, result.status);
}
