import type { BibItem, BibKind, ID, SubjectNotebook } from './types';
import { normalize } from './parser';

// Caderno da disciplina (2026-11-26): the subject's notebook (four Markdown sections and the bibliography), the study
// profile shared by every subject, and the apostilas the chats write. Limits used by the validation, the app and the
// schema; pure helpers for merging and for the texts the review shows.

export const NOTEBOOK_LIMITS = {
  plan: 8000, studied: 4000, difficulties: 2000, nextChat: 4000,
  bibliography: 40, bibTitle: 200, bibAuthors: 200, bibUrl: 500, bibNote: 200,
  docs: 3, docTitle: 120, docMarkdown: 40_000,
  studyProfile: 3000,
  /** The start of a long text in the review's detail. */
  excerpt: 300,
  /** ler_disciplina: notes of the subject's decks, newest first, each side cut to this many characters. */
  cards: 150, cardSide: 240,
  /**
   * "Copiar pedido de estudo" (no connector): the same memory with only the newest 60 cards, so the pasted request
   * still fits a chat with a small context (the schema and the rules already take about 20 thousand characters).
   */
  pasteCards: 60,
} as const;

export const NOTEBOOK_SECTIONS = ['plan', 'studied', 'difficulties', 'nextChat'] as const;
export type NotebookSection = (typeof NOTEBOOK_SECTIONS)[number];
export const NOTEBOOK_SECTION_TITLE: Record<NotebookSection, string> = {
  plan: 'Plano de ensino', studied: 'O que já foi estudado', difficulties: 'Dificuldades', nextChat: 'Para o próximo chat',
};

export const BIB_KINDS: readonly BibKind[] = ['basica', 'complementar', 'outra'];
export const BIB_KIND_LABEL: Record<BibKind, string> = { basica: 'básica', complementar: 'complementar', outra: 'outra' };

export const notebookId = (journeyId: ID): string => `notebook-${journeyId}`;

/** The merge key of a book or an apostila title: without accents, case and extra spaces. */
export const bibKey = (title: string): string => normalize(title.trim()).replace(/\s+/g, ' ');

/** What is wrong with an https:// address, if anything (shown as is). An empty address is fine: it removes the link. */
export function httpsUrlIssue(url: string, max: number): string | undefined {
  const u = url.trim();
  if (u === '') return undefined;
  if (u.length > max) return `O link pode ter até ${max} caracteres.`;
  if (!/^https:\/\//i.test(u)) return 'O link precisa começar com https://.';
  try {
    if (new URL(u).protocol !== 'https:') return 'O link precisa começar com https://.';
  } catch {
    return 'Esse link não parece um endereço válido.';
  }
  return undefined;
}

export const bibUrlIssue = (url: string): string | undefined => httpsUrlIssue(url, NOTEBOOK_LIMITS.bibUrl);

/** A book's link when it can be opened (https://), else undefined. */
export const openableBibUrl = (b: Pick<BibItem, 'url'>): string | undefined =>
  b.url && b.url.trim() !== '' && bibUrlIssue(b.url) === undefined ? b.url.trim() : undefined;

/** Same link, authors, kind and note (an empty field equals an absent one). */
export function sameBibFields(a: BibItem, b: BibItem): boolean {
  const v = (s?: string) => s?.trim() ?? '';
  return v(a.url) === v(b.url) && v(a.authors) === v(b.authors) && a.kind === b.kind && v(a.note) === v(b.note);
}

export type BibMerge =
  | { result: 'existed' }
  | { result: 'applied'; bibliography: BibItem[] }
  | { result: 'full' };

/**
 * A book merged by title: the same title with the same fields "already existed"; with other fields they are updated
 * (the title stays as it was); a new book goes at the end, unless the list is full.
 */
export function mergeBib(list: readonly BibItem[], item: BibItem): BibMerge {
  const key = bibKey(item.title);
  const i = list.findIndex((b) => bibKey(b.title) === key);
  const fields = (b: BibItem): Omit<BibItem, 'title'> => ({
    kind: b.kind,
    ...(b.authors?.trim() ? { authors: b.authors.trim() } : {}),
    ...(b.url?.trim() ? { url: b.url.trim() } : {}),
    ...(b.note?.trim() ? { note: b.note.trim() } : {}),
  });
  if (i >= 0) {
    if (sameBibFields(list[i]!, item)) return { result: 'existed' };
    return { result: 'applied', bibliography: list.map((b, k) => (k === i ? { title: b.title, ...fields(item) } : b)) };
  }
  if (list.length >= NOTEBOOK_LIMITS.bibliography) return { result: 'full' };
  return { result: 'applied', bibliography: [...list, { title: item.title.trim(), ...fields(item) }] };
}

/** Some section or some book filled. */
export function notebookFilled(nb: Pick<SubjectNotebook, NotebookSection | 'bibliography'> | undefined): boolean {
  if (!nb) return false;
  return NOTEBOOK_SECTIONS.some((s) => (nb[s] ?? '').trim() !== '') || (nb.bibliography?.length ?? 0) > 0;
}

/** At most `max` characters, the last one "…" when cut. */
export function cutText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** The start of a long text on one line (the review's detail): at most 300 characters, with "…" when cut. */
export const excerpt = (text: string, max: number = NOTEBOOK_LIMITS.excerpt): string => cutText(text.replace(/\s+/g, ' ').trim(), max);

/** "850 caracteres" · "1 caractere" · "mil caracteres" · "1,5 mil caracteres" · "12 mil caracteres". */
export function charsText(n: number): string {
  if (n < 1000) return `${n} ${n === 1 ? 'caractere' : 'caracteres'}`;
  // One decimal below 10 thousand (where it still says something), whole thousands above.
  const k = n < 9950 ? Math.round(n / 100) / 10 : Math.round(n / 1000);
  return k === 1 ? 'mil caracteres' : `${String(k).replace('.', ',')} mil caracteres`;
}
