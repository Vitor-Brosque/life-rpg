import type { BaseRecord, ID, SyncTable, TrainingLog, Workout, WorkoutKind, XpEvent } from '@life/shared';
import { WORKOUT_MAX_MIN, dayKeyOf, trainingLogId, workoutXp, workoutXpId } from '@life/shared';
import { db } from '../db/db';
import { mutate, newRecord, putAll } from '../db/repo';
import { hasLiveXp, withLock } from './common';

// Treino (Marco 4, spec §6). `workouts` is append-only: a log is created or soft-deleted, never edited.

const WORKOUT_AREA = 'area-vigor';

export class WorkoutValidationError extends Error {}

export interface WorkoutInput {
  kind: WorkoutKind;
  minutes: number;
  minimum?: boolean;
  blockId?: ID;
  /** Desfazer of a removal re-creates the log at its original time (and day). */
  at?: number;
  /** A retro record of a past day (Acompanhamento A, spec decision 2): the workout counts, but gives no XP. */
  noXp?: boolean;
}

/** Logs a workout; +5 XP (cardio +8) once per kind per logical day, to Vigor (none with `noXp`). */
export const logWorkout = (input: WorkoutInput): Promise<{ workout: Workout; xp: number }> => withLock('workout', async () => {
  const minutes = Math.round(input.minutes);
  if (!Number.isFinite(minutes) || minutes < 1) throw new WorkoutValidationError('Informe quantos minutos durou.');
  if (minutes > WORKOUT_MAX_MIN) throw new WorkoutValidationError('Até 300 minutos por registro.');
  const settings = await db.settings.get('settings');
  const at = input.at ?? Date.now();
  const day = dayKeyOf(at, settings?.dayStartHour ?? 4);
  const workout = newRecord<Workout>({
    at, day, kind: input.kind, minutes,
    ...(input.minimum ? { minimum: true } : {}),
    ...(input.blockId ? { blockId: input.blockId } : {}),
  });
  const entries: Array<{ table: SyncTable; record: BaseRecord }> = [{ table: 'workouts', record: workout }];
  const xpId = workoutXpId(input.kind, day);
  let xp = 0;
  if (!input.noXp && !(await hasLiveXp(xpId))) {
    xp = workoutXp(input.kind);
    entries.push({ table: 'xpEvents', record: newRecord<XpEvent>({
      id: xpId, at: Date.now(), amount: xp, reason: 'workout', dayKey: day, areaId: WORKOUT_AREA,
    }) });
  }
  await putAll(entries);
  return { workout: (await db.workouts.get(workout.id))!, xp };
});

/**
 * Soft-deletes a log (Desfazer, or "Apagar" in the list). The day's XP for that kind goes too, unless
 * another live log of the same kind remains that day. A workout linked to the day's training log
 * (Acompanhamento A) is unlinked: its cardio goes with the cardio workout; "Terminei" goes with the strength
 * one (the sets stay). Resolves with the removed log.
 */
export const removeWorkout = (id: ID): Promise<Workout | undefined> => withLock('workout', async () => {
  const w = await db.workouts.get(id);
  if (!w || w.deleted) return undefined;
  const sameKind = (await db.workouts.where('day').equals(w.day).toArray())
    .filter((o) => !o.deleted && o.id !== id && o.kind === w.kind);
  const entries: Array<{ table: SyncTable; record: BaseRecord }> = [{ table: 'workouts', record: { ...w, deleted: true } }];
  if (sameKind.length === 0) {
    const x = await db.xpEvents.get(workoutXpId(w.kind, w.day));
    if (x && !x.deleted) entries.push({ table: 'xpEvents', record: { ...x, deleted: true } });
  }
  await putAll(entries);
  const log = await db.trainingLogs.get(trainingLogId(w.day));
  if (log && !log.deleted && (log.cardioWorkoutId === id || log.strengthWorkoutId === id)) {
    await mutate<TrainingLog>('trainingLogs', log.id, (l) => {
      if (l.deleted) return undefined;
      if (l.cardioWorkoutId === id) return { cardio: undefined, cardioWorkoutId: undefined };
      if (l.strengthWorkoutId === id) return { strengthWorkoutId: undefined, finishedAt: undefined };
      return undefined;
    });
  }
  return w;
});

/**
 * Desfazer of "Apagar" in Corpo's list: the same log again, at its time. The day's XP comes back only when the
 * day had it for that kind (a past day's retro log from the training screen never had any).
 */
export async function restoreWorkout(gone: Workout): Promise<{ workout: Workout; xp: number }> {
  const hadXp = (await db.xpEvents.get(workoutXpId(gone.kind, gone.day))) !== undefined;
  return logWorkout({
    kind: gone.kind, minutes: gone.minutes, at: gone.at,
    ...(gone.minimum ? { minimum: true } : {}), ...(gone.blockId ? { blockId: gone.blockId } : {}),
    ...(hadXp ? {} : { noXp: true }),
  });
}

/**
 * A log's cardio corrected (Acompanhamento A): workouts are append-only, so the old record is soft-deleted and an
 * identical one with the new minutes takes its place, in one transaction. The day's XP is untouched.
 */
export const replaceWorkoutMinutes = (id: ID, minutes: number): Promise<Workout> => withLock('workout', async () => {
  const m = Math.round(minutes);
  if (!Number.isFinite(m) || m < 1) throw new WorkoutValidationError('Informe quantos minutos durou.');
  if (m > WORKOUT_MAX_MIN) throw new WorkoutValidationError('Até 300 minutos por registro.');
  const old = await db.workouts.get(id);
  if (!old || old.deleted) throw new Error(`workout ${id} not found`);
  const { id: _i, createdAt: _c, updatedAt: _u, deleted: _d, ...fields } = old;
  const next = newRecord<Workout>({ ...fields, minutes: m });
  await putAll([{ table: 'workouts', record: { ...old, deleted: true } }, { table: 'workouts', record: next }]);
  return (await db.workouts.get(next.id))!;
});
