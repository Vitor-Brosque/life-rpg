import { describe, expect, it } from 'vitest';
import type { TrainingBlock, TrainingDay, TrainingLog, TrainingPlan } from '../src/types';
import {
  FIVE_DAY_SPLIT, blockIssue, blockWeekOf, cleanBlock, cleanPlanned, discomfortText, lastSession, lastSessionText,
  normalizePlanDays, parseSet, planDaysOf, planIssues, plannedText, progressionReason, restText, setsRirText,
  startTrainingLog, targetText, trainingDayOf, trainingLogId, withDiscomfort, withSet,
} from '../src/training';
import { base } from './patternFixture';

const WED = '2026-11-11';
const block: TrainingBlock = {
  startDay: '2026-11-16',
  weeks: [{ rirMin: 3, rirMax: 3, cardioMin: 20, cardioMax: 25 }, { rirMin: 2, rirMax: 2, cardioMin: 30 }, { rirMin: 1, rirMax: 2 }],
};
const plan: TrainingPlan = { ...base, id: 'plan', days: [...FIVE_DAY_SPLIT], block };

describe('the plan request', () => {
  it('plans saved with plain strings are read as objects', () => {
    const old = { days: [{ weekday: 3, name: 'Pernas', exercises: ['Agachamento', 'Leg press'] }] } as unknown as TrainingPlan;
    expect(planDaysOf(old)[0]!.exercises).toEqual([{ name: 'Agachamento' }, { name: 'Leg press' }]);
    expect(trainingDayOf({ ...old, deleted: false }, WED)?.exercises[1]).toEqual({ name: 'Leg press' });
    expect(startTrainingLog(WED, { ...old, deleted: false }).exercises[0]).toEqual({ id: 'p0', name: 'Agachamento', sets: [] });
  });
  it('cleanPlanned keeps valid numbers, swaps a reversed range, drops the rest', () => {
    expect(cleanPlanned({ name: ' supino ', sets: 3, repsMin: 8, repsMax: 6, restMinSec: 180, restMaxSec: 120, note: '  devagar ' }))
      .toEqual({ name: 'Supino', sets: 3, repsMin: 6, repsMax: 8, restMinSec: 120, restMaxSec: 180, note: 'devagar' });
    expect(cleanPlanned({ name: 'Remada', sets: 0, repsMin: 101, restMinSec: 5, restMaxSec: 90 }))
      .toEqual({ name: 'Remada', restMinSec: 90 });
    expect(cleanPlanned({ name: 'Rosca', restMinSec: 90, restMaxSec: 90 })).toEqual({ name: 'Rosca', restMinSec: 90 });
    expect(cleanPlanned({ name: '   ' })).toBeUndefined();
    expect(normalizePlanDays([{ weekday: 1, name: 'A', exercises: [{ name: 'x', sets: 3 }, { name: ' ' }] }]))
      .toEqual([{ weekday: 1, name: 'A', exercises: [{ name: 'X', sets: 3 }] }]);
  });
  it('planIssues refuses reversed or out-of-range numbers (the editor does not fix them silently)', () => {
    const days: TrainingDay[] = [{ weekday: 1, name: 'A', exercises: [
      { name: 'ok', sets: 3, repsMin: 6, repsMax: 8, restMinSec: 120, restMaxSec: 180 },
      { name: 'reps', repsMin: 10, repsMax: 8 },
      { name: 'rest', restMinSec: 5 },
      { name: '', repsMin: 10, repsMax: 8 },
    ] }];
    expect(planIssues(days)).toEqual([{ weekday: 1, index: 1, kind: 'reps' }, { weekday: 1, index: 2, kind: 'rest' }]);
  });
  it('texts of the request and of the rest', () => {
    expect(plannedText({ sets: 3, repsMin: 6, repsMax: 8, restMinSec: 120, restMaxSec: 180 })).toBe('3 × 6–8 · descanso 2–3 min');
    expect(plannedText({ sets: 3, repsMin: 8, repsMax: 8 })).toBe('3 × 8');
    expect(plannedText({ sets: 2 })).toBe('2 séries');
    expect(plannedText({ repsMin: 10, repsMax: 15, restMinSec: 90 })).toBe('10–15 repetições · descanso 90 s');
    expect(plannedText({})).toBe('');
    expect(restText(60, 90)).toBe('60–90 s');
    expect(restText(180, 240)).toBe('3–4 min');
    expect(restText(45)).toBe('45 s');
    expect(restText(150, 240)).toBe('2 min 30 s a 4 min');
  });
});

describe('the block', () => {
  it('blockWeekOf: week by date, nothing before the start or after the last week', () => {
    expect(blockWeekOf(block, '2026-11-15')).toBeUndefined();
    expect(blockWeekOf(block, '2026-11-16')).toEqual({ week: 1, weeks: 3, rirMin: 3, rirMax: 3, cardioMin: 20, cardioMax: 25 });
    expect(blockWeekOf(block, '2026-11-29')).toMatchObject({ week: 2, rirMin: 2, cardioMin: 30 });
    expect(blockWeekOf(block, '2026-12-06')).toMatchObject({ week: 3, rirMin: 1, rirMax: 2 });
    expect(blockWeekOf(block, '2026-12-07')).toBeUndefined();
    expect(blockWeekOf(undefined, '2026-11-16')).toBeUndefined();
  });
  it('targetText', () => {
    expect(targetText(blockWeekOf(block, '2026-11-16')!)).toBe('Semana 1 de 3 · RIR ~3 · cardio 20–25 min');
    expect(targetText(blockWeekOf(block, '2026-12-01')!)).toBe('Semana 3 de 3 · RIR 1–2');
  });
  it('blockIssue and cleanBlock', () => {
    expect(blockIssue(block)).toBeUndefined();
    expect(blockIssue({ startDay: '', weeks: [{ rirMin: 1, rirMax: 2 }] })).toEqual({ kind: 'start' });
    expect(blockIssue({ startDay: WED, weeks: [] })).toEqual({ kind: 'weeks' });
    expect(blockIssue({ startDay: WED, weeks: [{ rirMin: 1, rirMax: 2 }, { rirMin: 3, rirMax: 2 }] })).toEqual({ kind: 'rir', week: 2 });
    expect(blockIssue({ startDay: WED, weeks: [{ rirMin: 1, rirMax: 2, cardioMin: 40, cardioMax: 30 }] })).toEqual({ kind: 'cardio', week: 1 });
    expect(cleanBlock({ startDay: WED, weeks: [{ rirMin: 1, rirMax: 2, cardioMax: 30 }, { rirMin: 1, rirMax: 1, cardioMin: 20, cardioMax: 20 }] }))
      .toEqual({ startDay: WED, weeks: [{ rirMin: 1, rirMax: 2, cardioMin: 30 }, { rirMin: 1, rirMax: 1, cardioMin: 20 }] });
  });
  it('startTrainingLog copies the request of each exercise and the block week', () => {
    const s = startTrainingLog('2026-11-25', plan);
    expect(s.planName).toBe('Pernas');
    expect(s.exercises[0]).toEqual({ id: 'p0', name: 'Agachamento livre', sets: [], planned: { sets: 3, repsMin: 6, repsMax: 10, restMinSec: 120, restMaxSec: 180 } });
    expect(s.target).toEqual({ week: 2, weeks: 3, rirMin: 2, rirMax: 2, cardioMin: 30 });
    expect(startTrainingLog(WED, plan).target).toBeUndefined();
  });
});

describe('RIR and discomfort', () => {
  it('parseSet takes an optional RIR from the buttons', () => {
    expect(parseSet('8', '40', 2)).toEqual({ reps: 8, kg: 40, rir: 2 });
    expect(parseSet('8', '', 0)).toEqual({ reps: 8, rir: 0 });
    expect(parseSet('8', '40', 7)).toEqual({ reps: 8, kg: 40 });
    expect(parseSet('8', '40')).toEqual({ reps: 8, kg: 40 });
  });
  it('setsRirText', () => {
    expect(setsRirText([{ reps: 8, rir: 2 }, { reps: 8 }, { reps: 7, rir: 5 }])).toBe('RIR 2, –, 5+');
    expect(setsRirText([{ reps: 8 }])).toBe('');
  });
  it('withDiscomfort sets, replaces and removes; discomfortText', () => {
    const l = { exercises: [{ id: 'p0', name: 'Supino', sets: [] }] };
    const a = withDiscomfort(l, 'p0', { spot: 'ombro', note: '  no fim  ' });
    expect(a.exercises[0]!.discomfort).toEqual({ spot: 'ombro', note: 'no fim' });
    expect(discomfortText(a.exercises[0]!.discomfort!)).toBe('desconforto: ombro (no fim)');
    expect(withDiscomfort(a, 'p0', undefined).exercises[0]).toEqual({ id: 'p0', name: 'Supino', sets: [] });
  });
});

describe('Pronto para subir a carga', () => {
  const day = (d: string, sets: { reps: number; kg?: number; rir?: number }[], p: Partial<TrainingLog> = {}): TrainingLog => {
    let l: TrainingLog = { ...base, id: trainingLogId(d), ...startTrainingLog(d, plan), ...p };
    for (const s of sets) l = { ...l, ...withSet(l, 'p0', s) };
    return l;
  };
  const reason = (logs: TrainingLog[], fallback?: Parameters<typeof progressionReason>[1]) =>
    progressionReason(lastSession(logs, 'Agachamento livre', '2026-12-02')!, fallback);

  it('closes at the top of the range in every planned set, one load, RIR at or above the week minimum', () => {
    const logs = [day('2026-11-25', [{ reps: 10, kg: 80, rir: 2 }, { reps: 10, kg: 80, rir: 2 }, { reps: 10, kg: 80, rir: 3 }])];
    expect(reason(logs)).toBe('Na última (qua 25/11): 3 × 10 · 80 kg, RIR 2, 2, 3. Faixa até 10.');
    expect(lastSessionText(lastSession(logs, 'Agachamento livre', '2026-12-02')!)).toBe('Última: 3 × 10 · 80 kg · RIR 2, 2, 3');
  });
  it('does not close: a set short, reps short, loads differ, RIR below or missing', () => {
    expect(reason([day('2026-11-25', [{ reps: 10, kg: 80, rir: 2 }, { reps: 10, kg: 80, rir: 2 }])])).toBeUndefined();
    expect(reason([day('2026-11-25', [{ reps: 10, kg: 80, rir: 2 }, { reps: 9, kg: 80, rir: 2 }, { reps: 10, kg: 80, rir: 2 }])])).toBeUndefined();
    expect(reason([day('2026-11-25', [{ reps: 10, kg: 80, rir: 2 }, { reps: 10, kg: 75, rir: 2 }, { reps: 10, kg: 80, rir: 2 }])])).toBeUndefined();
    expect(reason([day('2026-11-25', [{ reps: 10, kg: 80, rir: 1 }, { reps: 10, kg: 80, rir: 2 }, { reps: 10, kg: 80, rir: 2 }])])).toBeUndefined();
    expect(reason([day('2026-11-25', [{ reps: 10, kg: 80 }, { reps: 10, kg: 80, rir: 2 }, { reps: 10, kg: 80, rir: 2 }])])).toBeUndefined();
  });
  it('without a block week only the reps count; extra sets after the planned ones do not matter', () => {
    const logs = [day('2026-11-11', [{ reps: 10, kg: 60 }, { reps: 10, kg: 60 }, { reps: 10, kg: 60 }, { reps: 6, kg: 60 }])];
    expect(reason(logs)).toBe('Na última (qua 11/11): 3 × 10 · 60 kg. Faixa até 10 (sem meta de RIR).');
  });
  it('a session without the copied request uses today\'s plan; a swapped exercise never closes', () => {
    const old = day('2026-11-11', [{ reps: 10, kg: 60 }, { reps: 10, kg: 60 }, { reps: 10, kg: 60 }]);
    const bare = { ...old, exercises: old.exercises.map(({ planned: _p, ...e }) => e) };
    expect(reason([bare])).toBeUndefined();
    expect(reason([bare], { sets: 3, repsMin: 6, repsMax: 10 })).toContain('Faixa até 10');
    let swapped: TrainingLog = { ...base, id: trainingLogId('2026-11-25'), ...startTrainingLog('2026-11-25', plan) };
    swapped = { ...swapped, exercises: swapped.exercises.map((e) => (e.id === 'p0' ? { ...e, status: 'trocado' as const, replacedBy: 'Agachamento livre' } : e)) };
    for (const s of [1, 2, 3]) swapped = { ...swapped, ...withSet(swapped, 'p0', { reps: 10, kg: 80, rir: 2 + (s % 1) }) };
    expect(progressionReason(lastSession([swapped], 'Agachamento livre', '2026-12-02')!)).toBeUndefined();
  });
});
