import type { ReactNode } from 'react';
import type { Area, BlockOccurrence, DayKey, DayMode, Mission } from '@life/shared';
import { isOfBlock, reviewPrompt } from '@life/shared';
import { useBlocks, useWeek } from '../../db/hooks';
import { useTimer } from '../../timer/store';
import { PracticePrompt } from '../practice/PracticePrompt';
import { ReviewPrompt, ReviewPromptView } from '../study/ReviewPrompt';
import { useStudyPlan } from '../study/useStudyPlan';
import { sameNameIds } from '../week/weekData';
import { Alternatives } from './Alternatives';
import { BetweenBlocks, fitsIn } from './BetweenBlocks';
import { BlockBanner } from './BlockBanner';
import { FreeDay, lightMissions } from './FreeDay';
import { MainCard, MainCardEmpty } from './MainCard';
import { SubjectSuggestion } from '../faculty/SubjectSuggestion';
import { useResumeNote } from './ResumeNote';
import type { AgoraState } from './useAgora';
import './blocks.css';

export interface AgoraNowProps {
  agora: AgoraState;
  areas: Area[];
  missions: Mission[];
  today: DayKey;
  now: number;
  mode: DayMode;
  current?: BlockOccurrence;
  next?: BlockOccurrence;
  /** "Onde você parou" in the block banner; the Painel shows it in its Apoio column instead. */
  showNote?: boolean;
  /** The review card / line; the Painel shows its own status line in the Apoio column instead. */
  showReview?: boolean;
  /** The practice line in focus/study blocks; the Painel leaves it out. */
  showPractice?: boolean;
  compact?: boolean;
  onCapture(): void;
  onPickMode(mode: DayMode): void;
}

const live = (m: Mission) => !m.deleted && (m.status === 'open' || m.status === 'doing');

/** Whether the main mission card is on screen (not on a free day, a routine block or between blocks). */
export function showsMainCard(s: {
  mode: DayMode; current?: BlockOccurrence; next?: BlockOccurrence; inCommitment: boolean;
}): boolean {
  if (s.mode === 'free') return false;
  if (s.current) return s.current.block.kind !== 'routine';
  return !s.next || s.inCommitment;
}

/**
 * Inside a block, one study nudge at a time: the review card wins; the practice line shows only when there
 * is no review card (and only once the study plan has loaded, so it does not flash before the card).
 */
function BlockNudges({ mode, current, focus, showReview, showPractice, children }: {
  mode: DayMode; current: BlockOccurrence; focus?: Mission; showReview: boolean; showPractice: boolean; children: ReactNode;
}) {
  const study = useStudyPlan();
  const review = showReview ? reviewPrompt({ plan: study.plan, mode, restDay: study.restDay, current }) : undefined;
  return (
    <>
      {review && study.plan && <ReviewPromptView kind={review} plan={study.plan} />}
      {children}
      {showPractice && study.loaded && !review && <PracticePrompt mode={mode} current={current} focusMission={focus} />}
    </>
  );
}

/**
 * The "what now" part of the Agora (phone) and of the Painel's Agora column: the free day, the
 * current block (banner with its note, then its mission — or a routine's checklist), the gap before the
 * next block, or the Marco 1 main card when there are no blocks around.
 */
export function AgoraNow({
  agora, areas, missions, today, now, mode, current, next, showNote = true, showReview = true, showPractice = true, compact, onCapture, onPickMode,
}: AgoraNowProps) {
  const { engine, primary, alternatives, actions, canSkip } = agora;
  const week = useWeek();
  const blocks = useBlocks();
  const note = useResumeNote(current?.block.id, today);
  const timerMissionId = useTimer((s) => (s.status === 'idle' ? undefined : s.missionId));

  if (!engine) return null;
  const areaOf = (m?: Mission) => (m?.areaId ? areas.find((a) => a.id === m.areaId) : undefined);

  if (mode === 'free') {
    return (
      <FreeDay light={lightMissions(missions, today, now)} areas={areas} onOpen={actions.open} onPickMode={onPickMode} />
    );
  }

  const main = (
    <>
      {primary || engine.currentCommitment ? (
        <MainCard suggestion={primary} area={areaOf(primary?.mission)} commitment={engine.currentCommitment}
          canSkip={canSkip} actions={actions} />
      ) : (
        <MainCardEmpty onCapture={onCapture} />
      )}
      <Alternatives items={alternatives} areas={areas} onPick={actions.promote} />
    </>
  );

  if (current) {
    // The mission being worked on: the timer's, else the main card's when it belongs to the block.
    const timerMission = timerMissionId ? missions.find((m) => m.id === timerMissionId && live(m)) : undefined;
    const focus = timerMission ?? (primary && isOfBlock(primary.mission, current.block) ? primary.mission : undefined);
    return (
      <>
        <BlockBanner occurrence={current} now={now} next={next} note={showNote ? note : undefined} week={week}
          blockIds={sameNameIds(blocks, current.block)} focusMission={focus} compact={compact} />
        <SubjectSuggestion current={current} today={today}
          mainMissionId={current.block.kind !== 'routine' ? primary?.mission.id : undefined} />
        {showReview || showPractice ? (
          <BlockNudges mode={mode} current={current} focus={focus} showReview={showReview} showPractice={showPractice}>
            {current.block.kind !== 'routine' && main}
          </BlockNudges>
        ) : (current.block.kind !== 'routine' && main)}
      </>
    );
  }

  if (next && !engine.currentCommitment) {
    const freeMinutes = Math.min(engine.freeMinutes, Math.floor((next.start - now) / 60_000));
    const items = engine.ranked.filter(fitsIn(freeMinutes)).slice(0, 3);
    const c = engine.nextCommitment;
    const commitment = c && c.startTs < next.start ? { title: c.commitment.title, startTs: c.startTs } : undefined;
    return (
      <>
        {showReview && <ReviewPrompt mode={mode} />}
        <BetweenBlocks next={next} commitment={commitment} freeMinutes={freeMinutes} items={items} areas={areas}
          onPick={actions.open} />
      </>
    );
  }

  return (
    <>
      {main}
      {showReview && <ReviewPrompt mode={mode} />}
    </>
  );
}
