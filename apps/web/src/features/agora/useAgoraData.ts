import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKey, Mission } from '@life/shared';
import { dayKeyOf, needsReview, occurrencesOn, todayList } from '@life/shared';
import { db } from '../../db/db';
import { useAreas, useCommitments, useMissions, useNow, useSettings, useToday } from '../../db/hooks';
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

  const todayMissions = useMemo(() => (today ? todayList(missions, today, now) : []), [missions, today, now]);
  const occurrences = useMemo(() => (today ? occurrencesOn(commitments, today) : []), [commitments, today]);
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
 * done. Latched: once shown it stays (even after finishReview marks the day) until "Pronto"/"Dispensar".
 */
export function useDayReview(today: DayKey | undefined, missions: Mission[]) {
  // undefined while loading, null when the day has no state yet.
  const dayState = useLiveQuery(async () => (today ? (await db.dayState.get(today)) ?? null : undefined), [today]);
  const reviewDismissed = useAgoraSession((s) => s.reviewDismissed);
  const dismissReview = useAgoraSession((s) => s.dismissReview);
  const [open, setOpen] = useState(false);

  const items = useMemo(() => (today ? needsReview(missions, today) : []), [missions, today]);
  const reviewDone = dayState === undefined ? true : !!dayState && !dayState.deleted && dayState.reviewDone;
  const hardDay = !!dayState && !dayState.deleted && dayState.hardDay;
  useEffect(() => {
    if (!reviewDismissed && !reviewDone && items.length > 0) setOpen(true);
  }, [reviewDismissed, reviewDone, items.length]);

  return {
    items,
    show: open && !reviewDismissed,
    close: () => { setOpen(false); dismissReview(); },
    hardDay,
  };
}

let greeted = false;

function greetingFor(hour: number, dayStartHour: number): PhraseCategory {
  if (hour >= dayStartHour && hour < 12) return 'greetMorning';
  if (hour >= 12 && hour < 18) return 'greetAfternoon';
  return 'greetNight';
}

/** Companion greets once per app session; later, a mission postponed 3+ times gets a gentle nudge. */
export function useCompanionMoments(dayStartHour: number | undefined, primaryId: string | undefined, postponed: boolean) {
  useEffect(() => {
    if (greeted || dayStartHour === undefined) return;
    greeted = true;
    void useCompanion.getState().say(greetingFor(new Date().getHours(), dayStartHour));
  }, [dayStartHour]);

  const lastPrimary = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = lastPrimary.current;
    lastPrimary.current = primaryId;
    if (prev !== undefined && primaryId !== undefined && prev !== primaryId && postponed) {
      void useCompanion.getState().say('postponed');
    }
  }, [primaryId, postponed]);
}
