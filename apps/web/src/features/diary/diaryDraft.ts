import type { DiaryLink, DiaryTheme, ID } from '@life/shared';
import { isValidDayKey } from '@life/shared';
import type { DiaryDraft } from '../../domain/diaryActions';

// The editor's text kept on this device while the app is in the background (like the capture's draft), so an
// update reload or iOS closing the app does not lose what was typed in the last second. One entry at a time.

const KEY = 'life-rpg.diary.draft';

/** Kept only when the text has more than spaces (otherwise any kept draft of `id` is removed). */
export function writeDiaryDraft(id: ID, draft: DiaryDraft): void {
  try {
    if (draft.text.trim()) localStorage.setItem(KEY, JSON.stringify({ id, ...draft }));
    else clearDiaryDraft(id);
  } catch { /* storage may be unavailable */ }
}

/** The kept draft of entry `id`, when there is a well-formed one. */
export function readDiaryDraft(id: ID): DiaryDraft | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const d = JSON.parse(raw) as Partial<DiaryDraft> & { id?: unknown };
    if (d.id !== id || typeof d.text !== 'string' || !d.text.trim() || typeof d.day !== 'string' || !isValidDayKey(d.day)
      || typeof d.at !== 'number' || !Array.isArray(d.themes) || !Array.isArray(d.links) || typeof d.private !== 'boolean') return undefined;
    return {
      text: d.text, day: d.day, at: d.at, themes: d.themes as DiaryTheme[], links: d.links as DiaryLink[], private: d.private,
    };
  } catch {
    return undefined;
  }
}

/** Forgets the kept draft, only when it belongs to entry `id`. */
export function clearDiaryDraft(id: ID): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw && (JSON.parse(raw) as { id?: unknown }).id === id) localStorage.removeItem(KEY);
  } catch { /* storage may be unavailable or the value broken */ }
}
