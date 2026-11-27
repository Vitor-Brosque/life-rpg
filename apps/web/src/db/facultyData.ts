import { useLiveQuery } from 'dexie-react-hooks';
import type { Area, Commitment, ContactData, DayKey, Journey, Mission } from '@life/shared';
import { addDays, dayKeyOf, studySettingsOf } from '@life/shared';
import { db } from './db';
import { useNow, useSettings } from './hooks';

/** Everything the Matérias screens and the Faculdade block need, read once (live rows only). */
export interface FacultyData {
  today: DayKey;
  dayStartHour: number;
  restDays: number[];
  areas: Area[];
  journeys: Journey[];
  missions: Mission[];
  commitments: Commitment[];
  contact: ContactData;
}

const live = <T extends { deleted: boolean }>(rows: T[]): T[] => rows.filter((r) => !r.deleted);

const WINDOW_DAYS = 200;

export async function readFacultyData(now: number): Promise<FacultyData | undefined> {
  const settings = await db.settings.get('settings');
  if (!settings) return undefined;
  const dayStartHour = settings.dayStartHour;
  const today = dayKeyOf(now, dayStartHour);
  const since = addDays(today, -WINDOW_DAYS);
  const sinceTs = now - WINDOW_DAYS * 86_400_000;
  const [areas, journeys, missions, commitments, decks, cards, reviews, practice, focus, problemSets, topics, studyFiles, progress] = await Promise.all([
    db.areas.toArray(), db.journeys.toArray(), db.missions.toArray(), db.commitments.toArray(),
    db.decks.toArray(), db.cards.toArray(), db.reviews.where('day').aboveOrEqual(since).toArray(),
    db.practiceSessions.toArray(), db.focusSessions.where('startedAt').aboveOrEqual(sinceTs).toArray(),
    db.problemSets.toArray(), db.subjectTopics.toArray(), db.studyFiles.toArray(), db.studyFileProgress.toArray(),
  ]);
  const liveMissions = live(missions);
  return {
    today,
    dayStartHour,
    restDays: [...studySettingsOf(settings).restDays],
    areas: live(areas),
    journeys: live(journeys),
    missions: liveMissions,
    commitments: live(commitments),
    contact: {
      dayStartHour,
      decks: live(decks), cards: live(cards), reviews: live(reviews), practice: live(practice),
      missions: liveMissions, focus: live(focus), problemSets: live(problemSets), topics: live(topics),
      studyFiles: live(studyFiles), studyFileProgress: live(progress), // PDFs da aula: reading one counts as contact
    },
  };
}

/** Live faculty data; undefined while loading. Re-read when the day changes. */
export function useFacultyData(): FacultyData | undefined {
  const settings = useSettings();
  const now = useNow();
  const today = settings ? dayKeyOf(now, settings.dayStartHour) : undefined;
  return useLiveQuery(() => readFacultyData(now), [today]);
}
