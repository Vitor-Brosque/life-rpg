import { useEffect, useState } from 'react';
import type { DiaryLink, DiaryTheme, ID } from '@life/shared';
import { diaryClock, isValidDayKey } from '@life/shared';
import type { DiaryDraft } from '../../domain/diaryActions';

// Text of the editor kept on this device when it could not reach the database yet: the app went to the
// background with unsaved changes (an update reload or iOS closing the app would lose them), or a save failed.
// One draft per entry. Each remembers the updatedAt of the record it was based on (`base`, absent when the
// entry was never saved), so a draft is never restored over a record changed since (another device, "Como
// foi hoje?"): the editor asks instead.

const PREFIX = 'life-rpg.diary.draft.';
const CHANGED = 'life-rpg:diary-drafts';

export interface KeptDiaryDraft {
  id: ID;
  draft: DiaryDraft;
  /** updatedAt of the record the draft was based on; absent for an entry never saved. */
  base?: number;
  /** When the draft was kept. */
  keptAt: number;
}

const changed = (): void => {
  try { window.dispatchEvent(new Event(CHANGED)); } catch { /* no window */ }
};

/** Keeps the draft of entry `id` (based on the record version `base`) when its text has more than spaces; otherwise forgets it. */
export function writeDiaryDraft(id: ID, draft: DiaryDraft, base?: number): void {
  if (!draft.text.trim()) {
    clearDiaryDraft(id);
    return;
  }
  try {
    localStorage.setItem(PREFIX + id, JSON.stringify({ id, ...draft, ...(base !== undefined ? { base } : {}), keptAt: Date.now() }));
  } catch { /* storage may be unavailable */ }
  changed();
}

function parse(raw: string | null, id: ID): KeptDiaryDraft | undefined {
  if (!raw) return undefined;
  try {
    const d = JSON.parse(raw) as Partial<DiaryDraft> & { id?: unknown; base?: unknown; keptAt?: unknown };
    if (d.id !== id || typeof d.text !== 'string' || !d.text.trim() || typeof d.day !== 'string' || !isValidDayKey(d.day)
      || typeof d.at !== 'number' || !Array.isArray(d.themes) || !Array.isArray(d.links) || typeof d.private !== 'boolean'
      || typeof d.keptAt !== 'number' || (d.base !== undefined && typeof d.base !== 'number')) return undefined;
    return {
      id,
      draft: { text: d.text, day: d.day, at: d.at, themes: d.themes as DiaryTheme[], links: d.links as DiaryLink[], private: d.private },
      ...(typeof d.base === 'number' ? { base: d.base } : {}),
      keptAt: d.keptAt,
    };
  } catch {
    return undefined;
  }
}

/** The kept draft of entry `id`, when there is a well-formed one. */
export function readDiaryDraft(id: ID): KeptDiaryDraft | undefined {
  try {
    return parse(localStorage.getItem(PREFIX + id), id);
  } catch {
    return undefined;
  }
}

/** Every well-formed kept draft, the most recently kept first. */
export function listDiaryDrafts(): KeptDiaryDraft[] {
  const out: KeptDiaryDraft[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const kept = readDiaryDraft(key.slice(PREFIX.length));
      if (kept) out.push(kept);
    }
  } catch { /* storage may be unavailable */ }
  return out.sort((a, b) => b.keptAt - a.keptAt);
}

/** Forgets the kept draft of entry `id`. */
export function clearDiaryDraft(id: ID): void {
  try {
    if (localStorage.getItem(PREFIX + id) === null) return;
    localStorage.removeItem(PREFIX + id);
  } catch { return; /* storage may be unavailable */ }
  changed();
}

/** The kept drafts, read again whenever one is kept or forgotten here. */
export function useDiaryDrafts(): KeptDiaryDraft[] {
  const [drafts, setDrafts] = useState(listDiaryDrafts);
  useEffect(() => {
    const reread = () => setDrafts(listDiaryDrafts());
    window.addEventListener(CHANGED, reread);
    window.addEventListener('storage', reread);
    reread(); // one kept between the first render and now
    return () => {
      window.removeEventListener(CHANGED, reread);
      window.removeEventListener('storage', reread);
    };
  }, []);
  return drafts;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
/** "11/11 21:30": when a draft was kept. */
export function keptStamp(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${diaryClock(ts)}`;
}
