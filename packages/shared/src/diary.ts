import type { DayKey, DayState, DiaryEntry, HHmm, ID } from './types';
import { timestampAt } from './dates';

// Diário (2026-11-16): free-text entries by logical day and time. Pure rules: the v10 migration of the
// day-close note, the weekly timeline, search, "Registrado pelo app" and the weekly Markdown export.
// The user's words are never changed: only trimmed at the ends in the export.

// ------------------------------------------------------------------ ids and the v10 migration

/** The time a migrated day-close note gets when its day has no `closedAt`. */
export const DIARY_CLOSE_TIME: HHmm = '22:00';
export const diaryCloseId = (day: DayKey): ID => `diary-close-${day}`;

/**
 * Dexie v10: the `fechamento` entry made from a day-close note, built from the DayState alone (same id, text
 * and timestamps on every device, so two devices that migrate write identical records). None for a
 * soft-deleted DayState or a missing/blank note.
 */
export function closeNoteEntry(
  state: Pick<DayState, 'id' | 'deleted' | 'updatedAt' | 'closedAt' | 'closeNote'>,
): DiaryEntry | undefined {
  const text = state.closeNote;
  if (state.deleted || typeof text !== 'string' || text.trim() === '') return undefined;
  return {
    id: diaryCloseId(state.id), createdAt: state.updatedAt, updatedAt: state.updatedAt, deleted: false,
    day: state.id, at: state.closedAt ?? timestampAt(state.id, DIARY_CLOSE_TIME),
    kind: 'fechamento', text, themes: [], links: [], private: false,
  };
}
