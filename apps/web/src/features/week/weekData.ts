import { useLiveQuery } from 'dexie-react-hooks';
import type { Block, DayKey, ID, Week, WeekAtypical, WeekObjective, WeekReview, WeekStats } from '@life/shared';
import { addDays, formatHHmm, timestampAt, weekStats } from '@life/shared';
import { db } from '../../db/db';

// What the "Nova semana" card (§8) shows: last week's observed numbers, the main blocks to set
// objectives for, and last week's objectives that stayed open.

/** One main block (focus/study) per name: the same block on several weekdays is one group. */
export interface BlockGroup {
  key: string;
  name: string;
  /** Block that new objectives are attached to (the first one, in routine order). */
  blockId: ID;
  /** Every block with this name (the banner shows the objectives on any of them). */
  ids: ID[];
}

const nameKey = (name: string): string => name.trim().toLocaleLowerCase('pt-BR');
const isMain = (b: Block): boolean => (b.kind === 'focus' || b.kind === 'study') && b.weekdays.length > 0;

/** Active focus/study blocks deduplicated by name, in routine order. */
export function mainBlockGroups(blocks: Block[]): BlockGroup[] {
  const groups = new Map<string, BlockGroup>();
  const sorted = blocks
    .filter((b) => !b.deleted && !b.archived && isMain(b))
    .sort((a, b) => a.order - b.order || a.targetStart.localeCompare(b.targetStart));
  for (const b of sorted) {
    const key = nameKey(b.name);
    const g = groups.get(key);
    if (g) g.ids.push(b.id);
    else groups.set(key, { key, name: b.name.trim(), blockId: b.id, ids: [b.id] });
  }
  return [...groups.values()];
}

/** Ids of the live blocks named like `block` (itself included): objectives are kept per name. */
export function sameNameIds(blocks: Block[], block: Block): ID[] {
  const key = nameKey(block.name);
  const ids = blocks.filter((b) => !b.deleted && nameKey(b.name) === key).map((b) => b.id);
  return ids.includes(block.id) ? ids : [block.id, ...ids];
}

/** Last week's open objectives, each with the group (by its block's name) it falls under. */
export function carryOver(last: Week | undefined, blocks: Block[], groups: BlockGroup[]):
  Array<{ objective: WeekObjective; group: string }> {
  if (!last) return [];
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const keys = new Set(groups.map((g) => g.key));
  return last.objectives.flatMap((objective) => {
    const block = byId.get(objective.blockId);
    const group = block ? nameKey(block.name) : undefined;
    return !objective.done && group && keys.has(group) && objective.text.trim() ? [{ objective, group }] : [];
  });
}

/** Something was actually recorded last week (a week with no activity has nothing to observe). */
export function hasObservedData(s: WeekStats): boolean {
  return s.workdays > 0 && (s.activeWorkdays > 0 || s.started > 0 || s.escapes > 0 || s.resumptions > 0);
}

/** Labelled numbers of the "Observado" list, in the order of the spec. */
export function observedRows(s: WeekStats): Array<{ label: string; value: string }> {
  return [
    { label: 'Blocos iniciados', value: `${s.started} de ${s.planned}` },
    { label: 'Versão mínima', value: `${s.minimumUsed}×` },
    { label: 'Retomadas', value: String(s.resumptions) },
    { label: 'Escapei', value: `${s.escapes}×` },
    ...(s.topFeeling ? [{ label: 'Sentimento mais comum', value: s.topFeeling }] : []),
    { label: 'Dias úteis ativos', value: `${s.activeWorkdays} de ${s.workdays}` },
  ];
}

export interface WeekCardData {
  /** Last week's numbers; undefined when nothing was recorded (step 1 is skipped). */
  stats?: WeekStats;
  groups: BlockGroup[];
  carry: Array<{ objective: WeekObjective; group: string }>;
  /** This week's review, when step 1 was already answered. */
  review?: WeekReview;
  /** This week's experiment (chosen in Padrões or earlier), if any. */
  experiment?: string;
  /** The mark on this week (marked from the card's link or from Planejar), if any. */
  atypical?: WeekAtypical;
  /** The mark on last week: the card welcomes the user back. */
  lastAtypical?: WeekAtypical;
}

const live = <T extends { deleted: boolean }>(r: T | undefined): T | undefined => (r && !r.deleted ? r : undefined);

/** Everything the card needs for the week `weekId` (its Monday); undefined while loading. */
export function useWeekCardData(today: DayKey, weekId: DayKey): WeekCardData | undefined {
  return useLiveQuery(async () => {
    const settings = live(await db.settings.get('settings'));
    if (!settings) return undefined;
    const lastId = addDays(weekId, -7);
    const weekStartTs = timestampAt(weekId, formatHHmm(settings.dayStartHour * 60));
    const [blocks, commitments, dayStates, sessions, checkins, xpEvents, last, current] = await Promise.all([
      db.blocks.filter((b) => !b.deleted).toArray(),
      db.commitments.filter((c) => !c.deleted).toArray(),
      db.dayState.toArray(),
      db.blockSessions.where('day').between(lastId, weekId).toArray(),
      db.checkins.where('at').between(timestampAt(lastId, '00:00'), timestampAt(addDays(weekId, 1), '00:00')).toArray(),
      db.xpEvents.where('dayKey').between(lastId, weekId).toArray(),
      db.weeks.get(lastId),
      db.weeks.get(weekId),
    ]);
    const stats = weekStats({
      weekStart: lastId, today, dayStates, sessions, checkins, xpEvents, commitments,
      // A block created after last week was not part of its plan.
      blocks: blocks.filter((b) => b.createdAt < weekStartTs),
      dayStartHour: settings.dayStartHour, dayEndHour: settings.dayEndHour,
    });
    const groups = mainBlockGroups(blocks);
    return {
      stats: hasObservedData(stats) ? stats : undefined,
      groups,
      carry: carryOver(live(last), blocks, groups),
      review: live(current)?.review,
      experiment: live(current)?.experiment,
      atypical: live(current)?.atypical,
      lastAtypical: live(last)?.atypical,
    } satisfies WeekCardData;
  }, [today, weekId]);
}
