import { useCallback, useEffect, useRef, useState } from 'react';
import type { ID } from '@life/shared';
import { DIARY_SAVE_MS, purgeDiaryEntry, saveDiaryEntry, type DiaryDraft } from '../../domain/diaryActions';
import { safeRun } from '../../ui/safeRun';
import { usePageHide } from '../../ui/usePageHide';
import { clearDiaryDraft, writeDiaryDraft } from './diaryDraft';

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
}

/**
 * The editor's draft of entry `id` and when it is written (spec decision 2). Nothing is written while the
 * text is only spaces. Leaving the editor saves what is pending; an entry born in this editor (`isNew`) and
 * emptied before leaving is deleted (it never existed). A `restored` draft (kept while the app was in the
 * background) is saved after the usual pause. Hiding the page keeps the draft locally and saves it.
 */
export function useDiaryAutosave(id: ID, initial: DiaryDraft, isNew: boolean, restored: boolean): DiaryAutosave {
  const [draft, setDraft] = useState(initial);
  const [savedAt, setSavedAt] = useState<number>();
  const draftRef = useRef(initial);
  const dirty = useRef(restored);
  const unsavedRestore = useRef(restored);
  const gone = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const d = draftRef.current;
    if (!dirty.current || gone.current || !d.text.trim()) return;
    dirty.current = false;
    let saved;
    try {
      saved = await saveDiaryEntry(id, d, { edited: !isNew });
    } catch (e) {
      dirty.current = true; // the next pause or leaving tries again
      throw e;
    }
    if (saved) setSavedAt(saved.updatedAt);
    if (unsavedRestore.current) {
      // The kept draft is forgotten only once its text is in the database.
      unsavedRestore.current = false;
      clearDiaryDraft(id);
    }
  }, [id, isNew]);

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
    writeDiaryDraft(id, draftRef.current);
    safeRun(flush());
  });

  useEffect(() => {
    // A draft that was not restored is stale; a restored one is cleared after it is saved (see flush).
    if (!unsavedRestore.current) clearDiaryDraft(id);
    const onVisible = () => { if (document.visibilityState === 'visible' && !dirty.current) clearDiaryDraft(id); };
    document.addEventListener('visibilitychange', onVisible);
    if (dirty.current) schedule(DIARY_SAVE_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(timer.current);
      if (gone.current) return;
      if (draftRef.current.text.trim()) safeRun(flush());
      else if (isNew) safeRun(purgeDiaryEntry(id));
    };
  }, [id, isNew, flush, schedule]);

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
  };
}
