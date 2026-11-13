import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { SleepLog, SleepSettings, Workout } from '@life/shared';
import { sleepSettingsOf } from '@life/shared';
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
