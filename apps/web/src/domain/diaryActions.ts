import type { DayKey, DiaryEntry, DiaryKind, DiaryLink, DiaryTheme, ID } from '@life/shared';
import { DIARY_LINKS_MAX, diaryCloseId, diaryTrashed, diaryVisible } from '@life/shared';
import { db } from '../db/db';
import { mutate, patchMany, upsert } from '../db/repo';
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

const lockOf = (id: ID): string => `diary-${id}`;
const hasText = (s: string): boolean => s.trim() !== '';
const EMPTIED: Partial<DiaryEntry> = { text: '', themes: [], links: [], deleted: true };

/**
 * Saves the editor's draft of entry `id` when its text has more than spaces (otherwise writes nothing and
 * resolves undefined): the first save creates the entry (kind `livre` unless told), later ones replace the
 * draft fields (LWW). `edited` stamps `editedAt` (an edit outside the session that created the entry).
 * Links beyond DIARY_LINKS_MAX are dropped.
 */
export const saveDiaryEntry = (
  id: ID, draft: DiaryDraft, opts: { kind?: DiaryKind; edited?: boolean } = {},
): Promise<DiaryEntry | undefined> => withLock(lockOf(id), async () => {
  if (!hasText(draft.text)) return undefined;
  const fields = {
    text: draft.text, day: draft.day, at: draft.at, themes: [...draft.themes],
    links: draft.links.slice(0, DIARY_LINKS_MAX).map((l) => ({ kind: l.kind, id: l.id })), private: draft.private,
  };
  return upsert<DiaryEntry>('diaryEntries', id, { ...fields, ...(opts.edited ? { editedAt: Date.now() } : {}) },
    { ...fields, kind: opts.kind ?? 'livre' });
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
 * "Apagar de vez" (and the entry born in the editor and emptied before leaving): text, themes and links go
 * and the record is marked deleted. Nothing for a missing or already deleted entry.
 */
export const purgeDiaryEntry = (id: ID): Promise<void> => withLock(lockOf(id), async () => {
  const e = await db.diaryEntries.get(id);
  if (e && !e.deleted) await mutate<DiaryEntry>('diaryEntries', id, () => EMPTIED);
});

/** "Esvaziar": every entry in "Apagadas recentemente" is deleted for good, in one transaction. Resolves with how many. */
export async function emptyDiaryTrash(): Promise<number> {
  const trashed = (await db.diaryEntries.toArray()).filter(diaryTrashed);
  await patchMany<DiaryEntry>('diaryEntries', trashed.map((e) => ({ id: e.id, changes: EMPTIED })));
  return trashed.length;
}

/**
 * The "Como foi hoje?" observation is the day's `fechamento` entry (id `diary-close-<day>`). A note with
 * more than spaces is written trimmed: created at `Date.now()` the first time (or revived when it had been
 * deleted), otherwise its text replaced (marking `editedAt`) and brought back from "Apagadas recentemente".
 * A blank note moves an existing visible entry to "Apagadas recentemente" (nothing is deleted for good).
 */
export const saveCloseNote = (day: DayKey, note: string): Promise<void> => withLock(lockOf(diaryCloseId(day)), async () => {
  const id = diaryCloseId(day);
  const prev = await db.diaryEntries.get(id);
  const text = note.trim();
  if (!text) {
    if (prev && diaryVisible(prev)) await mutate<DiaryEntry>('diaryEntries', id, () => ({ trashedAt: Date.now() }));
    return;
  }
  if (prev && !prev.deleted) {
    if (prev.text === text && prev.trashedAt === undefined) return;
    await mutate<DiaryEntry>('diaryEntries', id, () => ({ text, trashedAt: undefined, editedAt: Date.now() }));
    return;
  }
  await upsert<DiaryEntry>('diaryEntries', id, {}, {
    day, at: Date.now(), kind: 'fechamento', text, themes: [], links: [], private: false,
  });
});
