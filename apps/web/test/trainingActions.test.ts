import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import {
  TrainingValidationError, addSet, applyFiveDaySplit, finishTraining, removeCardio, reopenTraining, saveCardio,
  saveTrainingPlan, undoFinishTraining,
} from '../src/domain/trainingActions';
import { logWorkout, removeWorkout, replaceWorkoutMinutes, restoreWorkout } from '../src/domain/workoutActions';
import { at } from './blockFixture';

const DAY = '2026-11-11';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 12, 40));
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

const liveWorkouts = async (kind?: string) => (await db.workouts.toArray()).filter((w) => !w.deleted && (!kind || w.kind === kind));
const liveXp = async () => (await db.xpEvents.toArray()).filter((x) => !x.deleted);

describe('treino do dia — ações', () => {
  it('the first set creates the day log from the plan, with no XP', async () => {
    await applyFiveDaySplit();
    const xpBefore = (await liveXp()).length;
    await addSet(DAY, 'p0', { reps: 10, kg: 80 });
    const log = await db.trainingLogs.get('training-2026-11-11');
    expect(log).toMatchObject({ planName: 'Pernas', day: DAY });
    expect(log!.exercises).toHaveLength(6);
    expect(log!.exercises[0]).toMatchObject({ id: 'p0', status: 'feito', sets: [{ reps: 10, kg: 80 }] });
    expect((await liveXp()).length).toBe(xpBefore);
  });

  it('"Terminei" logs a workout once; reopening and finishing again adopts it; undo of an adoption keeps it', async () => {
    await applyFiveDaySplit();
    const r = await finishTraining(DAY, 75);
    expect(r).toMatchObject({ xp: 5, created: true });
    expect(r.log.finishedAt).toBeDefined();
    const w = await liveWorkouts('musculacao');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ minutes: 75 });
    await reopenTraining(DAY);
    expect((await db.trainingLogs.get('training-2026-11-11'))!.finishedAt).toBeUndefined();
    const r2 = await finishTraining(DAY, 60);
    expect(r2).toMatchObject({ xp: 0, created: false, workoutId: w[0]!.id });
    expect(await liveWorkouts('musculacao')).toHaveLength(1);
    await undoFinishTraining(DAY, { workoutId: r2.workoutId, created: false });
    expect(await liveWorkouts('musculacao')).toHaveLength(1);
    expect((await db.trainingLogs.get('training-2026-11-11'))!.finishedAt).toBeUndefined();
  });

  it('undo of a creation removes the workout', async () => {
    const r = await finishTraining(DAY, 50);
    await undoFinishTraining(DAY, r);
    expect(await liveWorkouts('musculacao')).toHaveLength(0);
  });

  it('adopts a musculacao workout logged earlier', async () => {
    await logWorkout({ kind: 'musculacao', minutes: 70 });
    const r = await finishTraining(DAY, 60);
    expect(r).toMatchObject({ created: false, xp: 0 });
    expect(await liveWorkouts('musculacao')).toHaveLength(1);
  });

  it('cardio: one linked workout, replaced when the minutes change, XP once', async () => {
    const first = await saveCardio(DAY, { modality: 'bicicleta', minutes: 20, intensity: 6 });
    expect(first).toMatchObject({ xp: 8, created: true });
    const id1 = first.log.cardioWorkoutId!;
    expect((await db.workouts.get(id1))!.deleted).toBe(false);
    const second = await saveCardio(DAY, { modality: 'bicicleta', minutes: 30, intensity: 6 });
    expect(second).toMatchObject({ xp: 0, created: false });
    const id2 = second.log.cardioWorkoutId!;
    expect(id2).not.toBe(id1);
    expect((await db.workouts.get(id1))!.deleted).toBe(true);
    expect(await liveWorkouts('cardio')).toHaveLength(1);
    expect((await db.workouts.get(id2))!.minutes).toBe(30);
    const xp = await db.xpEvents.get('xp-workout-cardio-2026-11-11');
    expect(xp).toMatchObject({ amount: 8, deleted: false });
    const third = await saveCardio(DAY, { modality: 'esteira', minutes: 30 });
    expect(third.log.cardioWorkoutId).toBe(id2);
    expect(third.log.cardio).toEqual({ modality: 'esteira', minutes: 30 });
  });

  it('removeCardio deletes the workout, the cardio and the day XP', async () => {
    await saveCardio(DAY, { modality: 'bicicleta', minutes: 20 });
    await removeCardio(DAY);
    expect(await liveWorkouts('cardio')).toHaveLength(0);
    const log = await db.trainingLogs.get('training-2026-11-11');
    expect(log!.cardio).toBeUndefined();
    expect(log!.cardioWorkoutId).toBeUndefined();
    expect((await db.xpEvents.get('xp-workout-cardio-2026-11-11'))!.deleted).toBe(true);
  });

  it('the plan: split applied once, normalised on save, and day logs keep the name they copied', async () => {
    await applyFiveDaySplit();
    await applyFiveDaySplit();
    expect(await db.trainingPlans.count()).toBe(1);
    const plan = (await db.trainingPlans.get('plan'))!;
    expect(plan.days).toHaveLength(5);
    await addSet(DAY, 'p0', { reps: 8 });
    const saved = await saveTrainingPlan(plan.days.map((d) => (d.name === 'Pernas' ? { ...d, name: '  Inferiores ' } : d)));
    expect(saved.days.find((d) => d.weekday === 3)!.name).toBe('Inferiores');
    expect((await db.trainingLogs.get('training-2026-11-11'))!.planName).toBe('Pernas');
  });

  it('validation: cardio with 0 minutes and 301-minute replacement are rejected', async () => {
    await expect(saveCardio(DAY, { modality: 'bicicleta', minutes: 0 })).rejects.toThrow(TrainingValidationError);
    await expect(saveCardio(DAY, { modality: 'bicicleta', minutes: 0 })).rejects.toThrow('Informe quantos minutos durou (de 1 a 300).');
    const { workout } = await logWorkout({ kind: 'cardio', minutes: 10 });
    await expect(replaceWorkoutMinutes(workout.id, 301)).rejects.toThrow('Até 300 minutos por registro.');
  });
});

describe('treino de um dia passado — sem XP (spec decisão 2)', () => {
  const PAST = '2026-11-04';
  it('"Terminei" and the cardio of a past day create the workouts at noon of that day, with no XP', async () => {
    await applyFiveDaySplit();
    await addSet(PAST, 'p0', { reps: 10 });
    const fin = await finishTraining(PAST, 60);
    expect(fin).toMatchObject({ created: true, xp: 0 });
    const card = await saveCardio(PAST, { modality: 'esteira', minutes: 25 });
    expect(card).toMatchObject({ created: true, xp: 0 });
    const live = await liveWorkouts();
    expect(live.map((w) => [w.kind, w.day, w.minutes]).sort()).toEqual([['cardio', PAST, 25], ['musculacao', PAST, 60]]);
    expect(live.every((w) => w.at === at(4, 12, 0))).toBe(true);
    expect(await liveXp()).toEqual([]);
    // Correcting the past cardio still gives nothing; today's training still gives its XP.
    await saveCardio(PAST, { modality: 'esteira', minutes: 30 });
    expect(await liveXp()).toEqual([]);
    expect(await finishTraining(DAY, 45)).toMatchObject({ created: true, xp: 5 });
  });
});

describe('apagar no Corpo um treino ligado ao registro do dia', () => {
  it('the log cardio workout: the log forgets the cardio and the link', async () => {
    const r = await saveCardio(DAY, { modality: 'bicicleta', minutes: 20, intensity: 6 });
    await removeWorkout(r.log.cardioWorkoutId!);
    const log = (await db.trainingLogs.get('training-2026-11-11'))!;
    expect(log.cardio).toBeUndefined();
    expect(log.cardioWorkoutId).toBeUndefined();
    expect(await liveWorkouts('cardio')).toHaveLength(0);
  });

  it('the log strength workout: the link and "Terminei" go; the sets stay', async () => {
    await applyFiveDaySplit();
    await addSet(DAY, 'p0', { reps: 10 });
    const r = await finishTraining(DAY, 60);
    await removeWorkout(r.workoutId);
    const log = (await db.trainingLogs.get('training-2026-11-11'))!;
    expect(log.strengthWorkoutId).toBeUndefined();
    expect(log.finishedAt).toBeUndefined();
    expect(log.exercises[0]!.sets).toEqual([{ reps: 10 }]);
  });

  it('another workout of the day leaves the log as it is', async () => {
    const r = await saveCardio(DAY, { modality: 'bicicleta', minutes: 20 });
    const other = await logWorkout({ kind: 'cardio', minutes: 10, minimum: true });
    await removeWorkout(other.workout.id);
    expect((await db.trainingLogs.get('training-2026-11-11'))).toMatchObject({ cardioWorkoutId: r.log.cardioWorkoutId, cardio: { minutes: 20 } });
  });

  it('Desfazer of a removal gives the XP back only when the day had it (a retro log of a past day never had it)', async () => {
    const past = await saveCardio('2026-11-04', { modality: 'esteira', minutes: 25 });
    const gone = await removeWorkout(past.log.cardioWorkoutId!);
    expect((await restoreWorkout(gone!)).xp).toBe(0);
    expect(await liveXp()).toEqual([]);
    const today = await logWorkout({ kind: 'cardio', minutes: 30 });
    const goneToday = await removeWorkout(today.workout.id);
    expect((await restoreWorkout(goneToday!)).xp).toBe(8);
  });
});
