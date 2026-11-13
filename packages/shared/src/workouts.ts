import type { DayKey, ID, Workout, WorkoutKind } from './types';
import { addDays } from './dates';

// Treino (Marco 4, spec §6): quick log, modest Vigor XP and the week's count. No targets, no streaks.

export const WORKOUT_KINDS: readonly WorkoutKind[] = ['musculacao', 'cardio', 'outro'];
export const WORKOUT_LABEL: Record<WorkoutKind, string> = { musculacao: 'Musculação', cardio: 'Cardio', outro: 'Outro' };
/** Default minutes in the log sheet, per kind. */
export const WORKOUT_DEFAULT_MIN: Record<WorkoutKind, number> = { musculacao: 60, cardio: 30, outro: 30 };
export const WORKOUT_XP = 5;
/** Cardio is the one that is hard to start (contexto §9): a little more for starting it, minimum included. */
export const CARDIO_BONUS_XP = 3;
export const WORKOUT_MAX_MIN = 300;
/** "Versão mínima do cardio", like a block's minimum version. */
export const CARDIO_MINIMUM_MIN = 10;
export const CARDIO_MINIMUM_TEXT = 'caminhada leve ou bicicleta, em ritmo de conversa';

/** One award per kind per logical day: `xp-workout-${kind}-${day}`. */
export const workoutXpId = (kind: WorkoutKind, day: DayKey): ID => `xp-workout-${kind}-${day}`;

export const workoutXp = (kind: WorkoutKind): number => WORKOUT_XP + (kind === 'cardio' ? CARDIO_BONUS_XP : 0);

export interface WorkoutWeek {
  total: number;
  minutes: number;
  days: number;         // distinct days with a workout
  minimum: number;      // how many were the minimum cardio
  byKind: Record<WorkoutKind, number>;
}

/** Observed count of the week that starts on `weekStart` (a Monday): live workouts only. */
export function workoutWeek(workouts: readonly Workout[], weekStart: DayKey): WorkoutWeek {
  const end = addDays(weekStart, 6);
  const live = workouts.filter((w) => !w.deleted && w.day >= weekStart && w.day <= end);
  const byKind: Record<WorkoutKind, number> = { musculacao: 0, cardio: 0, outro: 0 };
  for (const w of live) byKind[w.kind] += 1;
  return {
    total: live.length,
    minutes: live.reduce((s, w) => s + w.minutes, 0),
    days: new Set(live.map((w) => w.day)).size,
    minimum: live.filter((w) => w.minimum).length,
    byKind,
  };
}
