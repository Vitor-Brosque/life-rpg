import type {
  Card, CodeLang, Deck, ID, Journey, Note, NoteErrors, NoteSource, NoteType, Rating, Review, Settings, StudySettings, XpEvent,
} from '@life/shared';
import {
  GOAL_MIN_REVIEWS, STUDY_GOAL_XP, STUDY_START_XP, dayKeyOf, defaultDayMode, newSchedule, normalizeNote, rate,
  scheduleOf, studyPlan, studySettingsOf, syncNoteCards, validateNote,
} from '@life/shared';
import { db } from '../db/db';
import { newRecord, patch, patchMany, put, putAll, softDelete } from '../db/repo';
import { readStudyData } from '../db/studyData';
import { hasLiveXp, withLock } from './common';
import { matchJourney } from './routineDefaults';

// Spaced repetition actions (spec §6, §8). A rating writes card + review + XP in one transaction.

const STUDY_AREA = 'area-intelecto';
const MAX_DURATION_MS = 300_000;
const MAX_TOPIC_DURATION_MS = 600_000;

/** The longest duration a review keeps: 10 min for topics, 5 min otherwise (a forgotten open screen). */
export const maxDurationMs = (card: Pick<Card, 'topic'>): number => (card.topic ? MAX_TOPIC_DURATION_MS : MAX_DURATION_MS);
const live = <T extends { deleted: boolean }>(xs: T[]): T[] => xs.filter((x) => !x.deleted);

// ------------------------------------------------------------------ decks

export async function saveDeck(input: { id?: ID; name: string; journeyId?: ID; areaId?: ID; speechLang?: string }): Promise<Deck> {
  const name = input.name.trim();
  if (!name) throw new Error('A deck needs a name');
  const speechLang = input.speechLang || undefined;
  if (input.id) return patch<Deck>('decks', input.id, { name, journeyId: input.journeyId, areaId: input.areaId, speechLang });
  const order = Math.max(-1, ...live(await db.decks.toArray()).map((d) => d.order)) + 1;
  return put('decks', newRecord<Deck>({
    name, order, archived: false,
    ...(input.journeyId ? { journeyId: input.journeyId } : {}),
    ...(input.areaId ? { areaId: input.areaId } : {}),
    ...(speechLang ? { speechLang } : {}),
  }));
}

/** A subject's own deck without creating one: its first active deck (lowest order), if any. */
export async function findSubjectDeck(journeyId: ID): Promise<Deck | undefined> {
  return live(await db.decks.toArray()).filter((d) => !d.archived && d.journeyId === journeyId).sort((a, b) => a.order - b.order)[0];
}

/** The subject's deck: its first active deck, else a new one with the subject's name (proposals, PDFs da aula). */
export async function subjectDeck(subject: Pick<Journey, 'id' | 'title'>): Promise<Deck> {
  return (await findSubjectDeck(subject.id)) ?? saveDeck({ name: subject.title, journeyId: subject.id });
}

export async function setDeckArchived(id: ID, archived: boolean): Promise<void> {
  await patch<Deck>('decks', id, { archived });
}

/** Soft-deletes an empty deck; false (nothing done) while it still has notes. */
export async function deleteDeck(id: ID): Promise<boolean> {
  if (live(await db.notes.where('deckId').equals(id).toArray()).length > 0) return false;
  await softDelete('decks', id);
  return true;
}

export async function restoreDeck(id: ID): Promise<void> {
  await patch<Deck>('decks', id, { deleted: false });
}

// ------------------------------------------------------------------ notes

export interface NoteInput {
  id?: ID; deckId?: ID; type: NoteType; front: string; back: string; extra?: string; language?: CodeLang; draft?: boolean;
  /** A new note made from a PDF page (PDFs da aula); an edited note keeps the source it has. */
  source?: NoteSource;
}

export class NoteValidationError extends Error {
  constructor(public errors: NoteErrors) { super('Invalid note'); }
}

/** Validates, normalises (cloze numbering) and saves the note with its cards in one transaction. */
export async function saveNote(input: NoteInput): Promise<Note> {
  const draft = input.draft ?? false;
  const errors = validateNote({ type: input.type, front: input.front, back: input.back, deckId: input.deckId, draft });
  if (Object.keys(errors).length) throw new NoteValidationError(errors);
  const fields = normalizeNote({ type: input.type, front: input.front, back: input.back, extra: input.extra });
  const prev = input.id ? await db.notes.get(input.id) : undefined;
  const base = prev ?? newRecord<Note>({ type: input.type, front: '', back: '', draft });
  const note: Note = {
    ...base, ...fields, type: input.type, deckId: input.deckId, draft, deleted: false,
    language: input.type === 'code' ? (input.language ?? 'python') : undefined,
    ...(!prev && input.source ? { source: { fileId: input.source.fileId, page: input.source.page } } : {}),
  };
  const { create, remove, update } = syncNoteCards(note, await db.cards.where('noteId').equals(note.id).toArray(), Date.now());
  await putAll([
    { table: 'notes', record: note },
    ...[...create, ...remove, ...update].map((record) => ({ table: 'cards' as const, record })),
  ]);
  return (await db.notes.get(note.id))!;
}

/** Soft-deletes the note and its live cards; returns the card ids (for "Desfazer"). */
export async function deleteNote(id: ID): Promise<ID[]> {
  const note = await db.notes.get(id);
  if (!note || note.deleted) return [];
  const cards = live(await db.cards.where('noteId').equals(id).toArray());
  await putAll([
    { table: 'notes', record: { ...note, deleted: true } },
    ...cards.map((c) => ({ table: 'cards' as const, record: { ...c, deleted: true } })),
  ]);
  return cards.map((c) => c.id);
}

export async function restoreNote(id: ID, cardIds: ID[]): Promise<void> {
  const note = await db.notes.get(id);
  if (!note) return;
  const cards = (await db.cards.bulkGet(cardIds)).filter((c): c is Card => !!c);
  await putAll([
    { table: 'notes', record: { ...note, deleted: false } },
    ...cards.map((c) => ({ table: 'cards' as const, record: { ...c, deleted: false } })),
  ]);
}

export async function setNoteSuspended(noteId: ID, suspended: boolean): Promise<void> {
  const cards = live(await db.cards.where('noteId').equals(noteId).toArray());
  await patchMany<Card>('cards', cards.map((c) => ({ id: c.id, changes: { suspended } })));
}

export async function setCardSuspended(id: ID, suspended: boolean): Promise<void> {
  await patch<Card>('cards', id, { suspended });
}

/** "Reiniciar progresso": every live card of the note back to new (history stays in reviews). */
export async function resetNote(noteId: ID): Promise<void> {
  const now = Date.now();
  const cards = live(await db.cards.where('noteId').equals(noteId).toArray());
  await putAll(cards.map((c) => {
    const reset: Card = { ...c, ...newSchedule(now) };
    delete reset.lastReview;
    delete reset.introducedDay;
    return { table: 'cards' as const, record: reset };
  }));
}

// ------------------------------------------------------------------ capture ("? ")

export const isCardCapture = (line: string): boolean => /^\s*\?\s+\S/.test(line);

/** "? pergunta #jornada": a basic draft in the first active deck of that journey, else the inbox. */
export async function captureCardDraft(line: string): Promise<Note | undefined> {
  let text = line.replace(/^\s*\?\s*/, '');
  let deckId: ID | undefined;
  const tag = /(^|\s)#([^\s#]+)/.exec(text);
  if (tag) {
    const journey = matchJourney(await db.journeys.toArray(), tag[2]!);
    const deck = journey
      ? live(await db.decks.toArray()).filter((d) => !d.archived && d.journeyId === journey.id).sort((a, b) => a.order - b.order)[0]
      : undefined;
    if (deck) {
      deckId = deck.id;
      text = text.slice(0, tag.index) + text.slice(tag.index + tag[0].length);
    }
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return saveNote({ type: 'basic', front: text, back: '', draft: true, ...(deckId ? { deckId } : {}) });
}

// ------------------------------------------------------------------ reviews

export interface RateResult { reviewId: ID; xp: number; goalReached: boolean }
export interface RateOpts {
  durationMs: number;
  wrote: boolean;
  coverage?: { covered: number; total: number };
  /** "Desenhar antes": at least one stroke when the answer was revealed. */
  drew?: boolean;
  /** "Responder falando": a recording existed when the answer was revealed. */
  spoke?: boolean;
  /** When the answer was revealed: FSRS schedules from it, so the saved interval is the one shown. */
  now?: number;
}

export const rateCard = (cardId: ID, rating: Rating, opts: RateOpts): Promise<RateResult> =>
  withLock('study', () => rateLocked(cardId, rating, opts));

/** Area of the deck with the most reviews today (deck area → journey area → Estudo). */
function xpArea(todayReviews: Review[], decks: Deck[], journeys: Journey[]): ID {
  const counts = new Map<ID, number>();
  for (const r of todayReviews) if (r.deckId) counts.set(r.deckId, (counts.get(r.deckId) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const deck = decks.find((d) => d.id === top);
  return deck?.areaId ?? journeys.find((j) => j.id === deck?.journeyId)?.areaId ?? STUDY_AREA;
}

async function rateLocked(cardId: ID, rating: Rating, opts: RateOpts): Promise<RateResult> {
  const card = await db.cards.get(cardId);
  if (!card || card.deleted) throw new Error(`Card ${cardId} not found`);
  const settings: Settings | undefined = await db.settings.get('settings');
  const dayStartHour = settings?.dayStartHour ?? 4;
  const study = studySettingsOf(settings);
  const now = Date.now();
  const today = dayKeyOf(now, dayStartHour);
  const before = scheduleOf(card);
  const after = rate(before, rating, opts.now ?? now, {
    dayStartHour, restDays: study.restDays, retention: study.retention, shortTerm: !card.topic,
  });
  const review = newRecord<Review>({
    cardId, noteId: card.noteId, ...(card.deckId ? { deckId: card.deckId } : {}), at: now, day: today, rating,
    durationMs: Math.max(0, Math.min(maxDurationMs(card), Math.round(opts.durationMs))), wrote: opts.wrote, before, after,
    ...(opts.coverage ? { coverage: opts.coverage } : {}),
    ...(opts.drew ? { drew: true } : {}),
    ...(opts.spoke ? { spoke: true } : {}),
  });
  const next: Card = { ...card, ...after, ...(card.introducedDay || before.state !== 'new' ? {} : { introducedDay: today }) };

  const data = await readStudyData(today);
  const dayState = await db.dayState.get(today);
  const reviews = [...data.reviews, review];
  const plan = studyPlan({
    cards: data.cards.map((c) => (c.id === cardId ? next : c)), reviews, deckOrder: data.deckOrder, settings: study,
    mode: defaultDayMode(today, dayState && !dayState.deleted ? dayState : undefined), today, now, dayStartHour,
  });
  const areaId = xpArea(reviews.filter((r) => r.day === today), data.decks, data.journeys);
  const xp: XpEvent[] = [];
  const award = (id: string, amount: number): void => {
    xp.push(newRecord<XpEvent>({ id, at: now, amount, reason: 'study', dayKey: today, areaId }));
  };
  const startId = `xp-study-start-${today}`;
  const goalId = `xp-study-goal-${today}`;
  if (plan.reviewsToday >= GOAL_MIN_REVIEWS && !(await hasLiveXp(startId))) award(startId, STUDY_START_XP);
  const goalReached = plan.goalMet && !(await hasLiveXp(goalId));
  if (goalReached) award(goalId, STUDY_GOAL_XP);

  await putAll([
    { table: 'cards', record: next },
    { table: 'reviews', record: review },
    ...xp.map((record) => ({ table: 'xpEvents' as const, record })),
  ]);
  return { reviewId: review.id, xp: xp.reduce((s, x) => s + x.amount, 0), goalReached };
}

/**
 * Undoes a rating: the review is soft-deleted and the card goes back to the review's `before` —
 * only while the card is still at that review's result (else it moved on: it stays). XP stays.
 */
export const undoRating = (reviewId: ID): Promise<void> => withLock('study', async () => {
  const review = await db.reviews.get(reviewId);
  if (!review || review.deleted) return;
  const card = await db.cards.get(review.cardId);
  if (!card) return;
  if (card.reps !== review.after.reps || card.lastReview !== review.after.lastReview) {
    await put('reviews', { ...review, deleted: true });
    return;
  }
  const restored: Card = { ...card, ...review.before };
  if (review.before.lastReview === undefined) delete restored.lastReview;
  if (review.before.state === 'new') delete restored.introducedDay;
  await putAll([
    { table: 'cards', record: restored },
    { table: 'reviews', record: { ...review, deleted: true } },
  ]);
});

// ------------------------------------------------------------------ settings

const RETENTIONS = [0.8, 0.85, 0.9, 0.95];

/** Saves `settings.study` (missing fields from the current values): clamped, with ≥ 1 study day. */
export async function saveStudySettings(changes: Partial<StudySettings>): Promise<void> {
  const cur = studySettingsOf(await db.settings.get('settings'));
  const merged = { ...cur, ...changes };
  const restDays = [...new Set(merged.restDays)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  const study: StudySettings = {
    budgetMin: Math.min(120, Math.max(5, Math.round(merged.budgetMin))),
    maxNewPerDay: Math.min(50, Math.max(0, Math.round(merged.maxNewPerDay))),
    retention: RETENTIONS.reduce((best, r) => (Math.abs(r - merged.retention) < Math.abs(best - merged.retention) ? r : best)),
    restDays: restDays.length >= 7 ? cur.restDays : restDays,
    // Absent = reminder off; only a valid HH:mm is kept.
    ...(merged.reminderAt && /^([01]\d|2[0-3]):[0-5]\d$/.test(merged.reminderAt) ? { reminderAt: merged.reminderAt } : {}),
  };
  await patch<Settings>('settings', 'settings', { study });
}
