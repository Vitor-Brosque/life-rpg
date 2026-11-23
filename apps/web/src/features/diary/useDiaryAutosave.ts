import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiaryEntry, DiaryKind, ID } from '@life/shared';
import {
  DIARY_SAVE_MS, NewerDiaryText, diaryDraftOf, purgeDiaryEntry, saveDiaryEntry, type DiaryBase, type DiaryDraft,
} from '../../domain/diaryActions';
import { safeRun } from '../../ui/safeRun';
import { usePageHide } from '../../ui/usePageHide';
import { clearDiaryDraft, readDiaryDraft, writeDiaryDraft, type KeptDiaryDraft } from './diaryDraft';

/** How the editor opens an entry (decided once, when it opens). */
export interface DiaryStart {
  /** What the field starts with. */
  draft: DiaryDraft;
  /** No record yet: this session creates the entry. */
  isNew: boolean;
  /** The entry's kind, kept when a save has to create the record again (after "Apagar de vez" elsewhere). */
  kind: DiaryKind;
  /** The version of the record the editor opened (`{ text: '' }` when there is none): saves never replace a newer text. */
  base: DiaryBase;
  /** `draft` is a kept draft brought back: saved after the usual pause, forgotten once saved. */
  restored: boolean;
  /** A kept draft of a record changed since: it waits for "Usar este texto" or "Descartar". */
  conflict?: KeptDiaryDraft;
}

export interface DiaryAutosave {
  draft: DiaryDraft;
  /** Typing: saved after a pause of DIARY_SAVE_MS. */
  type(text: string): void;
  /** Themes, links, private, date and time: saved right away (once the text has more than spaces). */
  change(fields: Partial<DiaryDraft>): void;
  /** updatedAt of the last save made here. */
  savedAt?: number;
  /** Saves what is pending now (before "Apagar"). */
  flush(): Promise<void>;
  /** The entry left the editor some other way ("Apagar"): leaving writes nothing more. */
  markGone(): void;
  /** The kept draft waiting for a choice, if any. */
  conflict?: KeptDiaryDraft;
  /** "Usar este texto": the kept text replaces the field and is saved. */
  takeKept(): void;
  /** "Descartar": the kept draft is forgotten. */
  dropKept(): void;
}

/**
 * The editor's draft of entry `id` and when it is written (spec decision 2). Nothing is written while the
 * text is only spaces. Leaving the editor saves what is pending; an entry born in this editor (`isNew`) and
 * emptied before leaving is deleted (it never existed). Unsaved changes, and a save still on its way, are
 * kept on this device (with the updatedAt they are based on) when the page is hidden and when a save fails,
 * and forgotten once that very text is saved. A save never replaces a newer text written elsewhere: his text
 * is kept instead and waits for a choice (`conflict`), with the newer text in the field. A kept draft waiting
 * for a choice is never overwritten or forgotten without that choice.
 */
export function useDiaryAutosave(id: ID, start: DiaryStart): DiaryAutosave {
  const { isNew, kind } = start;
  const [draft, setDraft] = useState(start.draft);
  const [savedAt, setSavedAt] = useState<number>();
  const [conflict, setConflict] = useState(start.conflict);
  const draftRef = useRef(start.draft);
  const dirty = useRef(start.restored);
  // The version the field is based on. saveDiaryEntry moves it as it saves; a newer text found elsewhere
  // replaces it with a new object, so saves queued before that are checked against the old one.
  const base = useRef<DiaryBase>({ ...start.base });
  const saving = useRef<DiaryDraft | undefined>(undefined); // the draft of the save on its way, if any
  const kept = useRef(start.restored); // the stored draft of this entry is this editor's
  const waiting = useRef(start.conflict !== undefined);
  const gone = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const keep = useCallback(() => {
    if (waiting.current) return;
    writeDiaryDraft(id, draftRef.current, base.current.updatedAt);
    kept.current = true;
  }, [id]);

  const forget = useCallback(() => {
    if (waiting.current || !kept.current) return;
    kept.current = false;
    clearDiaryDraft(id);
  }, [id]);

  /** A save found a newer text from elsewhere: his text stays on this device and waits for a choice; the field shows the newer one. */
  const newer = useCallback((live: DiaryEntry, from: DiaryBase, d: DiaryDraft) => {
    if (waiting.current) return; // a choice is already waiting; his text was kept then
    clearTimeout(timer.current);
    timer.current = undefined;
    dirty.current = false;
    const mine = draftRef.current.text.trim() ? draftRef.current : d;
    // Based on the version he wrote over, so opening the entry again asks too (never restored over the newer text).
    writeDiaryDraft(id, mine, from.updatedAt);
    kept.current = false;
    waiting.current = true;
    base.current = { updatedAt: live.updatedAt, text: live.text };
    const shown = diaryDraftOf(live);
    draftRef.current = shown;
    setDraft(shown);
    setConflict(readDiaryDraft(id) ?? { id, draft: mine, ...(from.updatedAt !== undefined ? { base: from.updatedAt } : {}), keptAt: Date.now() });
  }, [id]);

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const d = draftRef.current;
    if (!dirty.current || gone.current || !d.text.trim()) return;
    dirty.current = false;
    const from = base.current;
    saving.current = d;
    let saved;
    try {
      saved = await saveDiaryEntry(id, d, { kind, edited: !isNew, base: from });
    } catch (e) {
      if (e instanceof NewerDiaryText) {
        newer(e.entry, from, d);
        return;
      }
      dirty.current = true; // the next pause or leaving tries again
      keep(); // meanwhile the text stays on this device (the Diário offers it back)
      throw e;
    } finally {
      if (saving.current === d) saving.current = undefined;
    }
    if (saved) setSavedAt(saved.updatedAt);
    // The kept text is in the database now, unless it is newer than this save (typed while it was on its way).
    const stored = readDiaryDraft(id);
    if (!dirty.current && (!stored || stored.draft.text === d.text)) forget();
  }, [id, isNew, kind, keep, forget, newer]);

  const schedule = useCallback((ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => safeRun(flush()), ms);
  }, [flush]);

  const update = (fields: Partial<DiaryDraft>, now: boolean) => {
    const next = { ...draftRef.current, ...fields };
    draftRef.current = next;
    setDraft(next);
    dirty.current = true;
    if (now) safeRun(flush());
    else schedule(DIARY_SAVE_MS);
  };

  usePageHide(() => {
    // A save on its way is not saved yet: if the app is closed now, the kept text is all that is left.
    if (dirty.current || saving.current) keep();
    safeRun(flush());
  });

  useEffect(() => {
    // A kept draft neither brought back nor waiting for a choice adds nothing to the record.
    if (!kept.current && !waiting.current) clearDiaryDraft(id);
    if (dirty.current) schedule(DIARY_SAVE_MS);
    return () => {
      clearTimeout(timer.current);
      if (gone.current) return;
      if (draftRef.current.text.trim()) safeRun(flush());
      else {
        forget(); // he emptied the field: nothing to keep
        if (isNew) safeRun(purgeDiaryEntry(id));
      }
    };
  }, [id, isNew, flush, schedule, forget]);

  return {
    draft,
    type: (text) => update({ text }, false),
    change: (fields) => update(fields, true),
    savedAt,
    flush,
    markGone: () => {
      gone.current = true;
      clearTimeout(timer.current);
    },
    conflict,
    takeKept: () => {
      if (!conflict) return;
      waiting.current = false;
      kept.current = true; // forgotten once saved; kept again if that save fails
      setConflict(undefined);
      update({ text: conflict.draft.text }, true);
    },
    dropKept: () => {
      waiting.current = false;
      setConflict(undefined);
      clearDiaryDraft(id);
    },
  };
}
