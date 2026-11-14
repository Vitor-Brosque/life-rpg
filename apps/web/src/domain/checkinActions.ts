import type { Blocker, Checkin, ID } from '@life/shared';
import { CHECKIN_XP } from '@life/shared';
import { db } from '../db/db';
import { newRecord, patch, put } from '../db/repo';
import { awardXp, getToday, hasLiveXp, withLock } from './common';

interface CheckinInput { feelings: string[]; thought?: string; experimentMin?: number; missionId?: ID; blockId?: ID; blocker?: Blocker }

/** Start card answered: stores the check-in; +2 XP once per mission per day (none without a mission). */
export const saveCheckin = (c: CheckinInput): Promise<{ id: ID; xp: number }> =>
  withLock(`checkin:${c.missionId ?? ''}`, () => saveCheckinLocked(c));

async function saveCheckinLocked(c: CheckinInput): Promise<{ id: ID; xp: number }> {
  const thought = c.thought?.trim();
  const saved = await put('checkins', newRecord<Checkin>({
    at: Date.now(), kind: 'start', feelings: [...c.feelings],
    ...(thought ? { thought } : {}),
    ...(c.experimentMin !== undefined ? { experimentMin: c.experimentMin } : {}),
    ...(c.missionId ? { missionId: c.missionId } : {}),
    ...(c.blockId ? { blockId: c.blockId } : {}),
    ...(c.blocker ? { blocker: c.blocker } : {}),
  }));
  if (!c.missionId) return { id: saved.id, xp: 0 };
  const today = await getToday();
  const xpId = `xp-checkin-${c.missionId}-${today}`;
  if (await hasLiveXp(xpId)) return { id: saved.id, xp: 0 };
  const mission = await db.missions.get(c.missionId);
  await awardXp(CHECKIN_XP, 'checkin', today, {
    id: xpId, missionId: c.missionId, ...(mission?.areaId ? { areaId: mission.areaId } : {}),
  });
  return { id: saved.id, xp: CHECKIN_XP };
}

export async function setCheckinOutcome(id: ID, outcome: 'continued' | 'stopped'): Promise<void> {
  await patch<Checkin>('checkins', id, { outcome });
}

/** "Escapei": recorded for the weekly review only; never touches XP and pauses nothing. */
export async function logEscape(c: { escapedTo: string; missionId?: ID; blockId?: ID }): Promise<void> {
  await put('checkins', newRecord<Checkin>({
    at: Date.now(), kind: 'escape', feelings: [], escapedTo: c.escapedTo,
    ...(c.missionId ? { missionId: c.missionId } : {}),
    ...(c.blockId ? { blockId: c.blockId } : {}),
  }));
}
