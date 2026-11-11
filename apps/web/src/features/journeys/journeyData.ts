import type { Journey, Mission } from '@life/shared';

export interface JourneyStats {
  /** Missions done. */
  done: number;
  /** Missions that count: not deleted, not dropped. */
  total: number;
  /** Next mission to do: lowest journeyOrder among open / doing. */
  next?: Mission;
}

export const byJourneyOrder = (a: Mission, b: Mission): number =>
  (a.journeyOrder ?? Infinity) === (b.journeyOrder ?? Infinity)
    ? a.createdAt - b.createdAt
    : (a.journeyOrder ?? Infinity) < (b.journeyOrder ?? Infinity) ? -1 : 1;

export function journeyStats(journey: Journey, missions: Mission[]): JourneyStats {
  const own = missions.filter((m) => !m.deleted && m.journeyId === journey.id).sort(byJourneyOrder);
  const counted = own.filter((m) => m.status !== 'dropped');
  return {
    done: counted.filter((m) => m.status === 'done').length,
    total: counted.length,
    next: own.find((m) => m.status === 'open' || m.status === 'doing'),
  };
}
