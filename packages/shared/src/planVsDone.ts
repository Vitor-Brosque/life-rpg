import type { DayKey, DayMode, FocusSession, ID } from './types';
import { dayKeyOf } from './dates';
import { periodDays, type Period } from './periods';
import { atypicalWeekSet, dayIndex, overlapsAtypical, type DayIndex, type PatternData } from './trends';

// Planejado × executado (Acompanhamento D), in minutes per area, only on days with a recorded plan.
// Planned: the plan's blocks in the day mode's version. Executed: lived block windows plus focus
// sessions that overlap no block window. App-open time never counts.

export interface AreaMinutes { key: string; name: string; plannedMin: number; executedMin: number }
export interface DayMinutes { day: DayKey; mode: DayMode; plannedMin: number; executedMin: number; areas: AreaMinutes[] }
export interface PlanVsDonePoint {
  period: Period;
  daysWithPlan: number;
  plannedMin: number;
  executedMin: number;
  areas: AreaMinutes[];
  days: DayMinutes[];          // oldest → newest
  atypical?: boolean;
}

const MIN = 60_000;
interface Group { key: string; name: string }

const byMinutes = (a: AreaMinutes, b: AreaMinutes): number =>
  b.plannedMin - a.plannedMin || b.executedMin - a.executedMin || a.name.localeCompare(b.name, 'pt-BR');

function addTo(map: Map<string, AreaMinutes>, g: Group, plannedMin: number, executedMin: number): void {
  if (plannedMin === 0 && executedMin === 0) return;
  const cur = map.get(g.key);
  if (cur) { cur.plannedMin += plannedMin; cur.executedMin += executedMin; }
  else map.set(g.key, { key: g.key, name: g.name, plannedMin, executedMin });
}

const total = (rows: readonly AreaMinutes[], k: 'plannedMin' | 'executedMin'): number => rows.reduce((s, r) => s + r[k], 0);

/** One point per period: the days before today that are workdays and have a recorded plan. */
export function planVsDone(data: PatternData, periods: readonly Period[], idx: DayIndex = dayIndex(data)): PlanVsDonePoint[] {
  const areaNames = new Map(data.areas.map((a) => [a.id, a.name]));
  const journeys = new Map((data.journeys ?? []).map((j) => [j.id, j]));
  const missions = new Map(data.missions.map((m) => [m.id, m]));
  /** The area (or, without one, the journey) a block or a focus session belongs to. */
  const groupOf = (areaId?: ID, journeyId?: ID): Group => {
    const journey = journeyId ? journeys.get(journeyId) : undefined;
    const area = areaId ?? journey?.areaId;
    if (area) return { key: area, name: areaNames.get(area) ?? 'Outra área' };
    if (journey) return { key: `journey:${journey.id}`, name: journey.title };
    return { key: '', name: 'Sem área' };
  };
  const focusByDay = new Map<DayKey, FocusSession[]>();
  for (const f of data.focusSessions ?? []) {
    if (f.deleted) continue;
    const day = dayKeyOf(f.startedAt, data.dayStartHour);
    const list = focusByDay.get(day);
    if (list) list.push(f);
    else focusByDay.set(day, [f]);
  }
  const atypical = atypicalWeekSet(data.weeks);

  return periods.map((period) => {
    const days: DayMinutes[] = [];
    const periodAreas = new Map<string, AreaMinutes>();
    for (const day of periodDays(period)) {
      if (day >= data.today || !idx.isWorkday(day) || !idx.plan(day)) continue;
      const dayAreas = new Map<string, AreaMinutes>();
      const counted = idx.blocks(day);
      for (const c of counted) {
        const executed = c.lived ? Math.round((c.lived.end - c.lived.start) / MIN) : 0;
        addTo(dayAreas, groupOf(c.block.areaId, c.block.journeyId), c.plannedMin, executed);
      }
      const windows = counted.flatMap((c) => (c.lived ? [c.lived] : []));
      for (const f of focusByDay.get(day) ?? []) {
        if (windows.some((w) => f.startedAt < w.end && w.start < f.endedAt)) continue;
        const m = f.missionId ? missions.get(f.missionId) : undefined;
        addTo(dayAreas, groupOf(f.areaId ?? m?.areaId, m?.journeyId), 0, Math.round(f.activeMs / MIN));
      }
      const rows = [...dayAreas.values()].sort(byMinutes);
      for (const r of rows) addTo(periodAreas, r, r.plannedMin, r.executedMin);
      days.push({ day, mode: idx.mode(day), plannedMin: total(rows, 'plannedMin'), executedMin: total(rows, 'executedMin'), areas: rows });
    }
    const areas = [...periodAreas.values()].sort(byMinutes);
    return {
      period,
      daysWithPlan: days.length,
      plannedMin: total(areas, 'plannedMin'),
      executedMin: total(areas, 'executedMin'),
      areas,
      days,
      ...(overlapsAtypical(atypical, period.start, period.end) ? { atypical: true } : {}),
    };
  });
}
