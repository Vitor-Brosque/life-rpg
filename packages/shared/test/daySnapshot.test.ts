import { describe, expect, it } from 'vitest';
import type { BlockSession, Commitment, DayPlan, FocusSession } from '../src/types';
import { timestampAt } from '../src/dates';
import { completedWeeks } from '../src/periods';
import { blocksFromPlan, commitmentsFromPlan, dayPlanNeeded, takeDayPlan } from '../src/daySnapshot';
import { dayIndex, trendPoints } from '../src/trends';
import { planVsDone } from '../src/planVsDone';
import { countedBlocksOn, weekStats } from '../src/weekStats';
import { base, block, emptyData } from './patternFixture';

const MON = '2026-11-02';
const TUE = '2026-11-03';
const WED = '2026-11-04';
const at = (day: string, t: string): number => timestampAt(day, t);
const aula: Commitment = { ...base, id: 'aula', title: 'Aula', date: '2026-10-01', start: '19:00', end: '23:00', weekdays: [1, 2, 3, 4, 5], remind: true };
// The routine as it is today (A was shortened, C was added later; D was deleted).
const A = block({ id: 'A', name: 'Tech', order: 0, targetStart: '09:00', durationMin: 120, minimumMin: 30, areaId: 'area-tech' });
const B = block({ id: 'B', name: 'Facul', order: 1, targetStart: '15:00', durationMin: 90, minimumMin: 30, kind: 'study', areaId: 'area-facul' });
const C = block({ id: 'C', name: 'Compl', order: 2, targetStart: '18:00', durationMin: 40, minimumMin: 10, kind: 'light' });
const R = block({ id: 'R', name: 'Início', order: 3, targetStart: '08:30', durationMin: 30, minimumMin: 15, kind: 'routine' });
const D = block({ id: 'D', name: 'Inglês', order: 2, targetStart: '17:00', durationMin: 60, minimumMin: 20, areaId: 'area-x' });
const plan = (day: string, mode: DayPlan['mode'], blocks = [{ ...A, durationMin: 180, minimumMin: 45 }, B, D, R]): DayPlan =>
  ({ ...base, id: day, ...takeDayPlan({ day, mode, takenAt: at(day, '08:00'), blocks, commitments: [aula], dayStartHour: 4 }) });
const session = (blockId: string, day: string, start: string, end: string, version: 'normal' | 'minimum' = 'normal'): BlockSession =>
  ({ ...base, id: `bs-${blockId}-${day}`, blockId, day, version, startedAt: at(day, start), endedAt: at(day, end) });
const focus = (id: string, day: string, start: string, min: number, p: Partial<FocusSession> = {}): FocusSession => ({
  ...base, id, startedAt: at(day, start), endedAt: at(day, start) + min * 60_000, activeMs: min * 60_000, mode: 'free', outcome: 'finished', ...p,
});

describe('takeDayPlan', () => {
  it('copies the weekday’s live blocks (any kind, plan order) and the day’s commitments', () => {
    const p = takeDayPlan({
      day: MON, mode: 'normal', takenAt: 5, dayStartHour: 4, commitments: [aula, { ...aula, id: 'x', weekdays: [6] }],
      blocks: [B, A, R, { ...C, archived: true }, { ...D, deleted: true }, { ...D, id: 'sat', weekdays: [6] }],
    });
    expect(p.blocks.map((b) => b.blockId)).toEqual(['A', 'B', 'R']);
    expect(p.blocks[0]).toEqual({
      blockId: 'A', name: 'Tech', kind: 'focus', areaId: 'area-tech', targetStart: '09:00', durationMin: 120, minimumMin: 30,
      protected: false, order: 0, createdAt: 1,
    });
    expect(p.commitments).toEqual([{ commitmentId: 'aula', title: 'Aula', start: '19:00', end: '23:00' }]);
    expect(p).toMatchObject({ day: MON, mode: 'normal', takenAt: 5 });
  });
  it('dayPlanNeeded: none, deleted or another day type', () => {
    expect(dayPlanNeeded(undefined, 'normal')).toBe(true);
    expect(dayPlanNeeded({ deleted: true, mode: 'normal' }, 'normal')).toBe(true);
    expect(dayPlanNeeded({ deleted: false, mode: 'normal' }, 'low')).toBe(true);
    expect(dayPlanNeeded({ deleted: false, mode: 'low' }, 'low')).toBe(false);
  });
  it('blocksFromPlan: planned blocks as they were; current ones off the plan only when lived', () => {
    const p = plan(MON, 'normal');
    const out = blocksFromPlan(p, [A, B, C]);
    expect(out.map((b) => [b.id, b.durationMin, b.weekdays])).toEqual([
      ['A', 180, [1]], ['B', 90, [1]], ['D', 60, [1]], ['R', 30, [1]], ['C', 40, []],
    ]);
    expect(commitmentsFromPlan(p)).toEqual([{ id: 'aula', createdAt: 0, updatedAt: 0, deleted: false, title: 'Aula', date: MON, start: '19:00', end: '23:00', remind: false }]);
    const lived = countedBlocksOn({
      day: MON, mode: 'normal', blocks: out, commitments: commitmentsFromPlan(p), dayStartHour: 4, dayEndHour: 0,
      sessions: [session('C', MON, '18:00', '18:30')],
    });
    expect(lived.map((c) => [c.block.id, c.started, c.plannedMin])).toEqual([['A', false, 180], ['B', false, 90], ['D', false, 60], ['C', true, 0]]);
  });
});

describe('dayIndex with plans', () => {
  const sessions = [
    session('A', MON, '09:00', '11:30'), session('D', MON, '17:00', '17:40'),
    session('B', TUE, '15:00', '15:30', 'minimum'),
  ];
  const data = emptyData({
    blocks: [A, B, C, R], commitments: [aula], sessions,
    dayStates: [{ ...base, id: TUE, hardDay: true, reviewDone: false, mode: 'low' }],
    dayPlans: [plan(MON, 'normal'), plan(TUE, 'low')],
    focusSessions: [focus('f1', MON, '13:00', 45, { areaId: 'area-facul' }), focus('f2', MON, '09:30', 30, { areaId: 'area-tech' })],
    areas: [
      { ...base, id: 'area-tech', name: 'Tech', attribute: 'x', color: '#000', icon: 'x', order: 0, archived: false },
      { ...base, id: 'area-facul', name: 'Faculdade', attribute: 'x', color: '#000', icon: 'x', order: 1, archived: false },
      { ...base, id: 'area-x', name: 'Inglês', attribute: 'x', color: '#000', icon: 'x', order: 2, archived: false },
    ],
  });
  it('a day with a plan uses it; a day without keeps the current routine', () => {
    const idx = dayIndex(data);
    expect(idx.plan(MON)?.mode).toBe('normal');
    expect(idx.plan(WED)).toBeUndefined();
    expect(idx.blocks(MON).map((c) => [c.block.id, c.started, c.plannedMin, c.lived ? (c.lived.end - c.lived.start) / 60_000 : 0]))
      .toEqual([['A', true, 180, 150], ['B', false, 90, 0], ['D', true, 60, 40]]);
    expect(idx.blocks(TUE).map((c) => [c.block.id, c.started, c.minimum, c.plannedMin])).toEqual([['A', false, false, 45], ['B', true, true, 30], ['D', false, false, 20]]);
    expect(idx.blocks(WED).map((c) => [c.block.id, c.plannedMin])).toEqual([['A', 120], ['B', 90], ['C', 40]]);
  });
  it('trend counts follow the plans; without plans they are what they were', () => {
    const [w] = trendPoints(data, completedWeeks('2026-11-13', 2).slice(0, 1).map((p) => ({ ...p, start: MON, end: '2026-11-08', key: MON })));
    expect(w).toMatchObject({ blocksPlanned: 15, blocksStarted: 3, minimumUsed: 1 });
    const [old] = trendPoints({ ...data, dayPlans: [] }, completedWeeks('2026-11-13', 2).slice(0, 1).map((p) => ({ ...p, start: MON, end: '2026-11-08', key: MON })));
    expect(old).toMatchObject({ blocksPlanned: 14, blocksStarted: 2, minimumUsed: 1 });
    const [none] = trendPoints({ ...data, dayPlans: undefined }, completedWeeks('2026-11-13', 2).slice(0, 1).map((p) => ({ ...p, start: MON, end: '2026-11-08', key: MON })));
    expect(none).toEqual(old);
  });
  it('the weekly review (weekStats) reads the same plans, so it agrees with Padrões', () => {
    const input = {
      weekStart: MON, today: '2026-11-13', dayStates: data.dayStates, sessions, checkins: [], xpEvents: [],
      blocks: data.blocks, commitments: data.commitments, dayStartHour: 4, dayEndHour: 0,
    };
    expect(weekStats({ ...input, dayPlans: data.dayPlans })).toMatchObject({ planned: 15, started: 3, minimumUsed: 1 });
    expect(weekStats(input)).toMatchObject({ planned: 14, started: 2, minimumUsed: 1 });
    // A commitment created after the plan of Monday counts on both screens alike.
    const dent: Commitment = { ...base, id: 'dent', createdAt: at(MON, '10:00'), title: 'Dentista', date: MON, start: '15:00', end: '17:00', remind: true };
    const withDent = { ...data, commitments: [aula, dent] };
    const [t] = trendPoints(withDent, [{ kind: 'week', key: MON, start: MON, end: '2026-11-08', label: '02/11' }]);
    expect(weekStats({ ...input, commitments: withDent.commitments, dayPlans: data.dayPlans })).toMatchObject({
      planned: t!.blocksPlanned, started: t!.blocksStarted, minimumUsed: t!.minimumUsed,
    });
  });
  it('planVsDone: days with a plan only; planned by mode; executed = lived blocks + focus outside them', () => {
    const [p] = planVsDone(data, [completedWeeks('2026-11-13', 2)[0]!].map((x) => ({ ...x, start: MON, end: '2026-11-08', key: MON })));
    expect(p).toMatchObject({ daysWithPlan: 2, plannedMin: 425, executedMin: 265 });
    expect(p!.areas).toEqual([
      { key: 'area-tech', name: 'Tech', plannedMin: 225, executedMin: 150 },
      { key: 'area-facul', name: 'Faculdade', plannedMin: 120, executedMin: 75 },
      { key: 'area-x', name: 'Inglês', plannedMin: 80, executedMin: 40 },
    ]);
    expect(p!.days.map((d) => [d.day, d.mode, d.plannedMin, d.executedMin])).toEqual([[MON, 'normal', 330, 235], [TUE, 'low', 95, 30]]);
  });
  it('planVsDone groups a journey block without area under the journey, and unknown under "Sem área"', () => {
    const J = block({ id: 'J', name: 'Tech News', order: 0, targetStart: '09:00', durationMin: 60, minimumMin: 15, journeyId: 'j-tech' });
    const d2 = emptyData({
      blocks: [J], dayPlans: [plan(MON, 'normal', [J])], sessions: [session('J', MON, '09:00', '09:50')],
      journeys: [{ ...base, id: 'j-tech', title: 'Tech News', status: 'active', order: 0 }],
      focusSessions: [focus('f', MON, '14:00', 20)],
    });
    const [p] = planVsDone(d2, [{ kind: 'week', key: MON, start: MON, end: '2026-11-08', label: '02/11' }]);
    expect(p!.areas).toEqual([
      { key: 'journey:j-tech', name: 'Tech News', plannedMin: 60, executedMin: 50 },
      { key: '', name: 'Sem área', plannedMin: 0, executedMin: 20 },
    ]);
  });
});

describe('a day with a plan and commitments created later that day', () => {
  // The plan was taken at 08:00; "Dentista 15:00–17:00" was created at 10:00 for the same day.
  const blocks = [A, B, D];
  const dent: Commitment = { ...base, id: 'dent', createdAt: at(MON, '10:00'), title: 'Dentista', date: MON, start: '15:00', end: '17:00', remind: true };
  const p = plan(MON, 'normal', blocks);
  const ids = (d: ReturnType<typeof emptyData>) => dayIndex(d).blocks(MON).map((c) => c.block.id);

  it('the later commitment counts as on a day without plan (the 15:00 block is left out); the plan is not rewritten', () => {
    const without = ids(emptyData({ blocks, commitments: [aula, dent] }));
    expect(without).toEqual(['A', 'D']);
    expect(ids(emptyData({ blocks, commitments: [aula, dent], dayPlans: [p] }))).toEqual(without);
    expect(p.commitments.map((c) => c.commitmentId)).toEqual(['aula']);
    expect(commitmentsFromPlan(p, [aula, dent], 4).map((c) => c.id)).toEqual(['aula', 'dent']);
  });

  it('only live commitments of that day created after the plan: older, deleted or other-day ones stay out', () => {
    const older = { ...dent, createdAt: at(MON, '07:00') };
    const gone = { ...dent, deleted: true };
    const otherDay = { ...dent, date: TUE };
    for (const c of [older, gone, otherDay]) {
      expect(ids(emptyData({ blocks, commitments: [aula, c], dayPlans: [p] }))).toEqual(['A', 'B', 'D']);
    }
    expect(commitmentsFromPlan(p)).toHaveLength(1);
  });
});
