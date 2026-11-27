import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKey, ReportData, ReportRange } from '@life/shared';
import { REPORT_LOOKBACK_DAYS, addDays, patternSettingsOf, studySettingsOf, timestampAt } from '@life/shared';
import { db } from './db';
import { readLinkNames } from './diaryData';

// Relatórios: reading only (opening the screen and changing the choices never write). One reader for everything a
// report needs, like readDiaryExport; the rules in @life/shared pick what goes in.

const live = <T extends { deleted: boolean }>(rows: T[]): T[] => rows.filter((r) => !r.deleted);

/**
 * Everything a report of `range` needs: live records of the date-indexed tables from REPORT_LOOKBACK_DAYS before
 * the range on, the small tables whole, the range's diary entries as stored, and the link names. Undefined
 * without settings.
 */
export async function readReportData(range: Pick<ReportRange, 'start' | 'end'>, today: DayKey): Promise<ReportData | undefined> {
  const settings = await db.settings.get('settings');
  if (!settings || settings.deleted) return undefined;
  const from = addDays(range.start, -REPORT_LOOKBACK_DAYS);
  const fromTs = timestampAt(from, '00:00');
  const [
    dayStates, blocks, commitments, sessions, xpEvents, events, missions, areas, checkins, reviews, practice, sleepLogs,
    workouts, weeks, dayPlans, focusSessions, journeys, diaryEntries, monthReviews, trainingLogs, problemSets, subjectTopics,
    decks, cards, linkNames, strategies, goals, seasons, speechSessions, speechSituations, speechPrograms,
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
    db.dayPlans.toArray(),
    db.focusSessions.where('startedAt').aboveOrEqual(fromTs).toArray(),
    db.journeys.toArray(),
    db.diaryEntries.where('day').between(range.start, range.end, true, true).toArray(),
    db.monthReviews.toArray(),
    db.trainingLogs.where('day').aboveOrEqual(from).toArray(),
    db.problemSets.toArray(),
    db.subjectTopics.toArray(),
    db.decks.toArray(),
    db.cards.toArray(),
    readLinkNames(),
    db.strategies.toArray(),
    db.goals.toArray(),
    db.seasons.toArray(),
    db.speechSessions.toArray(),
    db.speechSituations.toArray(),
    db.speechPrograms.toArray(),
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
    dayPlans: live(dayPlans).filter((p) => p.day >= from),
    focusSessions: live(focusSessions),
    journeys: live(journeys),
    restDays: [...studySettingsOf(settings).restDays],
    diaryEntries,
    monthReviews: live(monthReviews),
    trainingLogs: live(trainingLogs),
    problemSets: live(problemSets),
    subjectTopics: live(subjectTopics),
    decks: live(decks),
    cards: live(cards),
    linkNames,
    strategies: live(strategies),
    goals: live(goals),
    seasons: live(seasons),
    speechSessions: live(speechSessions),
    speechSituations: live(speechSituations),
    speechPrograms: live(speechPrograms),
  };
}

/**
 * The report data of `range`, live. `data` is undefined while loading, without a range, or while another range is still
 * read; `failed` when reading this range rejected (logged), so the screen can say so instead of loading forever.
 */
export function useReportData(
  range: Pick<ReportRange, 'start' | 'end'> | undefined,
  today: DayKey | undefined,
  attempt = 0,
): { data: ReportData | undefined; failed: boolean } {
  const key = range && today ? `${range.start}|${range.end}|${today}|${attempt}` : '';
  const read = useLiveQuery(async () => {
    try {
      return { key, failed: false, data: range && today ? await readReportData(range, today) : undefined };
    } catch (e) {
      console.error('report read failed', e);
      return { key, failed: true, data: undefined };
    }
  }, [key]);
  return read && read.key === key ? { data: read.data, failed: read.failed } : { data: undefined, failed: false };
}
