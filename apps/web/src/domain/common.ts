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

export async function awardXp(
  amount: number, reason: XpReason, day: DayKey, extra: { areaId?: string; missionId?: string } = {},
): Promise<XpEvent> {
  return put('xpEvents', newRecord<XpEvent>({
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
