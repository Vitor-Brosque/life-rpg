import type { BaseRecord, Block, Commitment, DayKey, DayMode, DayPlan } from './types';
import { weekdayOf } from './dates';
import { occurrencesOn } from './engine';

// Foto do plano (Acompanhamento D): the day's planned blocks and commitments, copied on the first
// explicit action of the day and again when the day type changes. Padrões reads past days from it,
// so editing the routine today no longer rewrites the "planned" of past weeks.

const byPlanOrder = (a: Block, b: Block): number =>
  a.order - b.order || (a.targetStart < b.targetStart ? -1 : a.targetStart > b.targetStart ? 1 : 0);

/** The plan of `day` as it is now: every live, unarchived block of its weekday (any kind) and the day's commitments. */
export function takeDayPlan(input: {
  day: DayKey; mode: DayMode; takenAt: number; blocks: readonly Block[]; commitments: readonly Commitment[]; dayStartHour: number;
}): Omit<DayPlan, keyof BaseRecord> {
  const wd = weekdayOf(input.day);
  return {
    day: input.day,
    mode: input.mode,
    takenAt: input.takenAt,
    blocks: input.blocks.filter((b) => !b.deleted && !b.archived && b.weekdays.includes(wd)).sort(byPlanOrder).map((b) => ({
      blockId: b.id, name: b.name, kind: b.kind,
      ...(b.areaId ? { areaId: b.areaId } : {}),
      ...(b.journeyId ? { journeyId: b.journeyId } : {}),
      targetStart: b.targetStart, durationMin: b.durationMin, minimumMin: b.minimumMin, protected: b.protected,
      order: b.order, createdAt: b.createdAt,
    })),
    commitments: occurrencesOn([...input.commitments], input.day, input.dayStartHour).map((o) => ({
      commitmentId: o.commitment.id, title: o.commitment.title, start: o.commitment.start, end: o.commitment.end,
    })),
  };
}

/** An explicit action (re)takes the plan when the day has none yet or its type changed. */
export function dayPlanNeeded(existing: Pick<DayPlan, 'deleted' | 'mode'> | undefined, mode: DayMode): boolean {
  return !existing || existing.deleted || existing.mode !== mode;
}

/**
 * Blocks for `planDay` on a day with a plan: the planned ones exactly as they were, and the current blocks
 * missing from it with no weekdays, so they only enter when lived that day (like any block started off-plan).
 */
export function blocksFromPlan(plan: Pick<DayPlan, 'day' | 'blocks'>, current: readonly Block[]): Block[] {
  const wd = weekdayOf(plan.day);
  const planned = new Set(plan.blocks.map((b) => b.blockId));
  return [
    ...plan.blocks.map((p): Block => ({
      id: p.blockId, createdAt: p.createdAt, updatedAt: p.createdAt, deleted: false,
      name: p.name, weekdays: [wd], order: p.order, targetStart: p.targetStart,
      durationMin: p.durationMin, minimumMin: p.minimumMin,
      ...(p.areaId ? { areaId: p.areaId } : {}),
      ...(p.journeyId ? { journeyId: p.journeyId } : {}),
      kind: p.kind, protected: p.protected, checklist: [], archived: false,
    })),
    ...current.filter((b) => !b.deleted && !planned.has(b.id)).map((b) => ({ ...b, weekdays: [] })),
  ];
}

/**
 * The plan's commitments as one-off commitments of its day, plus the live commitments of that day created
 * after the plan was taken (`current`): a "dentista 15:00" added at 10:00 counts as it would on a day without
 * plan. The plan itself is never rewritten.
 */
export function commitmentsFromPlan(
  plan: Pick<DayPlan, 'day' | 'commitments' | 'takenAt'>, current: readonly Commitment[] = [], dayStartHour = 0,
): Commitment[] {
  const planned = new Set(plan.commitments.map((c) => c.commitmentId));
  const later = occurrencesOn(current.filter((c) => !c.deleted && c.createdAt > plan.takenAt && !planned.has(c.id)), plan.day, dayStartHour)
    .map((o) => o.commitment);
  return [
    ...plan.commitments.map((c) => ({
      id: c.commitmentId, createdAt: 0, updatedAt: 0, deleted: false,
      title: c.title, date: plan.day, start: c.start, end: c.end, remind: false,
    })),
    ...later,
  ];
}
