import { useMemo, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type {
  Area, Block, BlockOccurrence, Commitment, DayKey, DayMode, DayState, EnergyLevel, EngineOutput,
  Journey, LevelInfo, Mission, Profile, Settings, Week, XpEvent,
} from '@life/shared';
import {
  activeDays, activeWorkdays, dayKeyOf, defaultDayMode, levelFromXp, subjectJourneys, suggest, weekKey,
} from '@life/shared';
import { isFreeDayFor } from '../domain/blockActions';
import { planFromData, readDayPlanData } from './dayPlan';
import { db } from './db';

// ------------------------------------------------------------------ shared clock

const CLOCK_MS = 30_000;
let clockNow = Date.now();
const clockListeners = new Set<() => void>();
let stopClock: (() => void) | undefined;

function tick(): void {
  const t = Date.now();
  if (t === clockNow) return;
  clockNow = t;
  for (const l of clockListeners) l();
}

/** One interval for the whole app, plus an immediate tick when the app comes back (phone wakes). */
function startClock(): () => void {
  const id = setInterval(tick, CLOCK_MS);
  const onVisibility = () => { if (document.visibilityState === 'visible') tick(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', tick);
  window.addEventListener('focus', tick);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', tick);
    window.removeEventListener('focus', tick);
  };
}

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  stopClock ??= startClock();
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0) {
      stopClock?.();
      stopClock = undefined;
    }
  };
}

function readClock(): number {
  // Nothing kept the clock fresh while nobody listened: catch up before a first render uses it.
  // (Re-reading within the same second keeps the snapshot stable across React's double reads.)
  if (clockListeners.size === 0 && Math.abs(Date.now() - clockNow) >= 1000) clockNow = Date.now();
  return clockNow;
}

/**
 * Ticks the shared clock now. Call after a write anchored at `Date.now()` (day start, block end):
 * otherwise screens planned with the older clock value could see that moment as still ahead.
 */
export function refreshNow(): void {
  tick();
}

/** Current time from the shared app clock (30 s ticks; refreshed on visibilitychange/pageshow/focus). */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, readClock);
}

export function useSettings(): Settings | undefined {
  return useLiveQuery(async () => {
    const s = await db.settings.get('settings');
    return s && !s.deleted ? s : undefined;
  });
}

export function useProfile(): Profile | undefined {
  return useLiveQuery(async () => {
    const p = await db.profile.get('me');
    return p && !p.deleted ? p : undefined;
  });
}

const EMPTY: never[] = [];

export function useAreas(): Area[] {
  return useLiveQuery(
    async () => (await db.areas.orderBy('order').toArray()).filter((a) => !a.deleted),
  ) ?? (EMPTY as Area[]);
}

export function useMissions(): Mission[] {
  return useLiveQuery(() => db.missions.filter((m) => !m.deleted).toArray()) ?? (EMPTY as Mission[]);
}

export function useJourneys(): Journey[] {
  return useLiveQuery(() => db.journeys.filter((j) => !j.deleted).toArray()) ?? (EMPTY as Journey[]);
}

export function useCommitments(): Commitment[] {
  return useLiveQuery(() => db.commitments.filter((c) => !c.deleted).toArray()) ?? (EMPTY as Commitment[]);
}

export function useToday(): DayKey | undefined {
  const settings = useSettings();
  const now = useNow();
  return settings ? dayKeyOf(now, settings.dayStartHour) : undefined;
}

export function useDayState(day?: DayKey): DayState | undefined {
  const today = useToday();
  const key = day ?? today;
  return useLiveQuery(async () => {
    if (!key) return undefined;
    const d = await db.dayState.get(key);
    return d && !d.deleted ? d : undefined;
  }, [key]);
}

// ------------------------------------------------------------------ blocks (Marco 2)

/** Live routine blocks (not deleted, not archived), by order. */
export function useBlocks(): Block[] {
  return useLiveQuery(
    async () => (await db.blocks.orderBy('order').toArray()).filter((b) => !b.deleted && !b.archived),
  ) ?? (EMPTY as Block[]);
}

/** Every block that is not deleted (archived ones included), by order; undefined while loading. */
export function useRoutineBlocks(): Block[] | undefined {
  return useLiveQuery(async () => (await db.blocks.orderBy('order').toArray()).filter((b) => !b.deleted));
}

/** Type of `day` (default today): the recorded mode, else weekday default (§6). */
export function useDayMode(day?: DayKey): DayMode {
  const today = useToday();
  const key = day ?? today;
  const state = useDayState(key);
  return key ? defaultDayMode(key, state) : 'normal';
}

/** Block occurrences of `day` (default today) from `planDay`, recomputed on every clock tick. */
export function useDayPlan(day?: DayKey): BlockOccurrence[] | undefined {
  const today = useToday();
  const key = day ?? today;
  const now = useNow();
  const data = useLiveQuery(async () => (key ? readDayPlanData(key) : undefined), [key]);
  return useMemo(() => (data && data.key === key ? planFromData(data, now) : undefined), [data, key, now]);
}

/** Today's 'current' occurrence (at most one). */
export function useCurrentBlock(): BlockOccurrence | undefined {
  return useDayPlan()?.find((o) => o.state === 'current');
}

/** Today's first upcoming occurrence that starts after now. */
export function useNextBlock(): BlockOccurrence | undefined {
  const now = useNow();
  return useDayPlan()?.find((o) => o.state === 'upcoming' && o.start > now);
}

/** The week `weekId` (default: the week of today, keyed by its Monday). */
export function useWeek(weekId?: DayKey): Week | undefined {
  const today = useToday();
  const key = weekId ?? (today ? weekKey(today) : undefined);
  return useLiveQuery(async () => {
    if (!key) return undefined;
    const w = await db.weeks.get(key);
    return w && !w.deleted ? w : undefined;
  }, [key]);
}

export function useCurrentEnergy(): EnergyLevel | undefined {
  const settings = useSettings();
  const now = useNow();
  const startHour = settings?.dayStartHour;
  return useLiveQuery(async () => {
    if (startHour === undefined) return undefined;
    const today = dayKeyOf(now, startHour);
    const logs = await db.energyLogs.orderBy('at').reverse().filter((l) => !l.deleted).toArray();
    return logs.find((l) => dayKeyOf(l.at, startHour) === today)?.level;
  }, [startHour, now]);
}

/** A stored subject pick, only when it is still an active subject (deleted, paused or unflagged picks are ignored). */
export function validPick(pick: string | undefined, journeys: readonly Journey[]): string | undefined {
  return pick !== undefined && subjectJourneys(journeys).some((j) => j.id === pick) ? pick : undefined;
}

export function useEngine(skipIds?: string[]): EngineOutput | undefined {
  const now = useNow();
  const mode = useDayMode();
  const current = useCurrentBlock();
  const blockId = current?.block.id;
  const blockAreaId = current?.block.areaId;
  const blockJourneyId = current?.block.journeyId;
  const blockEnd = current?.end;
  const data = useLiveQuery(async () => {
    const settings = await db.settings.get('settings');
    if (!settings || settings.deleted) return undefined;
    const today = dayKeyOf(now, settings.dayStartHour);
    const [missions, journeys, commitments, logs, dayState] = await Promise.all([
      db.missions.filter((m) => !m.deleted).toArray(),
      db.journeys.filter((j) => !j.deleted).toArray(),
      db.commitments.filter((c) => !c.deleted).toArray(),
      db.energyLogs.orderBy('at').reverse().filter((l) => !l.deleted).toArray(),
      db.dayState.get(today),
    ]);
    const energy = logs.find((l) => dayKeyOf(l.at, settings.dayStartHour) === today)?.level;
    const lastCompletionByArea: Record<string, number> = {};
    for (const m of missions) {
      if (m.status === 'done' && m.areaId && m.completedAt !== undefined) {
        lastCompletionByArea[m.areaId] = Math.max(lastCompletionByArea[m.areaId] ?? 0, m.completedAt);
      }
    }
    return {
      settings, missions, journeys, commitments, energy,
      hardDay: dayState && !dayState.deleted ? dayState.hardDay : false,
      picks: dayState && !dayState.deleted ? dayState.subjectPicks : undefined,
      lastCompletionByArea,
    };
  }, [now]);
  const skipKey = skipIds?.join(',') ?? '';
  return useMemo(() => {
    if (!data) return undefined;
    // The subject chosen with "Usar" wins over the block's journey, but only while it is an active subject.
    const pick = blockId !== undefined ? validPick(data.picks?.[blockId], data.journeys) : undefined;
    return suggest({
      now,
      dayStartHour: data.settings.dayStartHour,
      dayEndHour: data.settings.dayEndHour,
      missions: data.missions,
      journeys: data.journeys,
      commitments: data.commitments,
      energy: data.energy,
      hardDay: data.hardDay,
      mode,
      block: blockId !== undefined && blockEnd !== undefined
        ? { id: blockId, areaId: blockAreaId, journeyId: pick ?? blockJourneyId, endTs: blockEnd }
        : undefined,
      lastCompletionByArea: data.lastCompletionByArea,
      skipIds: skipKey ? skipKey.split(',') : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, now, skipKey, mode, blockId, blockAreaId, blockJourneyId, blockEnd]);
}

export interface CharacterStats {
  total: LevelInfo;
  byArea: Array<{ area: Area; info: LevelInfo; xp: number }>;
  week: boolean[];
  month: boolean[];
  /** Constancy over workdays only (§9): free days are listed but not counted. */
  weekWorkdays: ReturnType<typeof activeWorkdays>;
  monthWorkdays: ReturnType<typeof activeWorkdays>;
  recent: XpEvent[];
}

export function useCharacterStats(): CharacterStats | undefined {
  const now = useNow();
  return useLiveQuery(async () => {
    const settings = await db.settings.get('settings');
    if (!settings || settings.deleted) return undefined;
    const today = dayKeyOf(now, settings.dayStartHour);
    const [xp, areas, dayStates] = await Promise.all([
      db.xpEvents.filter((x) => !x.deleted).toArray(),
      db.areas.orderBy('order').toArray(),
      db.dayState.toArray(),
    ]);
    const isFree = isFreeDayFor(dayStates);
    let sum = 0;
    const perArea = new Map<string, number>();
    const days = new Set<DayKey>();
    for (const x of xp) {
      sum += x.amount;
      days.add(x.dayKey);
      if (x.areaId) perArea.set(x.areaId, (perArea.get(x.areaId) ?? 0) + x.amount);
    }
    return {
      total: levelFromXp(sum),
      byArea: areas.filter((a) => !a.deleted && !a.archived).map((area) => {
        const v = perArea.get(area.id) ?? 0;
        return { area, info: levelFromXp(v, true), xp: v };
      }),
      week: activeDays(days, today, 7),
      month: activeDays(days, today, 30),
      weekWorkdays: activeWorkdays(days, today, 7, isFree),
      monthWorkdays: activeWorkdays(days, today, 30, isFree),
      recent: xp.sort((a, b) => b.at - a.at).slice(0, 10),
    } satisfies CharacterStats;
  }, [now]);
}
