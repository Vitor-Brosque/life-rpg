import type { ID, Journey, Note, StudyFile, StudyFileProgress } from '@life/shared';
import { STUDY_FILE_LIMITS, encodePdfText, isStudyFileMedia, mediaRefs, pagesHaveText, recallFront } from '@life/shared';
import { db } from '../db/db';
import {
  MediaInputError, discardMedia, hashBytes, removeLocalMedia, requeueMedia, storeMedia, type RemoveLocalResult,
} from '../db/media';
import { getMeta, mutate, newRecord, patch, put, upsert } from '../db/repo';
import { mediaServerState, type ServerMediaState } from '../sync/media';
import { findSubjectDeck, saveNote, subjectDeck } from './studyActions';

// PDFs da aula (spec 2026-11-26, fase 2): the PDFs of Materiais and of each subject. The PDF and its extracted text are
// media files (stored here, queued for the PC); the StudyFile record syncs like any other, and where she stopped is a
// record of its own (StudyFileProgress). A local copy leaves this device only after the PC confirms it holds the file.
// Reading gives no XP. Every write goes through the repo.

/** Something the person can act on: the message is shown as is. */
export class StudyFileError extends Error {}

export const STUDY_FILE_MESSAGES = {
  empty: 'O arquivo está vazio.',
  notPdf: 'Este arquivo não é um PDF.',
  tooBig: 'Este PDF passa de 50 MB.',
  password: 'Este PDF está protegido por senha. Tire a senha e adicione de novo.',
  unreadable: 'Não foi possível ler este PDF.',
  duplicate: 'Este PDF já está aqui.',
  subject: 'Escolha a disciplina.',
  notUploaded: 'Este PDF ainda não foi enviado ao PC. Abra o app com o PC ligado antes de tirar.',
  noPoints: 'Escreva ao menos um ponto, um por linha.',
  noSubject: 'Este PDF não está numa disciplina.',
} as const;

/** The deck option of "Criar card desta página" that creates the subject's deck when it has none yet. */
export const NEW_SUBJECT_DECK = 'nova-disciplina';

/**
 * "Apagar" keeps a PDF's bytes on this device this long, for "Desfazer" (the toast lasts 4 s; a minute leaves room),
 * before freeUnusedPdfCopies may free them.
 */
export const UNUSED_PDF_GRACE_MS = 60_000;

const isLiveSubject = (j: Journey | undefined): j is Journey => !!j && !j.deleted && j.subject === true;

async function liveSubject(journeyId: ID): Promise<Journey> {
  const j = await db.journeys.get(journeyId);
  if (!isLiveSubject(j)) throw new StudyFileError(STUDY_FILE_MESSAGES.subject);
  return j;
}

async function liveFile(id: ID): Promise<StudyFile> {
  const f = await db.studyFiles.get(id);
  if (!f || f.deleted) throw new StudyFileError('PDF não encontrado.');
  return f;
}

const cleanTitle = (title: string): string => title.replace(/\s+/g, ' ').trim().slice(0, STUDY_FILE_LIMITS.title).trim() || 'PDF';

/**
 * Keeps `bytes` (hash already known) and records in `created` when this call stored them. Bytes already on this device
 * (the same PDF in another subject, or kept before) keep their queue state: they are not queued for a second upload.
 */
async function keep(bytes: Uint8Array, hash: string, created: string[]): Promise<void> {
  try {
    const here = !!(await db.mediaInfo.get(hash));
    if ((await storeMedia(bytes, { upload: !here, knownHash: hash })).created) created.push(hash);
  } catch (e) {
    if (e instanceof MediaInputError) throw new StudyFileError(e.message);
    throw e;
  }
}

export interface NewStudyFile {
  /** The PDF's bytes (already checked: signature and size). */
  bytes: Uint8Array;
  pages: number;
  /** The text of each page, from PDF.js on this device. */
  texts: readonly string[];
  title: string;
  journeyId?: ID;
}

/**
 * "Adicionar PDF": the PDF is hashed first, so the same PDF twice in the same place is refused before anything is stored
 * or queued. Then the PDF and, when it has text, its extracted text are kept as media (queued for the PC) and the record
 * is written; if any step fails, the media this call just stored are removed. A PDF without text (scanned) gets
 * `hasText: false`.
 */
export async function createStudyFile(input: NewStudyFile): Promise<StudyFile> {
  if (input.journeyId) await liveSubject(input.journeyId);
  const fileHash = await hashBytes(input.bytes);
  const same = (await db.studyFiles.toArray())
    .some((f) => !f.deleted && f.fileHash === fileHash && (f.journeyId ?? '') === (input.journeyId ?? ''));
  if (same) throw new StudyFileError(STUDY_FILE_MESSAGES.duplicate);
  const hasText = pagesHaveText(input.texts);
  const encoded = hasText ? encodePdfText(input.texts) : undefined;
  const textHash = encoded ? await hashBytes(encoded.bytes) : undefined;
  const created: string[] = [];
  try {
    await keep(input.bytes, fileHash, created);
    if (encoded && textHash) await keep(encoded.bytes, textHash, created);
    return await put('studyFiles', newRecord<StudyFile>({
      title: cleanTitle(input.title), fileHash, bytes: input.bytes.byteLength, pages: input.pages, hasText,
      ...(input.journeyId ? { journeyId: input.journeyId } : {}),
      ...(encoded && textHash ? { textHash, textChars: encoded.chars } : {}),
    }));
  } catch (e) {
    // Nothing points to what was just stored: a failed "Adicionar PDF" leaves no 50 MB behind, nor a queued upload.
    for (const h of created) await discardMedia(h).catch(() => {});
    throw e;
  }
}

/** "Apagar": a soft delete (undefined when it was already gone). The media stay for "Desfazer" and other records. */
export async function deleteStudyFile(id: ID): Promise<StudyFile | undefined> {
  const prev = await db.studyFiles.get(id);
  if (!prev || prev.deleted) return undefined;
  return patch<StudyFile>('studyFiles', id, { deleted: true });
}

/** "Desfazer". */
export async function restoreStudyFile(id: ID): Promise<void> {
  await patch<StudyFile>('studyFiles', id, { deleted: false });
}

/** Moves a PDF to a subject, or to "Sem disciplina" with undefined. */
export async function setStudyFileSubject(id: ID, journeyId: ID | undefined): Promise<void> {
  if (journeyId) await liveSubject(journeyId);
  await mutate<StudyFile>('studyFiles', id, (f) => ((f.journeyId ?? undefined) === journeyId ? undefined : { journeyId }));
}

/**
 * The reader's writes, to the PDF's progress record (never to the StudyFile, so a move or "Apagar" on another device is
 * not undone): `page`, where she stopped (at most every 5 s and when it closes), and `readAt`, when she last read for
 * real (contact with the subject). Nothing for a PDF deleted meanwhile.
 */
export async function saveReadingProgress(id: ID, p: { page?: number; readAt?: number }): Promise<void> {
  const file = await db.studyFiles.get(id);
  if (!file || file.deleted) return;
  const changes: Partial<StudyFileProgress> = {};
  if (p.page !== undefined) changes.lastPage = Math.max(1, Math.min(file.pages, Math.round(p.page)));
  if (p.readAt !== undefined) changes.lastReadAt = p.readAt;
  if (Object.keys(changes).length === 0) return;
  await upsert<StudyFileProgress>('studyFileProgress', id, changes, {});
}

/** HEAD on the PC; a 404 (the PC answered that it lacks the file) puts the file kept here back in the upload queue. */
async function askServer(hash: string, token: string): Promise<ServerMediaState> {
  const state = await mediaServerState(hash, token);
  if (state === 'missing') await requeueMedia(hash);
  return state;
}

/**
 * "Tirar deste aparelho": deletes this device's copy of the PDF, never the only one. The PC must answer that it holds
 * the file (HEAD): while it waits in the queue, without an access code, offline, or when the PC lacks it, it refuses with
 * the reason; a PC that lacks it (refused upload, restored backup) gets it queued again. The queue is checked once more
 * inside the delete. The text goes by the same rule, and stays here otherwise.
 */
export async function removeLocalCopy(file: Pick<StudyFile, 'fileHash' | 'textHash'>): Promise<RemoveLocalResult> {
  const refuse = () => new StudyFileError(STUDY_FILE_MESSAGES.notUploaded);
  if (await db.mediaQueue.get(file.fileHash)) throw refuse();
  const token = await getMeta<string>('syncToken');
  if (!token) throw refuse();
  if ((await askServer(file.fileHash, token)) !== 'present') throw refuse();
  const r = await removeLocalMedia(file.fileHash);
  if (r === 'queued') throw refuse();
  const text = file.textHash;
  if (text && (await db.mediaInfo.get(text)) && !(await db.mediaQueue.get(text)) && (await askServer(text, token)) === 'present') {
    await removeLocalMedia(text);
  }
  return r;
}

let freeing: Promise<number> | undefined;
/** This session: when the PC last did not confirm an unused file (asked again after UNUSED_PDF_RETRY_MS). */
const unconfirmedAt = new Map<string, number>();
/** This session: unused files already queued again once (a PC that keeps refusing must not get 50 MB every round). */
const requeuedOnce = new Set<string>();
/** An unused file the PC did not confirm is asked about again after this long (each sync round otherwise). */
export const UNUSED_PDF_RETRY_MS = 10 * 60_000;

/** Tests only: forget what this session asked the PC about unused files. */
export function resetUnusedPdfState(): void {
  unconfirmedAt.clear();
  requeuedOnce.clear();
  freeing = undefined;
}

/**
 * Frees this device of the PDFs and extracted texts no live StudyFile uses (deleted ones, after the "Desfazer" window;
 * "Tirar deste aparelho" is gone with the row), only when the PC answers that it holds them; a 404 queues them again
 * (once per session). Never touches images or audio, anything a note references, or a file still queued (all checked
 * again inside the delete). Runs after a sync round, one run at a time; never throws. Resolves with how many files were
 * freed.
 */
export function freeUnusedPdfCopies(token: string): Promise<number> {
  freeing ??= (async () => {
    const unused = async (now: number): Promise<Set<string>> => {
      const keepHashes = new Set<string>();
      for (const f of await db.studyFiles.toArray()) {
        if (f.deleted && now - f.updatedAt >= UNUSED_PDF_GRACE_MS) continue;
        keepHashes.add(f.fileHash);
        if (f.textHash) keepHashes.add(f.textHash);
      }
      for (const h of mediaRefs((await db.notes.toArray()).flatMap((n) => [n.front, n.back, n.extra]))) keepHashes.add(h);
      const out = new Set<string>();
      await db.mediaInfo.each((m) => {
        if (isStudyFileMedia(m.type) && !keepHashes.has(m.hash) && now - m.addedAt >= UNUSED_PDF_GRACE_MS) out.add(m.hash);
      });
      for (const h of [...out]) if (await db.mediaQueue.get(h)) out.delete(h);
      return out;
    };
    try {
      const confirmed = new Set<string>();
      for (const h of await unused(Date.now())) {
        if (Date.now() - (unconfirmedAt.get(h) ?? -Infinity) < UNUSED_PDF_RETRY_MS) continue;
        const state = await mediaServerState(h, token);
        if (state === 'present') { confirmed.add(h); unconfirmedAt.delete(h); continue; }
        unconfirmedAt.set(h, Date.now());
        if (state === 'missing' && !requeuedOnce.has(h)) {
          requeuedOnce.add(h);
          await requeueMedia(h);
        }
      }
      if (confirmed.size === 0) return 0;
      let freed = 0;
      await db.transaction('rw', [db.mediaInfo, db.mediaData, db.mediaQueue, db.studyFiles, db.notes], async () => {
        const still = await unused(Date.now()); // a "Desfazer", a new PDF or a note since the check keeps the file
        for (const h of confirmed) {
          if (!still.has(h)) continue;
          await db.mediaInfo.delete(h);
          await db.mediaData.delete(h);
          freed += 1;
        }
      });
      return freed;
    } catch (e) {
      if ((e as { name?: string } | null)?.name !== 'DatabaseClosedError') console.warn('pdf: unused copies not freed', e);
      return 0;
    }
  })().finally(() => { freeing = undefined; });
  return freeing;
}

/**
 * The deck "Criar card desta página" starts with: the subject's deck, or the new-deck option when it has none; for a PDF
 * without subject, the first active deck; none when its subject was deleted (she picks one: any guess could be wrong).
 */
export async function defaultCardDeck(file: Pick<StudyFile, 'journeyId'>): Promise<string | undefined> {
  if (file.journeyId) {
    if (!isLiveSubject(await db.journeys.get(file.journeyId))) return undefined;
    const own = await findSubjectDeck(file.journeyId);
    return own?.id ?? NEW_SUBJECT_DECK;
  }
  return (await db.decks.toArray()).filter((d) => !d.deleted && !d.archived).sort((a, b) => a.order - b.order)[0]?.id;
}

/**
 * "Criar card desta página": a normal basic card (not a draft: she wrote it), with the page as its origin.
 * `deckId` NEW_SUBJECT_DECK creates the subject's deck. Invalid fields throw NoteValidationError.
 */
export async function createPageCard(input: { fileId: ID; page: number; front: string; back: string; deckId?: string }): Promise<Note> {
  const file = await liveFile(input.fileId);
  let deckId = input.deckId;
  if (deckId === NEW_SUBJECT_DECK) {
    if (!file.journeyId) throw new StudyFileError(STUDY_FILE_MESSAGES.noSubject);
    deckId = (await subjectDeck(await liveSubject(file.journeyId))).id;
  }
  return saveNote({
    type: 'basic', front: input.front, back: input.back, draft: false, source: { fileId: file.id, page: input.page },
    ...(deckId ? { deckId } : {}),
  });
}

/** The key points of the "Lembrar antes de sair" text: one per line, blank lines and list marks left out. */
export const recallPoints = (text: string): string[] =>
  text.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter((l) => l !== '');

/**
 * "Lembrar antes de sair": what she remembers, one point per line, becomes a topic card in the subject's deck with the
 * front "Título · p. 12–18" and the first page as its origin.
 */
export async function createRecallCard(input: { fileId: ID; from: number; to: number; text: string }): Promise<Note> {
  const file = await liveFile(input.fileId);
  if (!file.journeyId) throw new StudyFileError(STUDY_FILE_MESSAGES.noSubject);
  const points = recallPoints(input.text);
  if (points.length === 0) throw new StudyFileError(STUDY_FILE_MESSAGES.noPoints);
  const deck = await subjectDeck(await liveSubject(file.journeyId));
  return saveNote({
    type: 'topic', front: recallFront(file.title, input.from, input.to), back: points.join('\n'), draft: false, deckId: deck.id,
    source: { fileId: file.id, page: input.from },
  });
}
