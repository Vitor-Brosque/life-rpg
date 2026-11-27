import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKey, SleepLog, SleepSettings, TrainingLog, TrainingPlan, Workout } from '@life/shared';
import { TRAINING_PLAN_ID, readPlan, sleepSettingsOf, trainingLogId } from '@life/shared';
import { db } from './db';
import { useSettings } from './hooks';

// Live data of the Corpo screen, the Agora's sleep row and the body block (Marco 4).

/** Live sleep nights (not deleted); undefined while loading. */
export function useSleepLogs(): SleepLog[] | undefined {
  return useLiveQuery(async () => (await db.sleepLogs.toArray()).filter((l) => !l.deleted));
}

/** `settings.sleep` with defaults; undefined while the settings load. */
export function useSleepSettings(): SleepSettings | undefined {
  const settings = useSettings();
  // Same object while the settings don't change, so effects that depend on it don't re-run every render.
  return useMemo(() => (settings ? sleepSettingsOf(settings) : undefined), [settings]);
}

/** Live workouts, newest first; undefined while loading. */
export function useWorkouts(): Workout[] | undefined {
  return useLiveQuery(async () => (await db.workouts.orderBy('at').reverse().toArray()).filter((w) => !w.deleted));
}

/** The training plan: undefined while loading, null when there is none. */
export function useTrainingPlan(): TrainingPlan | null | undefined {
  return useLiveQuery(async () => {
    const p = await db.trainingPlans.get(TRAINING_PLAN_ID);
    // Plans saved before 2026-11-25 hold plain strings: the screens always see objects.
    return p && !p.deleted ? readPlan(p) : null;
  });
}

/** The day's training log: undefined while loading, null when there is none (or no day). */
export function useTrainingLog(day?: DayKey): TrainingLog | null | undefined {
  return useLiveQuery(async () => {
    if (!day) return null;
    const l = await db.trainingLogs.get(trainingLogId(day));
    return l && !l.deleted ? l : null;
  }, [day]);
}

/** Every live training log; undefined while loading. */
export function useTrainingLogs(): TrainingLog[] | undefined {
  return useLiveQuery(async () => (await db.trainingLogs.toArray()).filter((l) => !l.deleted));
}
