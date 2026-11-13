import { describe, expect, it } from 'vitest';
import type { DayState } from '../src/types';
import { completedWeeks, weekPeriod } from '../src/periods';
import {
  checkinBreakdown, dayIndex, effortByArea, monthCardDue, monthObserved, monthReviewId, trendPoints,
} from '../src/trends';
import {
  TODAY, base, block, checkin, emptyData, mission, night, practice, review, session, workout, xp,
} from './patternFixture';

// Two whole weeks before Friday 2026-11-13: W1 = 26/10–01/11, W2 = 02/11–08/11 (Wed 04/11 free).
const freeWed: DayState = { ...base, id: '2026-11-04', hardDay: false, reviewDone: false, mode: 'free' };
const reviews = [
  ...Array.from({ length: 25 }, (_, i) => review('2026-10-27', i < 5 ? 1 : 3)),   // learned: 20 of 25 right
  ...Array.from({ length: 3 }, () => review('2026-10-27', 1, {}, 'new')),          // new cards: no accuracy
  ...Array.from({ length: 10 }, () => review('2026-11-03', 3)),
  review('2026-11-03', 1, { deleted: true }),
];
const data = emptyData({
  dayStates: [freeWed],
  blocks: [block({ id: 'b1', name: 'Tech' })],
  sessions: [
    session('b1', '2026-10-26'), session('b1', '2026-10-27'), session('b1', '2026-10-28', '09:00', 'minimum'),
    session('b1', '2026-11-02'), session('b1', '2026-11-05'),
  ],
  xpEvents: [
    xp('2026-10-26', { areaId: 'area-intelecto' }), xp('2026-10-27', { areaId: 'area-intelecto' }),
    xp('2026-10-31', { amount: 8, reason: 'complete', areaId: 'area-vigor' }),   // Saturday: not a workday
    xp('2026-11-02', { areaId: 'area-intelecto' }), xp('2026-11-02', { amount: 10, reason: 'resumption' }),
    xp('2026-11-03', { deleted: true }),
  ],
  areas: [
    { ...base, id: 'area-intelecto', name: 'Estudo', attribute: 'Intelecto', color: '#6fb3e0', icon: 'book', order: 0, archived: false },
    { ...base, id: 'area-vigor', name: 'Corpo', attribute: 'Vigor', color: '#e5675d', icon: 'heart', order: 1, archived: false },
    { ...base, id: 'area-facul', name: 'Faculdade', attribute: 'Sabedoria', color: '#7bc96f', icon: 'book', order: 2, archived: false },
  ],
  missions: [mission({ id: 'm-f', title: 'Lista', areaId: 'area-facul' })],
  reviews,
  practice: [
    practice({ endedAt: new Date(2026, 9, 29, 20).getTime(), ratings: { delivered: 0, understood: 0, autonomous: 0 } }),
    practice({ endedAt: new Date(2026, 10, 3, 20).getTime(), ratings: { delivered: 2, understood: 1, autonomous: 2 } }),
    practice({ endedAt: new Date(2026, 10, 4, 20).getTime(), ratings: { delivered: 2, understood: 2, autonomous: 0 } }),
    practice({ status: 'open', ratings: { delivered: 2 } }),
  ],
  sleepLogs: [
    night('2026-10-26', '23:00', 480), night('2026-10-27', '23:00', 450),
    night('2026-11-02', '23:00', 480), night('2026-11-03', '00:30', 420), night('2026-11-04', '23:30', 420),
    night('2026-11-05', '23:00'),   // no wake: incomplete
  ],
  workouts: [
    workout('2026-10-27', 'musculacao', 60),
    workout('2026-11-03', 'cardio', 10, { minimum: true }), workout('2026-11-05', 'musculacao', 50),
    workout('2026-11-06', 'cardio', 30, { deleted: true }),
  ],
  checkins: [
    checkin('2026-10-27', '10:00', { kind: 'start', feelings: ['ansiedade'] }),
    checkin('2026-10-27', '15:00', { kind: 'escape', escapedTo: 'youtube' }),
    checkin('2026-11-03', '20:00', { kind: 'escape', escapedTo: 'redes', missionId: 'm-f' }),
    checkin('2026-11-05', '09:00', { kind: 'escape', escapedTo: 'outro', blockId: 'b1' }),
    checkin('2026-11-04', '10:00', { kind: 'start', feelings: ['tédio', 'ansiedade'] }),
  ],
});

describe('dayIndex', () => {
  it('modes (recorded and default), workdays and memoised blocks', () => {
    const idx = dayIndex(data);
    expect(idx.recordedMode('2026-11-04')).toBe('free');
    expect(idx.recordedMode('2026-11-05')).toBeUndefined();
    expect(idx.mode('2026-11-07')).toBe('free');
    expect(idx.isWorkday('2026-11-05')).toBe(true);
    expect(idx.isWorkday('2026-11-04')).toBe(false);
    expect(idx.blocks('2026-11-05')).toBe(idx.blocks('2026-11-05'));
    expect(idx.blocks('2026-11-05').map((c) => c.started)).toEqual([true]);
  });
});

describe('trendPoints', () => {
  const points = trendPoints(data, completedWeeks(TODAY, 2));
  const w1 = points[0]!;
  const w2 = points[1]!;
  it('blocks, workdays and activity', () => {
    expect(w1).toMatchObject({ workdays: 5, activeWorkdays: 2, blocksPlanned: 5, blocksStarted: 3, minimumUsed: 1, resumptions: 0 });
    expect(w2).toMatchObject({ workdays: 4, activeWorkdays: 1, blocksPlanned: 4, blocksStarted: 2, minimumUsed: 0, resumptions: 1 });
  });
  it('reviews: accuracy counts only learned cards, deleted ones never', () => {
    expect(w1).toMatchObject({ reviews: 28, learnedReviews: 25, learnedCorrect: 20 });
    expect(w2).toMatchObject({ reviews: 10, learnedReviews: 10, learnedCorrect: 10 });
  });
  it('practice: closed sessions and how many reached 2 in each indicator', () => {
    expect(w1).toMatchObject({ practiceClosed: 1, practiceTop: { delivered: 0, understood: 0, autonomous: 0 } });
    expect(w2).toMatchObject({ practiceClosed: 2, practiceTop: { delivered: 2, understood: 1, autonomous: 1 } });
  });
  it('sleep: averages only with 3 complete nights (bed spread is the population SD)', () => {
    expect(w1.sleepNights).toBe(2);
    expect(w1).not.toHaveProperty('sleepAvgMin');
    expect(w1).not.toHaveProperty('bedSpreadMin');
    expect(w2).toMatchObject({ sleepNights: 3, sleepAvgMin: 440, bedSpreadMin: 37 });
  });
  it('workouts and check-ins', () => {
    expect(w1).toMatchObject({ workouts: 1, workoutMinutes: 60, cardio: 0, startCheckins: 1, escapes: 1 });
    expect(w2).toMatchObject({ workouts: 2, workoutMinutes: 60, cardio: 1, startCheckins: 1, escapes: 2 });
  });
  it('never counts today or later', () => {
    const d = { ...data, sessions: [...data.sessions, session('b1', '2026-11-10'), session('b1', TODAY)] };
    expect(trendPoints(d, [weekPeriod('2026-11-09')])[0]).toMatchObject({ workdays: 4, blocksPlanned: 4, blocksStarted: 1 });
  });
});

describe('effortByArea', () => {
  it('XP by area with its share, largest first; no area is "Sem área"', () => {
    const rows = effortByArea(data, '2026-10-26', '2026-11-08');
    expect(rows.map((r) => [r.name, r.xp])).toEqual([['Estudo', 15], ['Sem área', 10], ['Corpo', 8]]);
    expect(rows[0]!.share).toBeCloseTo(15 / 33, 5);
    expect(effortByArea({ ...data, areas: [] }, '2026-10-26', '2026-11-08')[0]!.name).toBe('Outra área');
  });
});

describe('checkinBreakdown', () => {
  it('escapes by part of the day (day order), area and place; start-card feelings', () => {
    const b = checkinBreakdown(data, '2026-10-26', '2026-11-08');
    expect(b.escapesByPart.map((r) => [r.label, r.count])).toEqual([['manhã', 1], ['tarde', 1], ['noite', 1]]);
    expect(b.escapesByArea.map((r) => [r.label, r.count])).toEqual([['Sem área', 2], ['Faculdade', 1]]);
    expect(b.escapesByPlace.map((r) => [r.label, r.count])).toEqual([['Outro', 1], ['Redes', 1], ['YouTube', 1]]);
    expect(b.feelings.map((r) => [r.label, r.count])).toEqual([['ansiedade', 2], ['tédio', 1]]);
  });
});

describe('month', () => {
  it('monthObserved of October', () => {
    expect(monthReviewId('2026-10')).toBe('month-2026-10');
    expect(monthObserved(data, '2026-10')).toEqual({
      workdays: 22, activeWorkdays: 2, blocksPlanned: 22, blocksStarted: 3, minimumUsed: 1, resumptions: 0,
      reviews: 28, accuracy: 0.8, practiceClosed: 1, workouts: 1, escapes: 1,
    });
  });
  it('accuracy only from 20 learned reviews; sleep average from 3 complete nights', () => {
    expect(monthObserved({ ...data, reviews: reviews.slice(0, 19) }, '2026-10')).not.toHaveProperty('accuracy');
    expect(monthObserved({ ...data, reviews: reviews.slice(0, 20) }, '2026-10').accuracy).toBe(0.75);
    expect(monthObserved(data, '2026-11')).toMatchObject({ sleepAvgMin: 440 });
  });
  it('monthCardDue: days 1–7, not free, active previous month, no live record', () => {
    const ok = { today: '2026-11-07', mode: 'normal' as const, prevActive: true };
    expect(monthCardDue(ok)).toBe('2026-10');
    expect(monthCardDue({ ...ok, today: '2026-11-08' })).toBeUndefined();
    expect(monthCardDue({ ...ok, mode: 'free' })).toBeUndefined();
    expect(monthCardDue({ ...ok, prevActive: false })).toBeUndefined();
    expect(monthCardDue({ ...ok, prevReview: { deleted: false } })).toBeUndefined();
    expect(monthCardDue({ ...ok, prevReview: { deleted: true } })).toBe('2026-10');
    expect(monthCardDue({ ...ok, today: '2027-01-03' })).toBe('2026-12');
  });
});
