import type { CSSProperties } from 'react';
import type { BlockOccurrence } from '@life/shared';
import { formatHHmm } from '@life/shared';
import { Icon } from '../../art/icons';
import { formatDuration } from '../../ui/format';
import { versionMinutes } from '../agora/BlockParts';

// Today's blocks on the Painel timeline (§10): named bands next to the commitments.

const MIN = 60_000;

export interface Span { start: number; end: number }

export const clock = (ts: number): string => {
  const d = new Date(ts);
  return formatHHmm(d.getHours() * 60 + d.getMinutes());
};

/** The shrink matters only for what is still ahead (current or upcoming), not for what is over. */
const shows = (o: BlockOccurrence): boolean => o.shrunk && (o.state === 'current' || o.state === 'upcoming');

/**
 * The part of a shrunk block's target window it lost: the start that already went by (late
 * start, a block before it running long) and/or the end a commitment took. Those times are past
 * or under another entry, so the dashed outline never claims time that is still free.
 */
export function cutSpans(o: BlockOccurrence): Span[] {
  if (!shows(o)) return [];
  const out: Span[] = [];
  if (o.start > o.plannedStart) out.push({ start: o.plannedStart, end: Math.min(o.start, o.plannedEnd) });
  if (o.end < o.plannedEnd) out.push({ start: Math.max(o.end, o.plannedStart), end: o.plannedEnd });
  return out.filter((s) => s.end > s.start);
}

const STATE_TEXT: Partial<Record<BlockOccurrence['state'], string>> = {
  current: 'bloco atual', done: 'concluído', missed: 'passou',
};

export interface BlockBandProps {
  occ: BlockOccurrence;
  style: CSSProperties;
  /** Puts the text just below the now line (current band with "now" in its upper half). */
  textStyle?: CSSProperties;
}

/** One block as a band: current highlighted (aria-current), done muted with a check. */
export function BlockBand({ occ, style, textStyle }: BlockBandProps) {
  const { state } = occ;
  const shrunk = shows(occ);
  const cls = ['timeline__band', `timeline__band--${state}`, shrunk && 'timeline__band--shrunk'].filter(Boolean).join(' ');
  const stateText = STATE_TEXT[state];
  return (
    <li className={cls} style={style} data-state={state} aria-current={state === 'current' ? 'true' : undefined}>
      <span className={textStyle ? 'timeline__band-text timeline__block-text--below' : 'timeline__band-text'} style={textStyle}>
        {state === 'done' && <Icon name="check" size={12} className="timeline__band-check" />}
        <span className="timeline__band-time">{clock(occ.start)}–{clock(occ.end)}</span>
        <span className="timeline__band-title">{occ.block.name}</span>
        {stateText && <span className="visually-hidden">{stateText}</span>}
        {shrunk && (
          <span className="visually-hidden">
            {`, encolhido: ${formatDuration((occ.end - occ.start) / MIN)} de ${formatDuration(versionMinutes(occ))}`}
          </span>
        )}
      </span>
    </li>
  );
}

/** A block with no room today: a thin marker at its target time. */
export function SkipMarker({ occ, top }: { occ: BlockOccurrence; top: string }) {
  return (
    <li className="timeline__skip" style={{ top }} data-state="skipped">
      <span className="timeline__skip-label">
        <span className="timeline__skip-name">{occ.block.name}</span>
        <span className="timeline__skip-text">sem tempo hoje</span>
      </span>
    </li>
  );
}
