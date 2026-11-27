import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKey, Season, SeasonWeek } from '@life/shared';
import { activeSeason, atypicalWeekSet, seasonLine, seasonSkippedNote, seasonWeek } from '@life/shared';
import { db } from './db';

// Temporadas: reading only (opening a screen never writes).

export interface SeasonNow { season: Season; week: SeasonWeek; line: string; skippedNote?: string }

/** Mondays of the weeks marked atypical; undefined while loading. */
export function useAtypicalWeeks(): Set<DayKey> | undefined {
  return useLiveQuery(async () => atypicalWeekSet(await db.weeks.toArray()));
}

/** The active season on `today`, with its week and the card's line; null without one; undefined while loading. */
export function useSeasonNow(today: DayKey | undefined): SeasonNow | null | undefined {
  const seasons = useLiveQuery(() => db.seasons.toArray());
  const atypical = useAtypicalWeeks();
  if (!today || !seasons || !atypical) return undefined;
  const season = activeSeason(seasons);
  if (!season) return null;
  const week = seasonWeek(season, atypical, today);
  const skippedNote = seasonSkippedNote(week);
  return { season, week, line: seasonLine(season, week), ...(skippedNote ? { skippedNote } : {}) };
}
