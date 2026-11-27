import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearch } from 'wouter';
import { useLiveQuery } from 'dexie-react-hooks';
import type { StudyFile } from '@life/shared';
import { STUDY_FILE_LIMITS } from '@life/shared';
import { db } from '../../db/db';
import { saveReadingProgress } from '../../domain/studyFileActions';
import { fetchMediaNow } from '../../sync/media';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { usePageHide } from '../../ui/usePageHide';
import { loadPdfEngine } from './loadPdfEngine';
import { PageCardSheet, type PageCardRequest } from './PageCardSheet';
import type { PdfDoc } from './pdfEngine';
import { ReadingSession, ScrollGuard, pageAtScroll } from './reading';
import { useRecallSheet } from './RecallSheet';
import '../study/study.css';
import '../faculty/faculty.css';
import './pdf.css';

// "/estudo/pdf/:id" (spec 2026-11-26 §1.3, §4.2): the reader. It opens where she stopped (the synced progress record),
// or at `?pagina=N` ("Ver no PDF", which never moves where she stopped unless she reads on from there). Pages are drawn
// only near the screen, so a 300-page book does not freeze; the page is written at most every 5 s and when the reader
// closes. Only visible, non-idle reading counts (reading.ts): after 3 read pages or 5 minutes, leaving asks what she
// remembers ("Lembrar antes de sair"); after a minute it counts as contact with the subject. A PDF this device lacks is
// downloaded now, never in background.

export const READER_TEXT = {
  opening: 'Abrindo o PDF…',
  downloading: 'Baixando o PDF…',
  notHere: 'Este PDF não está neste aparelho. Abra com o PC ligado para baixar.',
  missingOnPc: 'O PC ainda não tem este PDF. Abra o app no aparelho onde ele foi adicionado, com o PC ligado.',
  unreadable: 'Não foi possível abrir este PDF.',
} as const;

/** The delayed page write's timer (tests run it by hand). */
export const pageWriteTimer = {
  set: (fn: () => void, ms: number): ReturnType<typeof setTimeout> => setTimeout(fn, ms),
  clear: (id: ReturnType<typeof setTimeout> | undefined): void => clearTimeout(id),
};
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.25;
/** Width used before the reading area is measured (and where nothing can be measured). */
const FALLBACK_WIDTH = 640;

interface Back { href: string; label: string }

function backOf(params: URLSearchParams, file: Pick<StudyFile, 'journeyId'> | null): Back {
  const voltar = params.get('voltar');
  if (voltar === 'revisao') {
    // The review she came from, with its deck ("Revisar este baralho"), so coming back does not start another session.
    const deck = params.get('baralho');
    return { href: deck ? `/estudo/revisar?baralho=${encodeURIComponent(deck)}` : '/estudo/revisar', label: '← Revisão' };
  }
  if (voltar === 'materiais' || !file?.journeyId) return { href: '/estudo/materiais', label: '← Materiais' };
  return { href: `/estudo/materias/${file.journeyId}`, label: '← Disciplina' };
}

export function PdfReaderScreen({ id }: { id: string }) {
  const params = new URLSearchParams(useSearch());
  const data = useLiveQuery(async () => {
    const [f, progress] = await Promise.all([db.studyFiles.get(id), db.studyFileProgress.get(id)]);
    return { file: f && !f.deleted ? f : null, lastPage: progress && !progress.deleted ? progress.lastPage : undefined };
  }, [id]);
  if (data === undefined) return <section className="screen study" aria-busy="true" aria-label="PDF" />;
  const { file } = data;
  const back = backOf(params, file);
  if (file === null) {
    return (
      <section className="screen study stack" aria-labelledby="pdf-missing">
        <Link className="deck__back" href={back.href}>{back.label}</Link>
        <h1 id="pdf-missing" tabIndex={-1} data-focus-target={FOCUS_PAGE}>PDF não encontrado.</h1>
      </section>
    );
  }
  const asked = Number.parseInt(params.get('pagina') ?? '', 10);
  const start = Number.isFinite(asked) ? asked : data.lastPage ?? 1;
  // Keyed by the asked page: another "Ver no PDF" link opens there; the page writes while reading never move it.
  return (
    <Reader key={params.get('pagina') ?? ''} file={file} startPage={Math.max(1, Math.min(file.pages, start))}
      asked={Number.isFinite(asked)} back={back} />
  );
}

type Load =
  | { state: 'loading' | 'downloading' | 'error' }
  | { state: 'absent'; message: string }
  | { state: 'ready'; doc: PdfDoc };

/** The recall card goes to the subject's deck: not when the PDF or its subject was deleted while the reader was open. */
async function canRecall(fileId: string, journeyId: string): Promise<boolean> {
  const [f, j] = await Promise.all([db.studyFiles.get(fileId), db.journeys.get(journeyId)]);
  return !!f && !f.deleted && f.journeyId === journeyId && !!j && !j.deleted && j.subject === true;
}

const isVisible = (): boolean => typeof document === 'undefined' || document.visibilityState !== 'hidden';

function Reader({ file, startPage: initial, asked, back }: { file: StudyFile; startPage: number; asked: boolean; back: Back }) {
  // Frozen at opening: lastPage changes while she reads (the reader writes it), which must not move the view.
  const [startPage] = useState(initial);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(startPage);
  const [card, setCard] = useState<PageCardRequest>();
  const fileRef = useRef(file);
  fileRef.current = file;
  // The reading session starts the moment the PDF is ready (set together with the 'ready' state, so no reading time is
  // lost between the first paint and an effect); `writes` is where she stopped as written, and the page waiting for the
  // 5 s between writes.
  const session = useRef<ReadingSession | undefined>(undefined);

  // The local copy, else a download now (spec §2.4); then PDF.js opens it (the fresh bytes go to PDF.js uncopied).
  useEffect(() => {
    let alive = true;
    let opened: PdfDoc | undefined;
    void (async () => {
      setLoad({ state: 'loading' });
      let row = await db.mediaData.get(file.fileHash);
      if (!row) {
        setLoad({ state: 'downloading' });
        const r = await fetchMediaNow(file.fileHash, file.bytes);
        if (!alive) return;
        if (r === 'stored') row = await db.mediaData.get(file.fileHash);
        if (!row) {
          setLoad({ state: 'absent', message: r === 'missing' ? READER_TEXT.missingOnPc : READER_TEXT.notHere });
          return;
        }
      }
      const engine = await loadPdfEngine();
      opened = await engine.openPdf(new Uint8Array(row.bytes));
      if (!alive) { void opened.destroy(); return; }
      session.current ??= new ReadingSession(startPage, Date.now(), { asked, visible: isVisible() });
      setLoad({ state: 'ready', doc: opened });
    })().catch((e: unknown) => {
      console.warn('pdf: could not open', e);
      if (alive) setLoad({ state: 'error' });
    });
    return () => {
      alive = false;
      if (opened) void opened.destroy();
    };
    // startPage is frozen at opening and asked comes from the URL of this opening: neither reopens the PDF.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.fileHash, file.bytes, attempt]);

  const writes = useRef({ saved: startPage, lastWrite: 0, pending: undefined as number | undefined });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Writes the page (when given) and, after a minute of real reading, the moment (contact with the subject). */
  const write = useCallback((n: number | undefined) => {
    const now = Date.now();
    const readAt = session.current?.contact(now) ? now : undefined;
    const w = writes.current;
    if (n !== undefined) {
      w.saved = n;
      w.pending = undefined;
      w.lastWrite = now;
    }
    if (n === undefined && readAt === undefined) return;
    saveReadingProgress(fileRef.current.id, { ...(n !== undefined ? { page: n } : {}), ...(readAt !== undefined ? { readAt } : {}) })
      .catch((e: unknown) => console.warn('pdf: page not saved', e));
  }, []);

  const onPage = useCallback((n: number) => {
    const s = session.current;
    if (!s || n === s.current) return;
    const now = Date.now();
    s.page(n, now);
    setPage(n);
    // Opened at an asked page ("Ver no PDF"): where she stopped stays until she reads on from there.
    if (!s.writesPage) return;
    const w = writes.current;
    if (n === w.saved && w.pending === undefined) return;
    const wait = w.lastWrite + STUDY_FILE_LIMITS.pageWriteMs - now;
    if (wait <= 0) { write(n); return; }
    w.pending = n;
    timer.current ??= pageWriteTimer.set(() => {
      timer.current = undefined;
      if (writes.current.pending !== undefined) write(writes.current.pending);
    }, wait);
  }, [write]);

  const onActivity = useCallback(() => { session.current?.activity(Date.now()); }, []);

  // The phone may close the app in background without any unmount: the waiting page is written then, and the time in
  // background never counts as reading.
  usePageHide(() => {
    pageWriteTimer.clear(timer.current);
    timer.current = undefined;
    const s = session.current;
    if (!s) return;
    s.hide(Date.now());
    write(s.writesPage ? writes.current.pending : undefined);
  });
  useEffect(() => {
    const onShow = () => { if (isVisible()) session.current?.show(Date.now()); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pageshow', onShow);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pageshow', onShow);
    };
  }, []);

  // Leaving: the waiting page is written, and the moment after a minute of reading; enough reading asks what she
  // remembers (only for a subject's PDF still there: the card goes to the subject's deck).
  useEffect(() => () => {
    pageWriteTimer.clear(timer.current);
    timer.current = undefined;
    const s = session.current;
    if (!s) return;
    const now = Date.now();
    write(s.writesPage ? writes.current.pending : undefined);
    const range = s.recall(now);
    const f = fileRef.current;
    if (!range || !f.journeyId) return;
    const journeyId = f.journeyId;
    void canRecall(f.id, journeyId).then((ok) => {
      if (ok) useRecallSheet.getState().open({ fileId: f.id, title: f.title, ...range });
    }, () => { /* the database is gone: nothing to ask */ });
  }, [write]);

  const pages = load.state === 'ready' ? load.doc.pages : file.pages;
  return (
    <section className="screen study pdfreader stack" aria-labelledby="pdf-title"
      onPointerDown={onActivity} onKeyDown={onActivity} onWheel={onActivity} onTouchStart={onActivity}>
      <Link className="deck__back" href={back.href}>{back.label}</Link>
      <h1 id="pdf-title" className="pdfreader__title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>{file.title}</h1>
      {load.state === 'ready' ? (
        <PdfView doc={load.doc} page={page} pages={pages} startPage={startPage} onPage={onPage} onActivity={onActivity}
          onCard={(request) => setCard(request)} />
      ) : (
        <div className="pdfreader__state stack">
          {load.state === 'absent' || load.state === 'error' ? (
            <>
              <p role="alert">{load.state === 'absent' ? load.message : READER_TEXT.unreadable}</p>
              <div><Button onClick={() => setAttempt((a) => a + 1)}>Tentar de novo</Button></div>
            </>
          ) : <p role="status">{load.state === 'downloading' ? READER_TEXT.downloading : READER_TEXT.opening}</p>}
        </div>
      )}
      <PageCardSheet file={file} request={card} onClose={() => setCard(undefined)} />
    </section>
  );
}

/** The selected text inside a page of the reader, with the page it starts on. */
function readSelection(root: HTMLElement | null): PageCardRequest | undefined {
  const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
  if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return undefined;
  const text = sel.toString().replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text === '') return undefined;
  const node = sel.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  const pageEl = el?.closest<HTMLElement>('[data-page]');
  if (!pageEl || !root.contains(pageEl)) return undefined;
  return { page: Number(pageEl.dataset.page), back: text };
}

interface ViewProps {
  doc: PdfDoc;
  page: number;
  pages: number;
  startPage: number;
  onPage(n: number): void;
  /** Her scroll in the reading area (reading time). */
  onActivity(): void;
  onCard(request: PageCardRequest): void;
}

function PdfView({ doc, page, pages, startPage, onPage, onActivity, onCard }: ViewProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const gotoId = useId();
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [baseAspect, setBaseAspect] = useState<number>();
  const [aspects, setAspects] = useState<Record<number, number>>({});
  const [visible, setVisible] = useState<Set<number>>(() => new Set());
  const [goto, setGoto] = useState('');
  const pageRef = useRef(page);
  pageRef.current = page;
  const selection = useRef<PageCardRequest | undefined>(undefined);
  const hasIO = typeof IntersectionObserver !== 'undefined';

  useEffect(() => {
    let alive = true;
    doc.pageSize(1).then((s) => { if (alive) setBaseAspect(s.height / s.width); }, () => { if (alive) setBaseAspect(Math.SQRT2); });
    return () => { alive = false; };
  }, [doc]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The reading area fills the screen below its own top (the header and the bar wrap differently on each phone): its
  // measured top goes to the CSS, which also takes out the bottom bar (pdf.css). Measured again when the bar or the
  // window changes size.
  const barRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      if (top > 0) el.style.setProperty('--reader-top', `${Math.round(top)}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    if (ro && barRef.current) ro.observe(barRef.current);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, []);

  const cssWidth = Math.max(120, Math.round(((width > 0 ? width - 16 : FALLBACK_WIDTH)) * zoom));
  const laidOut = baseAspect !== undefined;

  // The view moved by the reader itself (opening, "Ir", zoom): its scroll events keep the asked page.
  const guard = useRef(new ScrollGuard());
  const scrollToPage = useCallback((n: number) => {
    const root = viewportRef.current;
    const target = root?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    if (!root || !target) return;
    root.scrollTop = target.offsetTop - 8;
    guard.current.placed(root.scrollTop);
  }, []);

  // First layout: open at the start page. A zoom keeps the current page in view.
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (!laidOut) return;
    scrollToPage(placed.current ? pageRef.current : startPage);
    placed.current = true;
  }, [laidOut, cssWidth, scrollToPage, startPage]);

  // Pages near the screen are drawn (one and a half screens above and below); the others release their canvas.
  useEffect(() => {
    const root = viewportRef.current;
    if (!laidOut || !hasIO || !root) return undefined;
    const io = new IntersectionObserver((entries) => {
      setVisible((cur) => {
        const next = new Set(cur);
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page);
          if (e.isIntersecting) next.add(n); else next.delete(n);
        }
        return next;
      });
    }, { root, rootMargin: '150% 0px' });
    root.querySelectorAll('[data-page]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [laidOut, hasIO, pages]);

  // The current page after her scroll (pageAtScroll: the last slides of a deck included); the reader's own moves are
  // left out (ScrollGuard).
  const frame = useRef(0);
  const onScroll = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const root = viewportRef.current;
      if (!root || guard.current.ignores(root.scrollTop)) return;
      onActivity();
      const tops = Array.from(root.querySelectorAll<HTMLElement>('[data-page]'), (el) => el.offsetTop);
      const n = pageAtScroll(tops, root.scrollTop, root.clientHeight, root.scrollHeight);
      if (n !== pageRef.current) onPage(n);
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const goTo = (n: number) => {
    const target = Math.max(1, Math.min(pages, Math.round(n)));
    onPage(target);
    scrollToPage(target);
  };
  const submitGoto = (e: FormEvent) => {
    e.preventDefault();
    const n = Number.parseInt(goto, 10);
    if (Number.isFinite(n)) goTo(n);
    setGoto('');
  };

  const onRendered = useCallback((n: number, size: { width: number; height: number }) => {
    if (size.width <= 0) return;
    const a = size.height / size.width;
    setAspects((cur) => (Math.abs((cur[n] ?? 0) - a) < 0.001 ? cur : { ...cur, [n]: a }));
  }, []);

  const shown = hasIO ? visible : new Set([page - 1, page, page + 1]);
  const zoomBy = (f: number) => setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * f * 100) / 100)));

  return (
    <>
      <div ref={barRef} className="pdfreader__bar">
        <p className="pdfreader__where" aria-live="polite">{`p. ${page} de ${pages}`}</p>
        <form className="pdfreader__goto" noValidate onSubmit={submitGoto}>
          <label className="visually-hidden" htmlFor={gotoId}>Ir para a página</label>
          <input id={gotoId} type="number" inputMode="numeric" min={1} max={pages} value={goto} placeholder="Página"
            onChange={(e) => setGoto(e.target.value)} />
          <Button type="submit" size="sm">Ir</Button>
        </form>
        <div className="pdfreader__zoom">
          <Button size="sm" variant="ghost" aria-label="Diminuir o zoom" disabled={zoom <= ZOOM_MIN} onClick={() => zoomBy(1 / ZOOM_STEP)}>−</Button>
          <Button size="sm" variant="ghost" aria-pressed={zoom === 1} onClick={() => setZoom(1)}>Ajustar à largura</Button>
          <Button size="sm" variant="ghost" aria-label="Aumentar o zoom" disabled={zoom >= ZOOM_MAX} onClick={() => zoomBy(ZOOM_STEP)}>+</Button>
        </div>
        <Button size="sm" variant="primary"
          // The selection is read before the tap can clear it (iPhone), and the mouse down does not clear it either.
          onPointerDown={() => { selection.current = readSelection(viewportRef.current); }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const s = selection.current ?? readSelection(viewportRef.current);
            selection.current = undefined;
            onCard(s ?? { page: pageRef.current, back: '' });
          }}>Criar card desta página</Button>
      </div>
      <div ref={viewportRef} className="pdfreader__viewport" tabIndex={0} role="region" aria-label="Páginas do PDF" onScroll={onScroll}>
        {laidOut && (
          <div className="pdfreader__pages">
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
              <PdfPage key={n} doc={doc} n={n} cssWidth={cssWidth} height={Math.round(cssWidth * (aspects[n] ?? baseAspect))}
                show={shown.has(n)} onRendered={onRendered} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

interface PageProps {
  doc: PdfDoc;
  n: number;
  cssWidth: number;
  height: number;
  show: boolean;
  onRendered(n: number, size: { width: number; height: number }): void;
}

const PdfPage = memo(function PdfPage({ doc, n, cssWidth, height, show, onRendered }: PageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const layer = layerRef.current;
    if (!canvas || !layer) return undefined;
    if (!show) {
      // Far from the screen: the canvas memory goes back (a 300-page book keeps only a few drawn).
      canvas.width = 0;
      canvas.height = 0;
      layer.replaceChildren();
      return undefined;
    }
    const job = doc.renderPage(n, { canvas, textLayer: layer, cssWidth });
    job.promise.then((size) => onRendered(n, size), () => { /* cancelled or not drawable: the blank page stays */ });
    return () => job.cancel();
  }, [doc, n, cssWidth, show, onRendered]);
  return (
    <div className="pdfpage" data-page={n} style={{ width: cssWidth, height }} role="group" aria-label={`Página ${n}`}>
      <canvas ref={canvasRef} className="pdfpage__canvas" aria-hidden="true" />
      <div ref={layerRef} className="textLayer" />
    </div>
  );
});
