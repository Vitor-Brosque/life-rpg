import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiaryKind, ID } from '@life/shared';
import { DIARY_SAVE_MS, purgeDiaryEntry, saveDiaryEntry, type DiaryDraft } from '../../domain/diaryActions';
import { safeRun } from '../../ui/safeRun';
import { usePageHide } from '../../ui/usePageHide';
import { clearDiaryDraft, writeDiaryDraft, type KeptDiaryDraft } from './diaryDraft';

/** How the editor opens an entry (decided once, when it opens). */
export interface DiaryStart {
  /** What the field starts with. */
  draft: DiaryDraft;
  /** No record yet: this session creates the entry. */
  isNew: boolean;
  /** The entry's kind, kept when a save has to create the record again (after "Apagar de vez" elsewhere). */
  kind: DiaryKind;
  /** updatedAt of the record the editor opened (absent when there is none). */
  base?: number;
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
 * emptied before leaving is deleted (it never existed). Unsaved changes are kept on this device (with the
 * updatedAt they are based on) when the page is hidden and when a save fails, and forgotten once saved.
 * A kept draft waiting for a choice (`conflict`) is never overwritten or forgotten without that choice.
 */
export function useDiaryAutosave(id: ID, start: DiaryStart): DiaryAutosave {
  const { isNew, kind } = start;
  const [draft, setDraft] = useState(start.draft);
  const [savedAt, setSavedAt] = useState<number>();
  const [conflict, setConflict] = useState(start.conflict);
  const draftRef = useRef(start.draft);
  const dirty = useRef(start.restored);
  const base = useRef(start.base);
  const kept = useRef(start.restored); // the stored draft of this entry is this editor's
  const waiting = useRef(start.conflict !== undefined);
  const gone = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const keep = useCallback(() => {
    if (waiting.current) return;
    writeDiaryDraft(id, draftRef.current, base.current);
    kept.current = true;
  }, [id]);

  const forget = useCallback(() => {
    if (waiting.current || !kept.current) return;
    kept.current = false;
    clearDiaryDraft(id);
  }, [id]);

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const d = draftRef.current;
    if (!dirty.current || gone.current || !d.text.trim()) return;
    dirty.current = false;
    let saved;
    try {
      saved = await saveDiaryEntry(id, d, { kind, edited: !isNew });
    } catch (e) {
      dirty.current = true; // the next pause or leaving tries again
      keep(); // meanwhile the text stays on this device (the Diário offers it back)
      throw e;
    }
    if (saved) {
      base.current = saved.updatedAt;
      setSavedAt(saved.updatedAt);
    }
    if (!dirty.current) forget(); // the kept text is in the database now
  }, [id, isNew, kind, keep, forget]);

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
    if (dirty.current) keep();
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
