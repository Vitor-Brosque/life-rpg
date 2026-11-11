import type { DayState, EnergyLevel, EnergyLog, FocusSession, Journey } from '@life/shared';
import { focusXp, JOURNEY_XP, REVIEW_XP } from '@life/shared';
import { db } from '../db/db';
import { newRecord, patch, put } from '../db/repo';
import { awardXp, getToday, logEvent } from './common';

export async function completeJourney(id: string): Promise<{ xp: number }> {
  const j = await db.journeys.get(id);
  if (!j) throw new Error(`journey ${id} not found`);
  if (j.status === 'done') return { xp: 0 };
  const today = await getToday();
  await patch<Journey>('journeys', id, { status: 'done' });
  await awardXp(JOURNEY_XP, 'journey', today, { areaId: j.areaId });
  return { xp: JOURNEY_XP };
}

export async function setEnergy(level: EnergyLevel): Promise<void> {
  await put('energyLogs', newRecord<EnergyLog>({ at: Date.now(), level }));
}

async function upsertDayState(day: string, changes: Partial<DayState>): Promise<DayState> {
  const existing = await db.dayState.get(day);
  if (existing) return patch<DayState>('dayState', day, changes);
  return put('dayState', newRecord<DayState>({ id: day, hardDay: false, reviewDone: false, ...changes }));
}

export async function setHardDay(on: boolean): Promise<void> {
  const today = await getToday();
  await upsertDayState(today, { hardDay: on });
  await logEvent('hardDay', undefined, { on });
}

export async function finishReview(): Promise<{ xp: number }> {
  const today = await getToday();
  const existing = await db.dayState.get(today);
  if (existing?.reviewDone) return { xp: 0 };
  await upsertDayState(today, { reviewDone: true });
  await awardXp(REVIEW_XP, 'review', today);
  await logEvent('review');
  return { xp: REVIEW_XP };
}

export async function recordFocus(
  s: Omit<FocusSession, 'id' | 'createdAt' | 'updatedAt' | 'deleted'>,
): Promise<{ xp: number }> {
  const today = await getToday();
  let already = 0;
  await db.xpEvents.where('dayKey').equals(today).each((x) => {
    if (!x.deleted && x.reason === 'focus') already += x.amount;
  });
  const xp = focusXp(s.activeMs, already);
  await put('focusSessions', newRecord<FocusSession>(s));
  if (xp > 0) await awardXp(xp, 'focus', today, { areaId: s.areaId, missionId: s.missionId });
  await logEvent('focus', s.missionId, { activeMs: s.activeMs, outcome: s.outcome, xp });
  return { xp };
}
