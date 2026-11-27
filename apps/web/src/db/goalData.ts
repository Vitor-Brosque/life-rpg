import { useLiveQuery } from 'dexie-react-hooks';
import type { Goal } from '@life/shared';
import { db } from './db';

// Objetivos: reading only (opening a screen never writes).

/** Every goal not deleted (archived ones included: the rules pick); undefined while loading. */
export function useGoals(): Goal[] | undefined {
  return useLiveQuery(async () => (await db.goals.toArray()).filter((g) => !g.deleted));
}
