import type { Card, DayKey, Deck, ID, Journey, Note, Review } from '@life/shared';
import { addDays, cardOrds } from '@life/shared';
import { db } from './db';

export interface StudyData { cards: Card[]; reviews: Review[]; decks: Deck[]; deckOrder: Map<ID, number>; journeys: Journey[] }

/**
 * Whether `card` is one of the cards `note` currently has: the note exists, is live, is not a
 * draft and still has the card's ord. Such orphans are left alone (the note may still be syncing).
 */
export function isCardOfNote(card: Pick<Card, 'ord'>, note: Note | undefined): note is Note {
  return !!note && !note.deleted && !note.draft && cardOrds(note).includes(card.ord);
}

/**
 * Study inputs: ACTIVE cards (live, not suspended, in a live unarchived deck, of a live complete
 * note that still has their ord), live reviews of the last 30 days, every live deck (archived
 * included, by order) and live journeys.
 */
export async function readStudyData(today: DayKey): Promise<StudyData> {
  const [decks, cards, notes, reviews, journeys] = await Promise.all([
    db.decks.toArray(),
    db.cards.toArray(),
    db.notes.toArray(),
    db.reviews.where('day').aboveOrEqual(addDays(today, -30)).toArray(),
    db.journeys.toArray(),
  ]);
  const liveDecks = decks.filter((d) => !d.deleted).sort((a, b) => a.order - b.order);
  const active = liveDecks.filter((d) => !d.archived);
  const activeIds = new Set(active.map((d) => d.id));
  const noteById = new Map(notes.map((n) => [n.id, n]));
  return {
    decks: liveDecks,
    deckOrder: new Map(active.map((d) => [d.id, d.order])),
    cards: cards.filter((c) => !c.deleted && !c.suspended && c.deckId !== undefined && activeIds.has(c.deckId)
      && isCardOfNote(c, noteById.get(c.noteId))),
    reviews: reviews.filter((r) => !r.deleted),
    journeys: journeys.filter((j) => !j.deleted),
  };
}
