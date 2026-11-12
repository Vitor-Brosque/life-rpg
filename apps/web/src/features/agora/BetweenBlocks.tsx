import { useState } from 'react';
import type { Area, BlockOccurrence, Mission, Suggestion } from '@life/shared';
import { formatHHmm } from '@life/shared';
import { Icon } from '../../art/icons';
import { Button } from '../../ui/Button';
import { formatDuration } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import { safeRun } from '../../ui/safeRun';
import { Alternatives } from './Alternatives';
import { startBlockWithFeedback } from './blockFeedback';
import { DEFAULT_MISSION_MIN } from './capacity';
import './blocks.css';

/** Missions that fit the gap (no duration counts as 25 min, like the capacity check). */
export const fitsIn = (minutes: number) => (s: Suggestion): boolean =>
  (s.mission.durationMin ?? DEFAULT_MISSION_MIN) <= minutes;

export interface BetweenBlocksProps {
  /** Today's next occurrence (`useNextBlock`). */
  next: BlockOccurrence;
  /** Minutes until the next block (or an earlier commitment). */
  freeMinutes: number;
  /** Engine suggestions that fit (`fitsIn`). */
  items: Suggestion[];
  areas: Area[];
  onPick(m: Mission): void;
}

/** "Próximo: Treino às 13:30 · 25 min livres" and what fits until then (or rest). */
export function BetweenBlocks({ next, freeMinutes, items, areas, onPick }: BetweenBlocksProps) {
  const [starting, setStarting] = useState(false);
  const d = new Date(next.start);
  const at = formatHHmm(d.getHours() * 60 + d.getMinutes());
  const free = Math.max(0, freeMinutes);
  const startNow = () => {
    setStarting(true);
    safeRun(startBlockWithFeedback(next.block.id).finally(() => setStarting(false)));
  };
  return (
    <section className="between" aria-label="Entre blocos">
      <Panel variant="stone" className="between__card">
        <p className="block-banner__eyebrow"><Icon name="snooze" size={12} />Intervalo</p>
        <p className="between__next">{`Próximo: ${next.block.name} às ${at} · ${formatDuration(free)} livres`}</p>
        <p className="between__text">
          {items.length > 0 ? 'Tempo livre. Descanse, ou faça algo curto que caiba até lá.' : 'Tempo livre. Descansar também conta.'}
        </p>
        <Button size="sm" variant="ghost" icon="play" disabled={starting} onClick={startNow}>
          {`Começar ${next.block.name} agora`}
        </Button>
      </Panel>
      <Alternatives items={items} areas={areas} onPick={onPick} title="Cabe até lá" pickLabel="Abrir: " />
    </section>
  );
}
