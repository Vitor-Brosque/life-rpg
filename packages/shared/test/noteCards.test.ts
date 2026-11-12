import { describe, expect, it } from 'vitest';
import type { Card, Note } from '../src/types';
import { CLOZE_CLOSE, CLOZE_HIDDEN, CLOZE_OPEN } from '../src/cloze';
import { cardFace, cardOrds, keyPoints, normalizeNote, suggestRating, syncNoteCards, validateNote } from '../src/noteCards';

const note = (over: Partial<Note> = {}): Note => ({
  id: 'n1', createdAt: 1, updatedAt: 1, deleted: false, deckId: 'd1', type: 'basic', front: 'F', back: 'B', draft: false, ...over,
});

describe('cardOrds', () => {
  it('per type', () => {
    expect(cardOrds(note())).toEqual([0]);
    expect(cardOrds(note({ type: 'code' }))).toEqual([0]);
    expect(cardOrds(note({ type: 'topic' }))).toEqual([0]);
    expect(cardOrds(note({ type: 'reversible' }))).toEqual([0, 1]);
    expect(cardOrds(note({ type: 'cloze', front: '{{2::a}} {{1::b}} {{2::c}}' }))).toEqual([1, 2]);
  });
  it('drafts and deleted notes have no cards', () => {
    expect(cardOrds(note({ draft: true }))).toEqual([]);
    expect(cardOrds(note({ deleted: true }))).toEqual([]);
  });
});

describe('syncNoteCards', () => {
  it('creates new cards with deterministic ids and a new schedule', () => {
    const { create, remove, update } = syncNoteCards(note({ type: 'reversible' }), [], 50);
    expect(create.map((c) => c.id)).toEqual(['n1-0', 'n1-1']);
    expect(create[0]).toMatchObject({ noteId: 'n1', deckId: 'd1', ord: 0, suspended: false, state: 'new', due: 50, createdAt: 50, updatedAt: 50, deleted: false });
    expect(remove).toEqual([]);
    expect(update).toEqual([]);
    expect(create[0]).not.toHaveProperty('topic');
  });

  it('editing the text keeps progress (no changes); removing a group retires only that card', () => {
    const n = note({ type: 'cloze', front: '{{1::a}} {{2::b}}' });
    const cards = syncNoteCards(n, [], 1).create.map((c) => (c.ord === 1 ? { ...c, state: 'review' as const, reps: 4 } : c));
    expect(syncNoteCards({ ...n, front: 'novo {{1::a}} texto {{2::b}}' }, cards, 2)).toEqual({ create: [], remove: [], update: [] });
    const r = syncNoteCards({ ...n, front: '{{1::a}}' }, cards, 3);
    expect(r.create).toEqual([]);
    expect(r.remove.map((c) => [c.id, c.deleted])).toEqual([['n1-2', true]]);
  });

  it('changing the type recomputes ords; a deleted ord coming back is created fresh', () => {
    const cards = syncNoteCards(note(), [], 1).create;
    const rev = syncNoteCards(note({ type: 'reversible' }), cards, 2);
    expect(rev.create.map((c) => c.id)).toEqual(['n1-1']);
    const deleted = [...cards, { ...rev.create[0]!, deleted: true }];
    expect(syncNoteCards(note({ type: 'reversible' }), deleted, 3).create.map((c) => [c.id, c.due])).toEqual([['n1-1', 3]]);
  });

  it('moving the note to another deck moves its live cards', () => {
    const cards = syncNoteCards(note(), [], 1).create;
    expect(syncNoteCards(note({ deckId: 'd2' }), cards, 2).update.map((c) => c.deckId)).toEqual(['d2']);
  });

  it('topic notes: one card flagged as topic; switching type updates the flag', () => {
    const t = syncNoteCards(note({ type: 'topic', back: '- a\n- b' }), [], 1);
    expect(t.create[0]).toMatchObject({ id: 'n1-0', topic: true });
    const basic = syncNoteCards(note(), [], 1).create;
    expect(syncNoteCards(note({ type: 'topic', back: 'a' }), basic, 2).update.map((c) => c.topic)).toEqual([true]);
    expect(syncNoteCards(note(), t.create, 3).update[0]).not.toHaveProperty('topic');
  });

  it('a draft or deleted note removes every live card', () => {
    const cards = syncNoteCards(note({ type: 'reversible' }), [], 1).create;
    expect(syncNoteCards(note({ deleted: true }), cards, 2).remove.map((c) => c.deleted)).toEqual([true, true]);
    expect(syncNoteCards(note({ draft: true }), cards, 2).remove).toHaveLength(2);
  });
});

describe('validateNote', () => {
  it('asks for the front, the deck and the back with type-specific words', () => {
    expect(validateNote({ type: 'basic', front: ' ', back: '', draft: false })).toEqual({ front: 'Escreva a frente.', back: 'Escreva o verso.', deck: 'Escolha um baralho.' });
    expect(validateNote({ type: 'code', front: 'p', back: '', deckId: 'd', draft: false })).toEqual({ back: 'Escreva a solução.' });
    expect(validateNote({ type: 'cloze', front: '', back: '', deckId: 'd', draft: false })).toEqual({ front: 'Escreva o texto.' });
    expect(validateNote({ type: 'code', front: '', back: 'x', deckId: 'd', draft: false })).toEqual({ front: 'Escreva o enunciado.' });
  });
  it('a cloze note needs at least one cloze; a draft only needs the front', () => {
    expect(validateNote({ type: 'cloze', front: 'sem', back: '', deckId: 'd', draft: false })).toEqual({ front: 'Marque ao menos uma lacuna.' });
    expect(validateNote({ type: 'basic', front: 'dúvida', back: '', draft: true })).toEqual({});
  });
  it('a topic needs its text and at least one key point', () => {
    expect(validateNote({ type: 'topic', front: '', back: ' \n- \n', deckId: 'd', draft: false }))
      .toEqual({ front: 'Escreva o tópico.', back: 'Liste ao menos um ponto-chave.' });
    expect(validateNote({ type: 'topic', front: 'Explique 1FN', back: '- atômico', deckId: 'd', draft: false })).toEqual({});
  });
});

describe('keyPoints and suggestRating', () => {
  it('splits lines and drops list markers', () => {
    expect(keyPoints('- 1FN: valores atômicos\n\n2. 2FN: sem dependência parcial\n* 3FN')).toEqual(['1FN: valores atômicos', '2FN: sem dependência parcial', '3FN']);
  });
  it('suggests Bom when all are covered, Difícil from 60%, else Errei', () => {
    expect([suggestRating(5, 5), suggestRating(3, 5), suggestRating(2, 5), suggestRating(0, 3)]).toEqual([3, 2, 1, 1]);
  });
});

describe('normalizeNote', () => {
  it('numbers clozes, clears the cloze back, trims trailing space but keeps indentation', () => {
    expect(normalizeNote({ type: 'cloze', front: '{{a}} e {{b}}  \n', back: 'x', extra: '  ' }))
      .toEqual({ type: 'cloze', front: '{{1::a}} e {{2::b}}', back: '', extra: undefined });
    expect(normalizeNote({ type: 'code', front: 'p', back: '\n\n    return 1\n', extra: ' ok ' }))
      .toEqual({ type: 'code', front: 'p', back: '    return 1', extra: 'ok' });
  });
});

describe('cardFace', () => {
  it('basic, reversible, cloze and code faces', () => {
    expect(cardFace(note({ extra: 'E' }), 0)).toEqual({ front: 'F', back: 'B', extra: 'E' });
    expect(cardFace(note({ type: 'reversible' }), 1)).toEqual({ front: 'B', back: 'F' });
    const c = cardFace(note({ type: 'cloze', front: '{{1::a}} b' }), 1);
    expect(c.front).toBe(`${CLOZE_OPEN}${CLOZE_HIDDEN}${CLOZE_CLOSE} b`);
    expect(c.back).toBe(`${CLOZE_OPEN}a${CLOZE_CLOSE} b`);
    expect(cardFace(note({ type: 'code', front: 'Some', back: 'def f(): pass' }), 0))
      .toEqual({ front: 'Some', back: '', code: { lang: 'python', solution: 'def f(): pass' } });
    expect(cardFace(note({ type: 'code', front: 'q', back: 'SELECT 1', language: 'sql' }), 0).code!.lang).toBe('sql');
    expect(cardFace(note({ type: 'topic', front: 'Explique 1FN', back: '- a\n- b', extra: 'porque…' }), 0))
      .toEqual({ front: 'Explique 1FN', back: '', extra: 'porque…', points: ['a', 'b'] });
  });
});
