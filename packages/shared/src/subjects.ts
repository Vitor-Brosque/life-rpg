import { addDays, dayKeyOf } from './dates';
import { studyObserved } from './studyPlan';
import type { Card, DayKey, Deck, ID, Journey, Mission, Note, PracticeSession, Review } from './types';

/** Reviews of learned cards needed before the recall percentage shows up. */
export const SUBJECT_RECALL_MIN = 20;

/** What the Matérias screen reads (soft-deleted records are filtered here). */
export interface SubjectsData {
  dayStartHour: number;
  journeys: Journey[];
  decks: Deck[];
  cards: Card[];
  notes: Note[];
  reviews: Review[];
  practice: PracticeSession[];
  missions: Mission[];
}

/** A subject: an active journey with decks or practice, or a deck without journey. All numbers are observed. */
export interface Subject {
  id: ID;                       // journey id, or deck id for a loose deck
  kind: 'journey' | 'deck';
  title: string;
  deckIds: ID[];                // active (not archived) decks
  cards: number;                // live, not suspended
  learned: number;              // of those, out of new/learning (review state)
  recall?: number;              // 30 days, learned cards, rating > 1; only with 20+ reviews
  minutesWeek: number;
  topics: number;
  practice: { sessions: number; autonomous: number };   // ended in the last 30 days; autonomous = Sim
  nextDeadline?: { title: string; day: DayKey };
}

/** Subjects in order: journeys by their order, then loose decks by theirs. */
export function subjectsOf(data: SubjectsData, today: DayKey): Subject[] {
  const from30 = addDays(today, -29);
  const decks = data.decks.filter((d) => !d.deleted && !d.archived).sort((a, b) => a.order - b.order);
  const journeys = data.journeys.filter((j) => !j.deleted && j.status === 'active').sort((a, b) => a.order - b.order);
  const practice = data.practice.filter((p) => !p.deleted);
  const missions = data.missions.filter((m) => !m.deleted && (m.status === 'open' || m.status === 'doing'));
  const deckOfCard = new Map(data.cards.map((c) => [c.id, c.deckId]));

  const build = (id: ID, kind: Subject['kind'], title: string, own: Deck[], sessions: PracticeSession[], ms: Mission[]): Subject => {
    const ids = new Set(own.map((d) => d.id));
    const cards = data.cards.filter((c) => !c.deleted && !c.suspended && c.deckId !== undefined && ids.has(c.deckId));
    const reviews = data.reviews.filter((r) => {
      if (r.deleted) return false;
      const deckId = r.deckId ?? deckOfCard.get(r.cardId);
      return deckId !== undefined && ids.has(deckId);
    });
    const recent = reviews.filter((r) => r.day >= from30 && r.day <= today && r.before.state === 'review');
    const ended = sessions.filter((p) => p.status === 'done' && p.endedAt !== undefined
      && dayKeyOf(p.endedAt, data.dayStartHour) >= from30 && dayKeyOf(p.endedAt, data.dayStartHour) <= today);
    const next = ms.filter((m) => m.deadline !== undefined && m.deadline >= today)
      .sort((a, b) => a.deadline!.localeCompare(b.deadline!))[0];
    return {
      id, kind, title, deckIds: own.map((d) => d.id),
      cards: cards.length,
      learned: cards.filter((c) => c.state === 'review').length,
      ...(recent.length >= SUBJECT_RECALL_MIN ? { recall: recent.filter((r) => r.rating > 1).length / recent.length } : {}),
      minutesWeek: studyObserved(reviews, today).minutesWeek,
      topics: data.notes.filter((n) => !n.deleted && !n.draft && n.type === 'topic' && n.deckId !== undefined && ids.has(n.deckId)).length,
      practice: { sessions: ended.length, autonomous: ended.filter((p) => p.ratings.autonomous === 2).length },
      ...(next ? { nextDeadline: { title: next.title, day: next.deadline! } } : {}),
    };
  };

  const out: Subject[] = [];
  for (const j of journeys) {
    const own = decks.filter((d) => d.journeyId === j.id);
    const sessions = practice.filter((p) => p.journeyId === j.id);
    if (own.length === 0 && sessions.length === 0) continue;
    out.push(build(j.id, 'journey', j.title, own, sessions, missions.filter((m) => m.journeyId === j.id)));
  }
  const journeyIds = new Set(data.journeys.filter((j) => !j.deleted).map((j) => j.id));
  for (const d of decks) {
    if (d.journeyId && journeyIds.has(d.journeyId)) continue;   // belongs to a journey (shown there, or not at all once it is done)
    out.push(build(d.id, 'deck', d.name, [d], practice.filter((p) => p.deckId === d.id && !p.journeyId), []));
  }
  return out;
}
