import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Journey } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { readStudyData } from '../src/db/studyData';
import {
  NoteValidationError, captureCardDraft, deleteDeck, deleteNote, isCardCapture, rateCard, resetNote, restoreNote,
  saveDeck, saveNote, saveStudySettings, setDeckArchived, setNoteSuspended, undoRating,
} from '../src/domain/studyActions';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 12, 10, 0)); // Thursday
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

const liveCards = async (noteId: string) => (await db.cards.where('noteId').equals(noteId).toArray()).filter((c) => !c.deleted);
const xpTotal = async () => (await db.xpEvents.toArray()).filter((x) => !x.deleted).reduce((s, x) => s + x.amount, 0);

describe('decks', () => {
  it('saveDeck creates in order and edits; deleteDeck refuses a deck with notes', async () => {
    const a = await saveDeck({ name: ' SQL ' });
    const b = await saveDeck({ name: 'Faculdade', areaId: 'area-facul' });
    expect([a.name, a.order, b.order, b.areaId]).toEqual(['SQL', 0, 1, 'area-facul']);
    await saveDeck({ id: a.id, name: 'SQL e bancos', journeyId: 'j1' });
    expect(await db.decks.get(a.id)).toMatchObject({ name: 'SQL e bancos', journeyId: 'j1' });
    await saveNote({ deckId: a.id, type: 'basic', front: 'f', back: 'b' });
    expect(await deleteDeck(a.id)).toBe(false);
    expect(await deleteDeck(b.id)).toBe(true);
    expect((await db.decks.get(b.id))!.deleted).toBe(true);
  });
});

describe('saveNote', () => {
  it('creates one card per ord with deterministic ids; cloze text is numbered and its back cleared', async () => {
    const d = await saveDeck({ name: 'SQL' });
    const basic = await saveNote({ deckId: d.id, type: 'basic', front: 'f', back: 'b' });
    expect((await liveCards(basic.id)).map((c) => c.id)).toEqual([`${basic.id}-0`]);
    const rev = await saveNote({ deckId: d.id, type: 'reversible', front: 'gato', back: 'cat' });
    expect((await liveCards(rev.id)).map((c) => c.ord).sort()).toEqual([0, 1]);
    const cl = await saveNote({ deckId: d.id, type: 'cloze', front: '{{a}} e {{b}}', back: 'ignored' });
    expect([cl.front, cl.back]).toEqual(['{{1::a}} e {{2::b}}', '']);
    expect((await liveCards(cl.id)).map((c) => [c.ord, c.deckId, c.state]).sort()).toEqual([[1, d.id, 'new'], [2, d.id, 'new']]);
    const code = await saveNote({ deckId: d.id, type: 'code', front: 'Some', back: 'def f(): pass' });
    expect(code.language).toBe('python');
  });

  it('editing keeps progress, removing a cloze retires its card, re-adding starts fresh', async () => {
    const d = await saveDeck({ name: 'SQL' });
    const n = await saveNote({ deckId: d.id, type: 'cloze', front: '{{1::a}} {{2::b}}', back: '' });
    await db.cards.update(`${n.id}-1`, { state: 'review', reps: 4 });
    await saveNote({ id: n.id, deckId: d.id, type: 'cloze', front: 'novo {{1::a}} {{2::b}}', back: '' });
    expect(await db.cards.get(`${n.id}-1`)).toMatchObject({ state: 'review', reps: 4 });
    await saveNote({ id: n.id, deckId: d.id, type: 'cloze', front: '{{1::a}}', back: '' });
    expect((await db.cards.get(`${n.id}-2`))!.deleted).toBe(true);
    await saveNote({ id: n.id, deckId: d.id, type: 'cloze', front: '{{1::a}} {{2::b}}', back: '' });
    expect(await db.cards.get(`${n.id}-2`)).toMatchObject({ deleted: false, state: 'new' });
  });

  it('rejects invalid notes with field errors', async () => {
    await expect(saveNote({ type: 'basic', front: '', back: '' })).rejects.toBeInstanceOf(NoteValidationError);
    await expect(saveNote({ type: 'cloze', front: 'sem lacuna', back: '', deckId: 'd' }))
      .rejects.toMatchObject({ errors: { front: 'Marque ao menos uma lacuna.' } });
  });

  it('a draft has no cards until it is completed', async () => {
    const draft = await saveNote({ type: 'basic', front: 'dúvida', back: '', draft: true });
    expect(await liveCards(draft.id)).toEqual([]);
    const d = await saveDeck({ name: 'SQL' });
    await saveNote({ id: draft.id, deckId: d.id, type: 'basic', front: 'dúvida', back: 'resposta' });
    expect(await db.notes.get(draft.id)).toMatchObject({ draft: false, deckId: d.id });
    expect(await liveCards(draft.id)).toHaveLength(1);
  });
});

describe('note actions', () => {
  it('suspend, reset, delete and restore', async () => {
    const d = await saveDeck({ name: 'SQL' });
    const n = await saveNote({ deckId: d.id, type: 'reversible', front: 'a', back: 'b' });
    await setNoteSuspended(n.id, true);
    expect((await liveCards(n.id)).every((c) => c.suspended)).toBe(true);
    await setNoteSuspended(n.id, false);
    await db.cards.update(`${n.id}-0`, { state: 'review', reps: 3, lastReview: 5, introducedDay: '2026-11-10' });
    await resetNote(n.id);
    const c0 = await db.cards.get(`${n.id}-0`);
    expect(c0).toMatchObject({ state: 'new', reps: 0, suspended: false });
    expect(c0!.lastReview).toBeUndefined();
    expect(c0!.introducedDay).toBeUndefined();
    const ids = await deleteNote(n.id);
    expect([...ids].sort()).toEqual([`${n.id}-0`, `${n.id}-1`]);
    expect(await liveCards(n.id)).toEqual([]);
    await restoreNote(n.id, ids);
    expect((await db.notes.get(n.id))!.deleted).toBe(false);
    expect(await liveCards(n.id)).toHaveLength(2);
  });
});

describe('captureCardDraft', () => {
  it('detects "? " lines', () => {
    expect(isCardCapture('? o que é X')).toBe(true);
    expect(isCardCapture('  ?   o que é X')).toBe(true);
    expect(isCardCapture('?semespaço')).toBe(false);
    expect(isCardCapture('comprar pão?')).toBe(false);
  });
  it('uses the deck of the #journey, else the inbox; an unknown tag stays in the text', async () => {
    const j = await put('journeys', newRecord<Journey>({ title: 'Tech News', status: 'active', order: 0 }));
    const d = await saveDeck({ name: 'Pipeline', journeyId: j.id });
    const a = await captureCardDraft('? diferença entre WHERE e HAVING #tech');
    expect(a).toMatchObject({ front: 'diferença entre WHERE e HAVING', deckId: d.id, draft: true, type: 'basic' });
    const b = await captureCardDraft('?  o que é idempotência');
    expect(b!.deckId).toBeUndefined();
    expect((await captureCardDraft('? o que é #xyz'))!.front).toBe('o que é #xyz');
    expect(await captureCardDraft('?   ')).toBeUndefined();
  });
});

describe('rateCard / undoRating', () => {
  async function setup(budgetMin = 15): Promise<string[]> {
    await saveStudySettings({ budgetMin });
    const d = await saveDeck({ name: 'Ofício', areaId: 'area-oficio' });
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(`${(await saveNote({ deckId: d.id, type: 'basic', front: `f${i}`, back: 'b' })).id}-0`);
    return ids;
  }

  it('writes the review with before/after, updates the card and marks the introduction day', async () => {
    const [id] = await setup();
    const r = await rateCard(id!, 3, { durationMs: 9000, wrote: true });
    const review = await db.reviews.get(r.reviewId);
    expect(review).toMatchObject({ cardId: id, rating: 3, durationMs: 9000, wrote: true, day: '2026-11-12' });
    expect([review!.before.state, review!.after.state]).toEqual(['new', 'learning']);
    expect(await db.cards.get(id!)).toMatchObject({ state: 'learning', introducedDay: '2026-11-12', due: Date.now() + 600_000 });
    expect(r).toMatchObject({ xp: 0, goalReached: false });
  });

  it('caps the duration at 5 minutes', async () => {
    const [id] = await setup();
    const r = await rateCard(id!, 3, { durationMs: 3_600_000, wrote: false });
    expect((await db.reviews.get(r.reviewId))!.durationMs).toBe(300_000);
  });

  it('topics: no short steps, coverage stored on the review', async () => {
    const d = await saveDeck({ name: 'BD' });
    const n = await saveNote({ deckId: d.id, type: 'topic', front: 'Explique 1FN–3FN', back: '- 1FN\n- 2FN\n- 3FN' });
    const r = await rateCard(`${n.id}-0`, 3, { durationMs: 120000, wrote: true, coverage: { covered: 3, total: 3 } });
    // Thursday + 3 days = Sunday → moved to Monday: 4 days, straight to review (no 10-minute step).
    expect(await db.cards.get(`${n.id}-0`)).toMatchObject({ topic: true, state: 'review', scheduledDays: 4 });
    expect((await db.reviews.get(r.reviewId))!.coverage).toEqual({ covered: 3, total: 3 });
  });

  it('+3 XP at the 5th review and +10 when the goal is met, once per day, to the deck area', async () => {
    const ids = await setup(5); // goal = 300 s
    for (let i = 0; i < 4; i++) expect((await rateCard(ids[i]!, 3, { durationMs: 75_000, wrote: false })).xp).toBe(0);
    expect(await rateCard(ids[4]!, 3, { durationMs: 75_000, wrote: false })).toMatchObject({ xp: 13, goalReached: true });
    expect(await db.xpEvents.get('xp-study-start-2026-11-12')).toMatchObject({ amount: 3, reason: 'study', areaId: 'area-oficio', dayKey: '2026-11-12' });
    expect(await db.xpEvents.get('xp-study-goal-2026-11-12')).toMatchObject({ amount: 10, reason: 'study', areaId: 'area-oficio' });
    expect(await rateCard(ids[5]!, 3, { durationMs: 75_000, wrote: false })).toMatchObject({ xp: 0, goalReached: false });
    expect(await xpTotal()).toBe(13);
  });

  it('undoRating restores the card and soft-deletes the review; XP stays', async () => {
    const [id] = await setup();
    const before = await db.cards.get(id!);
    const r = await rateCard(id!, 4, { durationMs: 5000, wrote: false });
    await undoRating(r.reviewId);
    const after = await db.cards.get(id!);
    expect(after).toMatchObject({ state: 'new', due: before!.due, reps: 0 });
    expect(after!.introducedDay).toBeUndefined();
    expect(after!.lastReview).toBeUndefined();
    expect((await db.reviews.get(r.reviewId))!.deleted).toBe(true);
  });
});

describe('saveStudySettings', () => {
  it('merges with the defaults, clamps values and keeps at least one study day', async () => {
    await saveStudySettings({ budgetMin: 20 });
    expect((await db.settings.get('settings'))!.study).toEqual({ budgetMin: 20, maxNewPerDay: 10, retention: 0.9, restDays: [0, 6] });
    await saveStudySettings({ restDays: [0, 1, 2, 3, 4, 5, 6] });
    expect((await db.settings.get('settings'))!.study!.restDays).toEqual([0, 6]);
    await saveStudySettings({ budgetMin: 1, maxNewPerDay: 99, retention: 0.99, restDays: [6, 0, 6] });
    expect((await db.settings.get('settings'))!.study).toEqual({ budgetMin: 5, maxNewPerDay: 50, retention: 0.95, restDays: [0, 6] });
  });
});

describe('readStudyData', () => {
  it('keeps only active cards (not suspended, deck not archived)', async () => {
    const d1 = await saveDeck({ name: 'A' });
    const d2 = await saveDeck({ name: 'B' });
    const a = await saveNote({ deckId: d1.id, type: 'basic', front: 'a', back: 'b' });
    const s = await saveNote({ deckId: d1.id, type: 'basic', front: 's', back: 'b' });
    await saveNote({ deckId: d2.id, type: 'basic', front: 'x', back: 'y' });
    await setNoteSuspended(s.id, true);
    await setDeckArchived(d2.id, true);
    const data = await readStudyData('2026-11-12');
    expect(data.cards.map((c) => c.noteId)).toEqual([a.id]);
    expect(data.deckOrder.get(d1.id)).toBe(0);
    expect(data.deckOrder.has(d2.id)).toBe(false);
    expect(data.decks.map((d) => d.id)).toEqual([d1.id, d2.id]);
  });
});
