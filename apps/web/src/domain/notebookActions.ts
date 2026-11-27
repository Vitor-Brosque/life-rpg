import type { BibItem, BibKind, ID, Journey, Profile, StudyDoc, SubjectNotebook } from '@life/shared';
import {
  BIB_KINDS, NOTEBOOK_LIMITS, NOTEBOOK_SECTION_TITLE, bibKey, bibUrlIssue, mergeBib, notebookId, type NotebookSection,
} from '@life/shared';
import { db } from '../db/db';
import { mutate, newRecord, patch, put, upsert } from '../db/repo';
import { withLock } from './common';

// Caderno da disciplina (spec 2026-11-26): the subject's notebook (sections and bibliography), its apostilas and the
// study profile. Used by the subject page, Matérias and the proposals; every write goes through the repo. Nothing
// here gives XP.

/** An input the person can fix: the message is shown as is. */
export class NotebookValidationError extends Error {}

export type WriteResult = 'applied' | 'existed';

const thousands = (n: number): string => n.toLocaleString('pt-BR');

async function liveSubject(journeyId: ID): Promise<Journey> {
  const j = await db.journeys.get(journeyId);
  if (!j || j.deleted || j.subject !== true) throw new NotebookValidationError('Escolha a disciplina.');
  return j;
}

/**
 * Read-modify-write of the subject's notebook, created when missing: `fn` gets the current one (an empty one when
 * there is none) and returns the fields to change, or undefined to write nothing. A field set to undefined is removed
 * (an empty section is an absent field). True when something was written.
 */
async function changeNotebook(journeyId: ID, fn: (nb: SubjectNotebook) => Partial<SubjectNotebook> | undefined): Promise<boolean> {
  await liveSubject(journeyId);
  return withLock(`notebook:${journeyId}`, async () => {
    const id = notebookId(journeyId);
    const prev = await db.subjectNotebooks.get(id);
    if (prev && !prev.deleted) {
      let wrote = false;
      await mutate<SubjectNotebook>('subjectNotebooks', id, (nb) => {
        const changes = fn(nb);
        wrote = changes !== undefined;
        return changes;
      });
      return wrote;
    }
    const changes = fn({ ...newRecord<SubjectNotebook>({ id, journeyId, bibliography: [] }) });
    if (!changes) return false;
    const fields = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) as Partial<SubjectNotebook>;
    await upsert<SubjectNotebook>('subjectNotebooks', id, fields, { journeyId, bibliography: [] });
    return true;
  });
}

/** Saves a section ("Editar" or a proposal): the text replaces the current one; an empty text empties the section. */
export async function setNotebookSection(journeyId: ID, section: NotebookSection, text: string): Promise<WriteResult> {
  const t = text.trim();
  const max = NOTEBOOK_LIMITS[section];
  if (t.length > max) throw new NotebookValidationError(`${NOTEBOOK_SECTION_TITLE[section]} pode ter até ${thousands(max)} caracteres.`);
  const wrote = await changeNotebook(journeyId, (nb) => ((nb[section] ?? '') === t ? undefined : { [section]: t === '' ? undefined : t }));
  return wrote ? 'applied' : 'existed';
}

export interface BookFields { title: string; authors?: string; kind: BibKind; url?: string; note?: string }

function cleanBook(f: BookFields): BibItem {
  const title = f.title.replace(/\s+/g, ' ').trim();
  const authors = f.authors?.trim() ?? '';
  const url = f.url?.trim() ?? '';
  const note = f.note?.trim() ?? '';
  if (title === '') throw new NotebookValidationError('Dê o título do livro.');
  if (title.length > NOTEBOOK_LIMITS.bibTitle) throw new NotebookValidationError(`O título pode ter até ${NOTEBOOK_LIMITS.bibTitle} caracteres.`);
  if (authors.length > NOTEBOOK_LIMITS.bibAuthors) throw new NotebookValidationError(`Os autores podem ter até ${NOTEBOOK_LIMITS.bibAuthors} caracteres.`);
  if (!BIB_KINDS.includes(f.kind)) throw new NotebookValidationError('Escolha o tipo do livro.');
  const urlIssue = bibUrlIssue(url);
  if (urlIssue) throw new NotebookValidationError(urlIssue);
  if (note.length > NOTEBOOK_LIMITS.bibNote) throw new NotebookValidationError(`A observação pode ter até ${NOTEBOOK_LIMITS.bibNote} caracteres.`);
  return { title, ...(authors ? { authors } : {}), kind: f.kind, ...(url ? { url } : {}), ...(note ? { note } : {}) };
}

/** "Adicionar livro": a new book at the end of the bibliography. */
export async function addBook(journeyId: ID, fields: BookFields): Promise<BibItem> {
  const book = cleanBook(fields);
  let problem: string | undefined;
  await changeNotebook(journeyId, (nb) => {
    if (nb.bibliography.some((b) => bibKey(b.title) === bibKey(book.title))) { problem = 'Esse livro já está na bibliografia.'; return undefined; }
    if (nb.bibliography.length >= NOTEBOOK_LIMITS.bibliography) { problem = `A bibliografia já tem ${NOTEBOOK_LIMITS.bibliography} livros.`; return undefined; }
    return { bibliography: [...nb.bibliography, book] };
  });
  if (problem) throw new NotebookValidationError(problem);
  return book;
}

/** A book from a proposal, merged by title: 'full' when it is new and the bibliography already has 40 books. */
export async function mergeBook(journeyId: ID, fields: BookFields): Promise<WriteResult | 'full'> {
  const book = cleanBook(fields);
  let result: WriteResult | 'full' = 'existed';
  await changeNotebook(journeyId, (nb) => {
    const r = mergeBib(nb.bibliography, book);
    result = r.result;
    return r.result === 'applied' ? { bibliography: r.bibliography } : undefined;
  });
  return result;
}

/** "Apagar" of a book: returns it and its place, for "Desfazer". */
export async function removeBook(journeyId: ID, title: string): Promise<{ book: BibItem; index: number } | undefined> {
  let removed: { book: BibItem; index: number } | undefined;
  await changeNotebook(journeyId, (nb) => {
    const index = nb.bibliography.findIndex((b) => bibKey(b.title) === bibKey(title));
    if (index < 0) return undefined;
    removed = { book: nb.bibliography[index]!, index };
    return { bibliography: nb.bibliography.filter((_, i) => i !== index) };
  });
  return removed;
}

/**
 * "Desfazer": the book back in its place. Nothing is written when a book with that title is already there
 * ('existed') or when the bibliography filled up to 40 in the meantime ('full': the caller says so).
 */
export async function restoreBook(journeyId: ID, book: BibItem, index: number): Promise<'restored' | 'existed' | 'full'> {
  let result: 'restored' | 'existed' | 'full' = 'restored';
  await changeNotebook(journeyId, (nb) => {
    if (nb.bibliography.some((b) => bibKey(b.title) === bibKey(book.title))) { result = 'existed'; return undefined; }
    if (nb.bibliography.length >= NOTEBOOK_LIMITS.bibliography) { result = 'full'; return undefined; }
    const list = [...nb.bibliography];
    list.splice(Math.min(index, list.length), 0, book);
    return { bibliography: list };
  });
  return result;
}

/**
 * An apostila from a proposal: the same title in the subject with the same text "already existed"; with another text,
 * the text is replaced; otherwise it is created with `source`.
 */
export async function saveStudyDoc(journeyId: ID, title: string, markdown: string, source: string): Promise<WriteResult> {
  await liveSubject(journeyId);
  const t = title.trim();
  if (t === '' || t.length > NOTEBOOK_LIMITS.docTitle) throw new NotebookValidationError('Dê um título à apostila.');
  if (markdown.trim() === '') throw new NotebookValidationError('A apostila está vazia.');
  if (markdown.length > NOTEBOOK_LIMITS.docMarkdown) {
    throw new NotebookValidationError(`A apostila pode ter até ${thousands(NOTEBOOK_LIMITS.docMarkdown)} caracteres.`);
  }
  return withLock(`docs:${journeyId}`, async () => {
    const own = (await db.studyDocs.where('journeyId').equals(journeyId).toArray()).filter((d) => !d.deleted);
    const same = own.find((d) => bibKey(d.title) === bibKey(t));
    if (same) {
      if (same.markdown === markdown) return 'existed';
      await patch<StudyDoc>('studyDocs', same.id, { markdown });
      return 'applied';
    }
    await put('studyDocs', newRecord<StudyDoc>({ journeyId, title: t, markdown, source }));
    return 'applied';
  });
}

/** "Apagar apostila": a soft delete (undefined when it was already gone). */
export async function deleteStudyDoc(id: ID): Promise<StudyDoc | undefined> {
  const prev = await db.studyDocs.get(id);
  if (!prev || prev.deleted) return undefined;
  return patch<StudyDoc>('studyDocs', id, { deleted: true });
}

/** "Desfazer". */
export async function restoreStudyDoc(id: ID): Promise<void> {
  await patch<StudyDoc>('studyDocs', id, { deleted: false });
}

/** The study profile ("Editar" in Matérias or a proposal): the text replaces the current one; empty removes it. */
export async function setStudyProfile(text: string): Promise<WriteResult> {
  const t = text.trim();
  if (t.length > NOTEBOOK_LIMITS.studyProfile) {
    throw new NotebookValidationError(`O perfil de estudo pode ter até ${thousands(NOTEBOOK_LIMITS.studyProfile)} caracteres.`);
  }
  const me = await db.profile.get('me');
  if (!me || me.deleted) throw new Error('profile missing');
  let wrote = false;
  await mutate<Profile>('profile', 'me', (p) => {
    if ((p.studyProfile ?? '') === t) return undefined;
    wrote = true;
    return { studyProfile: t === '' ? undefined : t };
  });
  return wrote ? 'applied' : 'existed';
}
