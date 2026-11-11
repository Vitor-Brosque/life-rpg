import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Mission } from '@life/shared';
import { dayKeyOf, needsReview, occurrencesOn, todayList } from '@life/shared';
import { db } from '../../db/db';
import { useAreas, useCommitments, useMissions, useNow, useSettings, useToday } from '../../db/hooks';
import { reorderDay } from '../../domain/actions';
import { useCaptureStore } from '../capture/CaptureBar';
import type { PhraseCategory } from '../companion/phrases';
import { useCompanion } from '../companion/store';
import { useMissionSheet } from '../mission/MissionSheet';
import { Alternatives } from './Alternatives';
import { MainCard, MainCardEmpty } from './MainCard';
import { ReviewSheet } from './ReviewSheet';
import { ShrinkDialog } from './ShrinkDialog';
import { SnoozeDialog } from './SnoozeDialog';
import { StatusStrip } from './StatusStrip';
import { TodayList } from './TodayList';
import { useAgora, useAgoraSession } from './useAgora';
import './agora.css';

let greeted = false;

function greetingFor(hour: number, dayStartHour: number): PhraseCategory {
  if (hour >= dayStartHour && hour < 12) return 'greetMorning';
  if (hour >= 12 && hour < 18) return 'greetAfternoon';
  return 'greetNight';
}

/** Companion greets once per app session; later, a mission postponed 3+ times gets a gentle nudge. */
function useCompanionMoments(dayStartHour: number | undefined, primaryId: string | undefined, postponed: boolean) {
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

/** The "Agora" screen: one mission at a time, its first step first, and why it was chosen. */
export function AgoraScreen() {
  const { engine, primary, alternatives, actions, canSkip, dialog, closeDialog } = useAgora();
  const settings = useSettings();
  const today = useToday();
  const now = useNow();
  const missions = useMissions();
  const areas = useAreas();
  const commitments = useCommitments();
  // undefined while loading, null when the day has no state yet.
  const dayState = useLiveQuery(async () => (today ? (await db.dayState.get(today)) ?? null : undefined), [today]);
  const reviewDismissed = useAgoraSession((s) => s.reviewDismissed);
  const dismissReview = useAgoraSession((s) => s.dismissReview);
  const [reviewOpen, setReviewOpen] = useState(false);

  useCompanionMoments(settings?.dayStartHour, primary?.mission.id, primary?.postponedHint ?? false);

  const review = useMemo(() => (today ? needsReview(missions, today) : []), [missions, today]);
  const reviewDone = dayState === undefined ? true : !!dayState && !dayState.deleted && dayState.reviewDone;
  const hardDay = !!dayState && !dayState.deleted && dayState.hardDay;
  // Latched: once shown it stays (even after finishReview marks the day) until "Pronto"/"Dispensar".
  useEffect(() => {
    if (!reviewDismissed && !reviewDone && review.length > 0) setReviewOpen(true);
  }, [reviewDismissed, reviewDone, review.length]);

  const todayMissions = useMemo(() => (today ? todayList(missions, today, now) : []), [missions, today, now]);
  const occurrences = useMemo(() => (today ? occurrencesOn(commitments, today) : []), [commitments, today]);
  const doneToday = useMemo(() => {
    if (!today || !settings) return [];
    return missions
      .filter((m) => m.status === 'done' && m.completedAt !== undefined
        && dayKeyOf(m.completedAt, settings.dayStartHour) === today)
      .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
  }, [missions, today, settings]);

  if (!engine || !today) return <section className="screen agora" aria-busy="true" aria-label="Agora" />;

  const areaOf = (m?: Mission) => (m?.areaId ? areas.find((a) => a.id === m.areaId) : undefined);
  const openSheet = (m: Mission) => useMissionSheet.getState().open(m.id);

  return (
    <section className="screen agora" aria-labelledby="agora-title">
      <h1 id="agora-title" className="visually-hidden">Agora</h1>
      <StatusStrip engine={engine} />

      {reviewOpen && !reviewDismissed && (
        <ReviewSheet
          missions={review}
          today={today}
          onClose={() => { setReviewOpen(false); dismissReview(); }}
        />
      )}

      {primary || engine.currentCommitment ? (
        <MainCard
          suggestion={primary}
          area={areaOf(primary?.mission)}
          commitment={engine.currentCommitment}
          canSkip={canSkip}
          actions={actions}
        />
      ) : (
        <MainCardEmpty onCapture={() => useCaptureStore.getState().open()} />
      )}

      <Alternatives items={alternatives} areas={areas} onPick={actions.promote} />

      <TodayList
        missions={todayMissions}
        commitments={occurrences}
        done={doneToday}
        areas={areas}
        hardDay={hardDay}
        now={now}
        onOpen={openSheet}
        onReorder={(ids) => { void reorderDay(ids, today); }}
      />

      <ShrinkDialog mission={dialog?.kind === 'shrink' ? dialog.mission : undefined} onClose={closeDialog} />
      <SnoozeDialog mission={dialog?.kind === 'snooze' ? dialog.mission : undefined} today={today} onClose={closeDialog} />
    </section>
  );
}
