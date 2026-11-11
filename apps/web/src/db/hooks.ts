import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type {
  Area, Commitment, DayKey, DayState, EnergyLevel, EngineOutput, Journey, LevelInfo, Mission,
  Profile, Settings, XpEvent,
} from '@life/shared';
import { activeDays, dayKeyOf, levelFromXp, suggest } from '@life/shared';
import { db } from './db';

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
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

export function useEngine(skipIds?: string[]): EngineOutput | undefined {
  const now = useNow();
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
      lastCompletionByArea,
    };
  }, [now]);
  const skipKey = skipIds?.join(',') ?? '';
  return useMemo(() => {
    if (!data) return undefined;
    return suggest({
      now,
      dayStartHour: data.settings.dayStartHour,
      dayEndHour: data.settings.dayEndHour,
      missions: data.missions,
      journeys: data.journeys,
      commitments: data.commitments,
      energy: data.energy,
      hardDay: data.hardDay,
      lastCompletionByArea: data.lastCompletionByArea,
      skipIds: skipKey ? skipKey.split(',') : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, now, skipKey]);
}

export interface CharacterStats {
  total: LevelInfo;
  byArea: Array<{ area: Area; info: LevelInfo; xp: number }>;
  week: boolean[];
  month: boolean[];
  recent: XpEvent[];
}

export function useCharacterStats(): CharacterStats | undefined {
  const now = useNow();
  return useLiveQuery(async () => {
    const settings = await db.settings.get('settings');
    if (!settings || settings.deleted) return undefined;
    const today = dayKeyOf(now, settings.dayStartHour);
    const [xp, areas] = await Promise.all([
      db.xpEvents.filter((x) => !x.deleted).toArray(),
      db.areas.orderBy('order').toArray(),
    ]);
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
      recent: xp.sort((a, b) => b.at - a.at).slice(0, 10),
    } satisfies CharacterStats;
  }, [now]);
}
