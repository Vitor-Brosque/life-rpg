import type { Block, Card, DayKey, DayMode, ID, Review, StudySettings } from './types';
import { addDays, dayKeyOf, weekdayOf } from './dates';
import { nextDayStart, retrievability } from './scheduler';
import { weekKey } from './weekStats';

// The day's study plan (spec §5): time budget, how many new cards fit, the reason, the session
// queue, and when the Agora shows the review card. Pure: the caller passes ACTIVE cards only.

export interface StudyInput {
  cards: Card[];
  reviews: Review[];
  deckOrder: Map<ID, number>;
  settings: StudySettings;
  mode: DayMode;
  today: DayKey;
  now: number;
  dayStartHour: number;
}

export interface StudyPlan {
  dueCount: number;
  newAllowed: number;
  newReason: string;
  todayMin: number;
  goalSec: number;
  forecast: Array<{ day: DayKey; min: number }>;
  doneSecToday: number;
  reviewsToday: number;
  goalMet: boolean;
  nothingLeft: boolean;
  secPerReview: number;
  newCost: number;
  topicCost: number;
}

export const GOAL_MIN_REVIEWS = 5;
const REVIEW_SAMPLE = 100;
const REVIEW_MIN_SAMPLES = 20;
const DEFAULT_SEC_REVIEW = 10;
const NEW_SAMPLE = 50;
const NEW_MIN_SAMPLES = 10;
const DEFAULT_NEW_COST = 30;
const TOPIC_SAMPLE = 30;
const TOPIC_MIN_SAMPLES = 5;
const DEFAULT_TOPIC_COST = 180;
const DONE_CAP_MS = 180_000;
const FORECAST_DAYS = 5;
const LEARN_AHEAD_MS = 20 * 60_000;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Median seconds of the last 100 reviews of learned non-topic cards (3–60 s); 10 s below 20 samples. */
export function secPerReviewOf(reviews: Review[]): number {
  const xs = reviews.filter((r) => r.before.state !== 'new' && !r.coverage).sort((a, b) => b.at - a.at)
    .slice(0, REVIEW_SAMPLE).map((r) => r.durationMs / 1000);
  return xs.length < REVIEW_MIN_SAMPLES ? DEFAULT_SEC_REVIEW : clamp(median(xs), 3, 60);
}

/** Median total seconds spent on a non-topic card on its first day, last 50 (10–180 s); 30 s below 10. */
export function newCostOf(reviews: Review[]): number {
  const firsts = reviews.filter((r) => r.before.state === 'new' && !r.coverage).sort((a, b) => b.at - a.at).slice(0, NEW_SAMPLE);
  if (firsts.length < NEW_MIN_SAMPLES) return DEFAULT_NEW_COST;
  const costs = firsts.map((f) => reviews
    .filter((r) => r.cardId === f.cardId && r.day === f.day)
    .reduce((s, r) => s + r.durationMs, 0) / 1000);
  return clamp(median(costs), 10, 180);
}

/** Median seconds of the last 30 topic reviews (those with coverage), 30–600 s; 180 s below 5 samples. */
export function topicCostOf(reviews: Review[]): number {
  const xs = reviews.filter((r) => r.coverage).sort((a, b) => b.at - a.at).slice(0, TOPIC_SAMPLE).map((r) => r.durationMs / 1000);
  return xs.length < TOPIC_MIN_SAMPLES ? DEFAULT_TOPIC_COST : clamp(median(xs), 30, 600);
}

type Costs = Pick<StudyPlan, 'secPerReview' | 'newCost' | 'topicCost'>;

/** Expected seconds for a card: topics have their own cost; a new card includes its first-day steps. */
export function cardCost(c: Pick<Card, 'state' | 'topic'>, costs: Costs): number {
  if (c.topic) return costs.topicCost;
  return c.state === 'new' ? costs.newCost : costs.secPerReview;
}

export function studyDaysAfter(today: DayKey, restDays: number[], n: number): DayKey[] {
  const rest = new Set(restDays);
  const out: DayKey[] = [];
  if (rest.size >= 7) return out;
  for (let d = addDays(today, 1); out.length < n; d = addDays(d, 1)) if (!rest.has(weekdayOf(d))) out.push(d);
  return out;
}

const newOrder = (deckOrder: Map<ID, number>) => (a: Card, b: Card): number =>
  (deckOrder.get(a.deckId ?? '') ?? 1e9) - (deckOrder.get(b.deckId ?? '') ?? 1e9)
  || a.createdAt - b.createdAt || a.ord - b.ord;

interface NewLimit { n: number; reason: string; sec: number }

/** Walks the new cards in queue order, adding each one's cost while every limit still holds. */
function allowNew(p: {
  mode: DayMode; maxNewPerDay: number; introducedToday: number; fresh: Card[]; goalSec: number;
  busySec: number; budgetSec: number; avgForecastSec: number; costs: Costs;
}): NewLimit {
  if (p.mode === 'low') return { n: 0, reason: 'dia de baixa energia: só revisões', sec: 0 };
  if (p.mode === 'recovery') return { n: 0, reason: 'dia de recuperação: só revisões', sec: 0 };
  if (p.fresh.length === 0) return { n: 0, reason: 'nenhum card novo esperando', sec: 0 };
  const cap = Math.max(0, p.maxNewPerDay - p.introducedToday);
  let busy = p.busySec;
  let week = p.avgForecastSec;
  let n = 0;
  const stop = (reason: string): NewLimit => ({ n, reason, sec: busy - p.busySec });
  for (const c of p.fresh) {
    if (n >= cap) return stop(`teto de ${p.maxNewPerDay} novos por dia`);
    const today = cardCost(c, p.costs);
    const later = (2 * (c.topic ? p.costs.topicCost : p.costs.secPerReview)) / FORECAST_DAYS;
    if (busy + today > p.goalSec) {
      return stop(p.busySec >= p.goalSec ? 'o orçamento de hoje já está ocupado pelas revisões' : 'o que cabe no orçamento de hoje');
    }
    if (week + later > p.budgetSec) return stop(`a próxima semana já prevê ~${Math.round(p.avgForecastSec / 60)} min/dia`);
    busy += today;
    week += later;
    n++;
  }
  return stop('todos os novos que estavam esperando');
}

export function studyPlan(input: StudyInput): StudyPlan {
  const { cards, reviews, settings, mode, today, dayStartHour } = input;
  const costs: Costs = { secPerReview: secPerReviewOf(reviews), newCost: newCostOf(reviews), topicCost: topicCostOf(reviews) };
  const sum = (cs: Card[]): number => cs.reduce((s, c) => s + cardCost(c, costs), 0);
  const end = nextDayStart(today, dayStartHour);
  const learned = cards.filter((c) => c.state !== 'new');
  const due = learned.filter((c) => c.due < end);
  const todayReviews = reviews.filter((r) => r.day === today);
  const doneSecToday = todayReviews.reduce((s, r) => s + Math.min(r.durationMs, DONE_CAP_MS), 0) / 1000;
  const budgetSec = settings.budgetMin * 60;
  const goalSec = mode === 'low' || mode === 'recovery' ? budgetSec / 2 : budgetSec;
  const forecast = studyDaysAfter(today, settings.restDays, FORECAST_DAYS).map((day) => ({
    day, min: sum(learned.filter((c) => dayKeyOf(c.due, dayStartHour) === day)) / 60,
  }));
  const avgForecastSec = forecast.length ? (forecast.reduce((s, f) => s + f.min, 0) * 60) / forecast.length : 0;
  const todayLoad = sum(due);
  const limit = allowNew({
    mode, maxNewPerDay: settings.maxNewPerDay,
    introducedToday: cards.filter((c) => c.introducedDay === today).length,
    fresh: cards.filter((c) => c.state === 'new').sort(newOrder(input.deckOrder)),
    goalSec, busySec: doneSecToday + todayLoad, budgetSec, avgForecastSec, costs,
  });
  const nothingLeft = due.length === 0 && limit.n === 0;
  return {
    dueCount: due.length, newAllowed: limit.n, newReason: limit.reason,
    todayMin: Math.ceil((todayLoad + limit.sec) / 60),
    goalSec, forecast, doneSecToday, reviewsToday: todayReviews.length,
    goalMet: todayReviews.length >= GOAL_MIN_REVIEWS && (doneSecToday >= goalSec || nothingLeft),
    nothingLeft, ...costs,
  };
}

/** Work left in `input`'s scope (e.g. one deck): due cards plus the first allowed new ones, in minutes. */
export function remainingOf(input: StudyInput, plan: StudyPlan): { count: number; minutes: number } {
  const end = nextDayStart(input.today, input.dayStartHour);
  const due = input.cards.filter((c) => c.state !== 'new' && c.due < end);
  const fresh = input.cards.filter((c) => c.state === 'new').sort(newOrder(input.deckOrder)).slice(0, plan.newAllowed);
  const sec = [...due, ...fresh].reduce((s, c) => s + cardCost(c, plan), 0);
  return { count: due.length + fresh.length, minutes: Math.ceil(sec / 60) };
}

/**
 * Next card of the session: (re)learning cards already due, then today's reviews (lowest
 * retrievability first), then allowed new cards, then (re)learning cards due within 20 min.
 */
export function pickNext(input: StudyInput, plan: StudyPlan): Card | undefined {
  const { cards, now } = input;
  const end = nextDayStart(input.today, input.dayStartHour);
  const learning = cards.filter((c) => c.state === 'learning' || c.state === 'relearning').sort((a, b) => a.due - b.due);
  const dueLearning = learning.find((c) => c.due <= now);
  if (dueLearning) return dueLearning;
  const reviews = cards.filter((c) => c.state === 'review' && c.due < end)
    .map((c) => ({ c, r: retrievability(c, now, input.settings.retention) }))
    .sort((a, b) => a.r - b.r || a.c.due - b.c.due);
  if (reviews[0]) return reviews[0].c;
  if (plan.newAllowed > 0) {
    const fresh = cards.filter((c) => c.state === 'new').sort(newOrder(input.deckOrder));
    if (fresh[0]) return fresh[0];
  }
  return learning.find((c) => c.due <= now + LEARN_AHEAD_MS);
}

/** When the earliest (re)learning card comes back (session end: "volta às 18:42"). */
export function nextLearningAt(cards: Card[]): number | undefined {
  const dues = cards.filter((c) => c.state === 'learning' || c.state === 'relearning').map((c) => c.due);
  return dues.length ? Math.min(...dues) : undefined;
}

export function blockHasReviews(b: Pick<Block, 'reviews' | 'kind'>): boolean {
  return b.reviews ?? b.kind === 'light';
}

export type ReviewPromptKind = 'card' | 'line';

/** The Agora's review card (inside a block with reviews) or discreet line (no block running). */
export function reviewPrompt(p: {
  plan?: StudyPlan; mode: DayMode; restDay: boolean; current?: { block: Pick<Block, 'reviews' | 'kind'> };
}): ReviewPromptKind | undefined {
  const { plan } = p;
  if (!plan || p.restDay || p.mode === 'recovery' || p.mode === 'free') return undefined;
  if (plan.goalMet || plan.nothingLeft) return undefined;
  if (p.current) return blockHasReviews(p.current.block) ? 'card' : undefined;
  return 'line';
}

export interface StudyObserved { accuracy30?: number; reviewsWeek: number; minutesWeek: number }

/** Observed numbers only (spec §6): accuracy on learned cards (30 days) and this week's work. */
export function studyObserved(reviews: Review[], today: DayKey): StudyObserved {
  const from30 = addDays(today, -29);
  const learned = reviews.filter((r) => r.day >= from30 && r.day <= today && r.before.state === 'review');
  const monday = weekKey(today);
  const week = reviews.filter((r) => r.day >= monday && r.day <= today);
  return {
    ...(learned.length ? { accuracy30: learned.filter((r) => r.rating > 1).length / learned.length } : {}),
    reviewsWeek: week.length,
    minutesWeek: Math.round(week.reduce((s, r) => s + Math.min(r.durationMs, DONE_CAP_MS), 0) / 60_000),
  };
}
