import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKey, DiaryAppDay, DiaryDayGroup, DiaryEntry, DiaryReviewRef, ID } from '@life/shared';
import {
  addDays, diaryAppDays, diaryCloseId, diaryReviews, diaryTrashed, diaryVisible, diaryWeek, linkKey, sleepLogId, weekDays,
} from '@life/shared';
import { db } from './db';

// Diário: reading only (opening a screen never writes). Plain async readers, each wrapped by a live hook.

async function hours(): Promise<{ dayStartHour: number; dayEndHour: number }> {
  const s = await db.settings.get('settings');
  return { dayStartHour: s?.dayStartHour ?? 4, dayEndHour: s?.dayEndHour ?? 23 };
}

const weekEntries = (monday: DayKey): Promise<DiaryEntry[]> =>
  db.diaryEntries.where('day').between(monday, addDays(monday, 6), true, true).toArray();

async function weekReviews(monday: DayKey, dayStartHour: number): Promise<DiaryReviewRef[]> {
  const [weeks, months, seasons] = await Promise.all([db.weeks.toArray(), db.monthReviews.toArray(), db.seasons.toArray()]);
  return diaryReviews({ weeks, months, seasons, monday, dayStartHour });
}

/** The timeline of the week of `monday`: day groups (newest first) with the reviews answered that week. */
export async function readDiaryWeek(monday: DayKey): Promise<DiaryDayGroup[]> {
  const { dayStartHour } = await hours();
  const [entries, reviews] = await Promise.all([weekEntries(monday), weekReviews(monday, dayStartHour)]);
  return diaryWeek(entries, monday, reviews);
}

export function useDiaryWeek(monday: DayKey): DiaryDayGroup[] | undefined {
  const data = useLiveQuery(async () => ({ monday, groups: await readDiaryWeek(monday) }), [monday]);
  return data && data.monday === monday ? data.groups : undefined;
}

/** Every entry (search, filters, the links in use); undefined while loading. */
export function useDiaryEntries(): DiaryEntry[] | undefined {
  return useLiveQuery(() => db.diaryEntries.toArray());
}

/** One entry: undefined while loading, null when it does not exist (yet). */
export function useDiaryEntry(id: ID): DiaryEntry | null | undefined {
  const data = useLiveQuery(async () => ({ id, entry: (await db.diaryEntries.get(id)) ?? null }), [id]);
  return data && data.id === id ? data.entry : undefined;
}

/** "Apagadas recentemente", the most recently trashed first. */
export function useDiaryTrash(): DiaryEntry[] | undefined {
  return useLiveQuery(async () => (await db.diaryEntries.toArray())
    .filter(diaryTrashed).sort((a, b) => b.trashedAt! - a.trashedAt!));
}

/** Titles of the link targets (any status, not deleted), keyed by linkKey. */
export async function readLinkNames(): Promise<Record<string, string>> {
  const [missions, journeys] = await Promise.all([db.missions.toArray(), db.journeys.toArray()]);
  const out: Record<string, string> = {};
  for (const m of missions) if (!m.deleted) out[linkKey({ kind: 'mission', id: m.id })] = m.title;
  for (const j of journeys) if (!j.deleted) out[linkKey({ kind: 'journey', id: j.id })] = j.title;
  return out;
}

export function useLinkNames(): Record<string, string> | undefined {
  return useLiveQuery(readLinkNames);
}

/** Today's visible `fechamento` entry (the "Como foi hoje?" observation), or null. */
export async function readCloseEntry(day: DayKey): Promise<DiaryEntry | null> {
  const e = await db.diaryEntries.get(diaryCloseId(day));
  return e && diaryVisible(e) ? e : null;
}

export interface DiaryExportData {
  entries: DiaryEntry[];
  appDays: Record<DayKey, DiaryAppDay>;
  reviews: DiaryReviewRef[];
  linkNames: Record<string, string>;
}

/** Everything "Exportar semana" needs for the week of `monday` (diaryMarkdown's input, without the options). */
export async function readDiaryExport(monday: DayKey): Promise<DiaryExportData> {
  const { dayStartHour, dayEndHour } = await hours();
  const days = weekDays(monday);
  const sunday = days[6]!;
  const [entries, reviews, linkNames, dayStates, blocks, commitments, sessions, dayPlans, trainingLogs, workouts, sleepLogs] = await Promise.all([
    weekEntries(monday),
    weekReviews(monday, dayStartHour),
    readLinkNames(),
    db.dayState.bulkGet(days),
    db.blocks.toArray(),
    db.commitments.toArray(),
    db.blockSessions.where('day').between(monday, sunday, true, true).toArray(),
    db.dayPlans.bulkGet(days),
    db.trainingLogs.where('day').between(monday, sunday, true, true).toArray(),
    db.workouts.where('day').between(monday, sunday, true, true).toArray(),
    db.sleepLogs.bulkGet(days.map((d) => sleepLogId(addDays(d, -1)))),
  ]);
  const present = <T>(rows: Array<T | undefined>): T[] => rows.filter((r): r is T => r !== undefined);
  const appDays = diaryAppDays({
    days, dayStartHour, dayEndHour, dayStates: present(dayStates), blocks, commitments, sessions,
    dayPlans: present(dayPlans), trainingLogs, workouts, sleepLogs: present(sleepLogs),
  });
  return { entries, appDays, reviews, linkNames };
}

export function useDiaryExport(monday: DayKey): DiaryExportData | undefined {
  const data = useLiveQuery(async () => ({ monday, data: await readDiaryExport(monday) }), [monday]);
  return data && data.monday === monday ? data.data : undefined;
}
