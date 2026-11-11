import type { DayState, EnergyLevel, EnergyLog, FocusSession, Journey } from '@life/shared';
import { focusXp, JOURNEY_XP, REVIEW_XP } from '@life/shared';
import { db } from '../db/db';
import { newRecord, patch, put } from '../db/repo';
import { awardXp, getToday, logEvent, withLock } from './common';

export const completeJourney = (id: string): Promise<{ xp: number }> =>
  withLock(`journey:${id}`, () => completeJourneyLocked(id));

async function completeJourneyLocked(id: string): Promise<{ xp: number }> {
  const j = await db.journeys.get(id);
  if (!j) throw new Error(`journey ${id} not found`);
  if (j.status === 'done') return { xp: 0 };
  const today = await getToday();
  await patch<Journey>('journeys', id, { status: 'done' });
  // Once per journey, even when it is reactivated and completed again.
  const xpId = `xp-journey-${id}`;
  const awarded = await db.xpEvents.get(xpId);
  if (awarded && !awarded.deleted) return { xp: 0 };
  await awardXp(JOURNEY_XP, 'journey', today, { areaId: j.areaId, id: xpId });
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

export const finishReview = (): Promise<{ xp: number }> => withLock('review', finishReviewLocked);

async function finishReviewLocked(): Promise<{ xp: number }> {
  const today = await getToday();
  const existing = await db.dayState.get(today);
  if (existing?.reviewDone) return { xp: 0 };
  await upsertDayState(today, { reviewDone: true });
  await awardXp(REVIEW_XP, 'review', today, { id: `xp-review-${today}` });
  await logEvent('review');
  return { xp: REVIEW_XP };
}

/** `id` defaults to `focus-${startedAt}` (the timer adds the Pomodoro count for each phase). */
type FocusInput = Omit<FocusSession, 'id' | 'createdAt' | 'updatedAt' | 'deleted'> & { id?: string };

export const recordFocus = (s: FocusInput): Promise<{ xp: number }> =>
  withLock('focus', () => recordFocusLocked(s));

async function recordFocusLocked(input: FocusInput): Promise<{ xp: number }> {
  const { id: givenId, ...s } = input;
  // Deterministic id: the same session recorded twice (e.g. by two tabs) is stored once.
  const id = givenId ?? `focus-${s.startedAt}`;
  const existing = await db.focusSessions.get(id);
  if (existing && !existing.deleted) return { xp: 0 };
  const today = await getToday();
  let already = 0;
  await db.xpEvents.where('dayKey').equals(today).each((x) => {
    if (!x.deleted && x.reason === 'focus') already += x.amount;
  });
  const xp = focusXp(s.activeMs, already);
  await put('focusSessions', newRecord<FocusSession>({ ...s, id }));
  if (xp > 0) {
    await awardXp(xp, 'focus', today, { areaId: s.areaId, missionId: s.missionId, id: `xp-focus-${id}` });
  }
  await logEvent('focus', s.missionId, { activeMs: s.activeMs, outcome: s.outcome, xp });
  return { xp };
}
