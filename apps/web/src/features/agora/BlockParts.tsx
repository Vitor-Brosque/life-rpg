import { useEffect, useState } from 'react';
import type { Block, BlockOccurrence, DayKey } from '@life/shared';
import { formatDuration } from '../../ui/format';

// Pieces of the block banner: the remaining-time bar and the checklist of routine blocks.

const MIN = 60_000;

/** Minutes of the occurrence's version (normal or minimum). */
export const versionMinutes = (o: BlockOccurrence): number =>
  (o.version === 'minimum' ? o.block.minimumMin : o.block.durationMin);

/**
 * Remaining time of the block: the fill drains toward the left as time passes. When the block
 * shrank (late start, a commitment), the track stands for the whole version and the part that
 * will not happen is drawn dashed at the end.
 */
export function TimeLeft({ occurrence, now }: { occurrence: BlockOccurrence; now: number }) {
  const windowMs = Math.max(0, occurrence.end - occurrence.start);
  const fullMin = versionMinutes(occurrence);
  const trackMs = Math.max(windowMs, fullMin * MIN, 1);
  const leftMs = Math.min(Math.max(occurrence.end - now, 0), windowMs);
  const leftMin = Math.ceil(leftMs / MIN);
  const windowMin = Math.round(windowMs / MIN);
  const leftText = `${formatDuration(leftMin)} ${leftMin === 1 ? 'restante' : 'restantes'}`;
  return (
    <div className="time-left">
      <div
        className="time-left__track"
        role="progressbar"
        aria-label="Tempo restante do bloco"
        aria-valuemin={0}
        aria-valuemax={windowMin}
        aria-valuenow={leftMin}
        aria-valuetext={leftText}
      >
        <span className="time-left__fill" style={{ width: `${(leftMs / trackMs) * 100}%` }} />
        {occurrence.shrunk && (
          <span className="time-left__lost" style={{ left: `${(windowMs / trackMs) * 100}%` }} />
        )}
      </div>
      <p className="time-left__caption">
        <span>{leftText}</span>
        {occurrence.shrunk && (
          <span className="time-left__shrunk">{`Bloco encolhido: ${formatDuration(windowMin)} de ${formatDuration(fullMin)}`}</span>
        )}
      </p>
    </div>
  );
}

const ROUTINE_PREFIX = 'life-rpg-routine:';
const routineKey = (day: DayKey, blockId: string) => `${ROUTINE_PREFIX}${day}:${blockId}`;

function readTicks(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Stores today's ticks and drops the ones of other days (they are not synced, never needed again). */
function writeTicks(key: string, day: DayKey, ticks: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ticks));
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(ROUTINE_PREFIX) && !k.startsWith(`${ROUTINE_PREFIX}${day}:`)) localStorage.removeItem(k);
    }
  } catch { /* private mode / quota: the ticks just stay in memory */ }
}

export interface RoutineTicks {
  ticks: string[];
  toggle(id: string): void;
  /** Every item of the block's checklist is ticked (and there is at least one). */
  allDone: boolean;
}

/** Today's ticks of a routine block's checklist. Ticks are per device and per day. */
export function useRoutineTicks(block: Block, day: DayKey): RoutineTicks {
  const key = routineKey(day, block.id);
  const [ticks, setTicks] = useState(() => readTicks(key));
  useEffect(() => setTicks(readTicks(key)), [key]);
  const toggle = (id: string) => {
    const next = ticks.includes(id) ? ticks.filter((x) => x !== id) : [...ticks, id];
    setTicks(next);
    writeTicks(key, day, next);
  };
  const allDone = block.checklist.length > 0 && block.checklist.every((c) => ticks.includes(c.id));
  return { ticks, toggle, allDone };
}

/** A routine block's own checklist (no missions), fed by `useRoutineTicks`. */
export function RoutineChecklist({ block, ticks, toggle }: { block: Block } & Pick<RoutineTicks, 'ticks' | 'toggle'>) {
  if (block.checklist.length === 0) return null;
  const done = block.checklist.filter((c) => ticks.includes(c.id)).length;
  return (
    <div className="block-banner__group">
      <p className="block-banner__label">Checklist · {done}/{block.checklist.length}</p>
      <ul className="block-checks">
        {block.checklist.map((c) => (
          <li key={c.id}>
            <label className="block-check">
              <input type="checkbox" className="px-checkbox" checked={ticks.includes(c.id)} onChange={() => toggle(c.id)} />
              <span className="block-check__text">{c.text}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
