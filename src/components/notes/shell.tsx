'use client';
/* Native anchors deliberately defer routing to the draft guard in NotesProvider. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X, SquarePen, ShieldCheck, ArrowUpRight } from 'lucide-react';
import branding from '../../../branding.json';
import { Button } from '@/components/ui/button';
export function Brand({ compact = false }: { compact?: boolean }) { return <span className={`brand-lockup ${compact ? 'compact' : ''}`}><span className="brand-mark-support"><img data-brand-logo src={branding.logoImageUrl || '/brand-mark.svg'} alt="" width="32" height="32"/></span><span>{branding.logoText}</span></span>; }
export function Header() {
  const pathname = usePathname(); const [open, setOpen] = useState(false); const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { queueMicrotask(() => setOpen(false)); }, [pathname]);
  useEffect(() => { const close = () => setOpen(false); window.addEventListener('popstate', close); return () => window.removeEventListener('popstate', close); }, []);
  return <header className="site-header"><a className="skip-link" href="#contenido">Saltar al contenido</a><div className="shell header-inner"><a className="brand-link" href="/" aria-label={`${branding.logoText}, Inicio`}><Brand/></a><nav className="desktop-nav" aria-label="Navegación principal"><a href="/" aria-current={pathname === '/' ? 'page' : undefined}>Inicio</a><a href="/notas" aria-current={pathname === '/notas' ? 'page' : undefined}>Notas</a></nav><a className="control header-new" href="/notas?nueva=1"><SquarePen/><span className="header-new-label">Nueva nota</span></a><Button ref={trigger} className="control mobile-menu-button" aria-label={open ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={open} aria-controls="menu-movil" onClick={() => setOpen(!open)}>{open ? <X/> : <Menu/>}</Button></div>{open && <nav id="menu-movil" className="mobile-nav" aria-label="Navegación móvil" onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } }}><a href="/" aria-current={pathname === '/' ? 'page' : undefined} onClick={() => setOpen(false)}>Inicio</a><a href="/notas" aria-current={pathname === '/notas' ? 'page' : undefined} onClick={() => setOpen(false)}>Notas</a></nav>}</header>;
}
export function Footer() { return <footer className="site-footer"><div className="shell footer-inner"><div><Brand compact/><p className="descriptor"><ShieldCheck size={16}/>Una app ficticia de Esteban para probar Constructor</p></div><nav aria-label="Navegación del pie"><a href="/">Inicio</a><a href="/notas">Notas</a><a href="/#consejos">Consejos rápidos</a><a href="/#privacidad">Privacidad y datos</a><a href="/api/info">API pública <ArrowUpRight size={14}/></a></nav></div></footer>; }
export function FragmentFocus() {
  const pathname = usePathname(); const [fragment, setFragment] = useState(''); const [attempt, setAttempt] = useState(0); const [unknown, setUnknown] = useState(false); const errorRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { const read = () => { let hash = ''; try { hash = decodeURIComponent(location.hash.slice(1)); } catch { hash = location.hash.slice(1); } setFragment(hash); setAttempt(n => n+1); }; queueMicrotask(read); window.addEventListener('load', read); window.addEventListener('hashchange', read); window.addEventListener('popstate', read); window.addEventListener('ndb:fragment', read); return () => { window.removeEventListener('load', read); window.removeEventListener('hashchange', read); window.removeEventListener('popstate', read); window.removeEventListener('ndb:fragment', read); }; }, [pathname]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
    if (cancelled) return;
    if (!fragment) { setUnknown(false); return; }
    const target = document.getElementById(fragment);
    if (target) { setUnknown(false); for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) { if (ancestor instanceof HTMLDetailsElement) ancestor.open = true; } const heading = target.matches('h1,h2,h3') ? target : target.querySelector<HTMLElement>('h1,h2,h3') || target; heading.tabIndex = -1; heading.focus({ preventScroll: true }); heading.scrollIntoView({ block: 'start' }); }
    else setUnknown(true);
    });
    return () => { cancelled = true; };
  }, [fragment, attempt, pathname]);
  useEffect(() => { if (unknown) { errorRef.current?.focus(); errorRef.current?.scrollIntoView({ block: 'start' }); } }, [unknown, attempt]);
  if (!unknown) return null;
  return <section className="shell fragment-error" role="alert"><h2 ref={errorRef} tabIndex={-1}>No se encuentra esta sección</h2><p>El enlace no corresponde a una sección disponible.</p><div className="button-row"><a href="/#contenido">Volver al inicio</a><a href="/#consejos">Consejos rápidos</a><a href="/notas">Ver todas las notas</a></div></section>;
}

export function BrandFonts() { useEffect(() => { for (const face of branding.brandbook.fontFaces) void document.fonts.load(face.weight + ' 16px ' + JSON.stringify(face.family)).catch(() => { /* Native font fallback remains visible when a supplied asset fails. */ }); }, []); return null; }
