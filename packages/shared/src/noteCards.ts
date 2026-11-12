import type { Card, CodeLang, Note, Rating } from './types';
import { clozeNumbers, numberClozes, renderCloze } from './cloze';
import { newSchedule } from './scheduler';

// Notes → cards (spec §3). Content lives in the note; scheduling lives in each card.

export function cardOrds(note: Pick<Note, 'type' | 'front' | 'draft' | 'deleted'>): number[] {
  if (note.draft || note.deleted) return [];
  switch (note.type) {
    case 'basic':
    case 'code':
    case 'topic': return [0];
    case 'reversible': return [0, 1];
    case 'cloze': return clozeNumbers(note.front);
  }
}

export interface CardChanges { create: Card[]; remove: Card[]; update: Card[] }

/**
 * What to write so the live cards of `note` match its ords: kept cards keep their progress
 * (deck and topic flag follow the note), vanished ords are soft-deleted, new ords start as new.
 */
export function syncNoteCards(note: Note, existing: Card[], now: number): CardChanges {
  const live = existing.filter((c) => !c.deleted && c.noteId === note.id);
  const want = new Set(cardOrds(note));
  const have = new Set(live.map((c) => c.ord));
  const topic = note.type === 'topic';
  const create: Card[] = [...want].filter((ord) => !have.has(ord)).map((ord) => ({
    id: `${note.id}-${ord}`, createdAt: now, updatedAt: now, deleted: false,
    noteId: note.id, ...(note.deckId ? { deckId: note.deckId } : {}), ord, suspended: false,
    ...(topic ? { topic: true } : {}), ...newSchedule(now),
  }));
  const remove = live.filter((c) => !want.has(c.ord)).map((c) => ({ ...c, deleted: true }));
  const update = live
    .filter((c) => want.has(c.ord) && (c.deckId !== note.deckId || !!c.topic !== topic))
    .map((c) => {
      const next: Card = { ...c, deckId: note.deckId };
      if (topic) next.topic = true;
      else delete next.topic;
      return next;
    });
  return { create, remove, update };
}

/** Key points of a topic: the non-empty lines of `back`, without list markers. */
export function keyPoints(back: string): string[] {
  return back.split('\n').map((l) => l.trim().replace(/^([-*]|\d+[.)])(\s+|$)/, '').trim()).filter((l) => l !== '');
}

/** Rating suggested after ticking key points (the user decides): all → Bom, ≥ 60% → Difícil, less → Errei. */
export function suggestRating(covered: number, total: number): Rating {
  if (total <= 0 || covered >= total) return 3;
  return covered / total >= 0.6 ? 2 : 1;
}

export type NoteErrors = Partial<Record<'front' | 'back' | 'deck', string>>;

const FRONT_MISSING: Record<Note['type'], string> = {
  basic: 'Escreva a frente.', reversible: 'Escreva a frente.', cloze: 'Escreva o texto.',
  code: 'Escreva o enunciado.', topic: 'Escreva o tópico.',
};

export function validateNote(n: Pick<Note, 'type' | 'front' | 'back' | 'deckId' | 'draft'>): NoteErrors {
  const e: NoteErrors = {};
  const front = n.front.trim();
  if (!front) e.front = FRONT_MISSING[n.type];
  if (n.draft) return e;
  if (!n.deckId) e.deck = 'Escolha um baralho.';
  if (n.type === 'cloze') {
    if (front && clozeNumbers(n.front).length === 0) e.front = 'Marque ao menos uma lacuna.';
  } else if (n.type === 'topic') {
    if (keyPoints(n.back).length === 0) e.back = 'Liste ao menos um ponto-chave.';
  } else if (!n.back.trim()) {
    e.back = n.type === 'code' ? 'Escreva a solução.' : 'Escreva o verso.';
  }
  return e;
}

const tidy = (s: string): string => s.replace(/^\n+/, '').replace(/\s+$/, '');

/** Stored form: numbered clozes, cloze back cleared, blank edges removed (indentation kept). */
export function normalizeNote<T extends Pick<Note, 'type' | 'front' | 'back' | 'extra'>>(n: T): T {
  const extra = n.extra?.trim();
  return {
    ...n,
    front: n.type === 'cloze' ? numberClozes(tidy(n.front)) : tidy(n.front),
    back: n.type === 'cloze' ? '' : tidy(n.back),
    extra: extra ? extra : undefined,
  };
}

export interface CardFace {
  front: string;
  back: string;
  extra?: string;
  code?: { lang: CodeLang; solution: string };
  points?: string[];
}

/** Markdown of each side of card `ord` (cloze sides carry the cloze.ts sentinels; topics list their key points). */
export function cardFace(note: Pick<Note, 'type' | 'front' | 'back' | 'extra' | 'language'>, ord: number): CardFace {
  const extra = note.extra ? { extra: note.extra } : {};
  switch (note.type) {
    case 'basic': return { front: note.front, back: note.back, ...extra };
    case 'reversible': return ord === 1 ? { front: note.back, back: note.front, ...extra } : { front: note.front, back: note.back, ...extra };
    case 'cloze': return { front: renderCloze(note.front, ord, 'front'), back: renderCloze(note.front, ord, 'back'), ...extra };
    case 'code': return { front: note.front, back: '', ...extra, code: { lang: note.language ?? 'python', solution: note.back } };
    case 'topic': return { front: note.front, back: '', ...extra, points: keyPoints(note.back) };
  }
}
