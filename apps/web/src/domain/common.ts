import type { DayKey, EventType, LifeEvent, Settings, XpEvent, XpReason } from '@life/shared';
import { dayKeyOf } from '@life/shared';
import { db } from '../db/db';
import { newRecord, put } from '../db/repo';

export async function getToday(): Promise<DayKey> {
  const s: Settings | undefined = await db.settings.get('settings');
  return dayKeyOf(Date.now(), s?.dayStartHour ?? 4);
}

export async function logEvent(
  type: EventType, missionId?: string, data?: Record<string, unknown>,
): Promise<LifeEvent> {
  return put('events', newRecord<LifeEvent>({
    at: Date.now(), type, ...(missionId ? { missionId } : {}), ...(data ? { data } : {}),
  }));
}

/**
 * `extra.id` gives the award a deterministic id, so the same award made on two devices (or twice
 * on one) merges into one record; writing it again revives a soft-deleted one.
 */
export async function awardXp(
  amount: number, reason: XpReason, day: DayKey,
  extra: { areaId?: string; missionId?: string; id?: string } = {},
): Promise<XpEvent> {
  return put('xpEvents', newRecord<XpEvent>({
    ...(extra.id ? { id: extra.id } : {}),
    at: Date.now(), amount, reason, dayKey: day,
    ...(extra.areaId ? { areaId: extra.areaId } : {}),
    ...(extra.missionId ? { missionId: extra.missionId } : {}),
  }));
}

export async function hasXp(missionId: string, reason: XpReason): Promise<boolean> {
  return (await db.xpEvents.where('missionId').equals(missionId).toArray())
    .some((x) => !x.deleted && x.reason === reason);
}

export async function totalXp(): Promise<number> {
  let sum = 0;
  await db.xpEvents.each((x) => { if (!x.deleted) sum += x.amount; });
  return sum;
}

const locks = new Map<string, Promise<unknown>>();

/** Serialises async read-check-write sequences that share a key (prevents double XP awards). */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return run;
}
