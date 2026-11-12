import type { Block, BlockKind, HHmm, ID } from '@life/shared';
import { parseHHmm } from '@life/shared';
import type { IconName } from '../../art/icons';
import { formatDuration } from '../../ui/format';

// Labels and ordering helpers shared by the routine editor, its sheets and the setup preview.

export const KIND_OPTIONS: BlockKind[] = ['focus', 'body', 'study', 'light', 'routine'];
export const KIND_LABEL: Record<BlockKind, string> = {
  focus: 'foco', body: 'corpo', study: 'estudo', light: 'leve', routine: 'rotina',
};
export const KIND_ICON: Record<BlockKind, IconName> = {
  focus: 'flame', body: 'energy', study: 'book', light: 'leaf', routine: 'house',
};

/** Weekdays Monday first (0 = Sunday, as in `Block.weekdays`). */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const WEEKDAY_NAME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** "na segunda", "no sábado". */
export const WEEKDAY_IN = ['no domingo', 'na segunda', 'na terça', 'na quarta', 'na quinta', 'na sexta', 'no sábado'];
export const isWeekend = (weekday: number): boolean => weekday === 0 || weekday === 6;

/** "3h · mín 45 min". */
export const durationText = (b: Pick<Block, 'durationMin' | 'minimumMin'>): string =>
  `${formatDuration(b.durationMin)} · mín ${formatDuration(b.minimumMin)}`;

/** Plan order (as `blocksForDay`): `order`, then target time. */
export function byPlanOrder(a: Block, b: Block): number {
  return a.order - b.order || (a.targetStart < b.targetStart ? -1 : a.targetStart > b.targetStart ? 1 : 0);
}

/** Minutes since midnight, with times before the day start counted as the next morning. */
export function logicalMinutes(t: HHmm, dayStartHour: number): number {
  const m = parseHHmm(t);
  return m < dayStartHour * 60 ? m + 24 * 60 : m;
}

/**
 * Whole-routine order after one day's list was reordered: the slots the day's blocks held in
 * `all` are refilled in the new `day` order, so blocks of other days keep their places.
 */
export function mergeDayOrder(all: ID[], day: ID[]): ID[] {
  const known = new Set(all);
  const next = day.filter((id) => known.has(id));
  const inDay = new Set(next);
  let i = 0;
  return all.map((id) => (inDay.has(id) ? next[i++]! : id));
}

/**
 * Whole-routine order with block `id` moved before the first other block that starts later.
 * `planDay` places blocks in this order, so a new (or re-timed) block must not stay last.
 */
export function placeByTime(blocks: Block[], id: ID, dayStartHour: number): ID[] {
  const sorted = [...blocks].sort(byPlanOrder);
  const self = sorted.find((b) => b.id === id);
  const ids = sorted.filter((b) => b.id !== id).map((b) => b.id);
  if (!self) return ids;
  const mine = logicalMinutes(self.targetStart, dayStartHour);
  const at = sorted.filter((b) => b.id !== id).findIndex((b) => logicalMinutes(b.targetStart, dayStartHour) > mine);
  ids.splice(at < 0 ? ids.length : at, 0, id);
  return ids;
}
