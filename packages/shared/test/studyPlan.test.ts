import { describe, expect, it } from 'vitest';
import type { Card, CardSchedule, Review, StudySettings } from '../src/types';
import { DEFAULT_STUDY } from '../src/types';
import { newSchedule } from '../src/scheduler';
import {
  blockHasReviews, newCostOf, nextLearningAt, pickNext, remainingOf, reviewPrompt, secPerReviewOf, studyDaysAfter,
  studyObserved, studyPlan, topicCostOf, type StudyInput,
} from '../src/studyPlan';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const NOW = at(12, 10); // Thursday
const TODAY = '2026-11-12';
const dueToday: Partial<CardSchedule> = { state: 'review', due: at(12, 4), stability: 5, difficulty: 5, reps: 3, scheduledDays: 3, lastReview: at(9, 10) };

let seq = 0;
const card = (over: Partial<Card> = {}): Card => ({
  id: `c${++seq}`, createdAt: seq, updatedAt: seq, deleted: false, noteId: `n${seq}`, deckId: 'd1', ord: 0,
  suspended: false, ...newSchedule(1), ...over,
});
const many = (n: number, over: Partial<Card> = {}) => Array.from({ length: n }, () => card(over));
const review = (over: Partial<Review> = {}): Review => ({
  id: `r${++seq}`, createdAt: 1, updatedAt: 1, deleted: false, cardId: `c${seq}`, noteId: 'n', at: at(11, 10) + seq,
  day: '2026-11-11', rating: 3, durationMs: 8000, wrote: false,
  before: { ...newSchedule(1), state: 'review' }, after: { ...newSchedule(1), state: 'review' }, ...over,
});
const input = (over: Partial<StudyInput> = {}, settings: Partial<StudySettings> = {}): StudyInput => ({
  cards: [], reviews: [], deckOrder: new Map([['d1', 0], ['d2', 1]]), settings: { ...DEFAULT_STUDY, ...settings },
  mode: 'normal', today: TODAY, now: NOW, dayStartHour: 4, ...over,
});

describe('costs', () => {
  it('defaults below the minimum number of samples', () => {
    expect(secPerReviewOf(Array.from({ length: 19 }, () => review()))).toBe(10);
    expect(newCostOf([])).toBe(30);
  });
  it('median clamped to 3–60 s', () => {
    expect(secPerReviewOf(Array.from({ length: 25 }, () => review({ durationMs: 2000 })))).toBe(3);
    expect(secPerReviewOf(Array.from({ length: 25 }, () => review({ durationMs: 120000 })))).toBe(60);
    expect(secPerReviewOf(Array.from({ length: 25 }, () => review({ durationMs: 12000 })))).toBe(12);
  });
  it('new cost = time spent on a card on its first day, median of the last 50', () => {
    const rs: Review[] = [];
    for (let i = 0; i < 12; i++) {
      const cardId = `nc${i}`;
      rs.push(review({ cardId, durationMs: 20000, before: newSchedule(1) }));
      rs.push(review({ cardId, durationMs: 10000 }), review({ cardId, durationMs: 10000 }));
    }
    expect(newCostOf(rs)).toBe(40);
  });
});

describe('topic costs', () => {
  it('topicCostOf: 180 s by default, median of topic reviews (30–600 s); topic reviews leave secPerReview alone', () => {
    const cov = { covered: 2, total: 3 };
    expect(topicCostOf(Array.from({ length: 4 }, () => review({ coverage: cov, durationMs: 240000 })))).toBe(180);
    expect(topicCostOf(Array.from({ length: 6 }, () => review({ coverage: cov, durationMs: 240000 })))).toBe(240);
    expect(secPerReviewOf(Array.from({ length: 25 }, () => review({ coverage: cov, durationMs: 240000 })))).toBe(10);
  });
  it('due topics weigh topicCost in the load; each new topic costs topicCost', () => {
    expect(studyPlan(input({ cards: [card({ ...dueToday, topic: true }), card(dueToday)] })).todayMin).toBe(Math.ceil((180 + 10) / 60));
    expect(studyPlan(input({ cards: many(6, { topic: true }) }))).toMatchObject({ newAllowed: 5, newReason: 'o que cabe no orçamento de hoje' });
  });
  it('remainingOf counts the scoped due cards and the first allowed new ones', () => {
    const cards = [card(dueToday), card({ ...dueToday, deckId: 'd2' }), ...many(3)];
    const i = input({ cards });
    const plan = studyPlan(i);
    expect(remainingOf(i, plan)).toEqual({ count: 5, minutes: Math.ceil((2 * 10 + 3 * 30) / 60) });
    expect(remainingOf({ ...i, cards: cards.filter((c) => c.deckId === 'd2') }, plan)).toEqual({ count: 1, minutes: 1 });
  });
});

describe('studyDaysAfter', () => {
  it('skips rest days', () => {
    expect(studyDaysAfter(TODAY, [0, 6], 5)).toEqual(['2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']);
    expect(studyDaysAfter(TODAY, [0, 1, 2, 3, 4, 5, 6], 5)).toEqual([]);
  });
});

describe('studyPlan — new cards and their reason', () => {
  it('daily cap', () => {
    const p = studyPlan(input({ cards: many(30) }));
    expect(p).toMatchObject({ newAllowed: 10, newReason: 'teto de 10 novos por dia', dueCount: 0 });
  });
  it('cap already used today', () => {
    const p = studyPlan(input({ cards: [...many(10, { state: 'review', due: at(20, 4), introducedDay: TODAY, scheduledDays: 8 }), ...many(5)] }));
    expect(p).toMatchObject({ newAllowed: 0, newReason: 'teto de 10 novos por dia' });
  });
  it("today's budget", () => {
    expect(studyPlan(input({ cards: [...many(80, dueToday), ...many(20)] }))).toMatchObject({ newAllowed: 3, newReason: 'o que cabe no orçamento de hoje' });
    expect(studyPlan(input({ cards: [...many(100, dueToday), ...many(20)] }))).toMatchObject({ newAllowed: 0, newReason: 'o orçamento de hoje já está ocupado pelas revisões' });
  });
  it("next week's forecast", () => {
    const days = studyDaysAfter(TODAY, [0, 6], 5);
    const week = days.flatMap((d) => many(88, { state: 'review', due: new Date(`${d}T04:00:00`).getTime(), scheduledDays: 5 }));
    const p = studyPlan(input({ cards: [...week, ...many(20)] }));
    expect(p).toMatchObject({ newAllowed: 5, newReason: 'a próxima semana já prevê ~15 min/dia' });
    expect(p.forecast.map((f) => Math.round(f.min))).toEqual([15, 15, 15, 15, 15]);
  });
  it('fewer waiting than allowed / none waiting', () => {
    expect(studyPlan(input({ cards: many(3) }))).toMatchObject({ newAllowed: 3, newReason: 'todos os novos que estavam esperando' });
    expect(studyPlan(input({ cards: many(2, dueToday) }))).toMatchObject({ newAllowed: 0, newReason: 'nenhum card novo esperando' });
  });
  it('low energy and recovery: half the goal, no new cards', () => {
    expect(studyPlan(input({ cards: many(5), mode: 'low' }))).toMatchObject({ goalSec: 450, newAllowed: 0, newReason: 'dia de baixa energia: só revisões' });
    expect(studyPlan(input({ cards: many(5), mode: 'recovery' }))).toMatchObject({ goalSec: 450, newAllowed: 0, newReason: 'dia de recuperação: só revisões' });
    expect(studyPlan(input({ mode: 'free' })).goalSec).toBe(900);
  });
});

describe('studyPlan — today', () => {
  it('counts due learned cards (overdue and learning later today), not tomorrow', () => {
    const cards = [card(dueToday), card({ ...dueToday, due: at(5, 4) }), card({ state: 'learning', due: at(12, 23, 30) }), card({ ...dueToday, due: at(13, 4) })];
    const p = studyPlan(input({ cards }));
    expect(p.dueCount).toBe(3);
    expect(p.todayMin).toBe(Math.ceil((3 * 10) / 60));
  });
  it('goalMet by time (each review counted up to 3 min) or by nothing left, with 5 reviews', () => {
    const today = (ms: number) => review({ day: TODAY, durationMs: ms });
    const byTime = studyPlan(input({ cards: many(10, dueToday), reviews: Array.from({ length: 5 }, () => today(600000)) }));
    expect(byTime.doneSecToday).toBe(900);
    expect(byTime.goalMet).toBe(true);
    expect(studyPlan(input({ cards: many(10, dueToday), reviews: Array.from({ length: 4 }, () => today(600000)) })).goalMet).toBe(false);
    const empty = studyPlan(input({ reviews: Array.from({ length: 5 }, () => today(8000)) }));
    expect(empty).toMatchObject({ nothingLeft: true, goalMet: true, reviewsToday: 5 });
    expect(studyPlan(input({ reviews: [today(8000)] }))).toMatchObject({ nothingLeft: true, goalMet: false });
  });
  it('topic reviews (with coverage) count up to 10 min each, others up to 3 min', () => {
    const cov = { covered: 2, total: 3 };
    const topic = (ms: number) => review({ day: TODAY, durationMs: ms, coverage: cov });
    const five = studyPlan(input({ cards: many(10, dueToday), reviews: Array.from({ length: 5 }, () => topic(180000)) }));
    expect(five).toMatchObject({ doneSecToday: 900, goalMet: true });
    expect(studyPlan(input({ reviews: [topic(600000)] })).doneSecToday).toBe(600);
    expect(studyPlan(input({ reviews: [review({ day: TODAY, durationMs: 600000 })] })).doneSecToday).toBe(180);
    expect(studyObserved([topic(600000), review({ day: TODAY, durationMs: 600000 })], TODAY).minutesWeek).toBe(13);
  });
});

describe('pickNext', () => {
  it('learning due now, then reviews by risk, then new by deck order and age', () => {
    const fragile = card({ ...dueToday, stability: 1, lastReview: at(1, 10) });
    const solid = card({ ...dueToday, stability: 50, lastReview: at(11, 10) });
    const learning = card({ state: 'learning', due: NOW - 1000 });
    const newD2 = card({ deckId: 'd2', createdAt: 1 });
    const newD1 = card({ deckId: 'd1', createdAt: 5 });
    const cards = [solid, newD2, fragile, newD1, learning];
    const i = input({ cards });
    const plan = studyPlan(i);
    expect(pickNext(i, plan)!.id).toBe(learning.id);
    const i2 = input({ cards: cards.filter((c) => c !== learning) });
    expect(pickNext(i2, studyPlan(i2))!.id).toBe(fragile.id);
    const i3 = input({ cards: [newD2, newD1] });
    expect(pickNext(i3, studyPlan(i3))!.id).toBe(newD1.id);
  });
  it('no new card when none is allowed; learns ahead up to 20 min', () => {
    const fresh = card();
    const i = input({ cards: [fresh], mode: 'low' });
    expect(pickNext(i, studyPlan(i))).toBeUndefined();
    const soon = card({ state: 'learning', due: NOW + 15 * 60_000 });
    const late = card({ state: 'learning', due: NOW + 30 * 60_000 });
    expect(pickNext(input({ cards: [soon] }), studyPlan(input({ cards: [soon] })))!.id).toBe(soon.id);
    expect(pickNext(input({ cards: [late] }), studyPlan(input({ cards: [late] })))).toBeUndefined();
    expect(nextLearningAt([late, card(dueToday)])).toBe(NOW + 30 * 60_000);
    expect(nextLearningAt([card(dueToday)])).toBeUndefined();
  });
});

describe('reviewPrompt', () => {
  const plan = studyPlan(input({ cards: many(3, dueToday) }));
  const light = { block: { kind: 'light' as const } };
  const focus = { block: { kind: 'focus' as const } };
  it('a card in a block with reviews, a line outside blocks', () => {
    expect(reviewPrompt({ plan, mode: 'normal', restDay: false, current: light })).toBe('card');
    expect(reviewPrompt({ plan, mode: 'low', restDay: false })).toBe('line');
    expect(reviewPrompt({ plan, mode: 'normal', restDay: false, current: focus })).toBeUndefined();
    expect(reviewPrompt({ plan, mode: 'normal', restDay: false, current: { block: { kind: 'focus', reviews: true } } })).toBe('card');
    expect(reviewPrompt({ plan, mode: 'normal', restDay: false, current: { block: { kind: 'light', reviews: false } } })).toBeUndefined();
  });
  it('nothing on recovery, free or rest days, after the goal or with nothing left', () => {
    expect(reviewPrompt({ plan, mode: 'recovery', restDay: false })).toBeUndefined();
    expect(reviewPrompt({ plan, mode: 'free', restDay: false })).toBeUndefined();
    expect(reviewPrompt({ plan, mode: 'normal', restDay: true })).toBeUndefined();
    expect(reviewPrompt({ plan: { ...plan, goalMet: true }, mode: 'normal', restDay: false })).toBeUndefined();
    expect(reviewPrompt({ plan: { ...plan, nothingLeft: true }, mode: 'normal', restDay: false })).toBeUndefined();
    expect(reviewPrompt({ mode: 'normal', restDay: false })).toBeUndefined();
  });
  it('blockHasReviews defaults to light blocks', () => {
    expect(blockHasReviews({ kind: 'light' })).toBe(true);
    expect(blockHasReviews({ kind: 'study' })).toBe(false);
  });
});

describe('studyObserved', () => {
  it('accuracy on learned cards over 30 days, reviews and minutes this week (Mon–)', () => {
    const rs = [
      review({ day: '2026-11-10', rating: 1, durationMs: 60000 }),
      review({ day: '2026-11-11', rating: 3, durationMs: 60000 }),
      review({ day: '2026-11-12', rating: 4, durationMs: 60000 }),
      review({ day: '2026-11-06', rating: 3, before: newSchedule(1) }),
      review({ day: '2026-10-01', rating: 1 }),
    ];
    expect(studyObserved(rs, TODAY)).toEqual({ accuracy30: 2 / 3, reviewsWeek: 3, minutesWeek: 3 });
    expect(studyObserved([], TODAY)).toEqual({ reviewsWeek: 0, minutesWeek: 0 });
  });
});
