import type { ID, Journey } from '@life/shared';
import { db } from '../db/db';
import { newRecord, put } from '../db/repo';

/** "Nova jornada" and a proposal's journey: active, after every other journey. */
export async function createJourney(f: { title: string; outcome?: string; goalId?: ID; areaId?: ID }): Promise<Journey> {
  const all = (await db.journeys.toArray()).filter((j) => !j.deleted);
  const order = all.reduce((mx, j) => Math.max(mx, j.order + 1), 0);
  const outcome = f.outcome?.trim();
  return put('journeys', newRecord<Journey>({
    title: f.title.trim(), status: 'active', order, ...(outcome ? { outcome } : {}), ...(f.goalId ? { goalId: f.goalId } : {}),
    ...(f.areaId ? { areaId: f.areaId } : {}),
  }));
}
