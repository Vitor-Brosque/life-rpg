import { useLiveQuery } from 'dexie-react-hooks';
import { create } from 'zustand';
import type { DayCloseSummary, DayKey, DayMode, DayState } from '@life/shared';
import { addDays, closeCardDue, dayCloseSummary, formatHHmm, logicalTimestamp, trainingLogId } from '@life/shared';
import { db } from '../../db/db';
import { useCommitments, useDayPlan, useSettings } from '../../db/hooks';
import { focusWhenGone } from '../../ui/focusAfter';

// "Como foi hoje" (Acompanhamento C): when the card is due, the sheet's open state, and what today observed.
// Reading never writes: only the buttons of the card and the sheet do.

interface DayCloseSheetStore { isOpen: boolean; open(): void; close(): void }

let opener: HTMLElement | null = null;

/** The close sheet for the whole app (card, link and the Painel). */
export const useDayCloseSheet = create<DayCloseSheetStore>((set) => ({
  isOpen: false,
  open: () => {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    set({ isOpen: true });
  },
  close: () => {
    // The opener may be gone by then (the card hides once the day is closed): focus must not fall on <body>.
    focusWhenGone(opener);
    set({ isOpen: false });
  },
}));

/** The evening card is due: today only (never an old day), a workday, after the class, not closed or dismissed. */
export function useDayCloseDue(today: DayKey | undefined, mode: DayMode, now: number): boolean {
  const settings = useSettings();
  const commitments = useCommitments();
  const state = useLiveQuery(async () => {
    if (!today) return undefined;
    const d = await db.dayState.get(today);
    return d && !d.deleted ? d : null;
  }, [today]);
  if (!today || !settings || state === undefined) return false;
  return closeCardDue({
    now, day: today, mode, state: state ?? undefined, commitments, dayStartHour: settings.dayStartHour,
  });
}

/** What today observed, with the day's state; undefined while loading. */
export function useDayCloseData(today?: DayKey): { summary: DayCloseSummary; state?: DayState } | undefined {
  const occurrences = useDayPlan(today);
  const data = useLiveQuery(async () => {
    if (!today) return undefined;
    const settings = await db.settings.get('settings');
    const dayStartHour = settings?.dayStartHour ?? 4;
    const from = logicalTimestamp(today, formatHHmm(dayStartHour * 60), dayStartHour);
    const to = logicalTimestamp(addDays(today, 1), formatHHmm(dayStartHour * 60), dayStartHour);
    const [missions, events, focus, reviews, practice, trainingLog, workouts, state] = await Promise.all([
      db.missions.toArray(),
      db.events.where('at').between(from, to, true, false).toArray(),
      db.focusSessions.where('startedAt').between(from, to, true, false).toArray(),
      db.reviews.where('day').equals(today).toArray(),
      db.practiceSessions.toArray(),
      db.trainingLogs.get(trainingLogId(today)),
      db.workouts.where('day').equals(today).toArray(),
      db.dayState.get(today),
    ]);
    return { day: today, dayStartHour, missions, events, focus, reviews, practice, trainingLog, workouts, state };
  }, [today]);
  if (!today || !occurrences || !data || data.day !== today) return undefined;
  const live = data.state && !data.state.deleted ? data.state : undefined;
  const summary = dayCloseSummary({
    day: today, dayStartHour: data.dayStartHour, occurrences, missions: data.missions, events: data.events,
    focus: data.focus, reviews: data.reviews, practice: data.practice, trainingLog: data.trainingLog, workouts: data.workouts,
  });
  return { summary, ...(live ? { state: live } : {}) };
}
