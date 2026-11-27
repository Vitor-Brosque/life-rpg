import { describe, expect, it } from 'vitest';
import type { BlockSession } from '../src/types';
import { addDays, weekdayOf } from '../src/dates';
import { blockHabits, habitAnchor, watchNotice, watchNotices, type BlockHabit, type WeekTally } from '../src/watch';
import { atypicalWeek, block, emptyData, session } from './patternFixture';

const tallies = (started: number[], planned: number | number[] = 5): WeekTally[] => started.map((s, i) => ({
  week: addDays('2026-09-28', 7 * i), started: s, planned: Array.isArray(planned) ? planned[i]! : planned,
}));
const habit = (weeks: WeekTally[], activeBefore = false): BlockHabit => ({
  key: 'block:tech', name: 'Tech', minimumMin: 40, weeks, activeBefore,
});

describe('habitAnchor', () => {
  it('the first week with a start; 3 weeks without restart it, 2 do not', () => {
    expect(habitAnchor(tallies([0, 2, 3, 0, 1]))).toBe(1);
    expect(habitAnchor(tallies([2, 0, 0, 0, 3, 1]))).toBe(4);
    expect(habitAnchor(tallies([2, 0, 0, 3]))).toBe(0);
    expect(habitAnchor(tallies([0, 0]))).toBeUndefined();
  });
  it('already active before the list: only a restart after a pause counts', () => {
    expect(habitAnchor(tallies([2, 3]), true)).toBeUndefined();
    expect(habitAnchor(tallies([2, 0, 0, 0, 1]), true)).toBe(4);
  });
});

describe('watchNotice', () => {
  it('week 5: the 5th week alone against weeks 1–4', () => {
    expect(watchNotice(habit(tallies([4, 4, 3, 4, 2])))).toEqual({
      key: 'block:tech:2026-09-28', habitKey: 'block:tech', name: 'Tech', minimumMin: 40,
      anchor: '2026-09-28', weekNumber: 5,
      base: { started: 15, planned: 20 }, recent: { started: 2, planned: 5, weeks: 1 },
    });
  });
  it('weeks 6–8 use the last 2 weeks; nothing in week 4 or 9', () => {
    expect(watchNotice(habit(tallies([4, 4, 3, 4])))).toBeUndefined();
    expect(watchNotice(habit(tallies([4, 4, 3, 4, 4, 4, 1, 1])))).toMatchObject({
      weekNumber: 8, recent: { started: 2, planned: 10, weeks: 2 },
    });
    expect(watchNotice(habit(tallies([4, 4, 3, 4, 4, 4, 4, 1, 1])))).toBeUndefined();
  });
  it('counts weeks from the anchor', () => {
    expect(watchNotice(habit(tallies([0, 0, 4, 4, 3, 4, 2])))).toMatchObject({ anchor: '2026-10-12', weekNumber: 5 });
  });
  it('relative drop: 28% no, 30% yes', () => {
    const weeks = (s5: number) => tallies([6, 6, 6, 6, s5], [10, 10, 10, 10, 100]);
    expect(watchNotice(habit(weeks(43)))).toBeUndefined();
    expect(watchNotice(habit(weeks(42)))).toMatchObject({ weekNumber: 5 });
  });
  it('drop in points: 14 no, 15 yes', () => {
    const weeks = (s5: number) => tallies([3, 3, 3, 3, s5], [10, 10, 10, 10, 100]);
    expect(watchNotice(habit(weeks(16)))).toBeUndefined();
    expect(watchNotice(habit(weeks(15)))).toMatchObject({ weekNumber: 5 });
  });
  it('minimum samples: 8 planned and 4 started in weeks 1–4, 5 planned in the recent weeks', () => {
    expect(watchNotice(habit(tallies([2, 2, 2, 1, 0], [2, 2, 2, 1, 5])))).toBeUndefined();
    expect(watchNotice(habit(tallies([1, 1, 1, 0, 0])))).toBeUndefined();
    expect(watchNotice(habit(tallies([4, 4, 4, 4, 0], [5, 5, 5, 5, 4])))).toBeUndefined();
    expect(watchNotice(habit(tallies([4, 4, 4, 4, 0], [5, 5, 5, 5, 5])))).toMatchObject({ weekNumber: 5 });
  });
});

describe('blockHabits and watchNotices', () => {
  // "Tech" Mon–Wed and "tech " Thu–Fri are one habit (same name). Fully started in weeks 1–4
  // (28/09–25/10), then only Monday and Tuesday in weeks 5–6 (26/10–08/11).
  const blocks = [
    block({ id: 'b1', name: 'Tech', weekdays: [1, 2, 3], minimumMin: 40 }),
    block({ id: 'b2', name: 'tech ', weekdays: [4, 5], targetStart: '14:00' }),
    block({ id: 'old', name: 'Velho', archived: true, targetStart: '17:00' }),
    block({ id: 'r', name: 'Início do dia', kind: 'routine', targetStart: '08:00', durationMin: 30, minimumMin: 15 }),
  ];
  const sessions: BlockSession[] = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays('2026-09-28', i);
    const wd = weekdayOf(d);
    if (wd === 0 || wd === 6) continue;
    const id = wd <= 3 ? 'b1' : 'b2';
    if (i < 28 || wd === 1 || wd === 2) sessions.push(session(id, d, id === 'b1' ? '09:00' : '14:00'));
    if (i < 7) sessions.push(session('old', d, '17:00'));
  }
  const data = emptyData({ blocks, sessions });

  it('groups by name, skips archived groups, counts whole weeks only', () => {
    const habits = blockHabits(data);
    expect(habits.map((h) => [h.key, h.name, h.minimumMin, h.weeks.length, h.activeBefore])).toEqual([
      ['block:tech', 'Tech', 40, 6, false],
    ]);
    expect(habits[0]!.weeks.map((w) => [w.started, w.planned])).toEqual([[5, 5], [5, 5], [5, 5], [5, 5], [2, 5], [2, 5]]);
  });
  it('the notice, and nothing once dismissed', () => {
    expect(watchNotices(data)).toEqual([{
      key: 'block:tech:2026-09-28', habitKey: 'block:tech', name: 'Tech', minimumMin: 40, anchor: '2026-09-28',
      weekNumber: 6, base: { started: 20, planned: 20 }, recent: { started: 4, planned: 10, weeks: 2 },
    }]);
    expect(watchNotices({ ...data, watchDismissed: ['block:tech:2026-09-28'] })).toEqual([]);
  });
  it('a start older than 52 weeks marks the habit as active before the window', () => {
    const habits = blockHabits({ ...data, sessions: [...sessions, session('b1', '2025-09-01')] });
    expect(habits[0]).toMatchObject({ activeBefore: true });
    expect(habits[0]!.weeks).toHaveLength(52);
    expect(habits[0]!.weeks[0]!.week).toBe('2025-11-10');
  });
  it('no started session: no habits', () => {
    expect(blockHabits(emptyData({ blocks }))).toEqual([]);
  });
});

describe('semana atípica (P3)', () => {
  const flag = (weeks: WeekTally[], at: number[]): WeekTally[] => weeks.map((w, i) => (at.includes(i) ? { ...w, atypical: true } : w));
  it('an atypical week is skipped: it neither shifts the anchor nor counts as a drop', () => {
    // Weeks 1–4 good, then an atypical week with nothing started, then week 5 still fine: no notice.
    expect(watchNotice(habit(flag(tallies([4, 4, 3, 4, 0, 4]), [4])))).toBeUndefined();
    // Without the flag the zero week would be the 5th and trigger a notice.
    expect(watchNotice(habit(tallies([4, 4, 3, 4, 0])))).toBeDefined();
  });
  it('the week number and the recent window skip atypical weeks', () => {
    const n = watchNotice(habit(flag(tallies([4, 4, 3, 4, 0, 2]), [4])));
    expect(n).toMatchObject({ weekNumber: 5, anchor: '2026-09-28', recent: { started: 2, planned: 5, weeks: 1 } });
  });
  it('an atypical first week does not become the anchor, and atypical weeks do not count as a gap', () => {
    expect(habitAnchor(flag(tallies([2, 0, 3]), [0]))).toBe(2);
    expect(habitAnchor(flag(tallies([2, 0, 0, 0, 3]), [1, 2, 3]))).toBe(0);
  });
  it('blockHabits marks the atypical weeks', () => {
    const d = emptyData({
      blocks: [block({ id: 'b1', name: 'Tech' })],
      sessions: [session('b1', '2026-10-26'), session('b1', '2026-11-02')],
      weeks: [atypicalWeek('2026-11-02')],
    });
    const h = blockHabits(d)[0]!;
    expect(h.weeks.map((w) => [w.week, !!w.atypical])).toEqual([['2026-10-26', false], ['2026-11-02', true]]);
  });
});
