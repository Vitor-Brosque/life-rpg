import type { ID, Journey, StudyFile } from './types';
import { PDF_TEXT_MAX_BYTES, PDF_TEXT_SIGNATURE } from './media';
import { cutText } from './notebook';

// PDFs da aula (2026-11-26, fase 2): the limits of a PDF of Materiais, the format of its extracted text (a media file of
// its own, read only by the server) and what `ler_material` gives an assistant. Pure: PDF.js never runs here (the app
// extracts the text on the device; the server only reads the JSON).

export const STUDY_FILE_LIMITS = {
  title: 120,
  /** ler_material: characters of page text per call; a longer range is cut at the last whole page that fits. */
  materialChars: 40_000,
  /** "Lembrar antes de sair": after this many new pages or this long in the reader. */
  recallPages: 3,
  recallMs: 5 * 60_000,
  /** The reader writes the current page at most this often (and when it closes). */
  pageWriteMs: 5_000,
} as const;

/** The extracted text: `pages[i]` is page i + 1. Pages after `pages.length` did not fit in PDF_TEXT_MAX_BYTES. */
export interface PdfText { lifeRpgPdfText: 1; pages: string[] }

const encoder = new TextEncoder();
const byteLength = (s: string): number => encoder.encode(s).length;

/**
 * One page's text from PDF.js text items: the runs in order, a line break where the PDF ends a line, spaces and blank
 * lines squeezed, edges trimmed.
 */
export function pageTextFromItems(items: ReadonlyArray<{ str?: unknown; hasEOL?: unknown }>): string {
  let s = '';
  for (const it of items) {
    if (typeof it.str === 'string') s += it.str;
    if (it.hasEOL === true) s += '\n';
  }
  return s.replace(/[ \t\f\v\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** True when some page has text (a scanned PDF has none: no OCR). */
export const pagesHaveText = (pages: readonly string[]): boolean => pages.some((p) => p.trim() !== '');

/**
 * The extracted text as the bytes of a JSON that starts exactly with PDF_TEXT_SIGNATURE, at most `maxBytes`: the pages
 * that do not fit are left out from the end (`keptPages` says how many stayed). `chars` counts the kept text.
 */
export function encodePdfText(pages: readonly string[], maxBytes: number = PDF_TEXT_MAX_BYTES): { bytes: Uint8Array; chars: number; keptPages: number } {
  const head = `${PDF_TEXT_SIGNATURE}"pages":[`;
  const tail = ']}';
  let size = byteLength(head) + byteLength(tail);
  const parts: string[] = [];
  let chars = 0;
  for (const p of pages) {
    const part = JSON.stringify(p);
    const add = byteLength(part) + (parts.length > 0 ? 1 : 0);
    if (size + add > maxBytes) break;
    size += add;
    parts.push(part);
    chars += p.length;
  }
  return { bytes: encoder.encode(head + parts.join(',') + tail), chars, keptPages: parts.length };
}

/** The extracted text from its bytes, or undefined when they are not one (wrong signature, bad JSON or shape). */
export function parsePdfText(bytes: Uint8Array | string): PdfText | undefined {
  const text = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);
  if (!text.startsWith(PDF_TEXT_SIGNATURE)) return undefined;
  try {
    const v = JSON.parse(text) as { lifeRpgPdfText?: unknown; pages?: unknown };
    if (v.lifeRpgPdfText !== 1 || !Array.isArray(v.pages) || !v.pages.every((p) => typeof p === 'string')) return undefined;
    return { lifeRpgPdfText: 1, pages: v.pages as string[] };
  } catch {
    return undefined;
  }
}

/** A title from the file name: without ".pdf", underscores as spaces, at most 120 characters; "PDF" when empty. */
export function studyFileTitle(name: string): string {
  const t = name.replace(/\.pdf$/i, '').replace(/[_\s]+/g, ' ').trim();
  return (t === '' ? 'PDF' : t).slice(0, STUDY_FILE_LIMITS.title).trim();
}

/** "1 página" · "120 páginas". */
export const pagesText = (n: number): string => `${n} ${n === 1 ? 'página' : 'páginas'}`;

/** The front of a "Lembrar antes de sair" card: "Título · p. 12–18" (one page: "Título · p. 12"). */
export const recallFront = (title: string, from: number, to: number): string =>
  `${title} · p. ${from === to ? from : `${from}–${to}`}`;

/** The card sheet's origin: "Título · p. 12". */
export const sourceLabel = (title: string, page: number): string => `${title} · p. ${page}`;

// ------------------------------------------------------------------ ler_material

/** The tables `buildMaterialView` reads. */
export const MATERIAL_TABLES = ['journeys', 'studyFiles'] as const;

export interface MaterialView {
  id: ID;
  title: string;
  subject: string;
  pages: number;
  fromPage: number;
  toPage: number;
  text: { page: number; text: string }[];
  /** The range went past 40 thousand characters: call again from this page. */
  nextPage?: number;
  note?: string;
}
export type MaterialResult = { ok: true; material: MaterialView } | { ok: false; message: string };

export const MATERIAL_MESSAGES = {
  noText: 'Este PDF não tem texto: é uma imagem escaneada.',
  textMissing: 'O texto deste PDF ainda não chegou ao PC. Abra o app no aparelho onde o PDF foi adicionado, com o PC ligado.',
} as const;

const live = <T extends { deleted: boolean }>(xs: readonly T[] | undefined): T[] => (xs ?? []).filter((x) => !x.deleted);

/**
 * A live PDF linked to an active subject, with its subject; undefined for "Sem disciplina" PDFs and for those of archived
 * or concluded subjects (never read: ler_disciplina lists only the active subjects too).
 */
export function subjectFileOf(t: { journeys?: Journey[]; studyFiles?: StudyFile[] }, id: string): { file: StudyFile; subject: Journey } | undefined {
  const file = live(t.studyFiles).find((f) => f.id === id);
  const subject = file?.journeyId
    ? live(t.journeys).find((j) => j.id === file.journeyId && j.subject === true && j.status === 'active')
    : undefined;
  return file && subject ? { file, subject } : undefined;
}

const pageArg = (v: unknown, fallback: number): number | undefined =>
  v === undefined || v === null ? fallback : typeof v === 'number' && Number.isInteger(v) ? v : undefined;

/**
 * `ler_material`: the text of the pages `fromPage`..`toPage` (default: from 1 to the end) of a PDF linked to an active subject,
 * each with its number, at most 40 thousand characters: a longer range ends at the last whole page that fits, with
 * `nextPage`. A first page longer than that comes cut. A "Sem disciplina" PDF answers as if it did not exist.
 * `readText` gives the extracted text of a hash (the server reads its media folder), undefined when it is not there.
 */
export function buildMaterialView(
  t: { journeys?: Journey[]; studyFiles?: StudyFile[] },
  input: { id?: unknown; fromPage?: unknown; toPage?: unknown },
  readText: (hash: string) => PdfText | undefined,
): MaterialResult {
  const id = typeof input.id === 'string' ? input.id : '';
  const found = subjectFileOf(t, id);
  if (!found) return { ok: false, message: `PDF "${cutText(id.trim(), 64)}" não existe. Use o id que ler_disciplina mostra em files.` };
  const { file, subject } = found;
  if (!file.hasText) return { ok: false, message: MATERIAL_MESSAGES.noText };
  const from = pageArg(input.fromPage, 1);
  const to = pageArg(input.toPage, file.pages);
  if (from === undefined || to === undefined || from < 1 || to > file.pages || from > to) {
    return { ok: false, message: `Página fora do intervalo: o PDF tem ${pagesText(file.pages)}. Use fromPage e toPage entre 1 e ${file.pages}, com fromPage até toPage.` };
  }
  const pdf = file.textHash ? readText(file.textHash) : undefined;
  if (!pdf) return { ok: false, message: MATERIAL_MESSAGES.textMissing };

  const max = STUDY_FILE_LIMITS.materialChars;
  const text: { page: number; text: string }[] = [];
  let used = 0;
  let nextPage: number | undefined;
  for (let p = from; p <= to; p++) {
    const pageText = pdf.pages[p - 1] ?? '';
    if (used + pageText.length > max) {
      if (text.length === 0) {
        // A single page longer than the limit: it comes cut, and the next call starts after it.
        text.push({ page: p, text: cutText(pageText, max) });
        if (p < to) nextPage = p + 1;
      } else {
        nextPage = p;
      }
      break;
    }
    used += pageText.length;
    text.push({ page: p, text: pageText });
  }
  const last = text[text.length - 1]!.page;
  const missing = pdf.pages.length < file.pages && last > pdf.pages.length;
  return {
    ok: true,
    material: {
      id: file.id, title: file.title, subject: subject.title, pages: file.pages, fromPage: from, toPage: last, text,
      ...(nextPage !== undefined ? { nextPage } : {}),
      ...(missing ? { note: `O texto das páginas depois da ${pdf.pages.length} não coube no limite de 4 MB do app.` } : {}),
    },
  };
}
