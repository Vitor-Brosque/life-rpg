import { useMemo } from 'react';
import {
  closestCenter, KeyboardSensor, PointerSensor, pointerWithin, useSensor, useSensors,
  type CollisionDetection,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { Commitment, DayKey, Mission } from '@life/shared';
import { occurrencesOn, weekdayOf } from '@life/shared';
import { useAreas, useCommitments, useMissions, useSettings, useToday } from '../../db/hooks';
import { WEEKDAY_ABBR } from '../../ui/format';
import { coarsePointer } from '../agora/TodayList';

/** Missions that still need doing (open or in progress). */
export const isPending = (m: Mission): boolean => m.status === 'open' || m.status === 'doing';

/** Manual day order first, then creation time. */
export function byDayOrder(a: Mission, b: Mission): number {
  const ao = a.dayOrder ?? Infinity;
  const bo = b.dayOrder ?? Infinity;
  if (ao !== bo) return ao < bo ? -1 : 1;
  return a.createdAt - b.createdAt;
}

/** "qua 11/11". */
export function dayLabel(day: DayKey): string {
  const [, m, d] = day.split('-');
  return `${WEEKDAY_ABBR[weekdayOf(day)]} ${d}/${m}`;
}

export interface PlanData {
  today?: DayKey;
  /** Logical day start (`occurrencesOn` puts earlier times on the next calendar morning). */
  dayStartHour: number;
  missions: Mission[];
  commitments: Commitment[];
  areas: ReturnType<typeof useAreas>;
  ready: boolean;
}

export function usePlanData(): PlanData {
  const settings = useSettings();
  const today = useToday();
  const missions = useMissions();
  const commitments = useCommitments();
  const areas = useAreas();
  return {
    today, dayStartHour: settings?.dayStartHour ?? 4, missions, commitments, areas, ready: settings !== undefined,
  };
}

/**
 * Pending missions planned for `day`, in manual order. Today's list also takes the pending ones
 * planned for earlier days (like the Agora "Hoje" list), so nothing overdue disappears.
 */
export function missionsOnDay(missions: Mission[], day: DayKey, today?: DayKey): Mission[] {
  const overdue = day === today;
  return missions
    .filter((m) => isPending(m) && m.date !== undefined && (m.date === day || (overdue && m.date < day)))
    .sort(byDayOrder);
}

export const backlogMissions = (missions: Mission[]): Mission[] =>
  missions.filter((m) => m.status === 'open' && m.date === undefined).sort(byDayOrder);

const RECENT_DROP_MS = 14 * 86_400_000;

/** Dropped ("soltas") in the last 14 days, most recent first (so they can be reopened). */
export const recentlyDropped = (missions: Mission[], now: number): Mission[] =>
  missions.filter((m) => m.status === 'dropped' && m.updatedAt >= now - RECENT_DROP_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt);

export { occurrencesOn };

/** Touch: press and hold 200 ms (so the page still scrolls); mouse: start after 4 px; plus keyboard. */
export function usePlanSensors() {
  const pointerOptions = useMemo(() => ({
    activationConstraint: coarsePointer() ? { delay: 200, tolerance: 8 } : { distance: 4 },
  }), []);
  const keyboardOptions = useMemo(() => ({ coordinateGetter: sortableKeyboardCoordinates }), []);
  return useSensors(useSensor(PointerSensor, pointerOptions), useSensor(KeyboardSensor, keyboardOptions));
}

/** Pointer position decides the container; fall back to the nearest item. */
export const planCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCenter(args);
};

export const DRAG_INSTRUCTIONS =
  'Para mover, pressione espaço ou Enter. Use as setas para mudar de lugar e espaço ou Enter para soltar. Esc cancela.';
