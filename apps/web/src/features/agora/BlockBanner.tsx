import { useState } from 'react';
import type { BlockOccurrence, Mission, Week } from '@life/shared';
import { formatHHmm } from '@life/shared';
import { Icon } from '../../art/icons';
import { setBlockVersion } from '../../domain/actions';
import { Button } from '../../ui/Button';
import { formatDuration } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { startBlockWithFeedback, toggleObjectiveWithFeedback } from './blockFeedback';
import { RoutineChecklist, TimeLeft, versionMinutes } from './BlockParts';
import { EscapeButton } from './EscapeButton';
import { firstOpenStep, useResumePrompt } from './ResumePrompt';
import './blocks.css';

const hhmm = (ts: number): string => {
  const d = new Date(ts);
  return formatHHmm(d.getHours() * 60 + d.getMinutes());
};

export interface BlockBannerProps {
  /** Today's 'current' occurrence (`useCurrentBlock`). */
  occurrence: BlockOccurrence;
  now: number;
  /** This week: objectives of the block and the week's experiment. */
  week?: Week;
  /** Mission in focus (timer or main card): its next unchecked step prefills "Onde parou?". */
  focusMission?: Mission;
  /** Tighter variant (Painel column). */
  compact?: boolean;
}

/**
 * "Bloco 1 · Tech News · até 10:30": what this part of the day is for, how long is left (and
 * whether it shrank), the week's objective for it, and Começar / Versão mínima / Encerrar / Escapei.
 */
export function BlockBanner({ occurrence, now, week, focusMission, compact }: BlockBannerProps) {
  const { block, session, day } = occurrence;
  const [starting, setStarting] = useState(false);
  const started = session?.startedAt !== undefined && session.endedAt === undefined;
  const minimum = occurrence.version === 'minimum';
  const objectives = week?.objectives.filter((o) => o.blockId === block.id) ?? [];
  // Before Começar, the minimum window is anchored at the target time: once it is over, switching
  // would just end the block, so the toggle waits for Começar (then it counts from the start).
  const minimumGone = !started && !minimum
    && Math.max(occurrence.plannedStart, occurrence.start) + block.minimumMin * 60_000 <= now;

  const start = () => {
    setStarting(true);
    safeRun(startBlockWithFeedback(block.id).finally(() => setStarting(false)));
  };
  const end = () => useResumePrompt.getState().open({
    blockId: block.id,
    missionId: focusMission?.id,
    suggestion: firstOpenStep(focusMission),
    endsBlock: true,
  });

  return (
    <section className={`block-banner px-border px-shadow${compact ? ' block-banner--compact' : ''}`} aria-label="Bloco atual">
      <div className="block-banner__head">
        <p className="block-banner__eyebrow">
          <Icon name="flame" size={12} />
          {started ? 'Bloco em andamento' : 'Bloco de agora'}
        </p>
        <span className="block-banner__until">{`até ${hhmm(occurrence.end)}`}</span>
      </div>
      <h2 className="block-banner__name">{block.name}</h2>
      <div className="block-banner__tags">
        {started && session?.startedAt !== undefined && (
          <span className="tag tag--gold">{`Começou às ${hhmm(session.startedAt)}`}</span>
        )}
        {minimum && <span className="tag tag--stone">{`Versão mínima · ${formatDuration(versionMinutes(occurrence))}`}</span>}
      </div>

      <TimeLeft occurrence={occurrence} now={now} />

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
      {block.kind === 'routine' ? (
        <RoutineChecklist block={block} day={day} />
      ) : week?.experiment && (
        <p className="block-banner__experiment">{`Experimento da semana: ${week.experiment}`}</p>
      )}

      <div className="block-banner__actions">
        {!started && (
          <Button variant="primary" icon="play" className="block-banner__start" disabled={starting} onClick={start}>
            Começar bloco
          </Button>
        )}
        {!minimumGone && (
          <Button size="sm" aria-pressed={minimum} className="block-banner__minimum"
            onClick={() => safeRun(setBlockVersion(block.id, minimum ? 'normal' : 'minimum'))}>
            Versão mínima
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={end}>Encerrar bloco</Button>
        {/* A routine block (morning, wind-down) has nothing to escape from. */}
        {block.kind !== 'routine' && <EscapeButton blockId={block.id} mission={focusMission} />}
      </div>
    </section>
  );
}
