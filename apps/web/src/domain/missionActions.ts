import type {
  Area, Commitment, DayKey, HHmm, Journey, LifeEvent, Mission, MissionStatus,
} from '@life/shared';
import {
  addDays, completionXp, formatHHmm, levelFromXp, nextOccurrence, normalize, parseHHmm,
  parseLines, startXp, strategyXp, ulid,
} from '@life/shared';
import { db } from '../db/db';
import { newRecord, patch, put, softDelete } from '../db/repo';
import { awardXp, getToday, hasXp, logEvent, totalXp } from './common';

export interface CompletionResult { xp: number; leveledUp: boolean; newLevel: number; next?: Mission }

const baseMission = {
  checklist: [], status: 'open' as MissionStatus, important: false, shrunk: false, postponeCount: 0,
};

const MAX_MINUTE = 23 * 60 + 59;

export async function createMission(fields: Partial<Mission> & { title: string }): Promise<Mission> {
  const m = await put('missions', newRecord<Mission>({ ...baseMission, ...fields }));
  await logEvent('created', m.id);
  return m;
}

export async function createCommitment(
  fields: Partial<Commitment> & { title: string; date: DayKey; start: HHmm },
): Promise<Commitment> {
  const end = fields.end ?? formatHHmm(Math.min(parseHHmm(fields.start) + 60, MAX_MINUTE));
  const c = await put('commitments', newRecord<Commitment>({ remind: true, ...fields, end }));
  await logEvent('created', undefined, { commitmentId: c.id });
  return c;
}

export async function convertCommitmentToMission(id: string): Promise<Mission> {
  const c = await db.commitments.get(id);
  if (!c) throw new Error(`commitment ${id} not found`);
  const m = await createMission({ title: c.title, date: c.date });
  await softDelete('commitments', id);
  return m;
}

async function resolveJourney(name: string): Promise<Journey> {
  const key = normalize(name.trim());
  const all = await db.journeys.filter((j) => !j.deleted).toArray();
  const found = all.find((j) => normalize(j.title) === key);
  if (found) return found;
  const order = all.reduce((mx, j) => Math.max(mx, j.order + 1), 0);
  return put('journeys', newRecord<Journey>({ title: name.trim(), status: 'active', order }));
}

function resolveArea(areas: Area[], query: string): Area | undefined {
  const q = normalize(query.trim());
  if (!q) return undefined;
  return areas.find((a) => normalize(a.name).startsWith(q) || normalize(a.attribute).startsWith(q));
}

export async function captureLines(
  text: string, extra: Partial<Mission> = {},
): Promise<Array<Mission | Commitment>> {
  const today = await getToday();
  const areas = (await db.areas.orderBy('order').toArray()).filter((a) => !a.deleted && !a.archived);
  const out: Array<Mission | Commitment> = [];
  for (const p of parseLines(text, today)) {
    const area = p.areaQuery ? resolveArea(areas, p.areaQuery) : undefined;
    if (p.kind === 'commitment' && p.time) {
      out.push(await createCommitment({
        title: p.title, date: p.date ?? today, start: p.time,
        ...(p.durationMin ? { end: formatHHmm(Math.min(parseHHmm(p.time) + p.durationMin, MAX_MINUTE)) } : {}),
      }));
      continue;
    }
    const journey = p.journeyName ? await resolveJourney(p.journeyName) : undefined;
    out.push(await createMission({
      ...extra,
      title: p.title,
      important: p.important || (extra.important ?? false),
      ...(p.durationMin !== undefined ? { durationMin: p.durationMin } : {}),
      ...(p.date ? { date: p.date } : {}),
      ...(area ? { areaId: area.id } : {}),
      ...(journey ? { journeyId: journey.id } : {}),
    }));
  }
  return out;
}

export async function startMission(id: string): Promise<{ xp: number }> {
  const m = await db.missions.get(id);
  if (!m) throw new Error(`mission ${id} not found`);
  const today = await getToday();
  await patch<Mission>('missions', id, { status: 'doing', startedAt: Date.now() });
  let xp = 0;
  if (!(await hasXp(id, 'start'))) {
    xp = startXp(m);
    if (xp > 0) await awardXp(xp, 'start', today, { areaId: m.areaId, missionId: id });
  }
  await logEvent('started', id);
  return { xp };
}

function nextInstance(m: Mission, today: DayKey): Promise<Mission> {
  return put('missions', newRecord<Mission>({
    title: m.title,
    checklist: m.checklist.map((c) => ({ ...c, id: ulid(), done: false })),
    status: 'open', important: m.important, shrunk: false, postponeCount: 0,
    ...(m.firstStep !== undefined ? { firstStep: m.firstStep } : {}),
    ...(m.notes !== undefined ? { notes: m.notes } : {}),
    ...(m.durationMin !== undefined ? { durationMin: m.durationMin } : {}),
    ...(m.energy !== undefined ? { energy: m.energy } : {}),
    ...(m.areaId !== undefined ? { areaId: m.areaId } : {}),
    ...(m.journeyId !== undefined ? { journeyId: m.journeyId } : {}),
    ...(m.journeyOrder !== undefined ? { journeyOrder: m.journeyOrder } : {}),
    recurrence: m.recurrence,
    date: nextOccurrence(m.recurrence!, m.date, today),
  }));
}

export async function completeMission(id: string): Promise<CompletionResult> {
  const m = await db.missions.get(id);
  if (!m) throw new Error(`mission ${id} not found`);
  const today = await getToday();
  const [dayState, before, completionsTodayBefore] = await Promise.all([
    db.dayState.get(today),
    totalXp(),
    db.xpEvents.where('dayKey').equals(today).filter((x) => !x.deleted && x.reason === 'complete').count(),
  ]);
  const { amount, resilience } = completionXp(m, {
    completionsTodayBefore, hardDay: dayState && !dayState.deleted ? dayState.hardDay : false,
  });
  const ref = { areaId: m.areaId, missionId: id };
  const xpIds: string[] = [(await awardXp(amount, 'complete', today, ref)).id];
  if (resilience > 0) xpIds.push((await awardXp(resilience, 'resilience', today, ref)).id);
  const next = m.recurrence ? await nextInstance(m, today) : undefined;
  await patch<Mission>('missions', id, { status: 'done', completedAt: Date.now() });
  await logEvent('completed', id, {
    prevStatus: m.status, ...(next ? { nextId: next.id } : {}), xpIds,
  });
  const xp = amount + resilience;
  const newLevel = levelFromXp(before + xp).level;
  return { xp, leveledUp: newLevel > levelFromXp(before).level, newLevel, ...(next ? { next } : {}) };
}

export async function undoComplete(id: string): Promise<void> {
  const events = (await db.events.where('missionId').equals(id).toArray()).filter((e) => !e.deleted);
  const undone = new Set(
    events.filter((e) => e.type === 'uncompleted').map((e) => e.data?.completedEventId as string),
  );
  const completed = events
    .filter((e) => e.type === 'completed' && !undone.has(e.id))
    .sort((a, b) => a.at - b.at || a.createdAt - b.createdAt)
    .pop() as LifeEvent | undefined;
  if (!completed) return;
  const data = (completed.data ?? {}) as { prevStatus?: MissionStatus; nextId?: string; xpIds?: string[] };
  for (const xid of data.xpIds ?? []) {
    if (await db.xpEvents.get(xid)) await softDelete('xpEvents', xid);
  }
  await patch<Mission>('missions', id, { status: data.prevStatus ?? 'open', completedAt: undefined });
  if (data.nextId) {
    const next = await db.missions.get(data.nextId);
    if (next && !next.deleted && next.updatedAt === next.createdAt) await softDelete('missions', next.id);
  }
  await logEvent('uncompleted', id, { completedEventId: completed.id });
}

export async function skipMission(id: string): Promise<void> {
  await logEvent('skipped', id);
}

export async function shrinkMission(id: string, firstStep: string): Promise<{ xp: number }> {
  const m = await db.missions.get(id);
  if (!m) throw new Error(`mission ${id} not found`);
  const today = await getToday();
  await patch<Mission>('missions', id, { firstStep, shrunk: true });
  let xp = 0;
  if (!(await hasXp(id, 'strategy'))) {
    xp = strategyXp(m);
    if (xp > 0) await awardXp(xp, 'strategy', today, { areaId: m.areaId, missionId: id });
  }
  await logEvent('shrunk', id, { firstStep });
  return { xp };
}

export async function snoozeMission(
  id: string, option: 'later' | 'tomorrow' | { date: DayKey },
): Promise<void> {
  const m = await db.missions.get(id);
  if (!m) throw new Error(`mission ${id} not found`);
  const changes: Partial<Mission> = { postponeCount: m.postponeCount + 1 };
  if (option === 'later') {
    changes.snoozedUntil = Date.now() + 3 * 3600_000;
  } else {
    const today = await getToday();
    changes.date = option === 'tomorrow' ? addDays(today, 1) : option.date;
    changes.dayOrder = undefined;
    changes.snoozedUntil = undefined;
  }
  await patch<Mission>('missions', id, changes);
  await logEvent('snoozed', id, { option });
}

export async function rescheduleMission(id: string, date: DayKey | null): Promise<void> {
  const m = await db.missions.get(id);
  if (!m) throw new Error(`mission ${id} not found`);
  const today = await getToday();
  const movingLater = date !== null && m.date !== undefined && m.date <= today && date > m.date;
  await patch<Mission>('missions', id, {
    date: date ?? undefined, dayOrder: undefined,
    postponeCount: m.postponeCount + (movingLater ? 1 : 0),
  });
  await logEvent('rescheduled', id, { from: m.date ?? null, to: date });
}

export async function dropMission(id: string, reason?: string): Promise<void> {
  await patch<Mission>('missions', id, { status: 'dropped', dropReason: reason });
  await logEvent('dropped', id, reason ? { reason } : undefined);
}

export async function splitMission(id: string): Promise<Journey> {
  const m = await db.missions.get(id);
  if (!m) throw new Error(`mission ${id} not found`);
  const today = await getToday();
  const order = (await db.journeys.toArray()).reduce((mx, j) => Math.max(mx, j.order + 1), 0);
  const journey = await put('journeys', newRecord<Journey>({
    title: m.title, status: 'active', order, ...(m.areaId ? { areaId: m.areaId } : {}),
  }));
  for (const [i, item] of m.checklist.entries()) {
    await createMission({
      title: item.text, journeyId: journey.id, journeyOrder: i, important: m.important,
      ...(m.areaId ? { areaId: m.areaId } : {}),
    });
  }
  const xp = (await hasXp(id, 'strategy')) ? 0 : strategyXp(m);
  if (xp > 0) await awardXp(xp, 'strategy', today, { areaId: m.areaId, missionId: id });
  await softDelete('missions', id);
  await logEvent('split', id, { journeyId: journey.id });
  return journey;
}

export async function updateMission(id: string, changes: Partial<Mission>): Promise<void> {
  await patch<Mission>('missions', id, changes);
}

export async function reorderDay(ids: string[], day: DayKey): Promise<void> {
  for (const [i, id] of ids.entries()) await patch<Mission>('missions', id, { dayOrder: i, date: day });
}

export async function moveToDay(id: string, day: DayKey | null): Promise<void> {
  await patch<Mission>('missions', id, { date: day ?? undefined, dayOrder: undefined });
}
