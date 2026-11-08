export type Note = { id: string; titulo: string; texto: string; fijada: boolean; created_at: string; updated_at: string; revision: number; implementation_version: string };
export type Summary = { session_ref: string; total: number; fijadas: number; recientes: Note[] };
export type NoteIndex = { total: number; coincidencias: number; notas: Note[] };
export type Draft = { titulo: string; texto: string };
export type Envelope = { session_ref: string; endpoint: string; body: Record<string, string | number | boolean>; baseline: Note | null };
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string,string>, public current?: Note) { super(message); }
}
export async function request<T>(url: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal });
  let data;
  try { data = await response.json(); } catch { throw new ApiError(response.status, 'unreadable_response', 'No pudimos comprobar la respuesta.'); }
  if (!response.ok) throw new ApiError(response.status, data.error?.code ?? 'server_error', data.error?.message ?? 'No pudimos completar la petición. Reintenta.', data.error?.fields, data.error?.current);
  return data as T;
}
export const envelopeKey = 'notas-de-bolsillo:envios-pendientes';
export function readEnvelopes(): Envelope[] {
  try { const value = JSON.parse(sessionStorage.getItem(envelopeKey) || '[]'); return Array.isArray(value) ? value.filter(e => e && typeof e.session_ref === 'string' && typeof e.endpoint === 'string' && e.endpoint.startsWith('/api/notas') && e.body && typeof e.body.mutation_key === 'string') : []; } catch { return []; }
}
export function keepEnvelope(envelope: Envelope) {
  const list = readEnvelopes().filter(e => e.body.mutation_key !== envelope.body.mutation_key);
  sessionStorage.setItem(envelopeKey, JSON.stringify([...list, envelope]));
}
export function clearEnvelope(key: string) { sessionStorage.setItem(envelopeKey, JSON.stringify(readEnvelopes().filter(e => e.body.mutation_key !== key))); }
export const sameDraft = (draft: Draft, note: Draft | null) => !!note && draft.titulo === note.titulo && draft.texto === note.texto;
export function dateLabel(value: string, timeOnly = false) {
  const d = new Date(value); if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('es', timeOnly ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}
export function excerpt(text: string) { const chars = Array.from(text); return chars.slice(0,160).join('') + (chars.length > 160 ? '…' : ''); }
