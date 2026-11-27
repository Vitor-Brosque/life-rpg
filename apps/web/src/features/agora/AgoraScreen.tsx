import type { Mission } from '@life/shared';
import { reorderDay } from '../../domain/actions';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { useMediaQuery } from '../../ui/useMediaQuery';
import { useCaptureStore } from '../capture/CaptureBar';
import { DayCloseLink } from '../dayClose/DayCloseCard';
import { useMissionSheet } from '../mission/MissionSheet';
import { PAINEL_QUERY, PainelScreen } from '../painel/PainelScreen';
import { useMonthCycle } from '../patterns/monthCycle';
import { useWeekLineTexts } from '../../db/strategyData';
import { activeAtypical, useWeekCycle } from '../week/weekCycle';
import { WeekLine } from '../week/WeekLine';
import { AgoraNow, showsMainCard } from './AgoraNow';
import { CareStrip } from './CareStrip';
import { pickDayMode } from './blockFeedback';
import { MomentCards, chooseMoment } from './MomentCards';
import { ProposalCard } from '../assist/ProposalCard';
import { ShrinkDialog } from './ShrinkDialog';
import { SnoozeDialog } from './SnoozeDialog';
import { StatusStrip } from './StatusStrip';
import { TodayList } from './TodayList';
import { useAgora } from './useAgora';
import { useBlocksNow, useCompanionMoments, useDayReview, useDayType, useTodayData } from './useAgoraData';
import './agora.css';

/** "/" — the Agora screen on phones; the 3-column Painel from 1200 px. */
export function AgoraScreen() {
  const wide = useMediaQuery(PAINEL_QUERY);
  return wide ? <PainelScreen /> : <AgoraView />;
}

/**
 * The day type, the weekly cycle (Monday), the current block, one mission at a time (first step
 * first), and today's list.
 */
function AgoraView() {
  const agora = useAgora();
  const { engine, primary, dialog, closeDialog } = agora;
  const { settings, today, now, missions, areas, todayMissions, occurrences, doneToday } = useTodayData();
  const review = useDayReview(today, missions);
  const dayType = useDayType(today);
  const { plan, current, next } = useBlocksNow(now);
  const cycle = useWeekCycle(today, dayType);
  const lines = useWeekLineTexts(today, cycle.week?.experiment);
  const month = useMonthCycle(today, dayType);
  const free = dayType.mode === 'free';

  const ready = engine !== undefined && today !== undefined && dayType.loaded && plan !== undefined && cycle.loaded && month.loaded;
  // "Empty" only once the empty card is on screen (and not where the main card is hidden).
  const empty = ready && !primary && !engine.currentCommitment
    && showsMainCard({ mode: dayType.mode, current, next, inCommitment: false });
  useCompanionMoments(settings?.dayStartHour, today, primary?.mission.id, primary?.postponedHint ?? false, empty, free);

  if (!ready) {
    return <section className="screen agora" aria-busy="true" aria-label="Agora" />;
  }

  const openSheet = (m: Mission) => useMissionSheet.getState().open(m.id);
  // A free day lists only what was planned for it (nothing left over from other days).
  const listed = free ? todayMissions.filter((m) => m.status === 'doing' || m.date === today) : todayMissions;

  return (
    <section className="screen agora" aria-labelledby="agora-title">
      <h1 id="agora-title" className="visually-hidden" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Agora</h1>
      <StatusStrip engine={engine} block={current} now={now} />
      <CareStrip now={now} inCommitment={!!engine.currentCommitment} />
      <WeekLine experiment={lines.experiment} strategies={lines.strategies} atypical={activeAtypical(cycle.week, today)} onOpen={cycle.showLink ? () => { chooseMoment(today, 'semana'); cycle.open(); } : undefined} />
      <MomentCards today={today} now={now} dayType={dayType} cycle={cycle} month={month} review={review} />
      <ProposalCard today={today} />

      <AgoraNow
        agora={agora}
        areas={areas}
        missions={missions}
        today={today}
        now={now}
        mode={dayType.mode}
        current={current}
        next={next}
        onCapture={() => useCaptureStore.getState().open()}
        onPickMode={pickDayMode}
      />

      <TodayList
        missions={listed}
        commitments={occurrences}
        done={doneToday}
        areas={areas}
        hardDay={dayType.mode === 'low' || dayType.mode === 'recovery'}
        now={now}
        onOpen={openSheet}
        onReorder={(ids) => safeRun(reorderDay(ids, today))}
      />
      <DayCloseLink />

      <ShrinkDialog mission={dialog?.kind === 'shrink' ? dialog.mission : undefined} onClose={closeDialog} />
      <SnoozeDialog mission={dialog?.kind === 'snooze' ? dialog.mission : undefined} today={today} onClose={closeDialog} />
    </section>
  );
}
