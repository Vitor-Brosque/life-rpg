import type { Block, Commitment, Settings, XpEvent } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, patch, put } from '../src/db/repo';

// The shared Marco 2 fixture (global constraints): five weekday blocks and the 19:00–23:00 class.

const base = { createdAt: 1, updatedAt: 1, deleted: false };
export const WD = [1, 2, 3, 4, 5];

export const block = (
  b: Partial<Block> & Pick<Block, 'id' | 'name' | 'order' | 'targetStart' | 'durationMin' | 'minimumMin' | 'kind'>,
): Block => ({ ...base, weekdays: WD, protected: false, checklist: [], archived: false, ...b });

export const FIXTURE: Block[] = [
  block({ id: 'b1', name: 'Tech', order: 0, targetStart: '09:00', durationMin: 180, minimumMin: 45, kind: 'focus', journeyId: 'j-tech' }),
  block({ id: 'b2', name: 'Treino', order: 1, targetStart: '12:30', durationMin: 120, minimumMin: 45, kind: 'body', areaId: 'area-vigor' }),
  block({ id: 'b3', name: 'Facul', order: 2, targetStart: '15:00', durationMin: 90, minimumMin: 30, kind: 'study', protected: true, areaId: 'area-facul' }),
  block({ id: 'b4', name: 'Tecnico', order: 3, targetStart: '16:45', durationMin: 60, minimumMin: 25, kind: 'study', areaId: 'area-intelecto' }),
  block({ id: 'b5', name: 'Compl', order: 4, targetStart: '18:00', durationMin: 40, minimumMin: 10, kind: 'light' }),
];

export const AULA: Commitment = {
  ...base, id: 'aula', title: 'Aula', date: '2026-11-02', start: '19:00', end: '23:00', weekdays: WD, remind: true,
};

/** Day `day` of November 2026 at h:m (local time), as epoch ms. 11 = Wednesday, 14 = Saturday. */
export const at = (day: number, h: number, m = 0): number => new Date(2026, 10, day, h, m).getTime();

/** Day ends at midnight, the five blocks and the class. */
export async function seedBlocks(blocks: Block[] = FIXTURE): Promise<void> {
  await patch<Settings>('settings', 'settings', { dayEndHour: 0 });
  await db.blocks.bulkPut(blocks);
  await db.commitments.put(AULA);
}

/** Some activity on a past day (for the resumption rule). */
export const pastXp = (dayKey: string) =>
  put('xpEvents', newRecord<XpEvent>({ at: 1, amount: 8, reason: 'complete', dayKey }));

export const xpBy = async (reason: string): Promise<number> => (await db.xpEvents.toArray())
  .filter((x) => !x.deleted && x.reason === reason).reduce((s, x) => s + x.amount, 0);
