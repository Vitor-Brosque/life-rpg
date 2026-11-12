import type {
  Area, BaseRecord, Block, BlockSession, DayKey, DayMode, DayState, ID, Journey, Mission, Settings,
} from '@life/shared';
import { BLOCK_XP, RESUMPTION_XP, defaultDayMode, isResumption, normalize } from '@life/shared';
import { db } from '../db/db';
import { newRecord, patch, put, upsert } from '../db/repo';
import { awardXp, getToday, hasLiveXp, upsertDayState, withLock } from './common';
import { createCommitment } from './missionActions';
import { findTechJourney, hasClassCommitment, type RoutinePreview } from './routineDefaults';

const sessionId = (blockId: ID, day: DayKey): string => `bs-${blockId}-${day}`;

/** Day predicate for resumption/constancy: free by the recorded mode, else by weekday (§9). */
export function isFreeDayFor(dayStates: DayState[]): (day: DayKey) => boolean {
  const byDay = new Map(dayStates.filter((d) => !d.deleted).map((d) => [d.id, d]));
  return (day) => defaultDayMode(day, byDay.get(day)) === 'free';
}

async function todayMode(today: DayKey): Promise<DayMode> {
  const ds = await db.dayState.get(today);
  return defaultDayMode(today, ds && !ds.deleted ? ds : undefined);
}

/** Today's session of the block with `changes` (created with the mode's version when missing). */
async function upsertSession(blockId: ID, today: DayKey, changes: Partial<BlockSession>): Promise<BlockSession> {
  const mode = await todayMode(today);
  const version = mode === 'low' || mode === 'recovery' ? 'minimum' : 'normal';
  return upsert<BlockSession>('blockSessions', sessionId(blockId, today), changes, { blockId, day: today, version });
}

// ------------------------------------------------------------------ routine and editing

export const applyRoutine = (p: RoutinePreview): Promise<void> => withLock('routine', () => applyRoutineLocked(p));

/** Creates what the preview asks for, re-checking the database so a repeated call never duplicates. */
async function applyRoutineLocked(p: RoutinePreview): Promise<void> {
  const today = await getToday();
  const remap = new Map<ID, ID>();
  if (p.createJourney) {
    const journeys = await db.journeys.toArray();
    const existing = findTechJourney(journeys);
    if (existing) remap.set(p.createJourney.id, existing.id);
    else {
      const order = journeys.reduce((mx, j) => Math.max(mx, j.order + 1), 0);
      await put('journeys', newRecord<Journey>({ id: p.createJourney.id, title: p.createJourney.title, status: 'active', order }));
    }
  }
  if (p.createArea) {
    const areas = (await db.areas.toArray()).filter((a) => !a.deleted);
    const key = normalize(p.createArea.name);
    const existing = areas.find((a) => a.id === p.createArea!.id) ?? areas.find((a) => normalize(a.name.trim()) === key);
    if (existing) remap.set(p.createArea.id, existing.id);
    else {
      const order = areas.reduce((mx, a) => Math.max(mx, a.order + 1), 0);
      await put('areas', newRecord<Area>({ ...p.createArea, order, archived: false }));
    }
  }
  if (p.createCommitment && !hasClassCommitment(await db.commitments.toArray(), today)) {
    const { title, start, end, weekdays } = p.createCommitment;
    await createCommitment({ title, date: today, start, end, weekdays: [...weekdays] });
  }
  const current = (await db.blocks.toArray()).filter((b) => !b.deleted && !b.archived);
  const names = new Set(current.map((b) => normalize(b.name.trim())));
  const offset = current.reduce((mx, b) => Math.max(mx, b.order + 1), 0);
  for (const b of p.blocks) {
    if (names.has(normalize(b.name.trim()))) continue;
    await put('blocks', newRecord<Block>({
      ...b, order: b.order + offset, checklist: b.checklist.map((c) => ({ ...c })),
      ...(b.areaId ? { areaId: remap.get(b.areaId) ?? b.areaId } : {}),
      ...(b.journeyId ? { journeyId: remap.get(b.journeyId) ?? b.journeyId } : {}),
    }));
  }
  if (p.dayEndHour === 0) await patch<Settings>('settings', 'settings', { dayEndHour: 0 });
}

const BLOCK_DEFAULTS: Omit<Block, keyof BaseRecord | 'order'> = {
  name: 'Novo bloco', weekdays: [1, 2, 3, 4, 5], targetStart: '09:00', durationMin: 60, minimumMin: 15,
  kind: 'focus', protected: false, checklist: [], archived: false,
};

/** Creates (no id / unknown id) or updates a block; keeps minimumMin ≤ durationMin and one link. */
export async function saveBlock(fields: Partial<Block> & { id?: ID }): Promise<Block> {
  const { id, createdAt: _c, updatedAt: _u, deleted: _d, ...rest } = fields;
  const prev = id ? await db.blocks.get(id) : undefined;
  let merged: Block;
  if (prev && !prev.deleted) {
    merged = { ...prev, ...rest };
  } else {
    const order = (await db.blocks.toArray())
      .filter((b) => !b.deleted)
      .reduce((mx, b) => Math.max(mx, b.order + 1), 0);
    merged = newRecord<Block>({ ...BLOCK_DEFAULTS, order, ...rest, ...(id ? { id } : {}) });
  }
  merged.minimumMin = Math.min(merged.minimumMin, merged.durationMin);
  if (fields.journeyId) merged.areaId = undefined;
  else if (fields.areaId) merged.journeyId = undefined;
  if (prev && !prev.deleted) return patch<Block>('blocks', prev.id, merged);
  return put('blocks', merged);
}

export async function archiveBlock(id: ID): Promise<void> {
  await patch<Block>('blocks', id, { archived: true });
}

export async function reorderBlocks(ids: ID[]): Promise<void> {
  for (const [order, id] of ids.entries()) {
    const b = await db.blocks.get(id);
    if (b && b.order !== order) await patch<Block>('blocks', id, { order });
  }
}

/** Adds `toWeekdays` to every live block active on `fromWeekday` ("Copiar este dia para…"). */
export async function copyBlockDays(fromWeekday: number, toWeekdays: number[]): Promise<void> {
  const blocks = (await db.blocks.toArray())
    .filter((b) => !b.deleted && !b.archived && b.weekdays.includes(fromWeekday));
  for (const b of blocks) {
    const weekdays = [...new Set([...b.weekdays, ...toWeekdays])].sort((x, y) => x - y);
    if (weekdays.length !== b.weekdays.length) await patch<Block>('blocks', b.id, { weekdays });
  }
}

// ------------------------------------------------------------------ the lived day

/** Today's type; the first answer also marks when the day started. `hardDay` mirrors it for old readers. */
export async function setDayMode(mode: DayMode): Promise<void> {
  const today = await getToday();
  const existing = await db.dayState.get(today);
  const startedAt = (existing && !existing.deleted ? existing.startedAt : undefined) ?? Date.now();
  await upsertDayState(today, { mode, startedAt, hardDay: mode === 'low' || mode === 'recovery' });
}

export const startBlock = (blockId: ID): Promise<{ xp: number; resumption: boolean }> =>
  withLock('block-start', () => startBlockLocked(blockId));

async function startBlockLocked(blockId: ID): Promise<{ xp: number; resumption: boolean }> {
  const block = await db.blocks.get(blockId);
  if (!block) throw new Error(`block ${blockId} not found`);
  const today = await getToday();
  const now = Date.now();

  const session = await db.blockSessions.get(sessionId(blockId, today));
  if (!session || session.deleted || session.startedAt === undefined) {
    await upsertSession(blockId, today, { startedAt: now });
  }
  const ds = await db.dayState.get(today);
  if (!ds || ds.deleted || ds.startedAt === undefined) await upsertDayState(today, { startedAt: now });

  // Resumption is decided from the days before today, before today's block XP is written.
  let resumption = false;
  const resumptionId = `xp-resumption-${today}`;
  if (!(await hasLiveXp(resumptionId))) {
    const xpDays = new Set<DayKey>();
    await db.xpEvents.each((x) => { if (!x.deleted) xpDays.add(x.dayKey); });
    resumption = isResumption(today, xpDays, isFreeDayFor(await db.dayState.toArray()));
  }

  let xp = 0;
  const blockXpId = `xp-block-${blockId}-${today}`;
  if (!(await hasLiveXp(blockXpId))) {
    const journey = block.journeyId ? await db.journeys.get(block.journeyId) : undefined;
    const areaId = block.areaId ?? journey?.areaId;
    await awardXp(BLOCK_XP, 'block', today, { id: blockXpId, ...(areaId ? { areaId } : {}) });
    xp += BLOCK_XP;
  }
  if (resumption) {
    await awardXp(RESUMPTION_XP, 'resumption', today, { id: resumptionId });
    xp += RESUMPTION_XP;
  }
  return { xp, resumption };
}

/** Ends today's occurrence; a blank `nextAction` is not stored. Never starts an unstarted block. */
export async function endBlock(blockId: ID, nextAction?: string): Promise<void> {
  const today = await getToday();
  const text = nextAction?.trim();
  const now = Date.now();
  // Ending a block that was never started still closes it (it becomes 'done', not 'current').
  const existing = await db.blockSessions.get(sessionId(blockId, today));
  const startedAt = existing && !existing.deleted && existing.startedAt !== undefined ? {} : { startedAt: now };
  await upsertSession(blockId, today, { ...startedAt, endedAt: now, ...(text ? { nextAction: text } : {}) });
}

export async function setBlockVersion(blockId: ID, version: 'normal' | 'minimum'): Promise<void> {
  const today = await getToday();
  await upsertSession(blockId, today, { version });
}

/** "Onde parou?": the block's session for today and the mission's first step. Blank text is ignored. */
export async function saveNextAction(input: { blockId?: ID; missionId?: ID; text: string }): Promise<void> {
  const text = input.text.trim();
  if (!text) return;
  if (input.blockId) await upsertSession(input.blockId, await getToday(), { nextAction: text });
  if (input.missionId) await patch<Mission>('missions', input.missionId, { firstStep: text });
}

/**
 * Next action of the block's most recent session before `beforeDay`. Sessions of past days are
 * over whether or not "Encerrar" was tapped, so any of them with a next action counts.
 */
export async function lastNextAction(blockId: ID, beforeDay: DayKey): Promise<string | undefined> {
  const sessions = await db.blockSessions.where('blockId').equals(blockId).toArray();
  const last = sessions
    .filter((s) => !s.deleted && s.day < beforeDay && s.nextAction?.trim())
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .pop();
  return last?.nextAction;
}
