'use client';
import { useState } from 'react';
import { ArrowRight, Check, Copy, FileText, Info, NotebookPen, Pin, RefreshCw, SquarePen } from 'lucide-react';
import { useNotesSession } from './provider';
import { dateLabel, excerpt, request } from '@/lib/notes-client';
import { Button } from '@/components/ui/button';
export function HomeWorkspace() {
  const { summary, loading, ready, error, refresh, retry } = useNotesSession();
  const [info, setInfo] = useState<{name:string;description:string} | null>(null), [infoError, setInfoError] = useState(''), [copied, setCopied] = useState(false), [infoLoading, setInfoLoading] = useState(false);
  const loadInfo = async () => { setInfoLoading(true); setInfoError(''); try { setInfo(await request('/api/info')); } catch { setInfoError('No pudimos consultar la información pública.'); } finally { setInfoLoading(false); } };
  return <main className="shell home-main" id="contenido">
    <section className="home-intro" aria-labelledby="inicio-titulo"><div><h1 id="inicio-titulo" tabIndex={-1}>Tus notas, a mano</h1><p>Resumen de tu sesión privada.</p></div></section>
    <div className="home-workspace">
      <section className="summary-panel" aria-label="Resumen de tus notas" aria-busy={loading}>
        <div className="stat"><div><span>Total de notas</span><strong>{loading || !ready || !summary ? '—' : summary.total}</strong></div><FileText aria-hidden="true"/></div>
        <div className="stat"><div><span>Notas fijadas</span><strong>{loading || !ready || !summary ? '—' : summary.fijadas}</strong></div><Pin aria-hidden="true"/></div>
        <div className="summary-help"><Info size={18}/><p>{loading ? 'Preparando tu sesión privada…' : ready && summary?.total === 0 ? 'Empiezas con cero notas. Crea la primera cuando quieras.' : 'Fija tus notas importantes para encontrarlas primero.'}</p></div>
        <a href="/notas?nueva=1" className="control primary summary-new"><SquarePen/>{ready && summary?.total === 0 ? 'Crear mi primera nota' : 'Nueva nota'}</a>
      </section>
      <section className="activity-panel paper" aria-labelledby="actividad-titulo"><div className="section-heading"><h2 id="actividad-titulo">Actividad reciente</h2><a className="text-link" href="/notas">Ver todas las notas <ArrowRight/></a></div>
        {loading ? <div className="activity-loading" role="status"><div className="skeleton-line"/><div className="skeleton-line"/><div className="skeleton-line"/><p>Cargando tus notas…</p></div> : error ? <div className="empty-state error-state" role="alert"><Info/><h3>{!ready ? 'No podemos acceder a esta sesión' : 'No pudimos cargar el resumen'}</h3><p>{error}</p><Button className="control secondary" onClick={() => ready ? void refresh() : retry()}><RefreshCw/>Reintentar</Button></div> : summary?.total === 0 ? <div className="empty-state"><div className="empty-icon"><NotebookPen size={40} strokeWidth={1.4}/></div><h3>Todavía no tienes notas</h3><p>Crea tu primera nota para verla aquí.</p></div> : <div className="recent-list">{summary?.recientes.map(note => <a className="recent-row" href={`/notas?nota=${note.id}`} key={note.id}><span className="recent-icon"><FileText/></span><div><h3>{note.titulo}{note.fijada && <Pin size={15} aria-label="Fijada"/>}</h3><p>{excerpt(note.texto) || 'Sin texto'}</p><time dateTime={note.updated_at}>{dateLabel(note.updated_at)}</time></div><ArrowRight className="row-arrow"/></a>)}</div>}
      </section>
    </div>
    <section className="home-reference" aria-labelledby="como-funciona">
      <h2 id="como-funciona" tabIndex={-1}>Ayuda y referencia</h2>
      <div className="reference-content">
        <details className="reference-disclosure"><summary><h3 id="consejos" tabIndex={-1}>Consejos rápidos</h3></summary><ul><li>El título es obligatorio; el texto, opcional. Busca por cualquiera de los dos.</li><li>Pulsa “Guardar nota”. La hora confirma el guardado y los cambios se conservan al recargar.</li><li>Fija lo importante para encontrarlo primero. Antes de eliminar, te pediremos confirmación.</li></ul></details>
        <details className="reference-disclosure"><summary><h3 id="privacidad" tabIndex={-1}>Tu sesión privada</h3></summary><p>Sin cuenta ni contraseña. Sólo tu sesión puede leer y cambiar tus notas. Si cambias de navegador o dispositivo, tus notas podrían no estar ahí. Abrir la app directamente o dentro de otra web puede usar sesiones distintas. Si pierdes el acceso a esta sesión, no podemos prometer recuperar tus notas.</p></details>
    <section className="developer-section" aria-labelledby="desarrolladores"><div className="section-heading"><h2 id="desarrolladores" tabIndex={-1}>Para desarrolladores</h2><a className="endpoint" href="/api/info">GET /api/info <ArrowRight size={14}/></a></div><p>Información pública de la aplicación, sin notas privadas.</p>{!info && <Button className="control text-button" onClick={loadInfo} disabled={infoLoading}>{infoLoading ? 'Consultando…' : 'Consultar respuesta de la API'}<ArrowRight/></Button>}{info && <div className="code-panel"><pre>{JSON.stringify(info, null, 2)}</pre><Button className="control copy-button" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(info,null,2)); setCopied(true); } catch { setInfoError('No pudimos copiar. Puedes seleccionar el texto de la respuesta.'); } }}>{copied ? <Check/> : <Copy/>}{copied ? 'Copiado' : 'Copiar'}</Button></div>}{infoError && <p role="alert">{infoError} <button className="inline-link" onClick={loadInfo}>Reintentar</button></p>}</section>
      </div>
    </section>
  </main>;
}
