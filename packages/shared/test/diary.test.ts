import { describe, expect, it } from 'vitest';
import type { DayState } from '../src/types';
import { closeNoteEntry, diaryCloseId } from '../src/diary';
import { base } from './patternFixture';

const at = (day: number, h: number, m = 0): number => new Date(2026, 10, day, h, m).getTime();

describe('closeNoteEntry (Dexie v10)', () => {
  const ds = (p: Partial<DayState>): DayState => ({ ...base, id: '2026-11-10', hardDay: false, reviewDone: false, ...p });
  it('builds the fechamento entry from the DayState alone: id, text, closedAt, timestamps = updatedAt', () => {
    expect(closeNoteEntry(ds({ closeNote: 'Dia corrido.', closedAt: at(10, 23, 5), updatedAt: at(10, 23, 6) }))).toEqual({
      id: 'diary-close-2026-11-10', createdAt: at(10, 23, 6), updatedAt: at(10, 23, 6), deleted: false,
      day: '2026-11-10', at: at(10, 23, 5), kind: 'fechamento', text: 'Dia corrido.', themes: [], links: [], private: false,
    });
  });
  it('without closedAt the moment is 22:00 of the day', () => {
    expect(closeNoteEntry(ds({ closeNote: 'x' }))!.at).toBe(at(10, 22));
  });
  it('nothing for a deleted DayState, a blank note or no note', () => {
    expect(closeNoteEntry(ds({ closeNote: 'x', deleted: true }))).toBeUndefined();
    expect(closeNoteEntry(ds({ closeNote: '   ' }))).toBeUndefined();
    expect(closeNoteEntry(ds({}))).toBeUndefined();
  });
  it('diaryCloseId', () => {
    expect(diaryCloseId('2026-11-10')).toBe('diary-close-2026-11-10');
  });
});
