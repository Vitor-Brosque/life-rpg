import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { BlockOccurrence, DayKey, DayMode, Mission } from '@life/shared';
import { dayKeyOf, defaultDayMode, needsReview, occurrencesOn, todayList, weekdayOf } from '@life/shared';
import { db } from '../../db/db';
import {
  useAreas, useCommitments, useDayPlan, useMissions, useNow, useSettings, useToday,
} from '../../db/hooks';
import type { PhraseCategory } from '../companion/phrases';
import { useCompanion } from '../companion/store';
import { useAgoraSession } from './useAgora';

// Data and moments shared by the Agora screen (phone) and the Painel (second monitor).

/** Today's missions (manual order), commitment occurrences and missions completed today. */
export function useTodayData() {
  const settings = useSettings();
  const today = useToday();
  const now = useNow();
  const missions = useMissions();
  const areas = useAreas();
  const commitments = useCommitments();

  const dayStartHour = settings?.dayStartHour;
  const todayMissions = useMemo(() => (today ? todayList(missions, today, now) : []), [missions, today, now]);
  const occurrences = useMemo(
    () => (today ? occurrencesOn(commitments, today, dayStartHour) : []),
    [commitments, today, dayStartHour],
  );
  const doneToday = useMemo(() => {
    if (!today || !settings) return [];
    return missions
      .filter((m) => m.status === 'done' && m.completedAt !== undefined
        && dayKeyOf(m.completedAt, settings.dayStartHour) === today)
      .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
  }, [missions, today, settings]);

  return { settings, today, now, missions, areas, todayMissions, occurrences, doneToday };
}

/**
 * The quick review card (§8): shown when missions were left behind and today's review is not
 * done. Latched: once shown it stays (even after finishReview marks the day) until
 * "Pronto"/"Dispensar", which hide it for the rest of that day.
 */
export function useDayReview(today: DayKey | undefined, missions: Mission[]) {
  // undefined while loading, null when the day has no state yet.
  const dayState = useLiveQuery(async () => (today ? (await db.dayState.get(today)) ?? null : undefined), [today]);
  const dismissedDay = useAgoraSession((s) => s.reviewDismissedDay);
  const dismissReview = useAgoraSession((s) => s.dismissReview);
  const [open, setOpen] = useState(false);
  const dismissed = today !== undefined && dismissedDay === today;

  const items = useMemo(() => (today ? needsReview(missions, today) : []), [missions, today]);
  const reviewDone = dayState === undefined ? true : !!dayState && !dayState.deleted && dayState.reviewDone;
  const hardDay = !!dayState && !dayState.deleted && dayState.hardDay;
  useEffect(() => {
    if (!dismissed && !reviewDone && items.length > 0) setOpen(true);
  }, [dismissed, reviewDone, items.length]);

  return {
    items,
    show: open && !dismissed,
    close: () => { setOpen(false); if (today) dismissReview(today); },
    hardDay,
  };
}

export interface DayType {
  /** False until today's state is read (avoids flashing the wrong view). */
  loaded: boolean;
  /** Recorded mode, else the weekday default (§6). */
  mode: DayMode;
  /** "Como está hoje?" was answered today. */
  asked: boolean;
  weekend: boolean;
}

/** Today's type and whether the day-type card should ask (workday without an answer). */
export function useDayType(today: DayKey | undefined): DayType {
  const dayState = useLiveQuery(async () => (today ? (await db.dayState.get(today)) ?? null : undefined), [today]);
  const live = dayState && !dayState.deleted ? dayState : undefined;
  const wd = today ? weekdayOf(today) : 1;
  return {
    loaded: today !== undefined && dayState !== undefined,
    mode: today ? defaultDayMode(today, live) : 'normal',
    asked: !!live?.mode,
    weekend: wd === 0 || wd === 6,
  };
}

/** Today's block plan with its current and next occurrence (one live query for both). */
export function useBlocksNow(now: number): {
  plan?: BlockOccurrence[]; current?: BlockOccurrence; next?: BlockOccurrence;
} {
  const plan = useDayPlan();
  return useMemo(() => ({
    plan,
    current: plan?.find((o) => o.state === 'current'),
    next: plan?.find((o) => o.state === 'upcoming' && o.start > now),
  }), [plan, now]);
}

function greetingFor(hour: number, dayStartHour: number): PhraseCategory {
  if (hour >= dayStartHour && hour < 12) return 'greetMorning';
  if (hour >= 12 && hour < 18) return 'greetAfternoon';
  return 'greetNight';
}

/** A greeting is on its way (its `say` has not set the message yet). */
let greetingPending = false;

/**
 * Companion moments of the Agora/Painel: a greeting once per day, the "empty" line once per day
 * when there is nothing to suggest (after any other message is gone), and a gentle nudge when the
 * card moves on from a mission postponed 3+ times.
 */
export function useCompanionMoments(
  dayStartHour: number | undefined, today: DayKey | undefined, primaryId: string | undefined,
  postponed: boolean, empty: boolean, free = false,
) {
  useEffect(() => {
    if (dayStartHour === undefined || !today) return;
    const session = useAgoraSession.getState();
    if (session.greetedDay === today) return;
    useAgoraSession.setState({ greetedDay: today });
    // The first-access introduction (Onboarding) is already showing: it is today's greeting.
    if (useCompanion.getState().message) return;
    greetingPending = true;
    // On a free day the greeting is a rest line.
    void useCompanion.getState().say(free ? 'dayFree' : greetingFor(new Date().getHours(), dayStartHour))
      .finally(() => { greetingPending = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStartHour, today]);

  const message = useCompanion((s) => s.message);
  const greetedDay = useAgoraSession((s) => s.greetedDay);
  useEffect(() => {
    if (!empty || free || !today || message !== undefined || greetingPending || greetedDay !== today) return;
    if (useAgoraSession.getState().emptyDay === today) return;
    useAgoraSession.setState({ emptyDay: today });
    void useCompanion.getState().say('empty');
  }, [empty, free, today, message, greetedDay]);

  const lastPrimary = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = lastPrimary.current;
    lastPrimary.current = primaryId;
    if (prev !== undefined && primaryId !== undefined && prev !== primaryId && postponed) {
      void useCompanion.getState().say('postponed');
    }
  }, [primaryId, postponed]);
}
