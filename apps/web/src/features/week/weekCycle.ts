import { useEffect } from 'react';
import { create } from 'zustand';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKey, DayMode, Week } from '@life/shared';
import { weekdayOf, weekKey } from '@life/shared';
import { db } from '../../db/db';

interface WeekSession {
  /** Week whose card got "Fazer depois" in this app session (it comes back on the next open). */
  dismissed?: DayKey;
  /** Week whose card is open: kept on screen through both steps (saving the review alone would hide it). */
  opened?: DayKey;
}

/** App-session state of the weekly cycle (not persisted), keyed by the week's Monday. */
export const useWeekSession = create<WeekSession>(() => ({ dismissed: undefined, opened: undefined }));

/** Monday or Tuesday: the days the "Nova semana" card is offered (§8). */
export const isCycleDay = (day: DayKey): boolean => {
  const wd = weekdayOf(day);
  return wd === 1 || wd === 2;
};

export interface WeekCycle {
  loaded: boolean;
  weekId?: DayKey;
  /** This week's record (experiment, objectives), when there is one. */
  week?: Week;
  showCard: boolean;
  /** Small "Nova semana" link: after "Fazer depois", or on a free day (offered, never pushed). */
  showLink: boolean;
  open(): void;
  later(): void;
  finish(): void;
}

/**
 * Whether the "Nova semana" card shows: Monday or Tuesday, the week has no record yet (no review,
 * no objectives), and never before "Como está hoje?" is answered.
 */
export function useWeekCycle(today: DayKey | undefined, day: { asked: boolean; mode: DayMode }): WeekCycle {
  const weekId = today ? weekKey(today) : undefined;
  // null: no record for this week (yet).
  const week = useLiveQuery(async () => {
    if (!weekId) return undefined;
    const w = await db.weeks.get(weekId);
    return w && !w.deleted ? w : null;
  }, [weekId]);
  const dismissed = useWeekSession((s) => s.dismissed);
  const opened = useWeekSession((s) => s.opened);

  const cycleDay = today !== undefined && isCycleDay(today);
  const pending = cycleDay && week === null;
  const auto = pending && day.asked && day.mode !== 'free' && dismissed !== weekId;
  const showCard = cycleDay && weekId !== undefined && (opened === weekId || auto);

  useEffect(() => {
    if (auto && weekId && useWeekSession.getState().opened !== weekId) useWeekSession.setState({ opened: weekId });
  }, [auto, weekId]);

  return {
    loaded: week !== undefined,
    weekId,
    week: week ?? undefined,
    showCard,
    showLink: pending && !showCard && (dismissed === weekId || day.mode === 'free'),
    open: () => useWeekSession.setState({ opened: weekId }),
    later: () => useWeekSession.setState({ dismissed: weekId, opened: undefined }),
    finish: () => useWeekSession.setState({ opened: undefined }),
  };
}
