'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleAlert, FileText, Info, LoaderCircle, NotebookPen, Pin, PinOff, RefreshCw, Save, Search, SquarePen, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Confirm } from './confirm';
import { useNotesSession } from './provider';
import { ApiError, clearEnvelope, dateLabel, excerpt, keepEnvelope, readEnvelopes, request, sameDraft, type Draft, type Envelope, type Note, type NoteIndex } from '@/lib/notes-client';

const emptyDraft: Draft = { titulo: '', texto: '' };
const contextKey = 'notas-de-bolsillo:indice';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Conflict = { previous: Note | null; current: Note };

export function NotesWorkspace() {
  const params = useSearchParams(); const noteId = params.get('nota'); const newNote = params.has('nueva');
  const invalidReference = (newNote && (params.get('nueva') !== '1' || params.has('nota'))) || (params.has('nota') && (!noteId || !uuid.test(noteId))) || params.getAll('nota').length > 1 || params.getAll('nueva').length > 1;
  const selection = invalidReference ? `invalid:${params.toString()}` : noteId ? `note:${noteId}` : newNote ? 'new' : 'none';
  const { ready, loading: sessionLoading, sessionRef, tick, invalidate, setDirty, confirm, loseSession } = useNotesSession();
  const [query, setQuery] = useState(''), [index, setIndex] = useState<NoteIndex | null>(null), [indexLoading, setIndexLoading] = useState(true), [indexError, setIndexError] = useState(''), [indexRetry, setIndexRetry] = useState(0);
  const [baseline, setBaseline] = useState<Note | null>(null), [draft, setDraft] = useState<Draft>(emptyDraft), [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState(''), [detailRetry, setDetailRetry] = useState(0);
  const [mobileEditor, setMobileEditor] = useState(selection !== 'none'), [pending, setPending] = useState(false), [message, setMessage] = useState(''), [titleError, setTitleError] = useState(''), [validationAttempt, setValidationAttempt] = useState(0), [conflict, setConflict] = useState<Conflict | null>(null);
  const [fullTitle, setFullTitle] = useState(false);
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]), [deleteOpen, setDeleteOpen] = useState(false), [deleteError, setDeleteError] = useState('');
  const toolbarRef = useRef<HTMLDivElement>(null), titleInput = useRef<HTMLInputElement>(null), indexHeading = useRef<HTMLHeadingElement>(null), editorHeading = useRef<HTMLHeadingElement>(null), deleteTrigger = useRef<HTMLButtonElement>(null), listRef = useRef<HTMLDivElement>(null);
  const currentDraft = useRef(draft), baselineRef = useRef(baseline), busy = useRef(false), selectionRef = useRef(selection), appliedSelection = useRef<string | null>(null), focusList = useRef(false), afterDelete = useRef(false), focusEditor = useRef(false), listPosition = useRef(0), pagePosition = useRef(0), viewReady = useRef(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLSpanElement>(null), tabAnimation = useRef<Animation | null>(null), tabPrevious = useRef<number | null>(null), tabSelection = useRef<string | null>(null);
  useLayoutEffect(() => { currentDraft.current = draft; baselineRef.current = baseline; selectionRef.current = selection; }, [draft, baseline, selection]);
  const dirty = (selection === 'new' || !!baseline) && (baseline ? !sameDraft(draft, baseline) : draft.titulo !== '' || draft.texto !== '');
  const relevantEnvelopes = envelopes.filter(e => e.session_ref === sessionRef && (selection === 'new' ? e.endpoint === '/api/notas' : !!noteId && (e.baseline?.id === noteId || e.endpoint.includes(`/${noteId}/`))));
  const uncertain = relevantEnvelopes.length > 0;
  const stateLabel = pending ? 'Guardando…' : uncertain ? 'Resultado incierto' : conflict ? 'Esta nota cambió' : titleError || message ? 'Revisa la nota' : dirty ? 'Cambios sin guardar' : baseline ? `Guardado · ${dateLabel(baseline.updated_at, true)}` : 'Sin guardar';
  // Let Next synchronize useSearchParams; its internal history flags must not be
  // passed back as though this were an internal router navigation.
  const setUrl = useCallback((href: string) => { history.replaceState(null, '', href); }, []);
  const awaitingSelection = ready && selection !== 'none' && selection !== 'new' && !invalidReference && appliedSelection.current !== `${sessionRef}:${selection}`;
  useEffect(() => { setDirty(dirty || pending || uncertain); return () => setDirty(false); }, [dirty, pending, uncertain, setDirty]);
  useEffect(() => {
    // Restore per-tab view context after hydration; never use it as note persistence.
    queueMicrotask(() => {
    try { const context = JSON.parse(sessionStorage.getItem(contextKey) || '{}'); if (typeof context.query === 'string') setQuery(context.query); if (typeof context.scroll === 'number') listPosition.current = context.scroll; if (typeof context.pageScroll === 'number') pagePosition.current = context.pageScroll; } catch { /* Start with a clean index when view context is unavailable. */ }
    viewReady.current = true; setEnvelopes(readEnvelopes());
    });
    const resetNew = () => { setDraft(emptyDraft); setBaseline(null); setMessage(''); setTitleError(''); setConflict(null); setMobileEditor(true); focusEditor.current = true; setValidationAttempt(n => n+1); };
    window.addEventListener('ndb:new-note', resetNew);
    return () => window.removeEventListener('ndb:new-note', resetNew);
  }, []);
  useEffect(() => { if (!viewReady.current) return; try { sessionStorage.setItem(contextKey, JSON.stringify({ query, scroll: listPosition.current, pageScroll: pagePosition.current, selection: noteId })); } catch { /* Server records remain unaffected. */ } }, [query, noteId]);
  useEffect(() => {
    if (!ready) { queueMicrotask(() => setIndexLoading(sessionLoading)); return; }
    const abort = new AbortController();
    queueMicrotask(() => { if (!abort.signal.aborted) { setIndexLoading(true); setIndexError(''); } });
    const timer = setTimeout(async () => {
      try { const result = await request<NoteIndex>(`/api/notas?q=${encodeURIComponent(query)}`, undefined, abort.signal); if (!abort.signal.aborted) setIndex(result); }
      catch (e) { if (!abort.signal.aborted) { if (e instanceof ApiError && e.status === 401) loseSession(); setIndexError('No pudimos cargar tus notas.'); } }
      finally { if (!abort.signal.aborted) setIndexLoading(false); }
    }, query ? 180 : 0);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [ready, sessionLoading, sessionRef, query, tick, indexRetry, loseSession]);
  useEffect(() => {
    if (!ready || !sessionRef) return;
    if (appliedSelection.current === `${sessionRef}:${selection}` && !detailRetry) return;
    appliedSelection.current = `${sessionRef}:${selection}`;
    const abort = new AbortController();
    queueMicrotask(() => {
    if (abort.signal.aborted) return;
    setFullTitle(false); setDetailError(''); setMessage(''); setTitleError(''); setConflict(null); setDeleteError(''); setMobileEditor(selection !== 'none');
    if (invalidReference) { setDetailLoading(false); setBaseline(null); setDraft(emptyDraft); setDetailError('No se puede abrir esta nota'); return; }
    const savedEnvelope = readEnvelopes().find(e => e.session_ref === sessionRef && (selection === 'new' ? e.endpoint === '/api/notas' : e.baseline?.id === noteId));
    if (selection === 'new') { setBaseline(null); setDraft(savedEnvelope ? { titulo: String(savedEnvelope.body.titulo ?? ''), texto: String(savedEnvelope.body.texto ?? '') } : emptyDraft); setDetailLoading(false); focusEditor.current = true; setValidationAttempt(n => n+1); return; }
    if (selection === 'none') { setBaseline(null); setDraft(emptyDraft); setDetailLoading(false); return; }
    setDetailLoading(true); setBaseline(savedEnvelope?.baseline ?? null); setDraft(savedEnvelope ? { titulo: String(savedEnvelope.body.titulo ?? savedEnvelope.baseline?.titulo ?? ''), texto: String(savedEnvelope.body.texto ?? savedEnvelope.baseline?.texto ?? '') } : emptyDraft);
    void request<{nota:Note}>(`/api/notas/${noteId}`, undefined, abort.signal).then(result => {
      if (abort.signal.aborted) return;
      if (!savedEnvelope) { setBaseline(result.nota); setDraft({ titulo: result.nota.titulo, texto: result.nota.texto }); }
      focusEditor.current = true;
    }).catch(e => { if (!abort.signal.aborted) { if (e instanceof ApiError && e.status === 401) loseSession(); if (!savedEnvelope) setDetailError(e instanceof ApiError && [400,404].includes(e.status) ? 'No se puede abrir esta nota' : 'No pudimos cargar esta nota.'); } }).finally(() => { if (!abort.signal.aborted) setDetailLoading(false); });
    });
    return () => abort.abort();
  }, [selection, sessionRef, ready, detailRetry, invalidReference, noteId, loseSession]);
  // Focus follows a committed mount and clears the real sticky work header.
  const focusTitle = useCallback(() => { const field = titleInput.current; if (!field) return; field.focus({ preventScroll: true }); field.scrollIntoView({ block: 'center', behavior: 'instant' }); }, []);
  useEffect(() => { if (titleError) focusTitle(); }, [titleError, validationAttempt, focusTitle]);
  useEffect(() => { if (!detailLoading && mobileEditor && !detailError && focusEditor.current) { focusEditor.current = false; if (selection === 'new') titleInput.current?.focus(); else editorHeading.current?.focus({ preventScroll: true }); } }, [detailLoading, mobileEditor, detailError, selection, baseline, ready, validationAttempt]);
  useEffect(() => { if (!indexLoading && !mobileEditor && focusList.current) { focusList.current = false; indexHeading.current?.focus({ preventScroll: !afterDelete.current }); afterDelete.current = false; } }, [indexLoading, mobileEditor, index]);
  useLayoutEffect(() => { if (!mobileEditor && listRef.current) listRef.current.scrollTop = listPosition.current; }, [mobileEditor, index]);
  useLayoutEffect(() => {
    const list = listRef.current, tab = tabRef.current, workspace = workspaceRef.current;
    if (!list || !tab || !workspace) return;
    const measure = () => {
      const active = list.querySelector<HTMLElement>('[aria-current="true"]');
      if (!active) { tabAnimation.current?.cancel(); tab.style.visibility = 'hidden'; return; }
      const mobile = window.matchMedia('(max-width:640px)').matches;
      if (mobile && !mobileEditor && tabSelection.current && tabSelection.current !== noteId) return;
      const origin = workspace.getBoundingClientRect(), row = active.getBoundingClientRect();
      const next = mobile && mobileEditor ? 60 : row.top - origin.top + Math.min(row.height / 2, 32) - 12;
      const x = mobile ? mobileEditor ? 0 : row.right - origin.left - 3 : row.right - origin.left - 6;
      const previous = tabPrevious.current, previousSelection = tabSelection.current;
      const painted = getComputedStyle(tab).transform;
      tabAnimation.current?.cancel();
      tab.style.transform = `translate(${x}px, ${next}px)`; tab.style.visibility = 'visible';
      if (previous !== null && previousSelection !== null && previousSelection !== noteId && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        tabAnimation.current = tab.animate([{ transform: mobile && mobileEditor ? `translate(${x}px, 44px)` : painted === 'none' ? 'translateY(' + previous + 'px)' : painted }, { transform: `translate(${x}px, ${next}px)` }], { duration: 160, easing: 'ease-out' });
      }
      tabPrevious.current = next; tabSelection.current = noteId;
    };
    measure();
    const resize = new ResizeObserver(() => { if (tabAnimation.current?.playState !== 'running') measure(); });
    resize.observe(list);
    return () => resize.disconnect();
  }, [index, noteId, mobileEditor]);
  useEffect(() => () => tabAnimation.current?.cancel(), []);
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const measure = () => {
      const height = toolbar.getBoundingClientRect().height;
      toolbar.classList.toggle('toolbar-static', height > Math.min(176, window.innerHeight * .32));
      toolbar.closest('.writing-sheet')?.setAttribute('style', '--working-header-height:' + height + 'px');
    };
    const observer = new ResizeObserver(measure); observer.observe(toolbar); measure(); window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [detailLoading, ready, selection]);
  const refreshEnvelopes = () => setEnvelopes(readEnvelopes());
  useEffect(() => {
    const record = () => {
      if (mobileEditor || !viewReady.current) return;
      pagePosition.current = window.scrollY;
      try { sessionStorage.setItem(contextKey, JSON.stringify({ query, scroll: listPosition.current, pageScroll: pagePosition.current, selection: noteId })); } catch { /* View context is optional. */ }
    };
    window.addEventListener('scroll', record, { passive: true });
    return () => window.removeEventListener('scroll', record);
  }, [mobileEditor, query, noteId]);
  useLayoutEffect(() => { if (!mobileEditor && !indexLoading && window.matchMedia('(max-width:640px)').matches) window.scrollTo({ top: pagePosition.current, behavior: 'instant' }); }, [mobileEditor, indexLoading]);
  const returnToList = () => { listPosition.current = listRef.current?.scrollTop ?? listPosition.current; focusList.current = true; setMobileEditor(false); };
  const runEnvelope = async (envelope: Envelope) => {
    if (busy.current || !ready || envelope.session_ref !== sessionRef) return;
    const startedSelection = selectionRef.current;
    busy.current = true; setPending(true); setMessage(''); setDeleteError('');
    try { keepEnvelope(envelope); refreshEnvelopes(); }
    catch { busy.current = false; setPending(false); setMessage('No podemos conservar este envío para recuperarlo. Permite el almacenamiento de esta pestaña antes de guardar.'); return; }
    try {
      const result = await request<{nota?:Note;id?:string;revision?:number;deleted_at?:string}>(envelope.endpoint, envelope.body);
      if (!result.nota && !result.deleted_at) throw new Error('Respuesta no confirmada');
      clearEnvelope(String(envelope.body.mutation_key)); refreshEnvelopes();
      if (selectionRef.current !== startedSelection) { invalidate(); return; }
      setConflict(null);
      if (result.deleted_at) {
        setDeleteOpen(false); setBaseline(null); setDraft(emptyDraft); setMessage(''); setDirty(false); setMobileEditor(false); focusList.current = true; afterDelete.current = true; appliedSelection.current = `${sessionRef}:none`; setUrl('/notas');
      } else if (result.nota) {
        const confirmed = result.nota;
        if (confirmed.titulo !== baselineRef.current?.titulo) setFullTitle(false);
        setBaseline(confirmed);
        if (envelope.endpoint === '/api/notas') { appliedSelection.current = `${sessionRef}:note:${confirmed.id}`; setUrl(`/notas?nota=${confirmed.id}`); }
      }
      invalidate();
    } catch (e) {
      if (selectionRef.current !== startedSelection) { if (e instanceof ApiError && e.status >= 400 && e.status < 500) { clearEnvelope(String(envelope.body.mutation_key)); refreshEnvelopes(); } return; }
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        clearEnvelope(String(envelope.body.mutation_key)); refreshEnvelopes();
        if (e.status === 401) loseSession();
        if (e.code === 'revision_conflict' && e.current) { setConflict({ previous: envelope.baseline, current: e.current }); setDeleteOpen(false); }
        else if (e.fields?.titulo) { setTitleError(e.fields.titulo); setValidationAttempt(n => n+1); }
        else { const error = e.status === 404 ? 'No se puede abrir esta nota. Puede que se haya eliminado. Tu borrador sigue aquí.' : e.message; setMessage(error); if (envelope.endpoint.endsWith('/eliminar')) setDeleteError(error); }
      } else {
        const text = 'Resultado incierto. No sabemos si se completó el envío. Conservamos los valores enviados y tu borrador. Recupera el envío original para comprobarlo sin repetir el cambio.';
        setMessage(text); if (envelope.endpoint.endsWith('/eliminar')) setDeleteError(text);
      }
    } finally { busy.current = false; setPending(false); }
  };
  const save = (override?: Note, explicitlyNew = false) => {
    if (busy.current || !ready || !sessionRef) return;
    if (!currentDraft.current.titulo.trim()) { setTitleError('Escribe un título para guardar la nota.'); setValidationAttempt(n => n+1); return; }
    setTitleError('');
    if (relevantEnvelopes.length && !explicitlyNew) { setMessage('Hay un envío pendiente de confirmar. Recupera el envío original o elige iniciar otro envío.'); return; }
    const previous = override ?? baselineRef.current;
    const envelope: Envelope = { session_ref: sessionRef, endpoint: previous ? `/api/notas/${previous.id}/editar` : '/api/notas', body: { mutation_key: crypto.randomUUID(), ...(previous ? { expected_revision: previous.revision } : {}), titulo: currentDraft.current.titulo, texto: currentDraft.current.texto }, baseline: baselineRef.current };
    void runEnvelope(envelope);
  };
  const startAnother = () => confirm({ title: '¿Iniciar otro envío?', body: 'El envío anterior podría haberse guardado. Un nuevo envío puede crear otra nota o entrar en conflicto. Conservaremos el envío original para que puedas recuperarlo.', action: 'Iniciar otro envío', run: () => save(undefined, true) });
  const pinNote = () => {
    if (!baseline || !sessionRef || uncertain || pending) return;
    void runEnvelope({ session_ref: sessionRef, endpoint: `/api/notas/${baseline.id}/fijar`, body: { mutation_key: crypto.randomUUID(), expected_revision: baseline.revision, fijada: !baseline.fijada }, baseline });
  };
  const deleteNote = () => {
    if (!baseline || !sessionRef) return;
    const prior = relevantEnvelopes.find(e => e.endpoint.endsWith('/eliminar'));
    void runEnvelope(prior ?? { session_ref: sessionRef, endpoint: `/api/notas/${baseline.id}/eliminar`, body: { mutation_key: crypto.randomUUID(), expected_revision: baseline.revision }, baseline });
  };
  return <main className={`shell notes-main ${mobileEditor ? 'show-editor' : 'show-index'}`} id="contenido">
    <div className="notes-page-heading"><div><h1>Notas</h1><p>Un índice claro. Una hoja para escribir.</p></div><span className="private-label"><ShieldIcon/>Sesión privada</span></div>
    <div className="notes-workspace" ref={workspaceRef}>
      <aside className="note-index paper" aria-labelledby="indice-titulo">
        <div className="index-header"><h2 id="indice-titulo" ref={indexHeading} tabIndex={-1}>Tus notas <span>{index && ready ? index.total : '—'}</span></h2><a className="control primary index-new" href="/notas?nueva=1"><SquarePen/>Nueva nota</a><label htmlFor="buscar-notas" className="search-label">Buscar notas</label><div className="search-field"><Search size={19}/><Input id="buscar-notas" value={query} placeholder="Por título o texto" onChange={e => setQuery(e.target.value)}/>{query && <button className="clear-search" aria-label="Limpiar búsqueda" onClick={() => setQuery('')}><X size={17}/></button>}</div></div>
        <div className="index-list" ref={listRef} aria-busy={indexLoading} onScroll={e => { listPosition.current = e.currentTarget.scrollTop; try { sessionStorage.setItem(contextKey,JSON.stringify({ query,scroll:listPosition.current,selection:noteId })); } catch {} }}>
          {indexLoading && !index ? <div className="index-state" role="status"><LoaderCircle className="spinner"/><p>Cargando tus notas…</p></div> : indexError || !ready ? <div className="index-state" role="alert"><CircleAlert/><h3>{!ready && !sessionLoading ? 'No podemos acceder a esta sesión' : indexError || 'Preparando tu sesión…'}</h3>{ready && <Button className="control secondary" onClick={() => setIndexRetry(n => n+1)}><RefreshCw/>Reintentar</Button>}</div> : index?.total === 0 ? <div className="index-state"><FileText/><h3>Todavía no tienes notas</h3><p>Tu primera idea empieza con una nota.</p><a href="/notas?nueva=1" className="text-link">Crear mi primera nota <ArrowRight/></a></div> : index?.coincidencias === 0 ? <div className="index-state"><Search/><h3>No hay resultados</h3><p>Prueba con otras palabras.</p><Button className="control secondary" onClick={() => setQuery('')}>Limpiar búsqueda</Button></div> : <>{indexLoading && <p role="status" className="search-status">Buscando…</p>}{index?.notas.map(note => <a key={note.id} data-note-id={note.id} href={`/notas?nota=${note.id}`} className={`index-row ${noteId === note.id ? 'selected' : ''}`} aria-current={noteId === note.id ? 'true' : undefined} onClick={e => { if (noteId === note.id) { e.preventDefault(); setMobileEditor(true); focusEditor.current = true; } }}><div className="index-row-title"><h3>{note.titulo}</h3>{note.fijada ? <Pin size={16} aria-label="Fijada"/> : <ChevronRight size={16}/>}</div><p>{excerpt(note.texto) || 'Sin texto'}</p><time dateTime={note.updated_at}>{dateLabel(note.updated_at)}</time></a>)}</>}

        </div>
        <div className="index-foot"><Info size={15}/><span>Las notas fijadas aparecen primero.</span></div>
      </aside>
          <span ref={tabRef} className="selection-tab" data-selection-tab data-selected-note={noteId ?? ''} aria-hidden="true" style={{ visibility: 'hidden' }}/>
      <section className={`writing-sheet paper ${selection !== 'none' ? 'has-selection' : ''}`} aria-label="Hoja de escritura" aria-busy={detailLoading || awaitingSelection}>
        <button className="mobile-back" onClick={returnToList}><ArrowLeft/>Volver a la lista</button>
        {!ready ? <div className="sheet-placeholder"><NotebookPen size={44}/><h2>{sessionLoading ? 'Preparando tu espacio…' : 'No podemos acceder a esta sesión'}</h2><p>{sessionLoading ? 'Estamos comprobando tu sesión privada.' : 'Reintenta para volver a tus notas.'}</p></div> : detailLoading || awaitingSelection ? <div className="sheet-placeholder" role="status"><LoaderCircle className="spinner"/><h2>Cargando esta nota…</h2><p>Conservamos tu selección.</p></div> : detailError ? <div className="sheet-placeholder" role="alert"><CircleAlert size={36}/><h2>{detailError}</h2><p>Vuelve a la lista para elegir una nota. No abriremos otra automáticamente.</p><div className="button-row"><a className="control secondary" href="/notas">Volver a la lista</a>{!invalidReference && <Button className="control secondary" onClick={() => { appliedSelection.current = null; setDetailRetry(n => n+1); }}><RefreshCw/>Reintentar</Button>}</div></div> : selection === 'none' ? <div className="sheet-placeholder"><div className="empty-icon"><NotebookPen size={44} strokeWidth={1.4}/></div><h2>Una hoja para tus ideas</h2><p>Elige una nota del índice o empieza una nueva.</p><a className="control primary" href="/notas?nueva=1"><SquarePen/>Nueva nota</a><span className="sheet-footnote">Escribe. Guarda. Vuelve cuando lo necesites.</span></div> : <form id="note-form" noValidate onSubmit={event => { event.preventDefault(); save(); }}>
          <div ref={toolbarRef} className="editor-toolbar"><div className="editor-identity"><NoteHeading title={baseline ? baseline.titulo : 'Nueva nota'} headingRef={editorHeading} onExpand={() => setFullTitle(value => !value)} expanded={fullTitle}/><p className={`save-status ${uncertain && !pending ? 'uncertain-status' : ''}`} role="status" aria-live="polite">{pending ? <LoaderCircle className="spinner"/> : uncertain ? <CircleAlert/> : dirty || !baseline || conflict || message || titleError ? <span className="status-dot"/> : <Check/>}{stateLabel}</p></div><Button className="control primary save-button" type="submit" disabled={pending || !ready}><Save/>{pending ? 'Guardando…' : 'Guardar nota'}</Button></div>
          {fullTitle && <p className="full-note-title" id="titulo-completo">{baseline?.titulo}</p>}
          {baseline && <div className="editor-secondary"><div className="button-row"><Button className="control text-button" disabled={pending || uncertain} onClick={pinNote}>{baseline.fijada ? <PinOff/> : <Pin/>}{baseline.fijada ? 'Desfijar nota' : 'Fijar nota'}</Button><Button ref={deleteTrigger} className="control delete-button" disabled={pending || uncertain} onClick={() => { setDeleteError(''); setDeleteOpen(true); }}><Trash2/>Eliminar</Button></div></div>}
          {(titleError || (message && !uncertain)) && <div className="editor-feedback" role="alert">{titleError ? <><strong>Revisa el título de la nota</strong><a href="#titulo-nota" onClick={e => { e.preventDefault(); focusTitle(); }}>{titleError}</a></> : <p>{message}</p>}</div>}
          {!pending && relevantEnvelopes.map(envelope => <div className="recovery-block editor-feedback" role="alert" key={String(envelope.body.mutation_key)}><div className="recovery-heading"><CircleAlert/><h3>Resultado incierto</h3></div><p>No sabemos si se completó el envío. Conservamos los valores enviados y tu borrador. Recupera el envío original para comprobarlo sin repetir el cambio.</p><details><summary>Ver valores enviados</summary><strong>{String(envelope.body.titulo ?? envelope.baseline?.titulo ?? '')}</strong><pre>{String(envelope.body.texto ?? envelope.baseline?.texto ?? '')}</pre></details><div className="button-row"><Button className="control secondary" disabled={pending} onClick={() => void runEnvelope(envelope)}><RefreshCw/>Recuperar envío original</Button>{!envelope.endpoint.endsWith('/eliminar') && <Button className="control text-button" disabled={pending} onClick={startAnother}>Iniciar otro envío</Button>}</div></div>)}
          {conflict && <div className="conflict-block" role="alert"><h3>Esta nota cambió</h3><p>Compara las versiones antes de decidir cómo continuar.</p><div className="version-grid"><Version label="Tu borrador" value={draft}/><Version label="Última confirmación" value={conflict.previous}/><Version label="Valores actuales" value={conflict.current}/></div><div className="button-row"><Button className="control secondary" onClick={() => setConflict(null)}>Conservar borrador</Button><Button className="control secondary" onClick={() => { setBaseline(conflict.current); setDraft({titulo:conflict.current.titulo,texto:conflict.current.texto}); setConflict(null); setMessage(''); }}>Cargar valores actuales</Button><Button className="control primary" onClick={() => save(conflict.current)}>Sobrescribir con mi borrador</Button></div></div>}
          <div className="editor-fields"><div className="title-group"><label htmlFor="titulo-nota">Título <span aria-hidden="true">Obligatorio</span></label><Input ref={titleInput} id="titulo-nota" aria-required="true" className="note-title-input" placeholder="Ponle un título a tu idea" value={draft.titulo} aria-invalid={!!titleError} aria-describedby={titleError ? 'titulo-error' : undefined} onChange={e => { setDraft(d => ({...d,titulo:e.target.value})); if (titleError && e.target.value.trim()) setTitleError(''); }}/>{titleError && <p id="titulo-error" className="field-error">{titleError}</p>}</div><div className="text-group"><label htmlFor="texto-nota">Texto (opcional)</label><Textarea id="texto-nota" placeholder="Escribe aquí lo que quieres recordar…" value={draft.texto} onChange={e => setDraft(d => ({...d,texto:e.target.value}))}/></div></div>
          <p className="character-count">{draft.texto.length.toLocaleString('es')} caracteres</p>
          {baseline && <details className="note-details"><summary>Detalles de la nota</summary><dl><dt>Creada</dt><dd><time dateTime={baseline.created_at}>{dateLabel(baseline.created_at)}</time></dd><dt>Última actualización</dt><dd><time dateTime={baseline.updated_at}>{dateLabel(baseline.updated_at)}</time></dd><dt>Revisión</dt><dd>{baseline.revision}</dd><dt>Versión de la aplicación</dt><dd>{baseline.implementation_version}</dd></dl></details>}
        </form>}
      </section>
    </div>
    {envelopes.length > relevantEnvelopes.length && <section className="other-recoveries paper"><h2>Envíos pendientes de confirmar</h2><p>Conservamos estos envíos de esta pestaña para que puedas resolverlos.</p>{envelopes.filter(e => !relevantEnvelopes.includes(e)).map(e => <div key={String(e.body.mutation_key)}><strong>{String(e.body.titulo ?? e.baseline?.titulo ?? 'Nota')}</strong>{e.session_ref === sessionRef ? <a className="text-link" href={e.baseline ? `/notas?nota=${e.baseline.id}` : '/notas?nueva=1'}>Abrir para recuperar <ArrowRight/></a> : <p>Este envío pertenece a otra sesión. No lo enviaremos desde la sesión actual.</p>}<Button className="control text-button" onClick={() => confirm({title:'¿Descartar la recuperación?',body:'Esto elimina la copia del envío pendiente de esta pestaña. No elimina ninguna nota que pudiera haberse guardado.',action:'Descartar recuperación',run:()=>{ clearEnvelope(String(e.body.mutation_key));refreshEnvelopes(); }})}>Descartar recuperación</Button></div>)}</section>}
    <Confirm open={deleteOpen} title="¿Eliminar esta nota?" action={deleteError && uncertain ? 'Recuperar envío original' : 'Eliminar'} danger pending={pending} returnFocus={baseline ? deleteTrigger : indexHeading} onCancel={() => setDeleteOpen(false)} onConfirm={deleteNote}><p className="delete-note-title">{baseline?.titulo}</p><p>Esta acción no se puede deshacer.</p>{dirty && <p>También se descartarán los cambios sin guardar de esta nota.</p>}{deleteError && <p className="dialog-error" role="alert">{deleteError}</p>}</Confirm>
  </main>;
}
function ShieldIcon() { return <svg width="16" height="18" viewBox="0 0 16 18" fill="none" aria-hidden="true"><path d="M8 1 2 3.5v5c0 4 3 6.5 6 8 3-1.5 6-4 6-8v-5L8 1Z" stroke="currentColor" strokeWidth="1.4"/><path d="M8 5v5" stroke="currentColor" strokeWidth="1.4"/></svg>; }
function Version({ label, value }: { label: string; value: Draft | null }) { return <section><h4>{label}</h4>{value ? <><strong>{value.titulo}</strong><pre>{value.texto}</pre></> : <p>Sin confirmación anterior.</p>}</section>; }

function NoteHeading({ title, headingRef, expanded, onExpand }: { title: string; headingRef: RefObject<HTMLHeadingElement | null>; expanded: boolean; onExpand: () => void }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;
    const measure = () => setLong(text.scrollWidth > text.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(text); measure();
    return () => observer.disconnect();
  }, [title, long]);
  return <h2 ref={headingRef} tabIndex={-1}>{long ? <button type="button" className="title-expand" onClick={onExpand} aria-expanded={expanded} aria-controls={expanded ? 'titulo-completo' : undefined}><span className="title-preview" ref={textRef}>{title}</span><span className="title-expand-label">{expanded ? 'Ocultar título completo' : 'Ver título completo'}</span></button> : <span className="title-preview" ref={textRef}>{title}</span>}</h2>;
}
