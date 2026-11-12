import type { DayKey, ID, Week, WeekObjective, WeekReview } from '@life/shared';
import { OBJECTIVE_XP, ulid } from '@life/shared';
import { db } from '../db/db';
import { softDelete, upsert } from '../db/repo';
import { awardXp, getToday, hasLiveXp, withLock } from './common';

/** The week `weekId` (Monday DayKey) with `changes`, created empty when missing. */
const upsertWeek = (weekId: DayKey, changes: Partial<Week>): Promise<Week> =>
  upsert<Week>('weeks', weekId, changes, { objectives: [] });

/** Stores the review; its adjustment becomes the week's experiment (shown on Agora). */
export async function saveWeekReview(weekId: DayKey, r: Omit<WeekReview, 'answeredAt'>): Promise<void> {
  const experiment = r.adjustment.trim();
  await withLock(`week:${weekId}`, () => upsertWeek(weekId, {
    review: { ...r, answeredAt: Date.now() }, experiment: experiment || undefined,
  }));
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
