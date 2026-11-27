import { useEffect } from 'react';
import { create } from 'zustand';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKey, DayMode, GoalProgress, ID, Week, WeekAtypical, WeekSummary } from '@life/shared';
import { cleanWeekSummary, isGoalProgress, weekdayOf, weekKey } from '@life/shared';
import { db } from '../../db/db';

interface WeekSession {
  /** Week whose card got "Fazer depois" in this app session (it comes back on the next open). */
  dismissed?: DayKey;
  /** Week whose card is open: kept on screen through both steps (saving the review alone would hide it). */
  opened?: DayKey;
  /** Week whose card was expanded ("Começar" or the "Nova semana" link); it shows collapsed before. */
  started?: DayKey;
}

/** App-session state of the weekly cycle (not persisted), keyed by the week's Monday. */
export const useWeekSession = create<WeekSession>(() => ({ dismissed: undefined, opened: undefined, started: undefined }));

/** The week's atypical mark while it still applies (not after its return day), for the Agora line. */
export function activeAtypical(week: Week | undefined, today: DayKey): WeekAtypical | undefined {
  const a = week?.atypical;
  return a && (!a.returnDay || a.returnDay > today) ? a : undefined;
}

/** Monday or Tuesday: the days the "Nova semana" card is offered (§8). */
export const isCycleDay = (day: DayKey): boolean => {
  const wd = weekdayOf(day);
  return wd === 1 || wd === 2;
};

export interface WeekCycle {
  loaded: boolean;
  weekId?: DayKey;
  /** This week's record (experiment, objectives), when there is one. */
  week?: Week;
  showCard: boolean;
  /** The card shows expanded (its steps); before "Começar" it is one line. */
  started: boolean;
  /**
   * Small "Nova semana" link: after "Fazer depois", on a free day (offered, never pushed), or
   * while the week has a review but no objectives yet.
   */
  showLink: boolean;
  /** The link: opens the card expanded. */
  open(): void;
  /** "Começar" on the collapsed card. */
  start(): void;
  later(): void;
  finish(): void;
}

/**
 * Whether the "Nova semana" card shows: Monday or Tuesday, the week has no review and no
 * objectives yet, and never before "Como está hoje?" is answered.
 */
export function useWeekCycle(today: DayKey | undefined, day: { asked: boolean; mode: DayMode }): WeekCycle {
  const weekId = today ? weekKey(today) : undefined;
  // null: no record for this week (yet).
  const week = useLiveQuery(async () => {
    if (!weekId) return undefined;
    const w = await db.weeks.get(weekId);
    return w && !w.deleted ? w : null;
  }, [weekId]);
  const { dismissed, opened, started } = useWeekSession();

  const cycleDay = today !== undefined && isCycleDay(today);
  // A week whose record only holds an experiment (chosen in Padrões) and/or the atypical mark
  // (chosen in Planejar) still waits for its cycle.
  const onlyMarks = !!week && !week.review && week.objectives.length === 0 && (!!week.experiment?.trim() || !!week.atypical);
  const pending = cycleDay && (week === null || onlyMarks);
  // Step 1 saved, step 2 never done (app closed, "Fazer depois"): the objectives stay reachable.
  const noObjectives = cycleDay && !!week?.review && week.objectives.length === 0;
  const auto = pending && day.asked && day.mode !== 'free' && dismissed !== weekId;
  const showCard = cycleDay && weekId !== undefined && (opened === weekId || auto);

  useEffect(() => {
    if (auto && weekId && useWeekSession.getState().opened !== weekId) useWeekSession.setState({ opened: weekId });
  }, [auto, weekId]);

  return {
    loaded: week !== undefined,
    weekId,
    week: week ?? undefined,
    showCard,
    started: weekId !== undefined && started === weekId,
    showLink: !showCard && ((pending && (dismissed === weekId || day.mode === 'free')) || noObjectives),
    open: () => useWeekSession.setState({ opened: weekId, started: weekId }),
    start: () => useWeekSession.setState({ started: weekId }),
    later: () => useWeekSession.setState({ dismissed: weekId, opened: undefined, started: undefined }),
    finish: () => useWeekSession.setState({ opened: undefined, dismissed: weekId }),
  };
}

// ------------------------------------------------- per-device memory of the week card

const DRAFT_PREFIX = 'life-rpg-week-draft:';
const GREETED_KEY = 'life-rpg-week-greeted';
let greetedInMemory: DayKey | undefined;

export type ReviewDraft = Record<'worked' | 'obstacle' | 'adjustment', string>;
const EMPTY_DRAFT: ReviewDraft = { worked: '', obstacle: '', adjustment: '' };

/** The review answers typed so far for the week (survive "Fazer depois" and navigation). */
export function readReviewDraft(weekId: DayKey): ReviewDraft {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DRAFT_PREFIX + weekId) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return EMPTY_DRAFT;
    const p = parsed as Partial<Record<keyof ReviewDraft, unknown>>;
    const text = (v: unknown) => (typeof v === 'string' ? v : '');
    return { worked: text(p.worked), obstacle: text(p.obstacle), adjustment: text(p.adjustment) };
  } catch {
    return EMPTY_DRAFT;
  }
}

/** The lines that came from "Usar no ajuste", kept with the draft (so a later Salvar still gives them source Padrões). */
export function readReviewSuggested(weekId: DayKey): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DRAFT_PREFIX + weekId) ?? 'null');
    const list = parsed && typeof parsed === 'object' ? (parsed as { suggested?: unknown }).suggested : undefined;
    return Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** Stores the draft (with its "Usar no ajuste" lines and "Avançou?" taps) and drops other weeks' drafts. */
export function writeReviewDraft(
  weekId: DayKey, draft: ReviewDraft | undefined, suggested: readonly string[] = [], goals: Readonly<Record<ID, GoalProgress>> = {},
): void {
  try {
    if (draft) localStorage.setItem(DRAFT_PREFIX + weekId, JSON.stringify({ ...draft, suggested, goals }));
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(DRAFT_PREFIX) && (k !== DRAFT_PREFIX + weekId || !draft)) localStorage.removeItem(k);
    }
  } catch { /* private mode / quota: the draft just stays in memory */ }
}

/** The "Avançou?" taps kept with the draft (only valid answers). */
export function readReviewGoals(weekId: DayKey): Record<ID, GoalProgress> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DRAFT_PREFIX + weekId) ?? 'null');
    const goals = parsed && typeof parsed === 'object' ? (parsed as { goals?: unknown }).goals : undefined;
    if (!goals || typeof goals !== 'object') return {};
    return Object.fromEntries(Object.entries(goals as Record<string, unknown>)
      .filter((e): e is [string, GoalProgress] => isGoalProgress(e[1])));
  } catch {
    return {};
  }
}

/** True once per week (per device): the first time the card shows, the companion greets the week. */
export function firstShowOfWeek(weekId: DayKey): boolean {
  let last: string | null | undefined;
  try { last = localStorage.getItem(GREETED_KEY); } catch { last = greetedInMemory; }
  if (last === weekId) return false;
  greetedInMemory = weekId;
  try { localStorage.setItem(GREETED_KEY, weekId); } catch { /* in memory only */ }
  return true;
}

const SUMMARY_PREFIX = 'life-rpg-week-ai:';

/** The AI summary of the week card, kept on this device only (spec §6.5). */
export interface StoredWeekSummary { summary: WeekSummary; at: number }

export function readWeekSummary(weekId: DayKey): StoredWeekSummary | undefined {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SUMMARY_PREFIX + weekId) ?? 'null');
    if (!v || typeof v !== 'object') return undefined;
    const o = v as { summary?: unknown; at?: unknown };
    const summary = cleanWeekSummary(o.summary);
    return summary && typeof o.at === 'number' ? { summary, at: o.at } : undefined;
  } catch {
    return undefined;
  }
}

/** Stores (or, with undefined, erases) the week's summary and drops other weeks' summaries. */
export function writeWeekSummary(weekId: DayKey, value: StoredWeekSummary | undefined): void {
  try {
    if (value) localStorage.setItem(SUMMARY_PREFIX + weekId, JSON.stringify(value));
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(SUMMARY_PREFIX) && (k !== SUMMARY_PREFIX + weekId || !value)) localStorage.removeItem(k);
    }
  } catch { /* private mode / quota: the summary just stays in memory */ }
}
