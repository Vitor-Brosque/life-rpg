import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { BlockOccurrence, DayKey } from '@life/shared';
import { defaultDayMode } from '@life/shared';
import { planFromData } from '../../db/dayPlan';
import { db } from '../../db/db';
import { useNow } from '../../db/hooks';

export interface DayBlocks {
  /** The day's type is 'free' (weekends by default): no blocks, "Dia livre". */
  free: boolean;
  occurrences: BlockOccurrence[];
}

/**
 * The routine as `planDay` lays it out on each of `days` (with that day's recorded type, else the
 * weekday default). An empty map while there is no routine, undefined while loading.
 */
export function useWeekBlocks(days: DayKey[]): Map<DayKey, DayBlocks> | undefined {
  const now = useNow();
  const key = days.join(',');
  const data = useLiveQuery(async () => {
    if (!key) return undefined;
    const list = key.split(',');
    const settings = await db.settings.get('settings');
    if (!settings || settings.deleted) return undefined;
    const [blocks, commitments, sessions, states] = await Promise.all([
      db.blocks.filter((b) => !b.deleted).toArray(),
      db.commitments.filter((c) => !c.deleted).toArray(),
      db.blockSessions.where('day').anyOf(list).filter((s) => !s.deleted).toArray(),
      db.dayState.bulkGet(list),
    ]);
    return { key, settings, blocks, commitments, sessions, states };
  }, [key]);

  return useMemo(() => {
    if (!data || data.key !== key) return undefined;
    const out = new Map<DayKey, DayBlocks>();
    if (!data.blocks.some((b) => !b.archived)) return out;
    key.split(',').forEach((day, i) => {
      const state = data.states[i];
      const dayState = state && !state.deleted ? state : undefined;
      const occurrences = planFromData({
        key: day, settings: data.settings, blocks: data.blocks, commitments: data.commitments,
        sessions: data.sessions.filter((s) => s.day === day), dayState,
      }, now);
      out.set(day, { free: defaultDayMode(day, dayState) === 'free', occurrences });
    });
    return out;
  }, [data, key, now]);
}
