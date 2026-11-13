import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { CharacterLook, DayKey, ID, NpcLine, Territory, WorldFacts, WorldJourney, WorldModel } from '@life/shared';
import {
  activeNews, avatarAreaId, buildAreaFacts, buildWorld, normalizeSeen, npcLines, npcStartIndex, reasonDaysThisWeek,
} from '@life/shared';
import { useDayMode, useDayPlan, useNow, useProfile, useSettings, useToday } from '../../db/hooks';
import { getMeta } from '../../db/repo';
import { XP_REASON_LABEL } from '../character/CharacterScreen';
import { journeyStats } from '../journeys/journeyData';
import { useStudyPlan } from '../study/useStudyPlan';
import { WORLD_META_KEY } from './WorldWatcher';
import { readWorldData, weekWindow } from './worldData';

export interface TerritoryView {
  t: Territory;
  lines: NpcLine[];   // never empty
  start: number;      // npcStartIndex
  talk: boolean;      // has a time-sensitive line
  grew: boolean;      // stage news in the last 3 days
}

export interface WorldView {
  model: WorldModel;
  territories: TerritoryView[];   // same order as model.territories
  missionTitles: ReadonlyMap<ID, string>;
  look: CharacterLook;
  companionName: string;
  today: DayKey;
  now: number;
}

const DEFAULT_LOOK: CharacterLook = { skin: 0, hair: 0, hairColor: 0, outfit: 0 };

/** PT-BR label of an XP reason; reasons added by later milestones fall back to the raw key. */
export const reasonLabel = (reason: string): string => (XP_REASON_LABEL as Record<string, string>)[reason] ?? reason;

/** The whole world, live: data changes, the day plan (avatar) and the study plan (escriba). Map screen only. */
export function useWorld(): WorldView | undefined {
  const settings = useSettings();
  const today = useToday();
  const now = useNow();
  const mode = useDayMode();
  const plan = useDayPlan();
  const study = useStudyPlan();
  const profile = useProfile();
  const startHour = settings?.dayStartHour;
  const data = useLiveQuery(
    async () => (today !== undefined && startHour !== undefined ? { today, d: await readWorldData(today, startHour) } : undefined),
    [today, startHour],
  );
  const seenRaw = useLiveQuery(() => getMeta<unknown>(WORLD_META_KEY), []);

  return useMemo(() => {
    if (!data || !today || data.today !== today || startHour === undefined) return undefined;
    const d = data.d;
    const { weekStart, weekStartTs } = weekWindow(today, startHour);
    const journeys: WorldJourney[] = d.journeys.filter((j) => j.status === 'active').map((j) => {
      const s = journeyStats(j, d.missions);
      return {
        id: j.id, title: j.title, order: j.order, done: s.done, total: s.total,
        ...(j.areaId ? { areaId: j.areaId } : {}),
        ...(s.next ? { nextTitle: s.next.firstStep ?? s.next.title } : {}),
      };
    });
    const model = buildWorld({ areas: d.areas, xp: d.xp, journeys, avatarAreaId: avatarAreaId(plan ?? [], d.journeys) });
    const facts = buildAreaFacts({
      today, weekStart, weekStartTs, areaIds: d.areas.map((a) => a.id), xp: d.xp, missions: d.missions,
      journeys: d.journeys, focus: d.focus, blocks: d.blocks, sessions: d.sessions, reasonLabel,
    });
    const p = study.loaded ? study.plan : undefined;
    const world: WorldFacts = {
      today, mode,
      reasonDays: reasonDaysThisWeek(d.xp, weekStart, today),
      sketchesThisWeek: d.sketchesThisWeek,
      checkinsThisWeek: d.checkinsThisWeek,
      ...(p ? {
        study: {
          due: p.dueCount, fresh: p.newAllowed, minutes: p.todayMin,
          goalMet: (p.goalMet || p.nothingLeft) && p.reviewsToday > 0,
          restDay: study.restDay, cards: study.input?.cards.length ?? 0,
        },
      } : {}),
      ...(d.workouts ? { workouts: d.workouts } : {}),
      ...(d.freezer ? { freezer: d.freezer } : {}),
      ...(d.sleepNights !== undefined ? { sleepNights: d.sleepNights } : {}),
    };
    const grew = new Set(activeNews(normalizeSeen(seenRaw), now).flatMap((n) => (n.kind === 'stage' ? [n.areaId] : [])));
    const territories = model.territories.map((t): TerritoryView => {
      const lines = npcLines({
        kind: t.npc.kind, area: t.area, stage: t.stage, facts: facts[t.area.id]!, world,
        ...(t.next ? { next: t.next } : {}),
        ...(t.journeys[0] ? { journey: t.journeys[0] } : {}),
      });
      return { t, lines, start: npcStartIndex(lines, today, t.index), talk: lines.some((l) => l.now), grew: grew.has(t.area.id) };
    });
    return {
      model, territories,
      missionTitles: new Map(d.missions.map((m) => [m.id, m.title])),
      look: profile?.look ?? DEFAULT_LOOK,
      companionName: profile?.companionName || 'Faísca',
      today, now,
    };
  }, [data, today, startHour, plan, study, mode, profile, seenRaw, now]);
}
