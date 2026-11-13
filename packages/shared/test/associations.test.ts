import { describe, expect, it } from 'vitest';
import type { BlockSession, DayMode, DayState } from '../src/types';
import { addDays } from '../src/dates';
import { medianSplit, reviewMethods, sleepVsBlocks, sleepVsDayMode } from '../src/associations';
import { base, block, emptyData, night, review, session, TODAY } from './patternFixture';

// 14 workdays, 19/10 (Mon) to 05/11 (Thu); the night before each is dated the day before.
const DAYS = [
  '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23',
  '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30',
  '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05',
];
const SHORT = DAYS.slice(0, 7);   // 6 h nights
const nights = (minutes: (i: number) => number, days = DAYS) => days.map((d, i) => night(addDays(d, -1), '23:00', minutes(i)));

describe('medianSplit', () => {
  it('lower median; ties go to the low half', () => {
    const s = medianSplit([5, 1, 3, 3, 9].map((x) => ({ x, y: x })));
    expect(s.threshold).toBe(3);
    expect(s.low.map((p) => p.x)).toEqual([1, 3, 3]);
    expect(s.high.map((p) => p.x)).toEqual([5, 9]);
    expect(medianSplit([4, 1, 3, 2].map((x) => ({ x, y: 0 }))).threshold).toBe(2);
  });
});

describe('sleepVsBlocks', () => {
  const blocks = [block({ id: 'b1' }), block({ id: 'b2', kind: 'study', targetStart: '15:00', durationMin: 60 })];
  // b1 every day; b2 only after the long nights.
  const sessions: BlockSession[] = DAYS.flatMap((d) => (SHORT.includes(d) ? [session('b1', d)] : [session('b1', d), session('b2', d, '15:00')]));
  const sleepLogs = nights((i) => (i < 7 ? 360 : 480));
  const data = emptyData({ blocks, sessions, sleepLogs });

  it('averages of each half', () => {
    expect(sleepVsBlocks(data)).toEqual({
      pairs: 14, enough: true, thresholdMin: 360,
      shorter: { days: 7, started: 1, planned: 2 }, longer: { days: 7, started: 2, planned: 2 },
    });
  });
  it('13 pairs: not yet', () => {
    expect(sleepVsBlocks({ ...data, sleepLogs: sleepLogs.slice(1) })).toEqual({ pairs: 13, enough: false, reason: 'poucos' });
  });
  it('nights that barely vary: not comparable', () => {
    expect(sleepVsBlocks({ ...data, sleepLogs: nights(() => 420) })).toEqual({ pairs: 14, enough: false, reason: 'variacao' });
  });
  it('free days, incomplete nights and days outside the window are not pairs', () => {
    const free: DayState = { ...base, id: DAYS[0]!, hardDay: false, reviewDone: false, mode: 'free' };
    const extra = [night('2026-11-06', '23:00', 400), night('2026-08-01', '23:00', 400), night('2026-11-05', '23:00')];
    expect(sleepVsBlocks({ ...data, dayStates: [free], sleepLogs: [...sleepLogs, ...extra] }).pairs).toBe(13);
  });
});

describe('sleepVsDayMode', () => {
  const modes: DayMode[] = ['low', 'low', 'recovery', 'low', 'normal', 'normal', 'normal',
    'normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'recovery'];
  const dayStates: DayState[] = DAYS.map((d, i) => ({ ...base, id: d, hardDay: false, reviewDone: false, mode: modes[i] }));
  const data = emptyData({ dayStates, sleepLogs: nights((i) => (i < 7 ? 360 : 480)) });

  it('only days whose type was chosen; low energy or recovery per half', () => {
    expect(sleepVsDayMode(data)).toEqual({
      pairs: 14, enough: true, thresholdMin: 360, shorter: { days: 7, lowDays: 4 }, longer: { days: 7, lowDays: 1 },
    });
  });
  it('a day without a chosen type, or a free one, is not a pair', () => {
    const states = [...dayStates.slice(1), { ...dayStates[0]!, mode: 'free' as const }];
    expect(sleepVsDayMode({ ...data, dayStates: states }).pairs).toBe(13);
    expect(sleepVsDayMode({ ...data, dayStates: dayStates.slice(1) })).toEqual({ pairs: 13, enough: false, reason: 'poucos' });
  });
});

describe('reviewMethods', () => {
  const day = '2026-11-02';
  const many = (n: number, right: number, p = {}) => Array.from({ length: n }, (_, i) => review(day, i < right ? 3 : 1, p));
  const reviews = [
    ...many(30, 24),                                   // só pensou
    ...many(35, 30, { wrote: true }),
    ...many(10, 10, { wrote: true, drew: true }),      // counts in both
    ...many(5, 4, { spoke: true }),
    review(day, 3, {}, 'new'), review(TODAY, 3), review('2026-08-14', 3), review(day, 3, { deleted: true }),
  ];
  it('counts each method a review used; shows those with 30 or more', () => {
    const m = reviewMethods(emptyData({ reviews }));
    expect(m.all.map((r) => [r.method, r.reviews, r.correct])).toEqual([
      ['wrote', 45, 40], ['drew', 10, 10], ['spoke', 5, 4], ['none', 30, 24],
    ]);
    expect(m.rows.map((r) => r.method)).toEqual(['wrote', 'none']);
    expect(m.enough).toBe(true);
  });
  it('needs "só pensou" and another method with 30', () => {
    expect(reviewMethods(emptyData({ reviews: reviews.slice(1) })).enough).toBe(false);
  });
});
