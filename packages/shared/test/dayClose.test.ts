import { describe, expect, it } from 'vitest';
import type { BlockSession, Commitment, FocusSession, SleepLog } from '../src/types';
import { timestampAt } from '../src/dates';
import { planDay } from '../src/planDay';
import { closeCardDue, closeCardFrom, correctedFocus, dayCloseSummary, typedWindow } from '../src/dayClose';
import { sleepQualityOf } from '../src/sleep';
import { startTrainingLog, withSet, FIVE_DAY_SPLIT } from '../src/training';
import { base, block, event, mission, practice, review, workout } from './patternFixture';

const D = '2026-11-11'; // Wednesday
const at = (t: string, day = D): number => timestampAt(day, t);
const aula: Commitment = { ...base, id: 'aula', title: 'Aula', date: '2026-11-02', start: '19:00', end: '23:00', weekdays: [1, 2, 3, 4, 5], remind: true };
const blocks = [
  block({ id: 'r', order: 0, targetStart: '08:30', durationMin: 30, minimumMin: 15, kind: 'routine' }),
  block({ id: 'b1', name: 'Tech News', order: 1, targetStart: '09:00', durationMin: 180, minimumMin: 45 }),
  block({ id: 'b2', name: 'Treino', order: 2, targetStart: '12:30', durationMin: 120, minimumMin: 45, kind: 'body' }),
  block({ id: 'b3', name: 'Faculdade', order: 3, targetStart: '15:00', durationMin: 90, minimumMin: 30, kind: 'study' }),
  block({ id: 'b4', name: 'Estudo técnico', order: 4, targetStart: '16:45', durationMin: 60, minimumMin: 25, kind: 'study' }),
];
const s = (blockId: string, p: Partial<BlockSession>): BlockSession => ({ ...base, id: `bs-${blockId}-${D}`, blockId, day: D, version: 'normal', ...p });
const sessions = [
  s('b1', { startedAt: at('09:05'), endedAt: at('12:00'), outcome: 'parcial' }),
  s('b2', { startedAt: at('12:40'), endedAt: at('13:30'), version: 'minimum' }),
  s('b3', { endedAt: at('15:01'), skipped: true }),
];
const NOW = at('23:30');
const occurrences = planDay({ day: D, now: NOW, dayStartHour: 4, dayEndHour: 0, mode: 'normal', blocks, commitments: [aula], sessions });
const focus = (id: string, start: string, min: number, p: Partial<FocusSession> = {}): FocusSession => ({
  ...base, id, startedAt: at(start), endedAt: at(start) + min * 60_000, activeMs: min * 60_000, mode: 'free', outcome: 'finished', ...p,
});

describe('evening card', () => {
  it('starts at the later of 20:00 and the last commitment end', () => {
    expect(closeCardFrom(D, [aula], 4)).toBe(at('23:00'));
    expect(closeCardFrom(D, [], 4)).toBe(at('20:00'));
    expect(closeCardFrom('2026-11-14', [aula], 4)).toBe(at('20:00', '2026-11-14'));
  });
  it('due on a workday after the start, unless closed, dismissed or free', () => {
    const base0 = { day: D, mode: 'normal' as const, commitments: [aula], dayStartHour: 4 };
    expect(closeCardDue({ ...base0, now: at('22:59') })).toBe(false);
    expect(closeCardDue({ ...base0, now: at('23:00') })).toBe(true);
    expect(closeCardDue({ ...base0, now: at('01:30', '2026-11-12') })).toBe(true);
    expect(closeCardDue({ ...base0, now: NOW, state: { closedAt: 1 } })).toBe(false);
    expect(closeCardDue({ ...base0, now: NOW, state: { closeDismissed: true } })).toBe(false);
    expect(closeCardDue({ ...base0, now: NOW, mode: 'free' })).toBe(false);
  });
});

describe('dayCloseSummary', () => {
  const done = mission({ id: 'm1', title: 'Dedupe', status: 'done', completedAt: at('11:00') });
  const doneYesterday = mission({ id: 'm0', title: 'Velha', status: 'done', completedAt: at('11:00', '2026-11-10') });
  const open = mission({ id: 'm2', title: 'Teste de URLs', date: D });
  const overdue = mission({ id: 'm3', title: 'Ler capítulo', date: '2026-11-09' });
  const doing = mission({ id: 'm4', title: 'Lista 4', status: 'doing', date: D });
  const later = mission({ id: 'm5', title: 'Sexta', date: '2026-11-13' });
  let log = { ...base, id: `training-${D}`, ...startTrainingLog(D, { deleted: false, days: [...FIVE_DAY_SPLIT] }) };
  log = { ...log, ...withSet(log, 'p0', { reps: 10, kg: 80 }) };
  const summary = dayCloseSummary({
    day: D, dayStartHour: 4, occurrences,
    missions: [done, doneYesterday, open, overdue, doing, later],
    events: [
      event('partial', 'm4', D, '16:00', { result: 'metade' }),
      event('partial', 'm4', D, '17:00', { result: 'quase' }),
      event('partial', 'm2', '2026-11-10', '17:00', {}),
    ],
    focus: [focus('f1', '09:10', 50), focus('f2', '16:50', 40), focus('f3', '10:00', 30, { deleted: true }), focus('f4', '10:00', 30, { startedAt: at('10:00', '2026-11-10') })],
    reviews: [review(D, 3), review(D, 1), review('2026-11-10', 3)],
    practice: [practice({ endedAt: at('18:00') }), practice({ status: 'open' })],
    trainingLog: log,
    workouts: [workout(D, 'cardio', 20), workout('2026-11-10', 'cardio', 30)],
  });
  it('blocks: routine out; started normal, minimum, skipped, not started', () => {
    expect(summary.blocks.map((b) => [b.blockId, b.state])).toEqual([
      ['b1', 'normal'], ['b2', 'minimo'], ['b3', 'pulado'], ['b4', 'nao-iniciado'],
    ]);
    expect(summary.counts).toEqual({ normal: 1, minimo: 1, pulado: 1, 'nao-iniciado': 1 });
    expect(summary.blocks[0]).toMatchObject({ startedAt: at('09:05'), endedAt: at('12:00'), outcome: 'parcial' });
    expect(summary.blocks[3]).not.toHaveProperty('startedAt');
  });
  it('missions, partial (one per mission, today only), focus, reviews, practice, training, workouts', () => {
    expect(summary.completed.map((m) => m.id)).toEqual(['m1']);
    expect(summary.partial).toEqual([{ missionId: 'm4', title: 'Lista 4' }]);
    expect(summary.focus.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(summary.focusMin).toBe(90);
    expect(summary.reviews).toBe(2);
    expect(summary.practiceClosed).toBe(1);
    expect(summary.training).toBe('Pernas: 1 feito');
    expect(summary.workouts).toHaveLength(1);
  });
  it('pending: open missions planned up to today, never the ones in progress or of later days', () => {
    expect(summary.pending.map((m) => m.id)).toEqual(['m3', 'm2']);
  });
  it('a retro session is marked', () => {
    const retro = [...sessions.slice(0, 2), s('b4', { startedAt: at('17:00'), endedAt: at('17:40'), retro: true })];
    const occ = planDay({ day: D, now: NOW, dayStartHour: 4, dayEndHour: 0, mode: 'normal', blocks, commitments: [aula], sessions: retro });
    const out = dayCloseSummary({ day: D, dayStartHour: 4, occurrences: occ, missions: [], events: [], focus: [], reviews: [], practice: [], workouts: [] });
    expect(out.blocks.find((b) => b.blockId === 'b4')).toMatchObject({ state: 'normal', retro: true });
  });
});

describe('corrections', () => {
  it('typedWindow: logical times, order, the future and the format', () => {
    expect(typedWindow(D, '15:00', '16:30', 4, NOW)).toEqual({ startedAt: at('15:00'), endedAt: at('16:30') });
    expect(typedWindow(D, '23:40', '00:20', 4, at('02:00', '2026-11-12'))).toEqual({ startedAt: at('23:40'), endedAt: at('00:20', '2026-11-12') });
    expect(typedWindow(D, '16:30', '15:00', 4, NOW)).toBe('order');
    expect(typedWindow(D, '23:00', '23:50', 4, NOW)).toBe('future');
    expect(typedWindow(D, '9:00', '10:00', 4, NOW)).toBe('format');
  });
  it('correctedFocus keeps the pauses; range and future are refused', () => {
    const f = { startedAt: at('10:00'), endedAt: at('12:00'), activeMs: 100 * 60_000 };
    expect(correctedFocus(f, 45, NOW)).toEqual({ activeMs: 45 * 60_000, endedAt: at('11:05') });
    expect(correctedFocus(f, 0, NOW)).toBe('range');
    expect(correctedFocus(f, 1.5, NOW)).toBe('range');
    expect(correctedFocus(f, 601, NOW)).toBe('range');
    expect(correctedFocus(f, 200, at('13:00'))).toBe('future');
  });
});

describe('sleepQualityOf', () => {
  const n = (night: string, quality?: number, p: Partial<SleepLog> = {}): SleepLog =>
    ({ ...base, id: `sleep-${night}`, night, ...(quality !== undefined ? { quality: quality as SleepLog['quality'] } : {}), ...p });
  it('mean of the window nights with a quality, one decimal, from 3 nights', () => {
    expect(sleepQualityOf([n('2026-11-10', 4), n('2026-11-11', 3)], '2026-11-12')).toBeUndefined();
    expect(sleepQualityOf([n('2026-11-10', 4), n('2026-11-11', 3), n('2026-11-12', 4), n('2026-11-09')], '2026-11-12'))
      .toEqual({ avg: 3.7, nights: 3 });
    expect(sleepQualityOf([n('2026-10-01', 1), n('2026-11-10', 4), n('2026-11-11', 3), n('2026-11-12', 5, { deleted: true })], '2026-11-12'))
      .toBeUndefined();
  });
});
