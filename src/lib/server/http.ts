import "server-only";

export type Note = {
  id: string;
  titulo: string;
  texto: string;
  fijada: boolean;
  created_at: string;
  updated_at: string;
  revision: number;
  implementation_version: string;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly current?: Note,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  return Response.json(body, { status, headers: responseHeaders });
}

/** Never send SQL errors, stack traces, credentials or internal owner fields. */
export async function handle(action: () => Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ApiError) {
      return json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
          ...(error.current ? { current: error.current } : {}),
        },
      }, error.status);
    }
    return json({ error: {
      code: "server_error",
      message: "No podemos confirmar la operación ahora. Conserva tus cambios y reintenta el mismo envío.",
    } }, 503);
  }
}

export function invalid(fields: Record<string, string>): never {
  throw new ApiError(400, "validation_error", "Revisa los campos indicados.", fields);
}

export function unavailableSession(): never {
  throw new ApiError(401, "session_unavailable", "No podemos acceder a esta sesión. Reintenta o empieza una sesión vacía de forma explícita.");
}

export function notFound(): never {
  throw new ApiError(404, "note_not_found", "No se puede abrir esta nota.");
}

function configuredOrigin(value: string): string {
  const parsed = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash ||
      !(parsed.protocol === "https:" || (parsed.protocol === "http:" && local))) {
    throw new Error("Trusted origin configuration unavailable");
  }
  return parsed.origin;
}

/** Only provisioned configuration establishes trust; never Host/X-Forwarded-*. */
export function requireOrigin(request: Request): string {
  const trusted = new Set<string>();
  if (process.env.APP_ORIGIN) trusted.add(configuredOrigin(process.env.APP_ORIGIN));
  if (process.env.VERCEL_URL) {
    const preview = process.env.VERCEL_URL;
    // VERCEL_URL is a hostname; a supplied full URL must also be HTTPS.
    const origin = configuredOrigin(preview.includes("://") ? preview : `https://${preview}`);
    if (!origin.startsWith("https://")) throw new Error("Preview origin configuration unavailable");
    trusted.add(origin);
  }
  if (!trusted.size) throw new Error("Trusted origin configuration unavailable");
  const origin = request.headers.get("origin");
  if (!origin || !trusted.has(origin)) {
    throw new ApiError(400, "invalid_origin", "No se admite el origen de esta solicitud.");
  }
  return origin;
}

export function validateQuery(request: Request, allowed: readonly string[] = []): URLSearchParams {
  const params = new URL(request.url).searchParams;
  const fields: Record<string, string> = Object.create(null);
  for (const key of params.keys()) {
    if (!allowed.includes(key)) fields[key] = "Este parámetro no está permitido.";
    else if (params.getAll(key).length !== 1) fields[key] = "Envía este parámetro una sola vez.";
  }
  if (Object.keys(fields).length) invalid(fields);
  return params;
}

export async function readBody(request: Request, allowed: readonly string[]): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") invalid({ body: "Envía un objeto JSON válido." });
  let value: unknown;
  try { value = await request.json(); }
  catch { invalid({ body: "Envía un objeto JSON válido." }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid({ body: "Envía un objeto JSON válido." });
  }
  const fields: Record<string, string> = Object.create(null);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fields[key] = "Este campo no está permitido.";
  }
  if (Object.keys(fields).length) invalid(fields);
  return value as Record<string, unknown>;
}

export function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    invalid({ [field]: "Usa un identificador UUID válido en minúsculas." });
  }
  return value;
}

export function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    invalid({ expected_revision: "La revisión esperada debe ser un entero positivo válido." });
  }
  return value;
}

export function noteText(body: Record<string, unknown>): { titulo: string; texto: string } {
  const fields: Record<string, string> = Object.create(null);
  if (typeof body.titulo !== "string" || !body.titulo.trim()) {
    fields.titulo = "Escribe un título para guardar la nota.";
  }
  if (body.texto !== undefined && typeof body.texto !== "string") {
    fields.texto = "El texto debe ser una cadena; puede estar vacía.";
  }
  if (Object.keys(fields).length) invalid(fields);
  // trim is solely a validation test. No normalization or length restriction.
  return { titulo: body.titulo as string, texto: (body.texto ?? "") as string };
}
