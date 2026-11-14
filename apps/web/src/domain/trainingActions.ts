import type { DayKey, ExerciseSet, ID, TrainingCardio, TrainingDay, TrainingLog, TrainingPlan } from '@life/shared';
import {
  CARDIO_ISSUE_TEXT, EFFORT_MAX, FIVE_DAY_SPLIT, TRAINING_PLAN_ID, WORKOUT_MAX_MIN, adoptableWorkout, cardioIssue,
  logicalTimestamp, normalizePlanDays, startTrainingLog, trainingLogId, ulid, withExtra, withReplaced, withSet, withSetAt,
  withSkipped, withStatusCleared, withoutExtra, withoutSet,
} from '@life/shared';
import { db } from '../db/db';
import { mutate, newRecord, put, upsert } from '../db/repo';
import { getToday, withLock } from './common';
import { WorkoutValidationError, logWorkout, removeWorkout, replaceWorkoutMinutes } from './workoutActions';

// Treino do dia (Acompanhamento A). The plan is one record ('plan'); the day log is one editable record per
// logical day, created only by the first explicit action. Sets give no XP: the only XP is the Marco 4 workout
// XP, through "Terminei o treino" and the log's cardio.

export class TrainingValidationError extends Error {}

const LOCK = 'training';

/** "Usar a divisão de exemplo de 5 dias": the plan from the template; an existing live plan is kept as it is. */
export const applyFiveDaySplit = (): Promise<TrainingPlan> => withLock('training-plan', async () => {
  const prev = await db.trainingPlans.get(TRAINING_PLAN_ID);
  if (prev && !prev.deleted) return prev;
  return put('trainingPlans', newRecord<TrainingPlan>({
    id: TRAINING_PLAN_ID, days: FIVE_DAY_SPLIT.map((d) => ({ ...d, exercises: [...d.exercises] })),
  }));
});

/** Saves the plan (normalised). Day logs keep the names they copied: history is not rewritten. */
export const saveTrainingPlan = (days: TrainingDay[]): Promise<TrainingPlan> => withLock('training-plan', () =>
  upsert<TrainingPlan>('trainingPlans', TRAINING_PLAN_ID, { days: normalizePlanDays(days) }, { days: [] }));

/** The live log of `day`, created from the plan when missing. Call inside withLock(LOCK). */
async function ensureLog(day: DayKey): Promise<TrainingLog> {
  const id = trainingLogId(day);
  const prev = await db.trainingLogs.get(id);
  if (prev && !prev.deleted) return prev;
  const plan = await db.trainingPlans.get(TRAINING_PLAN_ID);
  return put('trainingLogs', newRecord<TrainingLog>({ id, ...startTrainingLog(day, plan) }));
}

/** A pure change applied to the day's log, creating it on this first action. */
const edit = (day: DayKey, fn: (log: TrainingLog) => Partial<TrainingLog>): Promise<TrainingLog> =>
  withLock(LOCK, async () => mutate<TrainingLog>('trainingLogs', (await ensureLog(day)).id, fn));

export const addSet = (day: DayKey, exerciseId: ID, set: ExerciseSet) => edit(day, (l) => withSet(l, exerciseId, set));
export const updateSet = (day: DayKey, exerciseId: ID, index: number, set: ExerciseSet) =>
  edit(day, (l) => withSetAt(l, exerciseId, index, set));
export const removeSet = (day: DayKey, exerciseId: ID, index: number) => edit(day, (l) => withoutSet(l, exerciseId, index));
export const skipExercise = (day: DayKey, exerciseId: ID) => edit(day, (l) => withSkipped(l, exerciseId));
export const replaceExercise = (day: DayKey, exerciseId: ID, name: string) => edit(day, (l) => withReplaced(l, exerciseId, name));
export const clearExerciseStatus = (day: DayKey, exerciseId: ID) => edit(day, (l) => withStatusCleared(l, exerciseId));
export const addExtraExercise = (day: DayKey, name: string) => edit(day, (l) => withExtra(l, `x-${ulid()}`, name));
export const removeExtraExercise = (day: DayKey, exerciseId: ID) => edit(day, (l) => withoutExtra(l, exerciseId));

/** Esforço / recuperação, 1–5; undefined removes it. */
export function setTrainingFeel(day: DayKey, field: 'effort' | 'recovery', value?: number): Promise<TrainingLog> {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > EFFORT_MAX)) {
    return Promise.reject(new TrainingValidationError('Escolha de 1 a 5.'));
  }
  return edit(day, () => ({ [field]: value }));
}

/** A past day's workout lands at noon of that day; today's at the moment of the tap. */
async function workoutAt(day: DayKey): Promise<number | undefined> {
  if (day === (await getToday())) return undefined;
  return logicalTimestamp(day, '12:00', (await db.settings.get('settings'))?.dayStartHour ?? 4);
}

/** The log's cardio: one linked 'cardio' Workout, replaced (never duplicated) when its minutes change. */
export function saveCardio(day: DayKey, cardio: TrainingCardio): Promise<{ log: TrainingLog; xp: number; created: boolean }> {
  const issue = cardioIssue(cardio);
  if (issue) return Promise.reject(new TrainingValidationError(CARDIO_ISSUE_TEXT[issue]));
  return withLock(LOCK, async () => {
    const log = await ensureLog(day);
    const linked = log.cardioWorkoutId ? await db.workouts.get(log.cardioWorkoutId) : undefined;
    let workoutId: ID;
    let xp = 0;
    let created = false;
    if (linked && !linked.deleted) {
      workoutId = linked.minutes === cardio.minutes ? linked.id : (await replaceWorkoutMinutes(linked.id, cardio.minutes)).id;
    } else {
      const at = await workoutAt(day);
      const r = await logWorkout({ kind: 'cardio', minutes: cardio.minutes, ...(at !== undefined ? { at } : {}) });
      workoutId = r.workout.id;
      xp = r.xp;
      created = true;
    }
    const clean: TrainingCardio = {
      modality: cardio.modality, minutes: cardio.minutes, ...(cardio.intensity !== undefined ? { intensity: cardio.intensity } : {}),
    };
    const saved = await mutate<TrainingLog>('trainingLogs', log.id, () => ({ cardio: clean, cardioWorkoutId: workoutId }));
    return { log: saved, xp, created };
  });
}

/** "Apagar cardio": the log forgets it; its linked workout goes with removeWorkout's XP rule. */
export const removeCardio = (day: DayKey): Promise<void> => withLock(LOCK, async () => {
  const log = await db.trainingLogs.get(trainingLogId(day));
  if (!log || log.deleted || !log.cardio) return;
  if (log.cardioWorkoutId) await removeWorkout(log.cardioWorkoutId);
  await mutate<TrainingLog>('trainingLogs', log.id, () => ({ cardio: undefined, cardioWorkoutId: undefined }));
});

export interface FinishResult { log: TrainingLog; xp: number; workoutId: ID; created: boolean }

/**
 * "Terminei o treino": adopts a live 'musculacao' workout of the day when there is one (no second record and
 * no second XP); otherwise logs one with `minutes` (Marco 4 XP, once per kind and day).
 */
export function finishTraining(day: DayKey, minutes: number, blockId?: ID): Promise<FinishResult> {
  const m = Math.round(minutes);
  if (!Number.isFinite(m) || m < 1) return Promise.reject(new WorkoutValidationError('Informe quantos minutos durou.'));
  if (m > WORKOUT_MAX_MIN) return Promise.reject(new WorkoutValidationError('Até 300 minutos por registro.'));
  return withLock(LOCK, async () => {
    const log = await ensureLog(day);
    const adopt = adoptableWorkout(await db.workouts.where('day').equals(day).toArray(), day, 'musculacao', log.strengthWorkoutId);
    let workoutId: ID;
    let xp = 0;
    let created = false;
    if (adopt) workoutId = adopt.id;
    else {
      const at = await workoutAt(day);
      const r = await logWorkout({ kind: 'musculacao', minutes: m, ...(blockId ? { blockId } : {}), ...(at !== undefined ? { at } : {}) });
      workoutId = r.workout.id;
      xp = r.xp;
      created = true;
    }
    const saved = await mutate<TrainingLog>('trainingLogs', log.id, () => ({ finishedAt: Date.now(), strengthWorkoutId: workoutId }));
    return { log: saved, xp, workoutId, created };
  });
}

/** Desfazer of "Terminei": the workout goes only when this action created it. */
export const undoFinishTraining = (day: DayKey, r: Pick<FinishResult, 'workoutId' | 'created'>): Promise<void> =>
  withLock(LOCK, async () => {
    if (r.created) await removeWorkout(r.workoutId);
    const log = await db.trainingLogs.get(trainingLogId(day));
    if (log && !log.deleted) await mutate<TrainingLog>('trainingLogs', log.id, () => ({ finishedAt: undefined, strengthWorkoutId: undefined }));
  });

/** "Reabrir": only `finishedAt` goes; the workout stays (Corpo's list can remove it). */
export const reopenTraining = (day: DayKey): Promise<void> => withLock(LOCK, async () => {
  const log = await db.trainingLogs.get(trainingLogId(day));
  if (log && !log.deleted && log.finishedAt !== undefined) await mutate<TrainingLog>('trainingLogs', log.id, () => ({ finishedAt: undefined }));
});
