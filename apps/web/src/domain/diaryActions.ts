import type { DayKey, DayState, DiaryEntry, DiaryKind, DiaryLink, DiaryTheme, ID } from '@life/shared';
import { DIARY_LINKS_MAX, diaryCloseId, diaryTrashed, diaryVisible } from '@life/shared';
import { db } from '../db/db';
import { mutate, newRecord, put, upsert } from '../db/repo';
import { withLock } from './common';

// Diário: every write of an entry. Nothing here gives XP. An entry exists only once its text has more than
// spaces. "Apagar" moves it to "Apagadas recentemente" (trashedAt); "Apagar de vez" empties it and marks it
// deleted, so the sync carries only the empty marker.

/** Pause in typing after which the editor saves. */
export const DIARY_SAVE_MS = 1000;

/** What the editor holds: the fields an entry's owner can change. */
export interface DiaryDraft {
  text: string;
  day: DayKey;
  at: number;
  themes: DiaryTheme[];
  links: DiaryLink[];
  private: boolean;
}

/** The key every write of entry `id` is queued on (withLock): waiting on it waits for the writes already queued. */
export const diaryLockKey = (id: ID): string => `diary-${id}`;
const lockOf = diaryLockKey;
const hasText = (s: string): boolean => s.trim() !== '';
const EMPTIED: Partial<DiaryEntry> = { text: '', themes: [], links: [], deleted: true };

/** The editor's fields of a stored entry. */
export const diaryDraftOf = (e: DiaryEntry): DiaryDraft =>
  ({ text: e.text, day: e.day, at: e.at, themes: e.themes, links: e.links, private: e.private });

/** The version of an entry an editor last saw or saved (no updatedAt: there was no record). */
export interface DiaryBase {
  updatedAt?: number;
  text: string;
}

/** A save refused because the entry now holds a newer text written elsewhere (another device, "Como foi hoje?"). */
export class NewerDiaryText extends Error {
  constructor(readonly entry: DiaryEntry) {
    super('the diary entry has a newer text');
    this.name = 'NewerDiaryText';
  }
}

/**
 * Saves the editor's draft of entry `id` when its text has more than spaces (otherwise writes nothing and
 * resolves undefined): the first save creates the entry (kind `livre` unless told), later ones replace the
 * draft fields (LWW). `edited` stamps `editedAt` (an edit outside the session that created the entry).
 * Links beyond DIARY_LINKS_MAX are dropped.
 *
 * With `base`, a copy left open never replaces a newer text: when the stored entry changed since `base` and
 * its text is neither `base.text` nor the draft's, nothing is written and the save rejects with
 * NewerDiaryText. A deleted entry is no text to lose (the save revives it). Checked and written in one
 * transaction under the entry's lock; after a save `base` moves to the version written, so saves queued
 * one after the other with the same `base` all go through.
 */
export const saveDiaryEntry = (
  id: ID, draft: DiaryDraft, opts: { kind?: DiaryKind; edited?: boolean; base?: DiaryBase } = {},
): Promise<DiaryEntry | undefined> => withLock(lockOf(id), async () => {
  if (!hasText(draft.text)) return undefined;
  const { base } = opts;
  const fields = {
    text: draft.text, day: draft.day, at: draft.at, themes: [...draft.themes],
    links: draft.links.slice(0, DIARY_LINKS_MAX).map((l) => ({ kind: l.kind, id: l.id })), private: draft.private,
  };
  let newer: DiaryEntry | undefined;
  const saved = await db.transaction('rw', db.diaryEntries, db.outbox, async () => {
    const live = await db.diaryEntries.get(id);
    if (base && live && !live.deleted && live.updatedAt !== base.updatedAt && live.text !== base.text && live.text !== draft.text) {
      newer = live;
      return undefined;
    }
    return upsert<DiaryEntry>('diaryEntries', id, { ...fields, ...(opts.edited ? { editedAt: Date.now() } : {}) },
      { ...fields, kind: opts.kind ?? 'livre' });
  });
  if (newer) throw new NewerDiaryText(newer);
  if (base && saved) {
    base.updatedAt = saved.updatedAt;
    base.text = saved.text;
  }
  return saved;
});

/** "Apagar": the entry goes to "Apagadas recentemente" (out of the timeline, the search and the exports). */
export const trashDiaryEntry = (id: ID): Promise<void> => withLock(lockOf(id), async () => {
  const e = await db.diaryEntries.get(id);
  if (e && diaryVisible(e)) await mutate<DiaryEntry>('diaryEntries', id, () => ({ trashedAt: Date.now() }));
});

/** "Restaurar": back to the timeline, as it was. */
export const restoreDiaryEntry = (id: ID): Promise<void> => withLock(lockOf(id), async () => {
  const e = await db.diaryEntries.get(id);
  if (e && diaryTrashed(e)) await mutate<DiaryEntry>('diaryEntries', id, () => ({ trashedAt: undefined }));
});

/**
 * An entry deleted for good takes the day's old DayState.closeNote with it (the note a `fechamento` was
 * migrated from, still on the server, other devices and JSON exports): for a `fechamento` whenever that day
 * has one, for any other entry when the note is its text (the trashed `livre` copy of a migrated note). One
 * LWW write through the outbox. Runs before the entry is emptied, so a failure leaves the entry in the trash
 * to retry.
 */
async function dropOldCloseNote(e: DiaryEntry): Promise<void> {
  const holds = (note: string | undefined): boolean =>
    note !== undefined && (e.kind === 'fechamento' || note.trim() === e.text.trim());
  const ds = await db.dayState.get(e.day);
  if (!holds(ds?.closeNote)) return;
  await mutate<DayState>('dayState', e.day, (prev) => (holds(prev.closeNote) ? { closeNote: undefined } : undefined));
}

/**
 * "Apagar de vez" (and the entry born in the editor and emptied before leaving): text, themes and links go
 * and the record is marked deleted. Nothing for a missing or already deleted entry.
 */
export const purgeDiaryEntry = (id: ID): Promise<void> => withLock(lockOf(id), async () => {
  const e = await db.diaryEntries.get(id);
  if (!e || e.deleted) return;
  await dropOldCloseNote(e);
  await mutate<DiaryEntry>('diaryEntries', id, () => EMPTIED);
});

/**
 * "Esvaziar": every entry in "Apagadas recentemente" is deleted for good. Each one is re-checked under its own
 * lock at write time, so an entry restored or re-saved meanwhile is left alone. `onDeleted` hears each id as
 * soon as its entry is emptied (even when another one then fails). Resolves with the ids deleted once every
 * entry was tried; rejects with the first failure.
 */
export async function emptyDiaryTrash(onDeleted?: (id: ID) => void): Promise<ID[]> {
  const ids = (await db.diaryEntries.toArray()).filter(diaryTrashed).map((e) => e.id);
  const results = await Promise.allSettled(ids.map((id) => withLock(lockOf(id), async () => {
    const e = await db.diaryEntries.get(id);
    if (!e || !diaryTrashed(e)) return undefined;
    await dropOldCloseNote(e);
    await mutate<DiaryEntry>('diaryEntries', id, () => EMPTIED);
    onDeleted?.(id);
    return id;
  })));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
  return results.flatMap((r) => (r.status === 'fulfilled' && r.value !== undefined ? [r.value] : []));
}

/**
 * Keeps the text of fechamento `prev` in "Apagadas recentemente" as a `livre` entry of the same day
 * (restorable). Its id comes from the version copied, so the copy made on two devices is one record; a copy
 * already there (in any state) is not written again.
 */
async function keepTrashedCopy(prev: DiaryEntry, trashedAt: number): Promise<void> {
  const id = `${prev.id}-copia-${prev.updatedAt}`;
  if (await db.diaryEntries.get(id)) return;
  await put('diaryEntries', newRecord<DiaryEntry>({
    id, day: prev.day, at: prev.at, kind: 'livre', text: prev.text, themes: [...prev.themes], links: prev.links.map((l) => ({ ...l })),
    private: prev.private, trashedAt,
  }));
}

/**
 * The "Como foi hoje?" observation is the day's `fechamento` entry (id `diary-close-<day>`). A note with
 * more than spaces is written trimmed: created at `Date.now()` the first time (or revived when it had been
 * deleted), otherwise its text replaced (marking `editedAt`). A fechamento in "Apagadas recentemente" with the
 * same text comes back; with a different text, that text is first kept there as a `livre` entry of the same
 * day (restorable), and the fechamento becomes the new note. A blank note moves an existing visible entry to
 * "Apagadas recentemente" (nothing is deleted for good).
 *
 * `shown` is the text the note was written over (the sheet's text when it opened): when the visible
 * fechamento changed since (another device, the diary) and is not already the note, that newer text is kept
 * the same way, in "Apagadas recentemente", before the note replaces it.
 */
export const saveCloseNote = (day: DayKey, note: string, opts: { shown?: string } = {}): Promise<void> => withLock(lockOf(diaryCloseId(day)), async () => {
  const id = diaryCloseId(day);
  const prev = await db.diaryEntries.get(id);
  const text = note.trim();
  if (!text) {
    if (prev && diaryVisible(prev)) await mutate<DiaryEntry>('diaryEntries', id, () => ({ trashedAt: Date.now() }));
    return;
  }
  if (opts.shown !== undefined && prev && diaryVisible(prev) && prev.text !== opts.shown && prev.text.trim() !== text) {
    await keepTrashedCopy(prev, Date.now());
  }
  if (prev && diaryTrashed(prev) && prev.text.trim() !== text) {
    await keepTrashedCopy(prev, prev.trashedAt ?? Date.now());
    await mutate<DiaryEntry>('diaryEntries', id, () => ({
      text, at: Date.now(), themes: [], links: [], private: false, trashedAt: undefined, editedAt: undefined,
    }));
    return;
  }
  if (prev && !prev.deleted) {
    if (prev.text.trim() === text && prev.trashedAt === undefined) return;
    await mutate<DiaryEntry>('diaryEntries', id, () => ({ text, trashedAt: undefined, editedAt: Date.now() }));
    return;
  }
  await upsert<DiaryEntry>('diaryEntries', id, {}, {
    day, at: Date.now(), kind: 'fechamento', text, themes: [], links: [], private: false,
  });
});
