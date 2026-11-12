import { useCallback } from 'react';
import type { Block, BlockOccurrence, DayKey, Mission } from '@life/shared';
import { dayKeyToDate, isOfBlock, nextBlockDay, weekdayOf } from '@life/shared';
import { useBlocks, useDayPlan, useMissions, useToday } from '../../db/hooks';
import { formatDuration, WEEKDAY_ABBR } from '../../ui/format';

// "Sem sobrecarga" (§5): moving a block mission to today checks the block's planned load first.

/** Assumed length of a mission without a duration. */
export const DEFAULT_MISSION_MIN = 25;

export interface BlockFit {
  /** The block the mission belongs to (explicit blockId, else area/journey). */
  block: Block;
  /** Next day (after today) that has the block. */
  nextDay?: DayKey;
  /** Minutes planned for the block today, counting the mission being moved. */
  load: number;
  /** Minutes the block has today (0 when it does not happen, was skipped or is already over). */
  capacity: number;
  full: boolean;
}

export interface BlockFitInput {
  mission: Mission;
  /** Live routine blocks. */
  blocks: Block[];
  /** Today's occurrences (`planDay`). */
  plan: BlockOccurrence[];
  missions: Mission[];
  today: DayKey;
}

const counts = (m: Mission, today: DayKey): boolean =>
  !m.deleted && (m.status === 'doing' || (m.status === 'open' && m.date === today));

/** The mission's block (preferring one that happens today) and today's load against its time. */
export function blockFit({ mission, blocks, plan, missions, today }: BlockFitInput): BlockFit | undefined {
  const mine = blocks.filter((b) => !b.deleted && !b.archived && isOfBlock(mission, b));
  if (mine.length === 0) return undefined;
  const wd = weekdayOf(today);
  const block = mine.find((b) => b.weekdays.includes(wd)) ?? mine[0]!;
  const occ = plan.find((o) => o.block.id === block.id && o.day === today);
  const open = occ && (occ.state === 'current' || occ.state === 'upcoming');
  const capacity = open ? Math.round((occ.end - occ.start) / 60_000) : 0;
  const others = missions.filter((m) => m.id !== mission.id && counts(m, today) && isOfBlock(m, block));
  const load = [...others, mission].reduce((s, m) => s + (m.durationMin ?? DEFAULT_MISSION_MIN), 0);
  return { block, nextDay: nextBlockDay(block, today), load, capacity, full: load > capacity };
}

/**
 * Today's `blockFit` for any mission (one set of live queries for a whole list); undefined until
 * today's plan is read, so a plan still loading never looks like a block with no time.
 */
export function useBlockFit(): (m: Mission) => BlockFit | undefined {
  const blocks = useBlocks();
  const plan = useDayPlan();
  const missions = useMissions();
  const today = useToday();
  return useCallback(
    (mission: Mission) => (today && plan ? blockFit({ mission, blocks, plan, missions, today }) : undefined),
    [blocks, plan, missions, today],
  );
}

/** "qui" */
export const weekdayAbbr = (day: DayKey): string => WEEKDAY_ABBR[dayKeyToDate(day).getDay()]!;

/** "bloco Treino", but "Bloco 1 · Tech News" stays as it is. */
export const blockLabel = (name: string): string => (/^bloco\b/i.test(name.trim()) ? name.trim() : `bloco ${name.trim()}`);

/** "Próximo bloco (qui)" */
export const nextBlockButton = (fit: BlockFit): string | undefined =>
  fit.nextDay ? `Próximo bloco (${weekdayAbbr(fit.nextDay)})` : undefined;

/** "Mandar para o próximo (qui)" */
export const sendToNextButton = (fit: BlockFit): string | undefined =>
  fit.nextDay ? `Mandar para o próximo (${weekdayAbbr(fit.nextDay)})` : undefined;

/** The inline warning shown before overloading today's block (never blocks the move). */
export function capacityWarning(fit: BlockFit): string {
  const label = blockLabel(fit.block.name);
  const question = fit.nextDay ? ` Mandar para o próximo (${weekdayAbbr(fit.nextDay)})?` : '';
  if (fit.capacity <= 0) return `Hoje não sobra tempo no ${label}.${question}`;
  return `O ${label} de hoje já está cheio (${formatDuration(fit.load)} de ${formatDuration(fit.capacity)}).${question}`;
}
