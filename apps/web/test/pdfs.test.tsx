import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { StudyFile } from '@life/shared';
import { PDF_MAX_BYTES, daysWithoutContact, parsePdfText, sha256Hex } from '@life/shared';
import { db } from '../src/db/db';
import { collectExport } from '../src/db/exportData';
import { readFacultyData } from '../src/db/facultyData';
import { storeMedia } from '../src/db/media';
import { setMeta } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { createSubject } from '../src/domain/facultyActions';
import { saveDeck } from '../src/domain/studyActions';
import {
  STUDY_FILE_MESSAGES, StudyFileError, UNUSED_PDF_GRACE_MS, UNUSED_PDF_RETRY_MS, createPageCard, createStudyFile, deleteStudyFile,
  freeUnusedPdfCopies, removeLocalCopy, resetUnusedPdfState, restoreStudyFile, setStudyFileSubject,
} from '../src/domain/studyFileActions';
import { SubjectDetailScreen } from '../src/features/faculty/SubjectDetailScreen';
import { addPdf } from '../src/features/pdf/addPdf';
import { MaterialsScreen } from '../src/features/pdf/MaterialsScreen';
import { PdfReaderScreen, READER_TEXT, pageWriteTimer } from '../src/features/pdf/PdfReaderScreen';
import { RecallSheetHost, useRecallSheet } from '../src/features/pdf/RecallSheet';
import { DataSection } from '../src/features/settings/DataSection';
import { ReviewSession } from '../src/features/study/ReviewSession';
import { useSession } from '../src/features/study/sessionStore';
import { StudyScreen } from '../src/features/study/StudyScreen';
import { syncNow } from '../src/sync/client';
import { prefetchMedia, resetMediaSyncState, uploadBigMedia, uploadPendingMedia } from '../src/sync/media';
import { ToastHost, useToast } from '../src/ui/Toast';

// PDFs da aula no app (spec 2026-11-26 fase 2, §1, §2, §4 and §6). PDF.js does not run in jsdom: the engine module is
// replaced by a fake that "extracts" given texts and "draws" each page as one span of text.

const fake = vi.hoisted(() => {
  class PdfPasswordError extends Error {}
  class PdfReadError extends Error {}
  return { PdfPasswordError, PdfReadError, extractPdf: vi.fn(), openPdf: vi.fn() };
});
vi.mock('../src/features/pdf/pdfEngine', () => fake);

const encoder = new TextEncoder();
/** A tiny file that passes the PDF signature check (the fake engine does the rest). */
const pdfBytes = (seed: string, size = 64) => {
  const b = new Uint8Array(size).fill(0x20);
  b.set(encoder.encode(`%PDF-1.4\n%${seed}\n`));
  return b;
};
const pdfFile = (name: string, bytes: Uint8Array) => new File([bytes.slice().buffer], name, { type: 'application/pdf' });

function fakeDoc(pages: number) {
  return {
    pages,
    pageSize: vi.fn(async () => ({ width: 600, height: 800 })),
    renderPage: vi.fn((n: number, t: { textLayer: HTMLElement; cssWidth: number }) => {
      const span = document.createElement('span');
      span.textContent = `Texto da página ${n}`;
      t.textLayer.replaceChildren(span);
      return { promise: Promise.resolve({ width: t.cssWidth, height: Math.round(t.cssWidth * 4 / 3) }), cancel: vi.fn() };
    }),
    destroy: vi.fn(async () => {}),
  };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 26, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
  resetMediaSyncState();
  resetUnusedPdfState();
  useToast.getState().dismiss();
  useRecallSheet.getState().close();
  useSession.getState().reset();
  fake.extractPdf.mockReset();
  fake.openPdf.mockReset();
  fake.extractPdf.mockImplementation(async () => ({ pages: 3, texts: ['Aula 1: modelo relacional', 'Chaves', 'Normalização'] }));
  fake.openPdf.mockImplementation(async () => fakeDoc(12));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const bd = () => createSubject({ title: 'Banco de Dados', weekdays: [3], start: '19:30', end: '22:30' });
const liveFiles = async () => (await db.studyFiles.toArray()).filter((f) => !f.deleted);
/** Where she stopped in a PDF: its own synced record (M6). */
const progressOf = (id: string) => db.studyFileProgress.get(id);
const setProgress = (id: string, p: { lastPage?: number; lastReadAt?: number }) =>
  db.studyFileProgress.put({ id, createdAt: 1, updatedAt: 1, deleted: false, ...p });
const at = (h: number, m: number, s = 0) => new Date(2026, 10, 26, h, m, s).getTime();

/**
 * A PC answering /api/media: PUT (upload) with `put`, HEAD (does it hold the file?) with `head(hash)`; 'offline' throws
 * like a phone without network. Every request is recorded as "METHOD hash".
 */
function stubPc(opts: { put?: number; head?: (hash: string) => number | 'offline' }) {
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    const hash = url.split('/').pop()!;
    calls.push(`${method} ${hash}`);
    const status = method === 'PUT' ? opts.put ?? 204 : method === 'HEAD' ? opts.head?.(hash) ?? 404 : 404;
    if (status === 'offline') throw new TypeError('Load failed');
    return { ok: status >= 200 && status < 300, status };
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}

function renderAt(path: string, ui: React.ReactNode) {
  const loc = memoryLocation({ path, record: true });
  const view = render(<Router hook={loc.hook} searchHook={loc.searchHook}>{ui}<RecallSheetHost /><ToastHost /></Router>);
  return { ...view, loc, get path() { return loc.history![loc.history!.length - 1]!; } };
}

/** A subject PDF kept on this device (as "Adicionar PDF" leaves it). */
async function subjectPdf(pages = 12): Promise<{ journeyId: string; file: StudyFile }> {
  const j = await bd();
  fake.extractPdf.mockImplementationOnce(async () => ({ pages, texts: Array.from({ length: pages }, (_, i) => `página ${i + 1}`) }));
  const file = await addPdf(pdfFile('Slides_BD.pdf', pdfBytes('slides')), j.id);
  return { journeyId: j.id, file };
}

describe('Adicionar PDF (§2.3, §4.1)', () => {
  it('counts the pages, extracts the text into its own media file, keeps both by hash and queues them for the PC', async () => {
    const j = await bd();
    const bytes = pdfBytes('aula3');
    const file = await addPdf(pdfFile('Aula_03 - Normalização.pdf', bytes), j.id);
    expect(fake.extractPdf).toHaveBeenCalledTimes(1);
    expect(file).toMatchObject({ title: 'Aula 03 - Normalização', journeyId: j.id, pages: 3, hasText: true, bytes: bytes.length, deleted: false });
    expect(file.fileHash).toBe(sha256Hex(bytes));
    expect((await db.mediaInfo.get(file.fileHash))!.type).toBe('application/pdf');
    const text = await db.mediaData.get(file.textHash!);
    expect(text!.type).toBe('application/vnd.liferpg.pdftext+json');
    expect(parsePdfText(new Uint8Array(text!.bytes))!.pages).toEqual(['Aula 1: modelo relacional', 'Chaves', 'Normalização']);
    expect(file.textChars).toBe('Aula 1: modelo relacionalChavesNormalização'.length);
    expect((await db.mediaQueue.toArray()).map((q) => q.hash).sort()).toEqual([file.fileHash, file.textHash].sort());
    // The record goes out with the next sync like any other.
    expect(await db.outbox.get(`studyFiles:${file.id}`)).toBeTruthy();
  });

  it('a scanned PDF (no text) is kept with hasText false and no text file', async () => {
    fake.extractPdf.mockImplementationOnce(async () => ({ pages: 2, texts: ['', '  '] }));
    const file = await addPdf(pdfFile('scan.pdf', pdfBytes('scan')));
    expect(file).toMatchObject({ hasText: false, pages: 2 });
    expect(file.textHash).toBeUndefined();
    expect(file.journeyId).toBeUndefined();
    expect(await db.mediaQueue.count()).toBe(1);
  });

  it('refuses a file over 50 MB, one that is not a PDF and one with a password, with the reason', async () => {
    const big = { size: PDF_MAX_BYTES + 1, name: 'grande.pdf', arrayBuffer: vi.fn() } as unknown as File;
    await expect(addPdf(big)).rejects.toThrow('Este PDF passa de 50 MB.');
    expect(big.arrayBuffer).not.toHaveBeenCalled();
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2])], 'foto.pdf');
    await expect(addPdf(png)).rejects.toThrow('Este arquivo não é um PDF.');
    fake.extractPdf.mockImplementationOnce(async () => { throw new fake.PdfPasswordError('password'); });
    await expect(addPdf(pdfFile('senha.pdf', pdfBytes('senha')))).rejects.toThrow('Este PDF está protegido por senha. Tire a senha e adicione de novo.');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.extractPdf.mockImplementationOnce(async () => { throw new fake.PdfReadError('broken'); });
    await expect(addPdf(pdfFile('quebrado.pdf', pdfBytes('quebrado')))).rejects.toThrow(STUDY_FILE_MESSAGES.unreadable);
    expect(fake.extractPdf).toHaveBeenCalledTimes(2);
    expect(await db.studyFiles.count()).toBe(0);
    expect(await db.mediaInfo.count()).toBe(0);
  });

  it('the same PDF twice in the same place is refused', async () => {
    const j = await bd();
    await addPdf(pdfFile('a.pdf', pdfBytes('dup')), j.id);
    await expect(addPdf(pdfFile('a.pdf', pdfBytes('dup')), j.id)).rejects.toThrow('Este PDF já está aqui.');
    await addPdf(pdfFile('a.pdf', pdfBytes('dup'))); // in "Sem disciplina" it is another place
    expect(await liveFiles()).toHaveLength(2);
  });

  it('a refused duplicate stores and queues nothing again; the same PDF in another place is not uploaded twice (M3)', async () => {
    const j = await bd();
    const first = await addPdf(pdfFile('a.pdf', pdfBytes('dup')), j.id);
    await db.mediaQueue.clear(); // the PC has both files
    await expect(addPdf(pdfFile('a.pdf', pdfBytes('dup')), j.id)).rejects.toThrow('Este PDF já está aqui.');
    expect(await db.mediaQueue.count()).toBe(0);
    const other = await addPdf(pdfFile('a.pdf', pdfBytes('dup'))); // "Sem disciplina"
    expect(other.fileHash).toBe(first.fileHash);
    expect(other.textHash).toBe(first.textHash);
    expect(await db.mediaQueue.count()).toBe(0);
  });

  it('when the record cannot be written, the PDF and text just stored go away: nothing left behind or queued (M3)', async () => {
    const j = await bd();
    vi.spyOn(db.outbox, 'put').mockRejectedValueOnce(new Error('QuotaExceededError')); // the record's write fails
    await expect(addPdf(pdfFile('b.pdf', pdfBytes('falha')), j.id)).rejects.toThrow();
    expect(await db.mediaInfo.count()).toBe(0);
    expect(await db.mediaData.count()).toBe(0);
    expect(await db.mediaQueue.count()).toBe(0);
    expect(await db.studyFiles.count()).toBe(0);
  });

  it('on screen: "Lendo o PDF…" while reading, the reason on a bad file, and the new row', async () => {
    const user = userEvent.setup();
    const j = await bd();
    let finish!: () => void;
    fake.extractPdf.mockImplementationOnce((_b: Uint8Array, onPage?: (d: number, t: number) => void) => new Promise((resolve) => {
      onPage?.(1, 2);
      finish = () => resolve({ pages: 2, texts: ['a', 'b'] });
    }));
    renderAt(`/estudo/materias/${j.id}`, <SubjectDetailScreen id={j.id} />);
    expect(await screen.findByRole('heading', { name: 'PDFs' })).toBeInTheDocument();
    expect(await screen.findByText(/Nenhum PDF ainda/)).toBeInTheDocument();
    await user.upload(screen.getByLabelText('Adicionar PDF'), pdfFile('Plano de ensino.pdf', pdfBytes('plano')));
    expect(await screen.findByText('Lendo o PDF… 1 de 2')).toBeInTheDocument();
    await act(async () => { finish(); });
    expect(await screen.findByRole('link', { name: 'Abrir Plano de ensino' })).toBeInTheDocument();
    expect(screen.getByText('2 páginas')).toBeInTheDocument();
    expect(screen.getByText('Neste aparelho')).toBeInTheDocument();
    await user.upload(screen.getByLabelText('Adicionar PDF'), new File([encoder.encode('não sou um pdf, sou texto puro')], 'texto.pdf'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Este arquivo não é um PDF.');
  });
});

describe('the reader (§1.3, §4.2)', () => {
  it('opens at the page where she stopped, shows "p. N de M" and goes to a page', async () => {
    const user = userEvent.setup();
    const { file } = await subjectPdf();
    await setProgress(file.id, { lastPage: 5 });
    renderAt(`/estudo/pdf/${file.id}`, <PdfReaderScreen id={file.id} />);
    expect(await screen.findByText('p. 5 de 12')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Disciplina' })).toHaveAttribute('href', `/estudo/materias/${file.journeyId}`);
    // jsdom has no IntersectionObserver: this is the fallback (the current page and its neighbours). The real path's
    // page computation is pageAtScroll, tested in pdfReading.test.ts.
    await waitFor(() => expect(screen.getByText('Texto da página 5')).toBeInTheDocument());
    const doc = await fake.openPdf.mock.results[0]!.value as ReturnType<typeof fakeDoc>;
    expect(new Set(doc.renderPage.mock.calls.map((c) => c[0]))).toEqual(new Set([4, 5, 6]));
    await user.type(screen.getByLabelText('Ir para a página'), '40');
    await user.click(screen.getByRole('button', { name: 'Ir' }));
    expect(await screen.findByText('p. 12 de 12')).toBeInTheDocument();
    for (const name of ['Ajustar à largura', 'Diminuir o zoom', 'Aumentar o zoom', 'Criar card desta página']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('?pagina=N opens at that page ("Ver no PDF"), with the way back to the review', async () => {
    const { file } = await subjectPdf();
    renderAt(`/estudo/pdf/${file.id}?pagina=9&voltar=revisao`, <PdfReaderScreen id={file.id} />);
    expect(await screen.findByText('p. 9 de 12')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Revisão' })).toHaveAttribute('href', '/estudo/revisar');
  });

  it('the way back to a deck\'s review keeps its deck (M1)', async () => {
    const { file } = await subjectPdf();
    renderAt(`/estudo/pdf/${file.id}?pagina=9&voltar=revisao&baralho=d%201`, <PdfReaderScreen id={file.id} />);
    expect(await screen.findByText('p. 9 de 12')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Revisão' })).toHaveAttribute('href', '/estudo/revisar?baralho=d%201');
  });

  it('writes the page at most every 5 seconds, and the waiting one when leaving, to its own record (never the PDF\'s)', async () => {
    const user = userEvent.setup();
    const timers: Array<{ run: () => void; ms: number }> = [];
    vi.spyOn(pageWriteTimer, 'set').mockImplementation((run, ms) => { timers.push({ run, ms }); return 0 as unknown as ReturnType<typeof setTimeout>; });
    const { file } = await subjectPdf();
    const view = renderAt(`/estudo/pdf/${file.id}`, <PdfReaderScreen id={file.id} />);
    await screen.findByText('p. 1 de 12');
    const go = async (n: number) => {
      await user.type(screen.getByLabelText('Ir para a página'), String(n));
      await user.click(screen.getByRole('button', { name: 'Ir' }));
      await screen.findByText(`p. ${n} de 12`);
    };
    const stored = async () => (await progressOf(file.id))!;
    await go(2);
    await waitFor(async () => expect((await progressOf(file.id))?.lastPage).toBe(2));
    const firstWrite = (await stored()).updatedAt;
    vi.setSystemTime(new Date(2026, 10, 26, 10, 0, 2));
    await go(3);
    await go(4);
    expect((await stored()).lastPage).toBe(2); // within 5 s: nothing written, one write waits for the 5 s
    expect((await stored()).updatedAt).toBe(firstWrite);
    expect(timers.map((t) => t.ms)).toEqual([3000]);
    vi.setSystemTime(new Date(2026, 10, 26, 10, 0, 5));
    act(() => timers[0]!.run()); // the wait is over: the latest page is written
    await waitFor(async () => expect((await stored()).lastPage).toBe(4));
    vi.setSystemTime(new Date(2026, 10, 26, 10, 0, 11));
    await go(5); // 6 s after the last write: written now, no timer
    await waitFor(async () => expect((await stored()).lastPage).toBe(5));
    expect(timers).toHaveLength(1);
    vi.setSystemTime(new Date(2026, 10, 26, 10, 0, 12));
    await go(7);
    expect((await stored()).lastPage).toBe(5);
    view.unmount(); // leaving writes the waiting page
    await waitFor(async () => expect((await stored()).lastPage).toBe(7));
    // 12 seconds of flipping pages is no contact with the subject.
    expect((await stored()).lastReadAt).toBeUndefined();
    // Reading never rewrote the PDF's record: a move or "Apagar" on another device is not undone (M6).
    expect(await db.studyFiles.get(file.id)).toEqual(file);
    expect((await db.outbox.toArray()).map((o) => o.key)).toContain(`studyFileProgress:${file.id}`);
  });

  it('a move made on another device survives a reader left open here (reading writes only the progress record)', async () => {
    const user = userEvent.setup();
    const { file } = await subjectPdf();
    const view = renderAt(`/estudo/pdf/${file.id}`, <PdfReaderScreen id={file.id} />);
    await screen.findByText('p. 1 de 12');
    await setStudyFileSubject(file.id, undefined); // stands for the PC's newer version arriving
    const moved = (await db.studyFiles.get(file.id))!;
    await user.type(screen.getByLabelText('Ir para a página'), '6');
    await user.click(screen.getByRole('button', { name: 'Ir' }));
    await waitFor(async () => expect((await progressOf(file.id))?.lastPage).toBe(6));
    view.unmount();
    expect(await db.studyFiles.get(file.id)).toEqual(moved);
  });

  it('opened from "Ver no PDF" (?pagina=12), leaving keeps where she stopped (p. 80) and records the reading (I5)', async () => {
    const { file } = await subjectPdf(120);
    fake.openPdf.mockImplementation(async () => fakeDoc(120));
    await setProgress(file.id, { lastPage: 80 });
    const view = renderAt(`/estudo/pdf/${file.id}?pagina=12&voltar=revisao`, <PdfReaderScreen id={file.id} />);
    expect(await screen.findByText('p. 12 de 120')).toBeInTheDocument();
    vi.setSystemTime(new Date(2026, 10, 26, 10, 1, 10)); // 70 s on that page
    view.unmount();
    await waitFor(async () => expect((await progressOf(file.id))!.lastReadAt).toBe(at(10, 1, 10)));
    expect((await progressOf(file.id))!.lastPage).toBe(80);
  });

  it('opened at ?pagina=12, a page or so away keeps p. 80; reading on 2 pages away writes the new page', async () => {
    const user = userEvent.setup();
    const { file } = await subjectPdf(120);
    fake.openPdf.mockImplementation(async () => fakeDoc(120));
    await setProgress(file.id, { lastPage: 80 });
    const view = renderAt(`/estudo/pdf/${file.id}?pagina=12`, <PdfReaderScreen id={file.id} />);
    await screen.findByText('p. 12 de 120');
    const go = async (n: number) => {
      await user.type(screen.getByLabelText('Ir para a página'), String(n));
      await user.click(screen.getByRole('button', { name: 'Ir' }));
      await screen.findByText(`p. ${n} de 120`);
    };
    await go(13);
    await go(11);
    expect((await progressOf(file.id))!.lastPage).toBe(80);
    await go(14);
    await waitFor(async () => expect((await progressOf(file.id))!.lastPage).toBe(14));
    view.unmount();
  });

  it('without a local copy and without the PC: says so; with the PC: "Baixando o PDF…", then opens', async () => {
    const user = userEvent.setup();
    const bytes = pdfBytes('remote');
    const j = await bd();
    // A PDF added on another device: the record arrived, the file did not.
    const file: StudyFile = {
      id: 'remote1', createdAt: 1, updatedAt: 1, deleted: false, journeyId: j.id, title: 'Capítulo 14', fileHash: sha256Hex(bytes),
      bytes: bytes.length, pages: 12, hasText: true, textHash: 'c'.repeat(64), textChars: 10,
    };
    await db.studyFiles.put(file);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    renderAt(`/estudo/pdf/${file.id}`, <PdfReaderScreen id={file.id} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(READER_TEXT.notHere);
    expect(READER_TEXT.notHere).toBe('Este PDF não está neste aparelho. Abra com o PC ligado para baixar.');
    expect(fetch).not.toHaveBeenCalled();
    expect(fake.openPdf).not.toHaveBeenCalled();

    await setMeta('syncToken', 'tok');
    let send!: () => void;
    fetch.mockImplementation((url: string) => new Promise((resolve) => {
      expect(url).toBe(`/api/media/${file.fileHash}`);
      send = () => resolve({ ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer });
    }));
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText(READER_TEXT.downloading)).toBeInTheDocument();
    expect(READER_TEXT.downloading).toBe('Baixando o PDF…');
    await act(async () => { send(); });
    expect(await screen.findByText('p. 1 de 12')).toBeInTheDocument();
    expect((await db.mediaInfo.get(file.fileHash))!.type).toBe('application/pdf');
    expect(await db.mediaQueue.count()).toBe(0); // downloaded, not queued
  });
});

describe('Criar card desta página and Ver no PDF (§1.4, §1.5)', () => {
  it('with a selection: Verso is the excerpt, Frente empty, the subject deck chosen and the origin shown; saves a normal card', async () => {
    const user = userEvent.setup();
    const { file, journeyId } = await subjectPdf();
    renderAt(`/estudo/pdf/${file.id}?pagina=2`, <PdfReaderScreen id={file.id} />);
    const span = await screen.findByText('Texto da página 2');
    const range = document.createRange();
    range.selectNodeContents(span);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    await user.click(screen.getByRole('button', { name: 'Criar card desta página' }));
    const dialog = await screen.findByRole('dialog', { name: 'Criar card desta página' });
    expect(within(dialog).getByText('Origem: Slides BD · p. 2')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Frente')).toHaveValue('');
    expect(within(dialog).getByLabelText('Verso')).toHaveValue('Texto da página 2');
    expect(within(dialog).getByLabelText('Baralho')).toHaveDisplayValue('Banco de Dados (baralho novo)');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar card' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Escreva a frente.');
    await user.type(within(dialog).getByLabelText('Frente'), 'O que diz a página 2?');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar card' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const notes = (await db.notes.toArray()).filter((n) => !n.deleted);
    expect(notes).toHaveLength(1);
    const deck = (await db.decks.toArray()).find((d) => d.journeyId === journeyId)!;
    expect(deck.name).toBe('Banco de Dados');
    expect(notes[0]).toMatchObject({ type: 'basic', front: 'O que diz a página 2?', back: 'Texto da página 2', draft: false, deckId: deck.id, source: { fileId: file.id, page: 2 } });
    expect(await db.cards.where('noteId').equals(notes[0]!.id).count()).toBe(1); // it enters the review
    expect(await screen.findByText('Card criado. Ele entra na revisão.')).toBeInTheDocument();
  });

  it('without a selection the Verso starts empty, on the current page, in the existing subject deck', async () => {
    const user = userEvent.setup();
    const { file, journeyId } = await subjectPdf();
    const own = await saveDeck({ name: 'BD — cards', journeyId });
    window.getSelection()!.removeAllRanges();
    renderAt(`/estudo/pdf/${file.id}?pagina=3`, <PdfReaderScreen id={file.id} />);
    await screen.findByText('p. 3 de 12');
    await user.click(screen.getByRole('button', { name: 'Criar card desta página' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Origem: Slides BD · p. 3')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Verso')).toHaveValue('');
    await waitFor(() => expect(within(dialog).getByLabelText('Baralho')).toHaveValue(own.id));
  });

  it('the review shows "Ver no PDF, p. N" after the reveal, opening the reader at that page; not for a deleted PDF', async () => {
    const user = userEvent.setup();
    const { file, journeyId } = await subjectPdf();
    const deck = await saveDeck({ name: 'BD', journeyId });
    vi.setSystemTime(new Date(2026, 10, 26, 9, 0));
    await createPageCard({ fileId: file.id, page: 12, front: 'pergunta do PDF', back: 'resposta do PDF', deckId: deck.id });
    vi.setSystemTime(new Date(2026, 10, 26, 10, 0));
    window.history.pushState({}, '', '/estudo/revisar');
    const view = render(<ReviewSession />);
    expect(await screen.findByText('pergunta do PDF')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Ver no PDF/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mostrar resposta' }));
    const link = await screen.findByRole('link', { name: 'Ver no PDF, p. 12' });
    expect(link).toHaveAttribute('href', `/estudo/pdf/${file.id}?pagina=12&voltar=revisao`);
    await db.studyFiles.update(file.id, { deleted: true });
    await waitFor(() => expect(screen.queryByRole('link', { name: /Ver no PDF/ })).toBeNull());
    view.unmount();
    window.history.pushState({}, '', '/');
  });

  it('in a deck\'s review ("Revisar este baralho"), "Ver no PDF" carries the deck for the way back (M1)', async () => {
    const user = userEvent.setup();
    const { file, journeyId } = await subjectPdf();
    const deck = await saveDeck({ name: 'BD', journeyId });
    vi.setSystemTime(new Date(2026, 10, 26, 9, 0));
    await createPageCard({ fileId: file.id, page: 3, front: 'pergunta do baralho', back: 'resposta', deckId: deck.id });
    vi.setSystemTime(new Date(2026, 10, 26, 10, 0));
    window.history.pushState({}, '', `/estudo/revisar?baralho=${deck.id}`);
    const view = render(<ReviewSession />);
    await user.click(await screen.findByRole('button', { name: 'Mostrar resposta' }));
    expect(await screen.findByRole('link', { name: 'Ver no PDF, p. 3' }))
      .toHaveAttribute('href', `/estudo/pdf/${file.id}?pagina=3&voltar=revisao&baralho=${deck.id}`);
    view.unmount();
    window.history.pushState({}, '', '/');
  });

  it('a PDF whose subject was deleted: the card sheet offers no subject deck and says why (M11)', async () => {
    const user = userEvent.setup();
    const { file, journeyId } = await subjectPdf();
    await saveDeck({ name: 'Outro baralho' });
    await db.journeys.update(journeyId, { deleted: true });
    window.getSelection()!.removeAllRanges();
    renderAt(`/estudo/pdf/${file.id}?pagina=2`, <PdfReaderScreen id={file.id} />);
    await screen.findByText('p. 2 de 12');
    await user.click(screen.getByRole('button', { name: 'Criar card desta página' }));
    const dialog = await screen.findByRole('dialog', { name: 'Criar card desta página' });
    expect(await within(dialog).findByText(/A disciplina deste PDF foi apagada/)).toBeInTheDocument();
    const select = within(dialog).getByLabelText('Baralho');
    expect(select).toHaveValue('');
    expect(within(select).queryByText(/baralho novo/)).toBeNull();
    await user.type(within(dialog).getByLabelText('Frente'), 'pergunta');
    await user.type(within(dialog).getByLabelText('Verso'), 'resposta');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar card' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Escolha um baralho.');
    await user.selectOptions(select, 'Outro baralho');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar card' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await db.notes.toArray()).filter((n) => !n.deleted)).toHaveLength(1);
  });
});

describe('Lembrar antes de sair (§1.6) and contact (§1.7): only visible, real reading counts (I4)', () => {
  /** Opens the reader at `start` and goes to each page, `stepMs` of reading on each one (8 s make a page read). */
  async function readPages(pages: number[], start = 1, stepMs = 10_000) {
    const user = userEvent.setup();
    const { file } = await subjectPdf();
    const view = renderAt(`/estudo/pdf/${file.id}?pagina=${start}`, <PdfReaderScreen id={file.id} />);
    await screen.findByText(`p. ${start} de 12`);
    let now = at(10, 0);
    const tick = () => { now += stepMs; vi.setSystemTime(now); };
    for (const n of pages) {
      tick();
      await user.type(screen.getByLabelText('Ir para a página'), String(n));
      await user.click(screen.getByRole('button', { name: 'Ir' }));
      await screen.findByText(`p. ${n} de 12`);
    }
    tick();
    return { user, file, view };
  }
  /** The browser hides or shows the page (locked phone, another app). */
  function setVisibility(state: 'hidden' | 'visible') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  }
  afterEach(() => { Reflect.deleteProperty(document, 'visibilityState'); });
  const noSheet = async () => {
    await new Promise((r) => setTimeout(r, 50));
    expect(useRecallSheet.getState().request).toBeUndefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  };

  it('after 3 new pages read, leaving asks what she remembers; each line becomes a key point of a topic card', async () => {
    const { user, file, view } = await readPages([3, 4, 7], 2);
    view.unmount();
    renderAt('/estudo', <div />);
    const dialog = await screen.findByRole('dialog', { name: 'Lembrar antes de sair' });
    const box = within(dialog).getByLabelText('Sem olhar, o que você lembra das páginas 2 a 7?');
    await user.type(box, 'Chave primária identifica a linha{Enter}{Enter}- 1FN: valores atômicos{Enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const notes = (await db.notes.toArray()).filter((n) => !n.deleted);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      type: 'topic', front: 'Slides BD · p. 2–7', back: 'Chave primária identifica a linha\n1FN: valores atômicos', draft: false,
      source: { fileId: file.id, page: 2 },
    });
    const deck = await db.decks.get(notes[0]!.deckId!);
    expect(deck!.journeyId).toBe(file.journeyId);
  });

  it('does not appear after fewer than 3 new pages and less than 5 minutes', async () => {
    const { view } = await readPages([2, 3]);
    view.unmount();
    renderAt('/estudo', <div />);
    await noSheet();
  });

  it('a fast scroll through 10 pages reads none of them: no sheet and no contact', async () => {
    const { file, view } = await readPages([2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 1, 1_000);
    view.unmount();
    await noSheet();
    expect((await progressOf(file.id))?.lastReadAt).toBeUndefined();
  });

  it('after 5 minutes of reading one page it appears; "Pular" closes without creating anything; the reading is contact', async () => {
    const user = userEvent.setup();
    const { file } = await subjectPdf();
    const view = renderAt(`/estudo/pdf/${file.id}?pagina=4`, <PdfReaderScreen id={file.id} />);
    await screen.findByText('p. 4 de 12');
    const viewport = screen.getByRole('region', { name: 'Páginas do PDF' });
    for (const m of [2, 4]) { // she touches the page now and then
      vi.setSystemTime(at(10, m));
      fireEvent.pointerDown(viewport);
    }
    vi.setSystemTime(at(10, 5));
    view.unmount();
    renderAt('/estudo', <div />);
    const dialog = await screen.findByRole('dialog', { name: 'Lembrar antes de sair' });
    expect(within(dialog).getByLabelText('Sem olhar, o que você lembra da página 4?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Pular' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await db.notes.count()).toBe(0);
    // Reading 5 minutes counts as contact: the moment is recorded even without a page turn.
    expect((await progressOf(file.id))!.lastReadAt).toBe(at(10, 5));
  });

  it('time in background is not counted: 4 × (50 s reading + 2 min locked) is 200 s of reading, not 11 minutes', async () => {
    const { file } = await subjectPdf();
    const view = renderAt(`/estudo/pdf/${file.id}?pagina=4`, <PdfReaderScreen id={file.id} />);
    await screen.findByText('p. 4 de 12');
    const viewport = screen.getByRole('region', { name: 'Páginas do PDF' });
    let now = at(10, 0);
    for (let i = 0; i < 4; i++) {
      now += 50_000;
      vi.setSystemTime(now);
      fireEvent.pointerDown(viewport);
      setVisibility('hidden'); // locks the phone
      now += 120_000;
      vi.setSystemTime(now);
      setVisibility('visible');
    }
    view.unmount();
    await noSheet(); // counting the locked minutes would have passed 5 minutes
    // 200 s of real reading is contact with the subject, recorded when she locked the phone the last time and on leaving.
    await waitFor(async () => expect((await progressOf(file.id))?.lastReadAt).toBe(now));
  });

  it('locked for two hours right after opening: nothing counts as contact', async () => {
    const { file } = await subjectPdf();
    const view = renderAt(`/estudo/pdf/${file.id}?pagina=4`, <PdfReaderScreen id={file.id} />);
    await screen.findByText('p. 4 de 12');
    vi.setSystemTime(at(10, 0, 20));
    setVisibility('hidden');
    vi.setSystemTime(at(12, 0));
    setVisibility('visible');
    vi.setSystemTime(at(12, 0, 10));
    view.unmount();
    await noSheet();
    expect((await progressOf(file.id))?.lastReadAt).toBeUndefined();
  });

  it('the reader left open on the table counts at most 3 minutes: never enough to ask what she remembers', async () => {
    const { file } = await subjectPdf();
    const view = renderAt(`/estudo/pdf/${file.id}?pagina=4`, <PdfReaderScreen id={file.id} />);
    await screen.findByText('p. 4 de 12');
    vi.setSystemTime(at(10, 30));
    view.unmount();
    await noSheet();
    const progress = await progressOf(file.id);
    expect(progress?.lastReadAt).toBeDefined();   // 3 minutes count: she did open the subject's PDF
    expect(progress?.lastPage).toBeUndefined();   // opened at an asked page and never moved: where she stopped stays
  });

  it('a PDF deleted while the reader is open: no sheet (the card would have nowhere to go) (M11)', async () => {
    const { file, view } = await readPages([3, 4, 7], 2);
    await deleteStudyFile(file.id); // the reader closes: "PDF não encontrado."
    expect(await screen.findByRole('heading', { name: 'PDF não encontrado.' })).toBeInTheDocument();
    await noSheet();
    view.unmount();
    await noSheet();
  });

  it('a "Sem disciplina" PDF never asks (the card needs the subject deck)', async () => {
    const user = userEvent.setup();
    const file = await addPdf(pdfFile('Solto.pdf', pdfBytes('solto')));
    fake.openPdf.mockImplementation(async () => fakeDoc(3));
    const view = renderAt(`/estudo/pdf/${file.id}`, <PdfReaderScreen id={file.id} />);
    await screen.findByText('p. 1 de 3');
    expect(screen.getByRole('link', { name: '← Materiais' })).toHaveAttribute('href', '/estudo/materiais');
    for (const n of [2, 3]) {
      vi.setSystemTime(at(10, n));
      await user.type(screen.getByLabelText('Ir para a página'), String(n));
      await user.click(screen.getByRole('button', { name: 'Ir' }));
    }
    vi.setSystemTime(at(10, 4));
    view.unmount();
    expect(useRecallSheet.getState().request).toBeUndefined();
  });
});

describe('Neste aparelho, Apagar and Materiais (§2.5, §4.1, §1.2)', () => {
  const NOT_UPLOADED = 'Este PDF ainda não foi enviado ao PC. Abra o app com o PC ligado antes de tirar.';
  const queued = async () => (await db.mediaQueue.toArray()).map((q) => q.hash).sort();

  it('"Tirar deste aparelho" is refused while the PDF waits for the PC, and works once the PC says it holds it', async () => {
    const user = userEvent.setup();
    const { file, journeyId } = await subjectPdf();
    await setMeta('syncToken', 'tok');
    renderAt(`/estudo/materias/${journeyId}`, <SubjectDetailScreen id={journeyId} />);
    expect(await screen.findByText('Neste aparelho')).toBeInTheDocument();
    const calls = stubPc({ put: 204, head: () => 200 });
    await user.click(screen.getByRole('button', { name: 'Tirar deste aparelho: Slides BD' }));
    expect(await screen.findByText(NOT_UPLOADED)).toBeInTheDocument();
    expect(await db.mediaInfo.get(file.fileHash)).toBeTruthy();
    expect(calls).toEqual([]); // still queued: the PC is not even asked
    await expect(removeLocalCopy(file)).rejects.toBeInstanceOf(StudyFileError);

    // The upload round sends the PDF and its text; the PC answers HEAD 200 for both, so the local copy may go.
    expect(await uploadPendingMedia('tok')).toBe('done');
    calls.length = 0;
    await user.click(screen.getByRole('button', { name: 'Tirar deste aparelho: Slides BD' }));
    expect(await screen.findByRole('button', { name: 'Baixar para ler sem internet: Slides BD' })).toBeInTheDocument();
    expect(screen.queryByText('Neste aparelho')).toBeNull();
    expect(calls).toEqual([`HEAD ${file.fileHash}`, `HEAD ${file.textHash}`]);
    expect(await db.mediaInfo.get(file.fileHash)).toBeUndefined();
    expect(await db.mediaData.get(file.textHash!)).toBeUndefined();
    expect((await db.studyFiles.get(file.id))!.deleted).toBe(false); // the record stays: the PC has the file
  });

  it('the PC answers that it lacks the PDF (HEAD 404): refused, the copy stays and goes back in the upload queue', async () => {
    const { file } = await subjectPdf();
    await setMeta('syncToken', 'tok');
    await db.mediaQueue.clear(); // as if it had left the queue (restored backup on the PC)
    const calls = stubPc({ head: () => 404 });
    await expect(removeLocalCopy(file)).rejects.toThrow(NOT_UPLOADED);
    expect(calls).toEqual([`HEAD ${file.fileHash}`]);
    expect(await db.mediaInfo.get(file.fileHash)).toBeTruthy();
    expect(await queued()).toEqual([file.fileHash]); // the next sync sends it again
  });

  it('an upload the PC refused (413) left the queue, but the copy is still refused to go, and is queued again', async () => {
    const { file } = await subjectPdf();
    await setMeta('syncToken', 'tok');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubPc({ put: 413, head: () => 404 });
    expect(await uploadPendingMedia('tok')).toBe('done');
    expect(await queued()).toEqual([]);
    await expect(removeLocalCopy(file)).rejects.toThrow(NOT_UPLOADED);
    expect(await db.mediaInfo.get(file.fileHash)).toBeTruthy();
    expect(await db.mediaData.get(file.textHash!)).toBeTruthy();
    expect(await queued()).toEqual([file.fileHash]);
  });

  it('without an access code, or with the PC unreachable, it is refused and nothing changes', async () => {
    const { file } = await subjectPdf();
    await db.mediaQueue.clear();
    const calls = stubPc({ head: () => 200 });
    await expect(removeLocalCopy(file)).rejects.toThrow(NOT_UPLOADED); // no token
    expect(calls).toEqual([]);
    await setMeta('syncToken', 'tok');
    stubPc({ head: () => 'offline' });
    await expect(removeLocalCopy(file)).rejects.toThrow(NOT_UPLOADED);
    stubPc({ head: () => 500 });
    await expect(removeLocalCopy(file)).rejects.toThrow(NOT_UPLOADED);
    expect(await db.mediaInfo.get(file.fileHash)).toBeTruthy();
    expect(await queued()).toEqual([]); // no answer is not a "no": nothing queued again
  });

  it('the text follows the same rule: the PDF goes, the text the PC lacks stays and is queued again', async () => {
    const { file } = await subjectPdf();
    await setMeta('syncToken', 'tok');
    await db.mediaQueue.clear();
    stubPc({ head: (h) => (h === file.fileHash ? 200 : 404) });
    expect(await removeLocalCopy(file)).toBe('removed');
    expect(await db.mediaInfo.get(file.fileHash)).toBeUndefined();
    expect(await db.mediaInfo.get(file.textHash!)).toBeTruthy();
    expect(await queued()).toEqual([file.textHash]);
  });

  it('a PDF queued again between the PC\'s answer and the delete stays (the queue is checked inside the delete)', async () => {
    const { file } = await subjectPdf();
    await setMeta('syncToken', 'tok');
    await db.mediaQueue.clear();
    vi.stubGlobal('fetch', vi.fn(async () => {
      await db.mediaQueue.put({ hash: file.fileHash, addedAt: 1 }); // "Adicionar PDF" of the same file meanwhile
      return { ok: true, status: 200 };
    }));
    await expect(removeLocalCopy(file)).rejects.toThrow(NOT_UPLOADED);
    expect(await db.mediaInfo.get(file.fileHash)).toBeTruthy();
  });

  it('"Baixar para ler sem internet" keeps it here', async () => {
    const user = userEvent.setup();
    const bytes = pdfBytes('baixar');
    const j = await bd();
    await db.studyFiles.put({ id: 'r2', createdAt: 1, updatedAt: 1, deleted: false, journeyId: j.id, title: 'Lista 2', fileHash: sha256Hex(bytes), bytes: bytes.length, pages: 4, hasText: false });
    await setMeta('syncToken', 'tok');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer })));
    renderAt(`/estudo/materias/${j.id}`, <SubjectDetailScreen id={j.id} />);
    expect(await screen.findByText(/4 páginas · sem texto/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Baixar para ler sem internet: Lista 2' }));
    expect(await screen.findByText('PDF guardado neste aparelho.')).toBeInTheDocument();
    expect(await screen.findByText('Neste aparelho')).toBeInTheDocument();
  });

  it('Apagar hides it with "Desfazer", which brings it back', async () => {
    const user = userEvent.setup();
    const { file, journeyId } = await subjectPdf();
    await setProgress(file.id, { lastPage: 10 });
    renderAt(`/estudo/materias/${journeyId}`, <SubjectDetailScreen id={journeyId} />);
    expect(await screen.findByText('12 páginas · p. 10 de 12')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apagar Slides BD' }));
    await waitFor(() => expect(screen.queryByText('Slides BD')).toBeNull());
    expect((await db.studyFiles.get(file.id))!.deleted).toBe(true);
    await user.click(await screen.findByRole('button', { name: 'Desfazer' }));
    expect(await screen.findByText('Slides BD')).toBeInTheDocument();
    expect((await db.studyFiles.get(file.id))!.deleted).toBe(false);
  });

  it('Materiais: every PDF by subject plus "Sem disciplina"; adding picks the subject; a PDF can move', async () => {
    const user = userEvent.setup();
    const { journeyId } = await subjectPdf();
    await createSubject({ title: 'Cálculo I', weekdays: [2], start: '19:30', end: '22:30' });
    await addPdf(pdfFile('Extrato.pdf', pdfBytes('solto')));
    renderAt('/estudo/materiais', <MaterialsScreen />);
    expect(await screen.findByRole('heading', { name: 'Banco de Dados' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sem disciplina' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cálculo I' })).toBeNull();
    expect(await screen.findByRole('link', { name: 'Abrir Slides BD' })).toHaveAttribute('href', expect.stringMatching(/\?voltar=materiais$/));
    await user.selectOptions(screen.getByLabelText('Disciplina do PDF'), 'Cálculo I');
    await user.upload(screen.getByLabelText('Adicionar PDF'), pdfFile('Lista de limites.pdf', pdfBytes('limites')));
    expect(await screen.findByRole('heading', { name: 'Cálculo I' })).toBeInTheDocument();
    const calc = (await db.journeys.toArray()).find((x) => x.title === 'Cálculo I')!;
    expect((await liveFiles()).find((f) => f.title === 'Lista de limites')!.journeyId).toBe(calc.id);
    await user.selectOptions(screen.getByLabelText('Disciplina de Extrato'), 'Banco de Dados');
    await waitFor(async () => expect((await liveFiles()).find((f) => f.title === 'Extrato')!.journeyId).toBe(journeyId));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Sem disciplina' })).toBeNull());
  });

  it('Estudo links to Materiais', async () => {
    const user = userEvent.setup();
    const view = renderAt('/estudo', <StudyScreen />);
    await user.click(await screen.findByRole('button', { name: 'Materiais' }));
    expect(view.path).toBe('/estudo/materiais');
  });
});

describe('sync, export and contact (§1.7, §2.2, §2.4, §2.8)', () => {
  it('an upload round takes a big file alone; the time limit grows with it', async () => {
    const small = (n: number) => { const b = new Uint8Array(32).fill(n); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b; };
    vi.setSystemTime(1000); await storeMedia(small(1), { upload: true });
    vi.setSystemTime(2000); const big = await storeMedia(pdfBytes('grande', 9 * 1024 * 1024), { upload: true });
    vi.setSystemTime(3000); await storeMedia(small(2), { upload: true });
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { sent.push(url); return { ok: true, status: 204 }; }));
    expect(await uploadPendingMedia('tok')).toBe('more');
    expect(sent).toHaveLength(1);
    expect(await uploadPendingMedia('tok')).toBe('more');
    expect(sent[1]).toBe(`/api/media/${big.info.hash}`);
    expect(await uploadPendingMedia('tok')).toBe('done');
    expect(sent).toHaveLength(3);
  });

  it('a big PDF uploads after the records, in its own pass; images and small files still go before them (M4)', async () => {
    const small = (n: number) => { const b = new Uint8Array(32).fill(n); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b; };
    vi.setSystemTime(1000); const big = await storeMedia(pdfBytes('grande', 9 * 1024 * 1024), { upload: true });
    vi.setSystemTime(2000); const img = await storeMedia(small(1), { upload: true });
    await setMeta('syncToken', 'tok');
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      sent.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/sync') return { ok: true, status: 200, json: async () => ({ cursor: 0, changes: [] }) };
      return { ok: true, status: 204 };
    }));
    expect(await syncNow()).toBe(true);
    await uploadBigMedia('tok');
    expect(sent.filter((s) => !s.startsWith('GET'))).toEqual([
      `PUT /api/media/${img.info.hash}`, 'POST /api/sync', `PUT /api/media/${big.info.hash}`,
    ]);
    expect(await db.mediaQueue.count()).toBe(0);
  });

  it('a big file that fails in any way (iOS "Load failed") goes to the back of the queue, so the next one gets its turn (M4)', async () => {
    vi.setSystemTime(1000); const a = await storeMedia(pdfBytes('grande-a', 9 * 1024 * 1024), { upload: true });
    vi.setSystemTime(2000); const b = await storeMedia(pdfBytes('grande-b', 9 * 1024 * 1024), { upload: true });
    vi.setSystemTime(3000);
    const sent: string[] = [];
    let cut = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      sent.push(url.split('/').pop()!);
      if (cut && url.endsWith(a.info.hash)) throw new TypeError('Load failed');
      return { ok: true, status: 204 };
    }));
    expect(await uploadPendingMedia('tok', 'small')).toBe('done'); // the small pass leaves big files alone
    expect(sent).toEqual([]);
    expect(await uploadPendingMedia('tok', 'big')).toBe('stopped');
    expect((await db.mediaQueue.get(a.info.hash))!.addedAt).toBe(3000);
    cut = false;
    expect(await uploadBigMedia('tok')).toBe('done');
    expect(sent).toEqual([a.info.hash, b.info.hash, a.info.hash]); // b went before a's second try
    expect(await db.mediaQueue.count()).toBe(0);
  });

  it('PDFs and their texts are never downloaded in background: only what notes reference is (M7)', async () => {
    const bytes = pdfBytes('fundo');
    await db.studyFiles.put({ id: 'bg', createdAt: 1, updatedAt: 1, deleted: false, title: 'Fundo', fileHash: sha256Hex(bytes), bytes: bytes.length, pages: 1, hasText: true, textHash: 'e'.repeat(64), textChars: 3 });
    const png = new Uint8Array(40).fill(9); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const imgHash = sha256Hex(png);
    await db.notes.put({
      id: 'n-img', createdAt: 1, updatedAt: 1, deleted: false, type: 'basic', draft: false, deckId: 'deck-x',
      front: `Qual é a tabela? ![diagrama](media:${imgHash})`, back: 'Clientes',
    });
    const fetch = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => png.slice().buffer }));
    vi.stubGlobal('fetch', fetch);
    await prefetchMedia('tok', true);
    expect(fetch.mock.calls.map((c) => (c as unknown[])[0])).toEqual([`/api/media/${imgHash}`]);
    expect(await db.mediaInfo.get(imgHash)).toBeTruthy();
    expect(await db.mediaInfo.get(sha256Hex(bytes))).toBeUndefined();
  });

  it('deleted PDFs leave this device after the "Desfazer" window, only once the PC confirms it has them (M2)', async () => {
    const { file } = await subjectPdf();
    const png = new Uint8Array(32).fill(4); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const img = await storeMedia(png, { upload: false }); // an image nobody references: never touched
    await db.mediaQueue.clear(); // uploaded
    await deleteStudyFile(file.id);
    const calls = stubPc({ head: () => 200 });
    expect(await freeUnusedPdfCopies('tok')).toBe(0); // within the window: kept for "Desfazer"
    expect(calls).toEqual([]);
    vi.setSystemTime(Date.now() + UNUSED_PDF_GRACE_MS + 1_000);
    expect(await freeUnusedPdfCopies('tok')).toBe(2);
    expect(calls.sort()).toEqual([`HEAD ${file.fileHash}`, `HEAD ${file.textHash}`].sort());
    expect(await db.mediaInfo.get(file.fileHash)).toBeUndefined();
    expect(await db.mediaData.get(file.textHash!)).toBeUndefined();
    expect(await db.mediaInfo.get(img.info.hash)).toBeTruthy();
    expect((await db.studyFiles.get(file.id))!.deleted).toBe(true); // the record stays (the PC has the file)
  });

  it('M2 keeps what is still used or not confirmed: "Desfazer", the same PDF elsewhere, a note, the queue, a PC without it', async () => {
    const { file } = await subjectPdf();
    await db.mediaQueue.clear();
    await deleteStudyFile(file.id);
    await restoreStudyFile(file.id); // "Desfazer"
    vi.setSystemTime(Date.now() + UNUSED_PDF_GRACE_MS + 1_000);
    let calls = stubPc({ head: () => 200 });
    expect(await freeUnusedPdfCopies('tok')).toBe(0);
    expect(calls).toEqual([]);
    // The same PDF in another place: deleting one keeps the bytes for the other.
    const other = await createStudyFile({ bytes: pdfBytes('slides'), pages: 12, texts: ['x'], title: 'Cópia' });
    expect(other.fileHash).toBe(file.fileHash);
    await deleteStudyFile(file.id);
    vi.setSystemTime(Date.now() + UNUSED_PDF_GRACE_MS + 1_000);
    expect(await freeUnusedPdfCopies('tok')).toBe(1); // only the first copy's text, which nothing else uses
    expect(await db.mediaInfo.get(file.fileHash)).toBeTruthy();
    expect(await db.mediaInfo.get(file.textHash!)).toBeUndefined();
    // A note that references it, or the upload queue, keeps it without asking the PC.
    await deleteStudyFile(other.id);
    await db.notes.put({
      id: 'n-ref', createdAt: 1, updatedAt: 1, deleted: false, type: 'basic', draft: false, deckId: 'deck-x',
      front: `[slides](media:${file.fileHash})`, back: 'b',
    });
    await db.mediaQueue.put({ hash: other.textHash!, addedAt: 1 });
    vi.setSystemTime(Date.now() + UNUSED_PDF_GRACE_MS + 1_000);
    calls = stubPc({ head: () => 200 });
    expect(await freeUnusedPdfCopies('tok')).toBe(0);
    expect(calls).toEqual([]);
    // Without the note and the queue entry, a PC that lacks the file (404) gets it queued again instead.
    await db.notes.delete('n-ref');
    await db.mediaQueue.clear();
    calls = stubPc({ head: () => 404 });
    expect(await freeUnusedPdfCopies('tok')).toBe(0);
    expect((await db.mediaQueue.toArray()).map((q) => q.hash).sort()).toEqual([file.fileHash, other.textHash].sort());
    expect(await db.mediaInfo.get(file.fileHash)).toBeTruthy();
    // A PC that keeps refusing the upload (it left the queue again) is not sent 50 MB every round: asked again only
    // after 10 minutes, and never queued twice in a session.
    await db.mediaQueue.clear();
    calls.length = 0;
    expect(await freeUnusedPdfCopies('tok')).toBe(0);
    expect(calls).toEqual([]);
    vi.setSystemTime(Date.now() + UNUSED_PDF_RETRY_MS);
    expect(await freeUnusedPdfCopies('tok')).toBe(0);
    expect(calls).toHaveLength(2);
    expect(await db.mediaQueue.count()).toBe(0);
  });

  it('the in-app export leaves PDFs and texts out and says so on screen', async () => {
    const { file } = await subjectPdf();
    const png = new Uint8Array(32).fill(3); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const img = await storeMedia(png, { upload: true });
    const data = await collectExport();
    expect(data.media!.map((m) => m.hash)).toEqual([img.info.hash]);
    expect(JSON.stringify(data.media)).not.toContain(file.fileHash);
    expect((data.studyFiles as StudyFile[]).map((f) => f.id)).toEqual([file.id]); // the record itself goes
    render(<DataSection />);
    expect(await screen.findByText('Os PDFs e o texto extraído deles ficam fora da exportação. Com a sincronização, o PC guarda uma cópia deles no backup diário.')).toBeInTheDocument();
    expect(await screen.findByText(/Imagens e áudios \(32 B\) entram na exportação/)).toBeInTheDocument();
  });

  it('reading a subject PDF counts as contact with the subject', async () => {
    const { file, journeyId } = await subjectPdf();
    const j = (await db.journeys.get(journeyId))!;
    vi.setSystemTime(new Date(2026, 11, 10, 10, 0)); // two weeks later
    let data = (await readFacultyData(Date.now()))!;
    expect(daysWithoutContact(j, data.contact, data.today, data.restDays)).toBeGreaterThan(5);
    await setProgress(file.id, { lastReadAt: new Date(2026, 11, 10, 9, 0).getTime() });
    data = (await readFacultyData(Date.now()))!;
    expect(daysWithoutContact(j, data.contact, data.today, data.restDays)).toBe(0);
  });

  it('createStudyFile refuses a subject that is not one', async () => {
    await expect(createStudyFile({ bytes: pdfBytes('x'), pages: 1, texts: ['a'], title: 't', journeyId: 'nada' })).rejects.toThrow('Escolha a disciplina.');
  });
});
