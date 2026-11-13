import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type {
  AreaShare, CheckinBreakdown, DayKey, Hypothesis, MethodAssociation, PatternData, PeriodKind, PostponeObserved,
  Settings, SleepBlocksAssociation, SleepModeAssociation, TrendPoint, WatchNotice,
} from '@life/shared';
import {
  addDays, checkinBreakdown, completedMonths, completedWeeks, dayIndex, effortByArea, patternSettingsOf, periodsSince,
  postponeHypotheses, postponeObserved, reviewMethods, sleepVsBlocks, sleepVsDayMode, timestampAt, trendPoints,
  watchNotices,
} from '@life/shared';
import { db } from '../../db/db';
import { useToday } from '../../db/hooks';

/** How far back the screen reads (the weeks 5–8 watch needs up to 52 weeks; trends need ~7 months). */
export const PATTERN_HISTORY_DAYS = 400;
export const TREND_WEEKS = 8;
export const TREND_MONTHS = 6;

const live = <T extends { deleted: boolean }>(rows: T[]): T[] => rows.filter((r) => !r.deleted);

/** Everything the Padrões screen needs, without soft-deleted records (big tables: the last 400 days). */
export async function readPatternData(today: DayKey, settings: Settings): Promise<PatternData> {
  const from = addDays(today, -PATTERN_HISTORY_DAYS);
  const fromTs = timestampAt(from, '00:00');
  const [
    dayStates, blocks, commitments, sessions, xpEvents, events, missions, areas, checkins, reviews, practice,
    sleepLogs, workouts, weeks,
  ] = await Promise.all([
    db.dayState.toArray(),
    db.blocks.toArray(),
    db.commitments.toArray(),
    db.blockSessions.where('day').aboveOrEqual(from).toArray(),
    db.xpEvents.where('dayKey').aboveOrEqual(from).toArray(),
    db.events.where('at').aboveOrEqual(fromTs).toArray(),
    db.missions.toArray(),
    db.areas.toArray(),
    db.checkins.where('at').aboveOrEqual(fromTs).toArray(),
    db.reviews.where('day').aboveOrEqual(from).toArray(),
    db.practiceSessions.toArray(),
    db.sleepLogs.where('night').aboveOrEqual(from).toArray(),
    db.workouts.where('day').aboveOrEqual(from).toArray(),
    db.weeks.toArray(),
  ]);
  return {
    today,
    dayStartHour: settings.dayStartHour,
    dayEndHour: settings.dayEndHour,
    dayStates: live(dayStates),
    blocks: live(blocks),
    commitments: live(commitments),
    sessions: live(sessions),
    xpEvents: live(xpEvents),
    events: live(events),
    missions: live(missions),
    areas: live(areas),
    checkins: live(checkins),
    reviews: live(reviews),
    practice: live(practice),
    sleepLogs: live(sleepLogs),
    workouts: live(workouts),
    weeks: live(weeks),
    watchDismissed: patternSettingsOf(settings).watchDismissed,
  };
}

/** PatternData of today, live; `enabled = false` reads nothing (undefined). */
export function usePatternData(enabled = true): PatternData | undefined {
  const today = useToday();
  return useLiveQuery(async () => {
    if (!enabled || !today) return undefined;
    const settings = await db.settings.get('settings');
    if (!settings || settings.deleted) return undefined;
    return readPatternData(today, settings);
  }, [today, enabled]);
}

/** The weeks 5–8 notices (dismissed ones already out); undefined while loading or disabled. */
export function useWatchNotices(enabled = true): WatchNotice[] | undefined {
  const data = usePatternData(enabled);
  return useMemo(() => (data ? watchNotices(data) : undefined), [data]);
}

export interface PastExperiment { week: DayKey; label: string; experiment: string; started: number; planned: number }

export interface PatternsView {
  hasData: boolean;
  kind: PeriodKind;
  points: TrendPoint[];
  balance: AreaShare[];
  breakdown: CheckinBreakdown;
  postpone: PostponeObserved;
  hypotheses: Hypothesis[];
  watch: WatchNotice[];
  sleepBlocks: SleepBlocksAssociation;
  sleepMode: SleepModeAssociation;
  methods: MethodAssociation;
  pastExperiments: PastExperiment[];   // newest first
}

const NO_BREAKDOWN: CheckinBreakdown = { escapesByPart: [], escapesByArea: [], escapesByPlace: [], feelings: [] };

/** Everything the Padrões screen shows, from one PatternData (pure; recomputed when data or kind change). */
export function buildPatternsView(data: PatternData, kind: PeriodKind): PatternsView {
  const idx = dayIndex(data);
  const firstDay = data.xpEvents.reduce<DayKey | undefined>(
    (m, x) => (x.deleted || (m !== undefined && m <= x.dayKey) ? m : x.dayKey), undefined);
  const weeks = periodsSince(completedWeeks(data.today, TREND_WEEKS), firstDay);
  const periods = kind === 'week' ? weeks : periodsSince(completedMonths(data.today, TREND_MONTHS), firstDay);
  const points = trendPoints(data, periods, idx);
  const weekPoints = kind === 'week' ? points : trendPoints(data, weeks, idx);
  const from = periods[0]?.start;
  const to = periods[periods.length - 1]?.end;
  const experiments = new Map(data.weeks
    .filter((w) => !w.deleted && w.experiment?.trim())
    .map((w) => [w.id, w.experiment!.trim()]));
  const postpone = postponeObserved(data);
  return {
    hasData: firstDay !== undefined,
    kind,
    points,
    balance: from && to ? effortByArea(data, from, to) : [],
    breakdown: from && to ? checkinBreakdown(data, from, to) : NO_BREAKDOWN,
    postpone,
    hypotheses: postponeHypotheses(postpone),
    watch: watchNotices(data, idx),
    sleepBlocks: sleepVsBlocks(data, idx),
    sleepMode: sleepVsDayMode(data, idx),
    methods: reviewMethods(data),
    pastExperiments: weekPoints
      .filter((p) => experiments.has(p.period.key))
      .map((p) => ({
        week: p.period.key, label: p.period.label, experiment: experiments.get(p.period.key)!,
        started: p.blocksStarted, planned: p.blocksPlanned,
      }))
      .reverse(),
  };
}
