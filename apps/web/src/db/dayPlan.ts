import type { Block, BlockOccurrence, BlockSession, Commitment, DayKey, DayState, Settings } from '@life/shared';
import { dayKeyOf, defaultDayMode, planDay } from '@life/shared';
import { db } from './db';

// What `planDay` needs, read from IndexedDB: shared by `useDayPlan` (live) and one-off reads.

export interface DayPlanData {
  key: DayKey;
  settings: Settings;
  blocks: Block[];
  commitments: Commitment[];
  sessions: BlockSession[];
  dayState?: DayState;
}

/** Inputs of `planDay` for `day`; undefined without settings. */
export async function readDayPlanData(day: DayKey): Promise<DayPlanData | undefined> {
  const settings = await db.settings.get('settings');
  if (!settings || settings.deleted) return undefined;
  const [blocks, commitments, sessions, dayState] = await Promise.all([
    db.blocks.filter((b) => !b.deleted).toArray(),
    db.commitments.filter((c) => !c.deleted).toArray(),
    db.blockSessions.where('day').equals(day).filter((s) => !s.deleted).toArray(),
    db.dayState.get(day),
  ]);
  return { key: day, settings, blocks, commitments, sessions, dayState: dayState && !dayState.deleted ? dayState : undefined };
}

export function planFromData(data: DayPlanData, now: number): BlockOccurrence[] {
  return planDay({
    day: data.key, now,
    dayStartHour: data.settings.dayStartHour, dayEndHour: data.settings.dayEndHour,
    mode: defaultDayMode(data.key, data.dayState), dayStartedAt: data.dayState?.startedAt,
    blocks: data.blocks, commitments: data.commitments, sessions: data.sessions,
  });
}

/** Today's 'current' occurrence right now (one-off read, e.g. when saving a note). */
export async function readCurrentBlock(now = Date.now()): Promise<BlockOccurrence | undefined> {
  const settings = await db.settings.get('settings');
  if (!settings || settings.deleted) return undefined;
  const data = await readDayPlanData(dayKeyOf(now, settings.dayStartHour));
  return data ? planFromData(data, now).find((o) => o.state === 'current') : undefined;
}
