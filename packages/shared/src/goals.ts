import type { Block, BlockSession, DayKey, DayState, Goal, GoalProgress, GoalStatus, ID, Journey, Mission, Week } from './types';
import { addDays, dayKeyOf } from './dates';

// Objetivos (2026-11-23): the why above the journeys ("Carreira em Dados › Tech News"), at most five active at a time,
// the purpose chain of a mission, what was linked to each objective in a period and the "Avançou?" of the Nova semana.
// Rules only; nothing here reads or writes the database. Named Goal in code: WeekObjective is a block's objective of
// the week (setObjectives, toggleObjective, XP 'objective'), a different thing.

export const GOAL_STATUSES: readonly GoalStatus[] = ['ativo', 'pausado', 'concluido', 'arquivado'];
/** The chips of "Situação" in the sheet. */
export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  ativo: 'Ativo', pausado: 'Pausado', concluido: 'Concluído', arquivado: 'Arquivado',
};
/** The tag of a goal in lists and reports. */
export const GOAL_STATUS_TAG: Record<GoalStatus, string> = {
  ativo: 'ativo', pausado: 'pausado', concluido: 'concluído', arquivado: 'arquivado',
};
export const GOAL_ACTIVE_MAX = 5;
export const GOAL_TITLE_MAX = 80;
export const GOAL_WHY_MAX = 140;
export const GOAL_HORIZON_MAX = 40;
export const GOAL_PROGRESS: readonly GoalProgress[] = ['sim', 'um-pouco', 'nao'];
export const GOAL_PROGRESS_LABEL: Record<GoalProgress, string> = { sim: 'Sim', 'um-pouco': 'Um pouco', nao: 'Não desta vez' };
export const isGoalProgress = (v: unknown): v is GoalProgress =>
  typeof v === 'string' && (GOAL_PROGRESS as readonly string[]).includes(v);

/** The text in one line: whitespace collapsed, ends trimmed. */
const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();
const cut = (text: string, max: number): string => flat(text).slice(0, max).trim();
const RANK: Record<GoalStatus, number> = { ativo: 0, pausado: 1, concluido: 2, arquivado: 3 };

/** Live goals: active, paused, concluded, archived; each status by order, then by creation. */
export function sortedGoals(list: readonly Goal[]): Goal[] {
  return list
    .filter((g) => !g.deleted)
    .sort((a, b) => RANK[a.status] - RANK[b.status] || a.order - b.order || a.createdAt - b.createdAt);
}

export const activeGoals = (list: readonly Goal[]): Goal[] => sortedGoals(list).filter((g) => g.status === 'ativo');

/** What the pickers offer (journey, season focus): active and paused goals, plus `keep` (the current link) whatever its status. */
export const pickableGoals = (list: readonly Goal[], keep?: ID): Goal[] =>
  sortedGoals(list).filter((g) => g.status === 'ativo' || g.status === 'pausado' || g.id === keep);

/** One more active goal besides `except` would pass the limit of five. */
export const goalLimitReached = (list: readonly Goal[], except?: ID): boolean =>
  activeGoals(list).filter((g) => g.id !== except).length >= GOAL_ACTIVE_MAX;

/** The order of a new goal: after every goal ever created. */
export const nextGoalOrder = (list: readonly Goal[]): number => list.reduce((mx, g) => Math.max(mx, g.order + 1), 0);

/** Saving Ativo for a goal that is not active yet, with five others active: the sheet asks which one to pause. */
export const goalNeedsPause = (
  list: readonly Goal[], status: GoalStatus, opts: { id?: ID; wasActive?: boolean } = {},
): boolean => status === 'ativo' && !opts.wasActive && goalLimitReached(list, opts.id);

export interface GoalSave { status: GoalStatus; pause?: ID }

/**
 * What a save really writes: Ativo beyond the limit pauses `pauseId` (one of the other active goals) or, without a
 * valid one, keeps the goal paused. Never refuses: a paused, concluded or archived goal is always saved as chosen.
 */
export function goalSave(
  list: readonly Goal[], status: GoalStatus, opts: { id?: ID; wasActive?: boolean; pauseId?: ID } = {},
): GoalSave {
  if (!goalNeedsPause(list, status, opts)) return { status };
  const pause = activeGoals(list).find((g) => g.id === opts.pauseId && g.id !== opts.id);
  return pause ? { status: 'ativo', pause: pause.id } : { status: 'pausado' };
}

// ------------------------------------------------------------------ Planejar → Objetivos

export interface GoalGroup {
  /** Absent: "Sem objetivo" (active journeys whose goal is missing or deleted). */
  goal?: Goal;
  journeys: Journey[];
}

const byJourneyOrder = (a: Journey, b: Journey): number => a.order - b.order || a.createdAt - b.createdAt;

/**
 * The groups of Planejar → Objetivos: every active or paused goal with its active journeys (by journey order); a
 * concluded or archived goal only while an active journey still points to it; last, "Sem objetivo", only when some
 * active journey has no live goal.
 */
export function goalGroups(goals: readonly Goal[], journeys: readonly Journey[]): GoalGroup[] {
  const active = journeys.filter((j) => !j.deleted && j.status === 'active').sort(byJourneyOrder);
  const live = sortedGoals(goals);
  const ids = new Set(live.map((g) => g.id));
  const out: GoalGroup[] = [];
  for (const goal of live) {
    const own = active.filter((j) => j.goalId === goal.id);
    if (goal.status === 'ativo' || goal.status === 'pausado' || own.length > 0) out.push({ goal, journeys: own });
  }
  const loose = active.filter((j) => j.goalId === undefined || !ids.has(j.goalId));
  if (loose.length > 0) out.push({ journeys: loose });
  return out;
}

/** Concluded and archived goals that no active journey points to ("Mostrar concluídos e arquivados"). */
export function oldGoals(goals: readonly Goal[], journeys: readonly Journey[]): Goal[] {
  const used = new Set(journeys.filter((j) => !j.deleted && j.status === 'active').map((j) => j.goalId));
  return sortedGoals(goals).filter((g) => (g.status === 'concluido' || g.status === 'arquivado') && !used.has(g.id));
}

/** "Pausado · 2027": the status (when not active) and the horizon, for the line under a goal's title. */
export function goalMeta(g: Goal): string {
  return [g.status !== 'ativo' ? GOAL_STATUS_LABEL[g.status] : '', g.horizon ? flat(g.horizon) : ''].filter(Boolean).join(' · ');
}

// ------------------------------------------------------------------ the purpose chain

export interface PurposeChain { visible: string; spoken: string }

/** "Carreira em Dados › Tech News" and its spoken form, when the journey is live and points to a live goal. */
export function purposeChain(
  journeyId: ID | undefined, journeys: readonly Journey[], goals: readonly Goal[],
): PurposeChain | undefined {
  const journey = journeyId ? journeys.find((j) => j.id === journeyId && !j.deleted) : undefined;
  const goal = journey?.goalId ? goals.find((g) => g.id === journey.goalId && !g.deleted) : undefined;
  if (!journey || !goal) return undefined;
  const g = flat(goal.title);
  const j = flat(journey.title);
  return { visible: `${g} › ${j}`, spoken: `Objetivo: ${g}, jornada: ${j}` };
}

// ------------------------------------------------------------------ what was linked to each goal

export interface GoalCounts { missions: number; blocks: number }

export interface GoalCountInput {
  goals: readonly Goal[];
  journeys: readonly Journey[];
  missions: readonly Mission[];
  sessions: readonly BlockSession[];
  blocks: readonly Block[];
  dayStates: readonly DayState[];
  from: DayKey;
  to: DayKey;
  dayStartHour: number;
}

/**
 * Per live goal with something linked: missions concluded and blocks started (not skipped) from `from` to `to` (both
 * included), counted through their journey's goal. A block session counts through the subject chosen with "Usar" that
 * day, else through its block's journey. Goals with nothing linked are absent.
 */
export function goalCounts(input: GoalCountInput): Map<ID, GoalCounts> {
  const live = new Set(input.goals.filter((g) => !g.deleted).map((g) => g.id));
  const goalOf = new Map<ID, ID>();
  for (const j of input.journeys) if (!j.deleted && j.goalId !== undefined && live.has(j.goalId)) goalOf.set(j.id, j.goalId);
  const out = new Map<ID, GoalCounts>();
  const add = (journeyId: ID | undefined, key: keyof GoalCounts): void => {
    const goal = journeyId !== undefined ? goalOf.get(journeyId) : undefined;
    if (goal === undefined) return;
    const c = out.get(goal) ?? { missions: 0, blocks: 0 };
    c[key] += 1;
    out.set(goal, c);
  };
  const inRange = (d: DayKey): boolean => d >= input.from && d <= input.to;
  for (const m of input.missions) {
    if (m.deleted || m.status !== 'done' || m.completedAt === undefined) continue;
    if (inRange(dayKeyOf(m.completedAt, input.dayStartHour))) add(m.journeyId, 'missions');
  }
  const blocks = new Map(input.blocks.filter((b) => !b.deleted).map((b) => [b.id, b]));
  const picks = new Map(input.dayStates.filter((d) => !d.deleted).map((d) => [d.id, d.subjectPicks]));
  for (const s of input.sessions) {
    if (s.deleted || s.skipped || s.startedAt === undefined || !inRange(s.day)) continue;
    add(picks.get(s.day)?.[s.blockId] ?? blocks.get(s.blockId)?.journeyId, 'blocks');
  }
  return out;
}

/** "2 missões concluídas · 1 bloco iniciado"; undefined when nothing was linked (never a zero). */
export function goalCountText(c: GoalCounts | undefined): string | undefined {
  if (!c) return undefined;
  const parts = [
    c.missions > 0 ? `${c.missions} ${c.missions === 1 ? 'missão concluída' : 'missões concluídas'}` : '',
    c.blocks > 0 ? `${c.blocks} ${c.blocks === 1 ? 'bloco iniciado' : 'blocos iniciados'}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** The observed line under each goal in the Nova semana card. */
export function goalWeekLine(c: GoalCounts | undefined): string {
  const text = goalCountText(c);
  return text ? `Ligado a ele na semana passada: ${text}.` : 'Sem registro ligado a ele na semana passada.';
}

// ------------------------------------------------------------------ "Avançou?"

export interface GoalAnswer {
  /** Monday of the week the answer is about (the week before the review's week). */
  week: DayKey;
  /** Logical day the review was answered. */
  day: DayKey;
  progress: GoalProgress;
}

/** The "Avançou?" answers about `goalId` in Nova semana reviews answered from `from` to `to`, oldest week first. */
export function goalAnswers(
  weeks: readonly Week[], goalId: ID, range: { from: DayKey; to: DayKey }, dayStartHour: number,
): GoalAnswer[] {
  const out: GoalAnswer[] = [];
  for (const w of weeks) {
    const progress = w.deleted ? undefined : w.review?.goals?.[goalId];
    if (!w.review || !isGoalProgress(progress)) continue;
    const day = dayKeyOf(w.review.answeredAt, dayStartHour);
    if (day >= range.from && day <= range.to) out.push({ week: addDays(w.id, -7), day, progress });
  }
  return out.sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0));
}

/** "Sim 2 · Um pouco 1", in the chips' order; undefined without answers. */
export function goalTally(answers: readonly GoalAnswer[]): string | undefined {
  const parts = GOAL_PROGRESS.flatMap((p) => {
    const n = answers.filter((a) => a.progress === p).length;
    return n > 0 ? [`${GOAL_PROGRESS_LABEL[p]} ${n}`] : [];
  });
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

// ------------------------------------------------------------------ the sheet

/** What the sheet holds (texts as typed; empty = absent). */
export interface GoalDraft { title: string; why: string; horizon: string; status: GoalStatus }

export const newGoalDraft = (): GoalDraft => ({ title: '', why: '', horizon: '', status: 'ativo' });
export const goalDraftOf = (g: Goal): GoalDraft => ({ title: g.title, why: g.why ?? '', horizon: g.horizon ?? '', status: g.status });

export type GoalIssue = 'title';
export const GOAL_ISSUE_TEXT: Record<GoalIssue, string> = { title: 'Escreva o objetivo.' };
export const goalIssue = (d: GoalDraft): GoalIssue | undefined => (flat(d.title) === '' ? 'title' : undefined);

export type GoalFields = Pick<Goal, 'title' | 'why' | 'horizon' | 'status'>;

/** The stored form of a draft: texts in one line, cut at their limits; blank texts absent. */
export function goalFields(d: GoalDraft): GoalFields {
  const why = cut(d.why, GOAL_WHY_MAX);
  const horizon = cut(d.horizon, GOAL_HORIZON_MAX);
  return { title: cut(d.title, GOAL_TITLE_MAX), ...(why ? { why } : {}), ...(horizon ? { horizon } : {}), status: d.status };
}

const GOAL_EDITABLE: ReadonlyArray<keyof GoalFields> = ['title', 'why', 'horizon', 'status'];

/** Only the fields that differ from `initial` (the sheet when it opened); a removed text is written as undefined. */
export function goalChanges(initial: GoalDraft, draft: GoalDraft): Partial<Goal> {
  const a = goalFields(initial);
  const b = goalFields(draft);
  const out: Partial<Goal> = {};
  for (const k of GOAL_EDITABLE) if ((a[k] ?? null) !== (b[k] ?? null)) Object.assign(out, { [k]: b[k] });
  return out;
}
