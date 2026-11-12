import type { Card, DayKey, Deck, ID, Journey, Review } from '@life/shared';
import { addDays } from '@life/shared';
import { db } from './db';

export interface StudyData { cards: Card[]; reviews: Review[]; decks: Deck[]; deckOrder: Map<ID, number>; journeys: Journey[] }

/**
 * Study inputs: ACTIVE cards (live, not suspended, in a live unarchived deck), live reviews of
 * the last 30 days, every live deck (archived included, by order) and live journeys.
 */
export async function readStudyData(today: DayKey): Promise<StudyData> {
  const [decks, cards, reviews, journeys] = await Promise.all([
    db.decks.toArray(),
    db.cards.toArray(),
    db.reviews.where('day').aboveOrEqual(addDays(today, -30)).toArray(),
    db.journeys.toArray(),
  ]);
  const liveDecks = decks.filter((d) => !d.deleted).sort((a, b) => a.order - b.order);
  const active = liveDecks.filter((d) => !d.archived);
  const activeIds = new Set(active.map((d) => d.id));
  return {
    decks: liveDecks,
    deckOrder: new Map(active.map((d) => [d.id, d.order])),
    cards: cards.filter((c) => !c.deleted && !c.suspended && c.deckId !== undefined && activeIds.has(c.deckId)),
    reviews: reviews.filter((r) => !r.deleted),
    journeys: journeys.filter((j) => !j.deleted),
  };
}
