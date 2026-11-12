import { useState, type MouseEvent } from 'react';
import type { BlockOccurrence, ID, Mission, Week } from '@life/shared';
import { formatHHmm, isOfBlock } from '@life/shared';
import { Icon } from '../../art/icons';
import { setBlockVersion } from '../../domain/actions';
import { useTimer } from '../../timer/store';
import { Button } from '../../ui/Button';
import { focusWhenGone, FOCUS_BLOCK } from '../../ui/focusAfter';
import { formatDuration } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import {
  endRoutineWithFeedback, finishTimerFor, skipBlockWithFeedback, startBlockWithFeedback, toggleObjectiveWithFeedback,
} from './blockFeedback';
import { RoutineChecklist, TimeLeft, useRoutineTicks, versionMinutes } from './BlockParts';
import { EscapeButton } from './EscapeButton';
import { ResumeNote } from './ResumeNote';
import { resumeSuggestion, useResumePrompt } from './ResumePrompt';
import './blocks.css';

const hhmm = (ts: number): string => {
  const d = new Date(ts);
  return formatHHmm(d.getHours() * 60 + d.getMinutes());
};

export interface BlockBannerProps {
  /** Today's 'current' occurrence (`useCurrentBlock`). */
  occurrence: BlockOccurrence;
  now: number;
  /** The block after this one today: past its time, the banner offers "Encerrar e seguir para …". */
  next?: BlockOccurrence;
  /** "Onde você parou" (the block's last note), under its name; the Painel shows it in Apoio instead. */
  note?: string;
  /** This week: its objectives for the block (the experiment shows under the status strip). */
  week?: Week;
  /** Blocks whose objectives count as this one's (same name on other weekdays); default: itself. */
  blockIds?: ID[];
  /** Mission in focus (timer or main card): its next step prefills "Onde parou?". */
  focusMission?: Mission;
  /** Tighter variant (Painel column). */
  compact?: boolean;
}

/**
 * "Bloco 1 · Tech News · até 10:30": what this part of the day is for, how long is left (and
 * whether it shrank), the week's objective for it, and Começar / Pular hoje / Versão mínima /
 * Encerrar / Escapei. Past its time it says so and offers to end it and go on to the next one.
 */
export function BlockBanner({ occurrence, now, next, note, week, blockIds, focusMission, compact }: BlockBannerProps) {
  const { block, session, day } = occurrence;
  const [busy, setBusy] = useState(false);
  const routine = useRoutineTicks(block, day);
  const timerMissionId = useTimer((s) => (s.status === 'idle' ? undefined : s.missionId));
  const started = session?.startedAt !== undefined && session.endedAt === undefined;
  const isRoutine = block.kind === 'routine';
  const overrun = started && occurrence.overrun === true;
  const concludable = isRoutine && routine.allDone;
  const minimum = occurrence.version === 'minimum';
  const ids = blockIds ?? [block.id];
  const objectives = week?.objectives.filter((o) => ids.includes(o.blockId)) ?? [];
  // Before Começar, the minimum window is anchored at the target time: once it is over, switching
  // would just end the block, so the toggle waits for Começar (then it counts from the start).
  const minimumGone = !started && !minimum
    && Math.max(occurrence.plannedStart, occurrence.start) + block.minimumMin * 60_000 <= now;

  /** Runs a block action; when the tapped button goes away, focus moves to the block heading. */
  const run = (work: () => Promise<void>) => (e: MouseEvent<HTMLButtonElement>) => {
    focusWhenGone(e.currentTarget);
    setBusy(true);
    safeRun(work().finally(() => setBusy(false)));
  };
  const end = () => {
    const missionId = focusMission?.id;
    const timerRuns = missionId !== undefined && timerMissionId === missionId && isOfBlock(focusMission!, block);
    safeRun(async () => {
      if (timerRuns) await finishTimerFor(missionId);
      useResumePrompt.getState().open({
        blockId: block.id, missionId, suggestion: resumeSuggestion(session?.nextAction, focusMission), endsBlock: true,
      });
    });
  };
  const endRoutine = (concluded: boolean) => run(() => endRoutineWithFeedback(block.id, { concluded, started }));
  const endLabel = overrun && next ? `Encerrar e seguir para ${next.block.name}` : 'Encerrar bloco';

  let primary = null;
  if (concludable) {
    primary = <Button variant="primary" icon="check" className="block-banner__start" disabled={busy} onClick={endRoutine(true)}>Concluir rotina</Button>;
  } else if (overrun) {
    primary = (
      <Button variant="primary" className="block-banner__start" disabled={busy} onClick={isRoutine ? endRoutine(false) : end}>
        {endLabel}
      </Button>
    );
  } else if (!started) {
    primary = (
      <Button variant="primary" icon="play" className="block-banner__start" disabled={busy}
        onClick={run(() => startBlockWithFeedback(block.id))}>
        Começar bloco
      </Button>
    );
  }

  return (
    <section className={`block-banner px-border px-shadow${compact ? ' block-banner--compact' : ''}`} aria-label="Bloco atual">
      <div className="block-banner__head">
        <p className="block-banner__eyebrow">
          <Icon name="flame" size={12} />
          {started ? 'Bloco em andamento' : 'Bloco de agora'}
        </p>
        <span className="block-banner__until">{`até ${hhmm(occurrence.end)}`}</span>
      </div>
      <h2 className="block-banner__name" tabIndex={-1} data-focus-target={FOCUS_BLOCK}>{block.name}</h2>
      <ResumeNote text={note} className="resume-note--inline" />
      <div className="block-banner__tags">
        {started && session?.startedAt !== undefined && (
          <span className="tag tag--gold">{`Começou às ${hhmm(session.startedAt)}`}</span>
        )}
        {minimum && <span className="tag tag--stone">{`Versão mínima · ${formatDuration(versionMinutes(occurrence))}`}</span>}
      </div>

      {overrun ? (
        <p className="block-banner__overrun"><Icon name="timer" size={12} />O horário do bloco acabou</p>
      ) : (
        <TimeLeft occurrence={occurrence} now={now} />
      )}

      {objectives.length > 0 && week && (
        <div className="block-banner__group">
          <p className="block-banner__label">{objectives.length === 1 ? 'Objetivo da semana' : 'Objetivos da semana'}</p>
          <ul className="block-checks">
            {objectives.map((o) => (
              <li key={o.id}>
                <label className="block-check">
                  <input type="checkbox" className="px-checkbox" checked={o.done}
                    onChange={() => safeRun(toggleObjectiveWithFeedback(week.id, o.id))} />
                  <span className={o.done ? 'block-check__text is-done' : 'block-check__text'}>{o.text}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      {isRoutine && <RoutineChecklist block={block} ticks={routine.ticks} toggle={routine.toggle} />}

      <div className="block-banner__actions">
        {primary}
        {!minimumGone && !overrun && (
          <Button size="sm" aria-pressed={minimum} className="block-banner__minimum"
            onClick={() => safeRun(setBlockVersion(block.id, minimum ? 'normal' : 'minimum'))}>
            Versão mínima
          </Button>
        )}
        {/* Before Começar the choice is to start or to let today's block go; ending comes after. */}
        {!started && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={run(() => skipBlockWithFeedback(block.id))}>
            Pular hoje
          </Button>
        )}
        {started && !overrun && !concludable && (
          <Button size="sm" variant="ghost" onClick={isRoutine ? endRoutine(false) : end}>Encerrar bloco</Button>
        )}
        {/* A routine block (morning, wind-down) has nothing to escape from. */}
        {!isRoutine && <EscapeButton blockId={block.id} mission={focusMission} />}
      </div>
    </section>
  );
}
