import { useCallback, useEffect, useRef } from 'react';
import { dayKeyToDate } from '@life/shared';
import { reorderDay } from '../../domain/actions';
import { resumeTimer } from '../../timer/TimerControls';
import { useTimer } from '../../timer/store';
import { WEEKDAY_ABBR } from '../../ui/format';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { safeRun } from '../../ui/safeRun';
import { AgoraNow, showsMainCard } from '../agora/AgoraNow';
import { CareStrip } from '../agora/CareStrip';
import { MorningCard } from '../agora/MorningCard';
import { pickDayMode } from '../agora/blockFeedback';
import { ResumeNote, useResumeNote } from '../agora/ResumeNote';
import { StudyStatusLine } from '../study/StudyStatusLine';
import { ShrinkDialog } from '../agora/ShrinkDialog';
import { SnoozeDialog } from '../agora/SnoozeDialog';
import { StatusStrip } from '../agora/StatusStrip';
import { TodayList } from '../agora/TodayList';
import { useAgora } from '../agora/useAgora';
import {
  useBlocksNow, useCompanionMoments, useDayReview, useDayType, useTodayData,
} from '../agora/useAgoraData';
import { CaptureForm } from '../capture/CaptureBar';
import { useMissionSheet } from '../mission/MissionSheet';
import { useMonthCycle } from '../patterns/monthCycle';
import { activeAtypical, useWeekCycle } from '../week/weekCycle';
import { WeekLine } from '../week/WeekLine';
import { ConstancyCard, PainelCompanion, PainelTimer } from './PainelParts';
import { Timeline, dayBounds } from './Timeline';
import '../agora/agora.css';
import './painel.css';

/** AgoraScreen renders the Painel automatically from this width. */
export const PAINEL_QUERY = '(min-width: 1200px)';

const isTypingTarget = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const INTERACTIVE = 'button, a[href], summary, [role="button"], [role="checkbox"], [role="switch"], [role="tab"]';

/** Space on a control reached with the keyboard keeps its native meaning (activate it). */
function keyboardFocusedControl(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement) || !t.matches(INTERACTIVE)) return false;
  try { return t.matches(':focus-visible'); } catch { return true; }
}

/**
 * N focuses the inline capture, Space pauses/resumes the timer, C completes the main mission.
 * Ignored while typing or with a dialog open. Capture phase, so the global N (CaptureHost,
 * which opens the capture sheet) sees `defaultPrevented` and stays out of the way.
 */
function usePainelShortcuts(handlers: { capture(): void; complete(): void }): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTypingTarget(e.target) || document.querySelector('[aria-modal="true"]')) return;
      const key = e.key.toLowerCase();
      if (key === 'n') {
        e.preventDefault();
        ref.current.capture();
      } else if (key === 'c' && !e.repeat) {
        e.preventDefault();
        ref.current.complete();
      } else if (e.key === ' ' && !e.shiftKey && !e.repeat && !keyboardFocusedControl(e.target)) {
        const t = useTimer.getState();
        if (t.status === 'running') { e.preventDefault(); t.pause(); }
        else if (t.status === 'paused') { e.preventDefault(); resumeTimer(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

/**
 * The Painel (§12): a 3-column layout for a secondary monitor — Agora (block banner, main card +
 * alternatives), Hoje (timeline of blocks and commitments + today's missions) and Apoio ("Onde
 * você parou", timer, companion, capture, constância). Large text, updates by itself (live
 * queries fed by sync/SSE).
 */
export function PainelScreen() {
  const agora = useAgora();
  const { engine, primary, actions, dialog, closeDialog } = agora;
  const { settings, today, now, missions, areas, todayMissions, occurrences, doneToday } = useTodayData();
  const review = useDayReview(today, missions);
  const dayType = useDayType(today);
  const { plan, current, next } = useBlocksNow(now);
  const cycle = useWeekCycle(today, dayType);
  const month = useMonthCycle(today, dayType);
  const note = useResumeNote(current?.block.id, today);
  const free = dayType.mode === 'free';
  const apoioRef = useRef<HTMLElement>(null);

  const loaded = engine !== undefined && dayType.loaded && plan !== undefined;
  const empty = loaded && !primary && !engine.currentCommitment
    && showsMainCard({ mode: dayType.mode, current, next, inCommitment: false });
  useCompanionMoments(settings?.dayStartHour, today, primary?.mission.id, primary?.postponedHint ?? false, empty, free);

  const focusCapture = useCallback(() => {
    const field = apoioRef.current?.querySelector<HTMLTextAreaElement>('.capture__input');
    field?.focus();
    field?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  usePainelShortcuts({
    capture: focusCapture,
    complete: () => {
      const shown = showsMainCard({ mode: dayType.mode, current, next, inCommitment: !!engine?.currentCommitment });
      if (shown && primary && !engine?.currentCommitment) actions.complete(primary.mission);
    },
  });

  const ready = engine !== undefined && today !== undefined && settings !== undefined && dayType.loaded
    && plan !== undefined && cycle.loaded && month.loaded;
  const listed = free ? todayMissions.filter((m) => m.status === 'doing' || m.date === today) : todayMissions;
  const bounds = ready ? dayBounds(today, settings.dayStartHour, settings.dayEndHour) : undefined;
  const date = today ? dayKeyToDate(today) : undefined;

  return (
    <div className="painel">
      <h1 className="visually-hidden" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Painel</h1>

      <section className="painel__col painel__agora" aria-label="Agora" aria-busy={!ready}>
        {ready && (
          <>
            <StatusStrip engine={engine} block={current} now={now} compact />
            <CareStrip now={now} inCommitment={!!engine.currentCommitment} />
            <WeekLine experiment={cycle.week?.experiment} atypical={activeAtypical(cycle.week, today)} onOpen={cycle.showLink ? cycle.open : undefined} />
            <MorningCard today={today} dayType={dayType} cycle={cycle} month={month} review={review} />
            {/* "Onde você parou" and the review status belong to the Apoio column here. */}
            <AgoraNow agora={agora} areas={areas} missions={missions} today={today} now={now} mode={dayType.mode}
              current={current} next={next} showNote={false} showReview={false} showPractice={false} compact onCapture={focusCapture} onPickMode={pickDayMode} />
          </>
        )}
      </section>

      <section className="painel__col painel__hoje" aria-label="Hoje">
        <h2 className="painel__heading">
          Hoje
          {date && <span className="painel__date">{WEEKDAY_ABBR[date.getDay()]} {date.getDate()}/{date.getMonth() + 1}</span>}
        </h2>
        {ready && bounds && (
          <>
            <div className="painel__timeline">
              <Timeline occurrences={occurrences} blocks={plan} now={now} dayStartTs={bounds.start} dayEndTs={bounds.end} />
            </div>
            <div className="painel__today">
              <TodayList
                title="Missões de hoje"
                emptyText="Nenhuma missão planejada para hoje."
                missions={listed}
                commitments={[]}
                done={doneToday}
                areas={areas}
                hardDay={dayType.mode === 'low' || dayType.mode === 'recovery'}
                now={now}
                onOpen={(m) => useMissionSheet.getState().open(m.id)}
                onReorder={(ids) => safeRun(reorderDay(ids, today))}
              />
            </div>
          </>
        )}
      </section>

      <section className="painel__col painel__apoio" aria-label="Apoio" ref={apoioRef}>
        <ResumeNote text={note} className="painel__resume" />
        <StudyStatusLine />
        <PainelTimer />
        <PainelCompanion />
        <Panel variant="stone" className="painel__capture">
          <h2 className="painel__subheading">Capturar <kbd aria-hidden="true">N</kbd></h2>
          {/* Esc leaves the field so the N / Space / C shortcuts work again. */}
          <CaptureForm onEscape={() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }} />
        </Panel>
        <ConstancyCard />
      </section>

      {today && (
        <>
          <ShrinkDialog mission={dialog?.kind === 'shrink' ? dialog.mission : undefined} onClose={closeDialog} />
          <SnoozeDialog mission={dialog?.kind === 'snooze' ? dialog.mission : undefined} today={today} onClose={closeDialog} />
        </>
      )}
    </div>
  );
}
