import type { DayKey, ID, Week, WeekObjective, WeekReview } from '@life/shared';
import { OBJECTIVE_XP, adjustmentLines, strategyKey, ulid } from '@life/shared';
import { db } from '../db/db';
import { softDelete, upsert } from '../db/repo';
import { awardXp, getToday, hasLiveXp, withLock } from './common';
import { testStrategy } from './strategyActions';

/** The week `weekId` (Monday DayKey) with `changes`, created empty when missing. */
const upsertWeek = (weekId: DayKey, changes: Partial<Week>): Promise<Week> =>
  upsert<Week>('weeks', weekId, changes, { objectives: [] });

/**
 * Stores the review (the week is created when missing; its old `experiment`, if any, is left as it is). Then each line
 * of the adjustment becomes a testing strategy (the same title already in test is reused): from Padrões when the line is
 * one of `suggested` (a "Usar no ajuste" text or the old experiment that prefilled the field), else Ideia minha.
 */
export async function saveWeekReview(
  weekId: DayKey, r: Omit<WeekReview, 'answeredAt'>, opts: { suggested?: readonly string[] } = {},
): Promise<void> {
  await withLock(`week:${weekId}`, () => upsertWeek(weekId, { review: { ...r, answeredAt: Date.now() } }));
  const suggested = new Set((opts.suggested ?? []).map(strategyKey));
  for (const line of adjustmentLines(r.adjustment)) {
    await testStrategy(line, suggested.has(strategyKey(line)) ? 'padroes' : 'ideia');
  }
}

/** Replaces the week's objectives; new ones get an id, blank texts are dropped. */
export async function setObjectives(
  weekId: DayKey, objectives: Array<Omit<WeekObjective, 'id'> & { id?: ID }>,
): Promise<void> {
  const list: WeekObjective[] = objectives
    .map((o) => ({ id: o.id ?? ulid(), blockId: o.blockId, text: o.text.trim(), done: o.done }))
    .filter((o) => o.text.length > 0);
  await withLock(`week:${weekId}`, () => upsertWeek(weekId, { objectives: list }));
}

/** Done → +10 XP (`xp-objective-${id}`, revived if it was undone); undone → that XP is soft-deleted. */
export const toggleObjective = (weekId: DayKey, objectiveId: ID): Promise<{ xp: number }> =>
  withLock(`week:${weekId}`, () => toggleObjectiveLocked(weekId, objectiveId));

async function toggleObjectiveLocked(weekId: DayKey, objectiveId: ID): Promise<{ xp: number }> {
  const week = await db.weeks.get(weekId);
  const objective = week && !week.deleted ? week.objectives.find((o) => o.id === objectiveId) : undefined;
  if (!week || !objective) return { xp: 0 };
  const done = !objective.done;
  await upsertWeek(weekId, {
    objectives: week.objectives.map((o) => (o.id === objectiveId ? { ...o, done } : o)),
  });
  const xpId = `xp-objective-${objectiveId}`;
  const awarded = await hasLiveXp(xpId);
  if (!done) {
    if (awarded) await softDelete('xpEvents', xpId);
    return { xp: 0 };
  }
  if (awarded) return { xp: 0 };
  const block = await db.blocks.get(objective.blockId);
  await awardXp(OBJECTIVE_XP, 'objective', await getToday(), {
    id: xpId, ...(block?.areaId ? { areaId: block.areaId } : {}),
  });
  return { xp: OBJECTIVE_XP };
}
