import { describe, expect, it } from 'vitest';
import type { Card, Deck, Journey, Mission, Note } from '../src/types';
import { subjectsOf, type SubjectsData } from '../src/subjects';
import { TODAY, base, practice, review } from './patternFixture';
import { timestampAt } from '../src/dates';

const SCHED = { due: 0, stability: 1, difficulty: 5, reps: 1, lapses: 0, learningSteps: 0, scheduledDays: 1 };
const journey = (id: string, order: number, p: Partial<Journey> = {}): Journey => ({ ...base, id, title: id, status: 'active', order, ...p });
const deck = (id: string, order: number, p: Partial<Deck> = {}): Deck => ({ ...base, id, name: id, order, archived: false, ...p });
const card = (id: string, deckId: string, state: Card['state'] = 'review', p: Partial<Card> = {}): Card => ({
  ...base, id, noteId: `n-${id}`, deckId, ord: 0, suspended: false, ...SCHED, state, ...p,
});
const topic = (id: string, deckId: string, p: Partial<Note> = {}): Note => ({
  ...base, id, deckId, type: 'topic', front: id, back: 'a', draft: false, ...p,
});
const mission = (id: string, journeyId: string, p: Partial<Mission> = {}): Mission => ({
  ...base, id, title: id, checklist: [], status: 'open', important: false, shrunk: false, postponeCount: 0, journeyId, ...p,
});
const data = (p: Partial<SubjectsData> = {}): SubjectsData => ({
  dayStartHour: 4, journeys: [], decks: [], cards: [], notes: [], reviews: [], practice: [], missions: [], ...p,
});
const rv = (deckId: string, day: string, rating: 1 | 2 | 3 | 4, p = {}, state: 'new' | 'review' = 'review') =>
  review(day, rating, { deckId, ...p }, state);

describe('subjectsOf', () => {
  it('journey with two decks sums cards; suspended and deleted do not count; journeys keep order, loose decks last', () => {
    const subs = subjectsOf(data({
      journeys: [journey('j2', 2), journey('j1', 1), journey('j-vazia', 3), journey('j-feita', 4, { status: 'done' })],
      decks: [deck('d1', 0, { journeyId: 'j1' }), deck('d2', 1, { journeyId: 'j1' }), deck('solto', 2), deck('d-feita', 3, { journeyId: 'j-feita' })],
      cards: [
        card('c1', 'd1'), card('c2', 'd1', 'new'), card('c3', 'd2', 'learning'), card('c4', 'd2'),
        card('c5', 'd2', 'review', { suspended: true }), card('c6', 'd2', 'review', { deleted: true }),
        card('c7', 'solto', 'relearning'), card('c8', 'solto'),
      ],
    }), TODAY);
    expect(subs.map((s) => s.id)).toEqual(['j1', 'solto']);
    expect(subs[0]).toMatchObject({ kind: 'journey', title: 'j1', deckIds: ['d1', 'd2'], cards: 4, learned: 2 });
    expect(subs[1]).toMatchObject({ kind: 'deck', title: 'solto', deckIds: ['solto'], cards: 2, learned: 1 });
  });

  it('a journey with only a practice session is a subject; a journey with nothing is not', () => {
    const subs = subjectsOf(data({
      journeys: [journey('j1', 1), journey('j2', 2)],
      practice: [practice({ journeyId: 'j1', status: 'open' })],
    }), TODAY);
    expect(subs.map((s) => s.id)).toEqual(['j1']);
    expect(subs[0]).toMatchObject({ cards: 0, learned: 0, deckIds: [] });
  });

  it('practice: ended in the last 30 days, and how many with Autônomo = Sim', () => {
    const at = (day: string) => timestampAt(day, '20:00');
    const subs = subjectsOf(data({
      journeys: [journey('j1', 1)],
      practice: [
        practice({ journeyId: 'j1', endedAt: at('2026-11-10'), ratings: { autonomous: 2 } }),
        practice({ journeyId: 'j1', endedAt: at('2026-10-15'), ratings: { autonomous: 1 } }),
        practice({ journeyId: 'j1', endedAt: at('2026-09-01'), ratings: { autonomous: 2 } }),   // older than 30 days
        practice({ journeyId: 'j1', status: 'open' }),
        practice({ journeyId: 'j1', endedAt: at('2026-11-11'), ratings: { autonomous: 2 }, deleted: true }),
        practice({ journeyId: 'outra', endedAt: at('2026-11-11'), ratings: { autonomous: 2 } }),
      ],
    }), TODAY);
    expect(subs[0]!.practice).toEqual({ sessions: 2, autonomous: 1 });
  });

  it('recall appears only with 20+ reviews of learned cards in 30 days', () => {
    const base20 = (n: number) => Array.from({ length: n }, (_, i) => rv('d1', '2026-11-05', i < 5 ? 1 : 3));
    const mk = (reviews: ReturnType<typeof rv>[]) => subjectsOf(data({
      journeys: [journey('j1', 1)], decks: [deck('d1', 0, { journeyId: 'j1' })], cards: [card('c1', 'd1')], reviews,
    }), TODAY)[0]!;
    expect(mk(base20(19)).recall).toBeUndefined();
    expect(mk(base20(20)).recall).toBeCloseTo(0.75);
    // new-card reviews, old reviews and other decks' reviews are not counted
    const noisy = [...base20(19), rv('d1', '2026-11-05', 3, {}, 'new'), rv('d1', '2026-10-01', 3), rv('outro', '2026-11-05', 3)];
    expect(mk(noisy).recall).toBeUndefined();
  });

  it('minutes in the week count the week-so-far reviews of its decks only', () => {
    // Friday 2026-11-13; the week starts Monday 2026-11-09
    const s = subjectsOf(data({
      journeys: [journey('j1', 1)], decks: [deck('d1', 0, { journeyId: 'j1' }), deck('d2', 1)],
      cards: [card('c1', 'd1'), card('c2', 'd2')],
      reviews: [
        rv('d1', '2026-11-13', 3, { durationMs: 60_000 }), rv('d1', '2026-11-09', 3, { durationMs: 120_000 }),
        rv('d1', '2026-11-08', 3, { durationMs: 600_000 }), rv('d2', '2026-11-13', 3, { durationMs: 600_000 }),
      ],
    }), TODAY);
    expect(s[0]!.minutesWeek).toBe(3);
    expect(s[1]!.minutesWeek).toBe(3);   // capped at 3 min per review, like the Estudo
  });

  it('topics: live, non-draft topic notes in its decks', () => {
    const s = subjectsOf(data({
      journeys: [journey('j1', 1)], decks: [deck('d1', 0, { journeyId: 'j1' })],
      notes: [topic('t1', 'd1'), topic('t2', 'd1'), topic('t3', 'd1', { deleted: true }), topic('t4', 'd1', { draft: true }),
        topic('t5', 'd1', { type: 'basic' }), topic('t6', 'outro')],
    }), TODAY);
    expect(s[0]!.topics).toBe(2);
  });

  it('nextDeadline is the nearest open mission deadline from today on', () => {
    const s = subjectsOf(data({
      journeys: [journey('j1', 1), journey('j2', 2)], decks: [deck('d1', 0, { journeyId: 'j1' }), deck('d2', 1, { journeyId: 'j2' })],
      missions: [
        mission('longe', 'j1', { deadline: '2026-12-20' }), mission('perto', 'j1', { deadline: '2026-11-20' }),
        mission('passou', 'j1', { deadline: '2026-11-01' }), mission('feita', 'j1', { deadline: '2026-11-14', status: 'done' }),
        mission('apagada', 'j1', { deadline: '2026-11-15', deleted: true }), mission('hoje-j2', 'j2', { deadline: TODAY }),
      ],
    }), TODAY);
    expect(s[0]!.nextDeadline).toEqual({ title: 'perto', day: '2026-11-20' });
    expect(s[1]!.nextDeadline).toEqual({ title: 'hoje-j2', day: TODAY });
  });

  it('no deadline: absent', () => {
    const s = subjectsOf(data({ decks: [deck('solto', 0)] }), TODAY);
    expect(s[0]!.nextDeadline).toBeUndefined();
  });
});
