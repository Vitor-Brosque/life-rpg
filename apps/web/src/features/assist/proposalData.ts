import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKey, ID, Proposal } from '@life/shared';
import { db } from '../../db/db';
import { getMeta, setMeta } from '../../db/repo';

/** Live proposals (not deleted), newest first; undefined while loading. */
export function useProposals(): Proposal[] | undefined {
  return useLiveQuery(async () => (await db.proposals.toArray()).filter((p) => !p.deleted).sort((a, b) => b.createdAt - a.createdAt));
}

export function useProposal(id: ID): Proposal | null | undefined {
  return useLiveQuery(async () => {
    const p = await db.proposals.get(id);
    return p && !p.deleted ? p : null;
  }, [id]);
}

/** "Agora não" on the Agora card: hidden until the next day, on this device only. */
const snoozeKey = (id: ID) => `proposal-snooze-${id}`;
export const snoozeProposal = (id: ID, today: DayKey): Promise<void> => setMeta(snoozeKey(id), today);

/** The newest pending proposal not hidden today; null when there is none. */
export function useProposalForAgora(today: DayKey | undefined): Proposal | null | undefined {
  return useLiveQuery(async () => {
    if (!today) return null;
    const pending = (await db.proposals.where('status').equals('pending').toArray()).filter((p) => !p.deleted)
      .sort((a, b) => b.createdAt - a.createdAt);
    for (const p of pending) if ((await getMeta<DayKey>(snoozeKey(p.id))) !== today) return p;
    return null;
  }, [today]);
}
