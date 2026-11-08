'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ApiError, request, type Summary } from '@/lib/notes-client';
import { Confirm } from './confirm';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

type Guard = { title: string; body: ReactNode; action?: string; run: () => void; danger?: boolean };
type SessionContext = { summary: Summary | null; ready: boolean; loading: boolean; error: string; sessionRef: string | null; refresh: () => Promise<void>; retry: () => void; invalidate: () => void; tick: number; setDirty: (value: boolean) => void; confirm: (guard: Guard) => void; navigate: (href: string, replace?: boolean) => void; loseSession: () => void };
const Session = createContext<SessionContext | null>(null);
function markerScope(): string | null {
  if (window.top === window.self) return 'direct';
  const origins = window.location.ancestorOrigins;
  if (origins?.length) return `embedded:${origins[origins.length-1]}`;
  try { if (window.top?.location.origin) return `embedded:${window.top.location.origin}`; } catch { /* Cross-origin parent cannot be inferred from a private credential. */ }
  return null;
}
export function NotesProvider({ children }: { children: ReactNode }) {
  const router = useRouter(); const pathname = usePathname();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [ready, setReady] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [tick, setTick] = useState(0);
  const [guard, setGuard] = useState<Guard | null>(null), [restartOpen, setRestartOpen] = useState(false);
  const acceptedAction = useRef<(() => void) | null>(null);
  const dirty = useRef(false), trigger = useRef<HTMLElement | null>(null), working = useRef<Promise<void> | null>(null), channel = useRef<BroadcastChannel | null>(null);
  const readyRef = useRef(false);
  const confirm = useCallback((value: Guard) => { trigger.current = document.activeElement as HTMLElement; setGuard(value); }, []);
  const loseSession = useCallback(() => { readyRef.current = false; setReady(false); setError('No podemos acceder a esta sesión'); }, []);
  const refresh = useCallback(async () => {
    if (!readyRef.current) return;
    try { setSummary(await request<Summary>('/api/resumen')); setError(''); }
    catch (e) { if (e instanceof ApiError && e.status === 401) loseSession(); else setError('No pudimos cargar el resumen de tus notas.'); }
  }, [loseSession]);
  const initialize = useCallback((action: 'normal' | 'restart' | 'manual' = 'normal') => {
    if (working.current) return working.current;
    setLoading(true); setError('');
    const run = async (allowInitialize: boolean) => {
      const scope = markerScope();
      const marker = scope ? `notas-de-bolsillo:sesion:${scope}` : null;
      let expected = false, legacy = false;
      try { expected = !!(marker && localStorage.getItem(marker)); legacy = !!localStorage.getItem('notas-de-bolsillo:sesion'); } catch { /* Authorization still comes from the cookie-backed read. */ }
      let established: { session_ref: string };
      if (action === 'restart') established = await request('/api/session', { action: 'restart' });
      else {
        try { established = await request('/api/session', { action: 'verify' }); }
        catch (e) {
          if (!(e instanceof ApiError) || e.status !== 401) throw e;
          if (!allowInitialize || expected || legacy || !scope || readyRef.current) throw new Error('No podemos acceder a esta sesión. Reintenta antes de empezar una sesión vacía.');
          established = await request('/api/session', { action: 'initialize' });
        }
      }
      const result = await request<Summary>('/api/resumen');
      if (result.session_ref !== established.session_ref) throw new Error('No pudimos verificar la continuidad de tu sesión.');
      if (marker) { try { localStorage.setItem(marker, '1'); } catch { /* Session remains cookie-backed. */ } }
      readyRef.current = true; setReady(true); setSummary(result); setTick(t => t+1);
    };
    working.current = Promise.resolve().then(async () => {
      try {
        if (navigator.locks) await navigator.locks.request('notas-de-bolsillo:session', () => run(true));
        else if (action === 'manual') await run(false);
        else throw new Error('Este navegador no permite coordinar una sesión nueva. Reintenta para comprobar una sesión existente o abre la app en un navegador compatible antes de empezar una sesión vacía.');
      } catch (e) { readyRef.current = false; setReady(false); setError(e instanceof Error ? e.message : 'No podemos acceder a esta sesión'); }
      finally { setLoading(false); working.current = null; }
    });
    return working.current;
  }, []);
  useEffect(() => { void initialize(); }, [initialize]);
  const invalidate = useCallback(() => { setTick(t => t+1); void refresh(); channel.current?.postMessage({ type: 'invalidate' }); }, [refresh]);
  useEffect(() => {
    const focus = () => { setTick(t => t+1); void refresh(); };
    window.addEventListener('focus', focus);
    if ('BroadcastChannel' in window) { const bc = new BroadcastChannel('notas-de-bolsillo:invalidaciones'); channel.current = bc; bc.onmessage = event => { if (event.data?.type === 'invalidate') focus(); }; }
    return () => { window.removeEventListener('focus', focus); channel.current?.close(); channel.current = null; };
  }, [refresh]);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => clearTimeout(timer); }, [pathname, refresh]);
  const setDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  const navigate = useCallback((href: string, replace = false) => {
    const go = () => { dirty.current = false; if (href === location.pathname + location.search && href === '/notas?nueva=1') { window.dispatchEvent(new Event('ndb:new-note')); return; } if (replace) router.replace(href); else router.push(href); };
    if (dirty.current) confirm({ title: '¿Salir sin guardar?', body: 'Tienes cambios sin guardar. Si continúas, se perderá este borrador. Los envíos con resultado incierto seguirán disponibles para recuperar.', action: 'Salir sin guardar', run: go });
    else go();
  }, [confirm, router]);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || !['/', '/notas'].includes(url.pathname)) return;
      if (url.pathname === location.pathname && url.search === location.search && url.hash) {
        event.preventDefault(); if (location.hash !== url.hash) history.pushState(history.state, '', url.href);
        window.dispatchEvent(new Event('ndb:fragment')); return;
      }
      event.preventDefault(); navigate(url.pathname + url.search + url.hash);
    };
    document.addEventListener('click', click);
    return () => document.removeEventListener('click', click);
  }, [navigate]);
  useEffect(() => {
    const originalPush = history.pushState.bind(history), originalReplace = history.replaceState.bind(history);
    let index = typeof history.state?.ndbIndex === 'number' ? history.state.ndbIndex : 0;
    let lastUrl = location.href, restoring = false, allow = false;
    originalReplace({ ...history.state, ndbIndex: index }, '', location.href);
    history.pushState = (state, unused, url) => { index += 1; originalPush({ ...state, ndbIndex: index }, unused, url); lastUrl = location.href; };
    history.replaceState = (state, unused, url) => { originalReplace({ ...state, ndbIndex: index }, unused, url); lastUrl = location.href; };
    const pop = (event: PopStateEvent) => {
      if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
      const targetIndex = typeof event.state?.ndbIndex === 'number' ? event.state.ndbIndex : index-1;
      if (!dirty.current || allow) { allow = false; index = targetIndex; lastUrl = location.href; return; }
      event.stopImmediatePropagation(); const delta = targetIndex-index; const target = location.pathname + location.search + location.hash;
      if (delta) { restoring = true; history.go(-delta); } else originalReplace({ ...history.state, ndbIndex: index }, '', lastUrl);
      confirm({ title: '¿Salir sin guardar?', body: 'Tienes cambios sin guardar. Puedes cancelar para seguir escribiendo.', action: 'Salir sin guardar', run: () => { dirty.current = false; if (delta) { allow = true; history.go(delta); } else router.replace(target); } });
    };
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('popstate', pop, true); window.addEventListener('beforeunload', unload);
    return () => { history.pushState = originalPush; history.replaceState = originalReplace; window.removeEventListener('popstate', pop, true); window.removeEventListener('beforeunload', unload); };
  }, [confirm, router]);
  return <Session.Provider value={{ summary, ready, loading, error, sessionRef: ready ? summary?.session_ref ?? null : null, refresh, retry: () => void initialize(), invalidate, tick, setDirty, confirm, navigate, loseSession }}>
    {children}
    <Confirm open={!!guard} title={guard?.title ?? ''} action={guard?.action} danger={guard?.danger} returnFocus={trigger} onCancel={() => setGuard(null)} onConfirm={() => { acceptedAction.current = guard?.run ?? null; setGuard(null); }} onClosed={() => { const run = acceptedAction.current; acceptedAction.current = null; run?.(); }}>{guard?.body}</Confirm>
    <Confirm open={restartOpen} title="¿Empezar una sesión vacía?" action="Empezar sesión vacía" onCancel={() => setRestartOpen(false)} onConfirm={() => { setRestartOpen(false); void initialize('restart'); }}><p>Tus notas anteriores no aparecerán en la nueva sesión. Si se perdió el acceso anterior, no podemos recuperarlas.</p></Confirm>
    {!ready && !loading && error && <div className="session-recovery" role="region" aria-label="Recuperación de sesión"><div className="shell"><AlertCircle aria-hidden="true"/><div><strong>No podemos acceder a esta sesión</strong><p>{error}</p></div><div className="button-row"><Button className="control secondary" onClick={() => void initialize(typeof navigator !== 'undefined' && !navigator.locks ? 'manual' : 'normal')}><RefreshCw/>Reintentar</Button><Button className="control text-button" onClick={() => setRestartOpen(true)}>Empezar sesión vacía</Button></div></div></div>}
  </Session.Provider>;
}
export function useNotesSession() { const ctx = useContext(Session); if (!ctx) throw new Error('NotesProvider requerido'); return ctx; }
