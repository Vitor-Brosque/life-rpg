import { describe, expect, it } from 'vitest';
import type { TrainingDay, TrainingLog, TrainingPlan } from '../src/types';
import {
  FIVE_DAY_SPLIT, adoptableWorkout, cardioIssue, cardioText, cardioWeeks, exerciseHistory, exercisesFromText, lastSession,
  lastSessionText, normalizePlanDays, parseKg, parseSet, setsText, startTrainingLog, trainingDayOf, trainingLogId,
  trainingSummaryText, withExtra, withReplaced, withSet, withSetAt, withSkipped, withStatusCleared, withoutExtra, withoutSet,
} from '../src/training';
import { base, workout } from './patternFixture';

// Names only (the detailed request has its own tests in trainingDetail.test.ts).
const plan: TrainingPlan = { ...base, id: 'plan', days: FIVE_DAY_SPLIT.map((d) => ({ ...d, exercises: d.exercises.map((e) => ({ name: e.name })) })) };
const WED = '2026-11-11';
const log = (day: string, p: Partial<TrainingLog> = {}): TrainingLog =>
  ({ ...base, id: trainingLogId(day), ...startTrainingLog(day, plan), ...p });

describe('plan', () => {
  it('the template: five weekdays, names and first letters capitalised', () => {
    expect(FIVE_DAY_SPLIT.map((d) => [d.weekday, d.name, d.exercises.length])).toEqual([
      [1, 'Peito e tríceps', 5], [2, 'Costas e bíceps', 5], [3, 'Pernas', 6], [4, 'Ombros', 5], [5, 'Corpo inteiro', 5],
    ]);
    expect(FIVE_DAY_SPLIT.every((d) => d.exercises.every((e) => e.name[0] === e.name[0]!.toUpperCase()))).toBe(true);
  });
  it('exercisesFromText: one per line, blanks out, capitalised', () => {
    expect(exercisesFromText('  supino reto \n\n\nremada aberta\r\n')).toEqual(['Supino reto', 'Remada aberta']);
  });
  it('normalizePlanDays: sorted, last of a weekday wins, empty is rest, missing name is "Treino", bad weekday out (old string format)', () => {
    expect(normalizePlanDays(([
      { weekday: 3, name: ' Pernas ', exercises: ['agachamento'] },
      { weekday: 1, name: 'x', exercises: [] },
      { weekday: 1, name: '', exercises: [' remada ', ''] },
      { weekday: 2, name: '  ', exercises: [] },
      { weekday: 7, name: 'Nunca', exercises: [] },
    ] as unknown as TrainingDay[]))).toEqual([
      { weekday: 1, name: 'Treino', exercises: [{ name: 'Remada' }] },
      { weekday: 3, name: 'Pernas', exercises: [{ name: 'Agachamento' }] },
    ]);
  });
  it('trainingDayOf: Wednesday is Pernas, Saturday rests, no plan rests', () => {
    expect(trainingDayOf(plan, WED)?.name).toBe('Pernas');
    expect(trainingDayOf(plan, '2026-11-14')).toBeUndefined();
    expect(trainingDayOf(undefined, WED)).toBeUndefined();
    expect(trainingDayOf({ ...plan, deleted: true }, WED)).toBeUndefined();
  });
  it('startTrainingLog copies the day: plan name and exercises with position ids', () => {
    const s = startTrainingLog(WED, plan);
    expect(s.planName).toBe('Pernas');
    expect(s.exercises.slice(0, 2)).toEqual([{ id: 'p0', name: 'Agachamento livre', sets: [] }, { id: 'p1', name: 'Leg press', sets: [] }]);
    expect(startTrainingLog('2026-11-14', plan)).toEqual({ day: '2026-11-14', exercises: [] });
  });
});

describe('sets', () => {
  it('parseKg and parseSet', () => {
    expect(parseKg('42,5')).toBe(42.5);
    expect(parseKg('')).toBeUndefined();
    expect(parseKg('abc')).toBeNull();
    expect(parseKg('501')).toBeNull();
    expect(parseSet('10', '40')).toEqual({ reps: 10, kg: 40 });
    expect(parseSet('12', '')).toEqual({ reps: 12 });
    expect(parseSet('0', '40')).toBe('reps');
    expect(parseSet('8.5', '40')).toBe('reps');
    expect(parseSet('8', '4o')).toBe('kg');
  });
  it('setsText', () => {
    expect(setsText([{ reps: 10, kg: 40 }, { reps: 10, kg: 40 }, { reps: 10, kg: 40 }])).toBe('3 × 10 · 40 kg');
    expect(setsText([{ reps: 10, kg: 40 }, { reps: 8, kg: 42.5 }])).toBe('10 × 40 kg, 8 × 42,5 kg');
    expect(setsText([{ reps: 12 }, { reps: 12 }])).toBe('2 × 12');
    expect(setsText([{ reps: 12 }, { reps: 10 }])).toBe('12, 10');
    expect(setsText([])).toBe('');
  });
});

describe('log changes', () => {
  const l = log(WED);
  it('a set makes it done; removing the last set makes it pending again', () => {
    const a = withSet(l, 'p0', { reps: 10, kg: 40 });
    expect(a.exercises[0]).toEqual({ id: 'p0', name: 'Agachamento livre', sets: [{ reps: 10, kg: 40 }], status: 'feito' });
    const b = withSetAt(a, 'p0', 0, { reps: 9, kg: 40 });
    expect(b.exercises[0]!.sets).toEqual([{ reps: 9, kg: 40 }]);
    expect(withoutSet(b, 'p0', 0).exercises[0]).toEqual({ id: 'p0', name: 'Agachamento livre', sets: [] });
  });
  it('skipped only without sets; cleared back to pending', () => {
    const s = withSkipped(l, 'p5');
    expect(s.exercises[5]!.status).toBe('pulado');
    expect(withStatusCleared(s, 'p5').exercises[5]).toEqual({ id: 'p5', name: 'Abdominal', sets: [] });
    const done = withSet(l, 'p0', { reps: 5 });
    expect(withSkipped(done, 'p0')).toEqual(done);
  });
  it('swapped keeps its replacement while sets are added', () => {
    const t = withSet(withReplaced(l, 'p2', '  afundo  '), 'p2', { reps: 12, kg: 20 });
    expect(t.exercises[2]).toMatchObject({ status: 'trocado', replacedBy: 'Afundo', sets: [{ reps: 12, kg: 20 }] });
    expect(withReplaced(l, 'p2', '   ')).toEqual(l);
  });
  it('a skipped exercise that gets a set is done', () => {
    expect(withSet(withSkipped(l, 'p1'), 'p1', { reps: 10 }).exercises[1]).toEqual({ id: 'p1', name: 'Leg press', sets: [{ reps: 10 }], status: 'feito' });
  });
  it('extras are added at the end and only they can be removed', () => {
    const e = withExtra(l, 'x-1', 'abdominal infra');
    expect(e.exercises[6]).toEqual({ id: 'x-1', name: 'Abdominal infra', sets: [], extra: true });
    expect(withoutExtra(e, 'x-1').exercises).toHaveLength(6);
    expect(withoutExtra(e, 'p0').exercises).toHaveLength(7);
    expect(withExtra(l, 'x-2', ' ')).toEqual(l);
  });
});

describe('cardio and summary', () => {
  it('cardioIssue and cardioText', () => {
    expect(cardioIssue({ modality: 'bicicleta', minutes: 20, intensity: 6 })).toBeUndefined();
    expect(cardioIssue({ modality: 'bicicleta', minutes: 0 })).toBe('minutes');
    expect(cardioIssue({ modality: 'bicicleta', minutes: 301 })).toBe('minutes');
    expect(cardioIssue({ modality: 'esteira', minutes: 20, intensity: 11 })).toBe('intensity');
    expect(cardioText({ modality: 'bicicleta', minutes: 20, intensity: 6 })).toBe('Bicicleta ergométrica · 20 min · intensidade 6');
    expect(cardioText({ modality: 'caminhada', minutes: 30 })).toBe('Caminhada · 30 min');
  });
  it('trainingSummaryText', () => {
    let l = log(WED);
    expect(trainingSummaryText(l)).toBe('Pernas: nada registrado');
    l = { ...l, ...withSet(l, 'p0', { reps: 10, kg: 80 }) };
    l = { ...l, ...withSet(l, 'p1', { reps: 10, kg: 100 }) };
    l = { ...l, ...withReplaced(l, 'p2', 'Afundo') };
    l = { ...l, ...withSkipped(l, 'p4') };
    expect(trainingSummaryText({ ...l, cardio: { modality: 'bicicleta', minutes: 20 } }))
      .toBe('Pernas: 2 feitos, 1 trocado, 1 pulado · cardio 20 min');
    expect(trainingSummaryText({ exercises: [], cardio: { modality: 'caminhada', minutes: 30 } }))
      .toBe('Treino: nada registrado · cardio 30 min');
  });
  it('adoptableWorkout: the linked one, else the first live of the kind that day', () => {
    const a = workout(WED, 'musculacao', 60, { id: 'a', at: 2 });
    const b = workout(WED, 'musculacao', 30, { id: 'b', at: 1 });
    const gone = workout(WED, 'musculacao', 30, { id: 'g', deleted: true, at: 0 });
    const other = workout('2026-11-10', 'musculacao', 30, { id: 'o' });
    expect(adoptableWorkout([a, b, gone, other], WED, 'musculacao', 'a')?.id).toBe('a');
    expect(adoptableWorkout([a, b, gone, other], WED, 'musculacao')?.id).toBe('b');
    expect(adoptableWorkout([a, b], WED, 'cardio')).toBeUndefined();
  });
});

describe('observed', () => {
  const day = (d: string, sets: Array<{ reps: number; kg?: number }>, p: Partial<TrainingLog> = {}): TrainingLog => {
    let l = log(d);
    for (const s of sets) l = { ...l, ...withSet(l, 'p0', s) };
    return { ...l, ...p };
  };
  const logs = [
    day('2026-11-04', [{ reps: 10, kg: 40 }, { reps: 10, kg: 40 }, { reps: 10, kg: 40 }]),
    day('2026-11-11', [{ reps: 10, kg: 40 }, { reps: 8, kg: 45 }, { reps: 9, kg: 45 }]),
    day('2026-10-28', [{ reps: 12 }]),
  ];
  it('lastSession: the newest before the day, never the day itself; by name, accents and case ignored', () => {
    expect(lastSession(logs, 'Agachamento livre', '2026-11-11')!.day).toBe('2026-11-04');
    expect(lastSessionText(lastSession(logs, 'AGACHAMENTO LIVRE', '2026-11-12')!)).toBe('Última: 10 × 40 kg, 8 × 45 kg, 9 × 45 kg');
    expect(lastSession(logs, 'Agachamento livre', '2026-10-28')).toBeUndefined();
    expect(lastSession(logs, 'Leg press', '2026-11-12')).toBeUndefined();
  });
  it('a swapped exercise counts under the replacement', () => {
    let l = log('2026-11-04');
    l = { ...l, ...withReplaced(l, 'p2', 'Afundo') };
    l = { ...l, ...withSet(l, 'p2', { reps: 12, kg: 20 }) };
    expect(lastSession([l], 'afundo', WED)!.sets).toEqual([{ reps: 12, kg: 20 }]);
    expect(lastSession([l], 'Cadeira extensora', WED)).toBeUndefined();
  });
  it('exerciseHistory: best set and volume per session, oldest → newest; deleted logs out', () => {
    const h = exerciseHistory([...logs, day('2026-11-12', [{ reps: 1, kg: 200 }], { deleted: true })], '2026-11-13');
    expect(h).toHaveLength(1);
    expect(h[0]!.name).toBe('Agachamento livre');
    expect(h[0]!.sessions.map((s) => [s.day, s.best, s.volume])).toEqual([
      ['2026-10-28', undefined, 0],
      ['2026-11-04', { kg: 40, reps: 10 }, 1200],
      ['2026-11-11', { kg: 45, reps: 9 }, 1165],
    ]);
  });
  it('exerciseHistory keeps the last 8 sessions and puts the most recently done first', () => {
    const one = (d: string, name: string, kg: number): TrainingLog => ({
      ...base, id: trainingLogId(d), day: d, exercises: [{ id: 'p0', name, status: 'feito', sets: [{ reps: 5, kg }] }],
    });
    const many = Array.from({ length: 10 }, (_, i) => one(`2026-10-${String(10 + i).padStart(2, '0')}`, 'Agachamento livre', 50 + i));
    const h = exerciseHistory([...many, one('2026-10-25', 'Leg press', 100)], '2026-11-13');
    expect(h.map((x) => x.name)).toEqual(['Leg press', 'Agachamento livre']);
    expect(h[1]!.sessions).toHaveLength(8);
    expect(h[1]!.sessions[0]!.day).toBe('2026-10-12');
  });
  it('cardioWeeks: complete weeks only, cardio of any source, deleted out', () => {
    const w = cardioWeeks([
      workout('2026-11-03', 'cardio', 20), workout('2026-11-05', 'cardio', 10, { minimum: true }),
      workout('2026-11-04', 'musculacao', 60), workout('2026-11-10', 'cardio', 30),
      workout('2026-11-06', 'cardio', 15, { deleted: true }),
    ], '2026-11-13', 2);
    expect(w.map((x) => [x.period.key, x.sessions, x.minutes])).toEqual([['2026-10-26', 0, 0], ['2026-11-02', 2, 30]]);
  });
});
