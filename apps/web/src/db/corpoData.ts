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
  return settings ? sleepSettingsOf(settings) : undefined;
}

/** Live workouts, newest first; undefined while loading. */
export function useWorkouts(): Workout[] | undefined {
  return useLiveQuery(async () => (await db.workouts.orderBy('at').reverse().toArray()).filter((w) => !w.deleted));
}
