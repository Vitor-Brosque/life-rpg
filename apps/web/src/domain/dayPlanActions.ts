import type { DayKey, DayMode, DayPlan } from '@life/shared';
import { dayPlanNeeded, takeDayPlan } from '@life/shared';
import { db } from '../db/db';
import { newRecord, put } from '../db/repo';
import { withLock } from './common';

/**
 * The day's plan (Acompanhamento D): taken on the first explicit action of the day and again when the day type
 * changes. A routine edit never rewrites it, and no screen that only reads calls this.
 */
export const ensureDayPlan = (day: DayKey, mode: DayMode): Promise<void> => withLock('day-plan', async () => {
  // A secondary record: if it cannot be written, the user's action (the block, the day type) must still complete.
  try {
    if (!dayPlanNeeded(await db.dayPlans.get(day), mode)) return;
    const [settings, blocks, commitments] = await Promise.all([
      db.settings.get('settings'), db.blocks.toArray(), db.commitments.toArray(),
    ]);
    await put('dayPlans', newRecord<DayPlan>({
      id: day, ...takeDayPlan({ day, mode, takenAt: Date.now(), blocks, commitments, dayStartHour: settings?.dayStartHour ?? 4 }),
    }));
  } catch (err) {
    console.error('[day-plan] snapshot not saved', err);
  }
});
