import type { Mission } from '@life/shared';
import { reorderDay } from '../../domain/actions';
import { useMediaQuery } from '../../ui/useMediaQuery';
import { useCaptureStore } from '../capture/CaptureBar';
import { useMissionSheet } from '../mission/MissionSheet';
import { PAINEL_QUERY, PainelScreen } from '../painel/PainelScreen';
import { Alternatives } from './Alternatives';
import { MainCard, MainCardEmpty } from './MainCard';
import { ReviewSheet } from './ReviewSheet';
import { ShrinkDialog } from './ShrinkDialog';
import { SnoozeDialog } from './SnoozeDialog';
import { StatusStrip } from './StatusStrip';
import { TodayList } from './TodayList';
import { useAgora } from './useAgora';
import { useCompanionMoments, useDayReview, useTodayData } from './useAgoraData';
import './agora.css';

/** "/" — the Agora screen on phones; the 3-column Painel from 1200 px. */
export function AgoraScreen() {
  const wide = useMediaQuery(PAINEL_QUERY);
  return wide ? <PainelScreen /> : <AgoraView />;
}

/** One mission at a time, its first step first, and why it was chosen. */
function AgoraView() {
  const { engine, primary, alternatives, actions, canSkip, dialog, closeDialog } = useAgora();
  const { settings, today, now, missions, areas, todayMissions, occurrences, doneToday } = useTodayData();
  const review = useDayReview(today, missions);

  useCompanionMoments(settings?.dayStartHour, primary?.mission.id, primary?.postponedHint ?? false);

  if (!engine || !today) return <section className="screen agora" aria-busy="true" aria-label="Agora" />;

  const areaOf = (m?: Mission) => (m?.areaId ? areas.find((a) => a.id === m.areaId) : undefined);
  const openSheet = (m: Mission) => useMissionSheet.getState().open(m.id);

  return (
    <section className="screen agora" aria-labelledby="agora-title">
      <h1 id="agora-title" className="visually-hidden">Agora</h1>
      <StatusStrip engine={engine} />

      {review.show && <ReviewSheet missions={review.items} today={today} onClose={review.close} />}

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
        hardDay={review.hardDay}
        now={now}
        onOpen={openSheet}
        onReorder={(ids) => { void reorderDay(ids, today); }}
      />

      <ShrinkDialog mission={dialog?.kind === 'shrink' ? dialog.mission : undefined} onClose={closeDialog} />
      <SnoozeDialog mission={dialog?.kind === 'snooze' ? dialog.mission : undefined} today={today} onClose={closeDialog} />
    </section>
  );
}
