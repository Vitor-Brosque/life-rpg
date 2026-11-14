import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import {
  TrainingValidationError, addSet, applyFiveDaySplit, finishTraining, removeCardio, reopenTraining, saveCardio,
  saveTrainingPlan, undoFinishTraining,
} from '../src/domain/trainingActions';
import { logWorkout, replaceWorkoutMinutes } from '../src/domain/workoutActions';
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
