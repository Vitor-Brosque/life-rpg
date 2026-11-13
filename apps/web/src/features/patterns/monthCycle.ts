import { create } from 'zustand';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKey, DayMode, MonthAnswers, MonthKey } from '@life/shared';
import { addMonths, monthCardDue, monthEnd, monthKeyOf, monthReviewId, monthStart } from '@life/shared';
import { db } from '../../db/db';

export const MONTH_QUESTIONS: ReadonlyArray<{ key: keyof MonthAnswers; label: string; short: string }> = [
  { key: 'progress', label: 'O que mostra que você avançou neste mês?', short: 'Avanços' },
  { key: 'obstacle', label: 'O que mais atrapalhou, e em que momentos?', short: 'O que atrapalhou' },
  { key: 'next', label: 'Que mudança pequena você quer levar para o próximo mês?', short: 'Para o próximo mês' },
];

interface MonthSession {
  /** Month whose card got "Agora não" / "Fazer depois" in this app session (it comes back on the next open). */
  dismissed?: MonthKey;
  /** Month whose card was expanded ("Começar"). */
  started?: MonthKey;
}

/** App-session state of the month card (not persisted), like the weekly cycle's. */
export const useMonthSession = create<MonthSession>(() => ({ dismissed: undefined, started: undefined }));

export interface MonthCycle {
  loaded: boolean;
  /** The month the card is about (the previous one), when it is due today. */
  month?: MonthKey;
  show: boolean;
  started: boolean;
  start(): void;
  later(): void;
}

/** Whether the Agora offers last month's reflection (spec §2, decision 21), after "Como está hoje?". */
export function useMonthCycle(today: DayKey | undefined, day: { asked: boolean; mode: DayMode }): MonthCycle {
  const prev = today ? addMonths(monthKeyOf(today), -1) : undefined;
  const state = useLiveQuery(async () => {
    if (!prev) return undefined;
    const [review, active] = await Promise.all([
      db.monthReviews.get(monthReviewId(prev)),
      db.xpEvents.where('dayKey').between(monthStart(prev), monthEnd(prev), true, true).filter((x) => !x.deleted).count(),
    ]);
    return { review: review ?? null, active: active > 0 };
  }, [prev]);
  const { dismissed, started } = useMonthSession();
  const month = today && state && day.asked
    ? monthCardDue({ today, mode: day.mode, prevReview: state.review ?? undefined, prevActive: state.active })
    : undefined;
  return {
    loaded: state !== undefined,
    month,
    show: month !== undefined && dismissed !== month,
    started: month !== undefined && started === month,
    start: () => useMonthSession.setState({ started: month }),
    later: () => useMonthSession.setState({ dismissed: month, started: undefined }),
  };
}

const DRAFT_PREFIX = 'life-rpg-month-draft:';
export const EMPTY_ANSWERS: MonthAnswers = { progress: '', obstacle: '', next: '' };

/** The answers typed so far for the month (survive "Fazer depois" and navigation). */
export function readMonthDraft(month: MonthKey): MonthAnswers {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DRAFT_PREFIX + month) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return EMPTY_ANSWERS;
    const p = parsed as Partial<Record<keyof MonthAnswers, unknown>>;
    const text = (v: unknown) => (typeof v === 'string' ? v : '');
    return { progress: text(p.progress), obstacle: text(p.obstacle), next: text(p.next) };
  } catch {
    return EMPTY_ANSWERS;
  }
}

/** Stores the draft (undefined removes it) and drops older months' drafts. */
export function writeMonthDraft(month: MonthKey, draft: MonthAnswers | undefined): void {
  try {
    const own = DRAFT_PREFIX + month;
    if (draft) localStorage.setItem(own, JSON.stringify(draft));
    else localStorage.removeItem(own);
    // Only older months' drafts are dropped; a newer month's partial draft must survive.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX) && k < own) localStorage.removeItem(k);
    }
  } catch { /* private mode / quota: the draft just stays in memory */ }
}
