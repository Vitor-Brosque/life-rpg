import type { Card, CardFace, CodeLang, DayKey, Note, NoteType } from '@life/shared';
import { cardFace, cardOrds, dayKeyOf, diffDays, normalize, stripCloze } from '@life/shared';

// Editor state and list helpers for notes (spec §6). Pure.

export interface NoteForm { type: NoteType; deckId: string; front: string; back: string; extra: string; language: CodeLang }

export const TYPE_LABEL: Record<NoteType, string> = {
  basic: 'Pergunta e resposta', reversible: 'Dois sentidos', cloze: 'Lacunas', code: 'Código', topic: 'Tópico',
};
export const LANG_LABEL: Record<CodeLang, string> = {
  python: 'Python', sql: 'SQL', javascript: 'JavaScript', bash: 'Bash', text: 'Texto',
};
export const NOTE_TYPES = Object.keys(TYPE_LABEL) as NoteType[];
export const isNoteType = (s: string | null): s is NoteType => s !== null && (NOTE_TYPES as string[]).includes(s);

export function emptyForm(deckId = '', type: NoteType = 'basic', language: CodeLang = 'python'): NoteForm {
  return { type, deckId, front: '', back: '', extra: '', language };
}

export function formOf(n: Note): NoteForm {
  return { type: n.type, deckId: n.deckId ?? '', front: n.front, back: n.back, extra: n.extra ?? '', language: n.language ?? 'python' };
}

/** Faces of every card the form would create (live preview). */
export function previewFaces(f: NoteForm): CardFace[] {
  const note = { type: f.type, front: f.front, back: f.back, extra: f.extra.trim() || undefined, language: f.language };
  return cardOrds({ ...note, draft: false, deleted: false }).map((ord) => cardFace(note, ord));
}

/** First meaningful line of the front, without Markdown marks, answers in place of clozes. */
export function noteTitle(front: string): string {
  const line = stripCloze(front).split('\n').map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('```')) ?? '';
  const plain = line.replace(/^([-*]|\d+[.)])\s+/, '').replace(/[*`$]/g, '').trim();
  if (!plain) return '(sem texto)';
  return plain.length > 80 ? `${plain.slice(0, 79)}…` : plain;
}

export function noteStatus(note: Note, cards: Card[], today: DayKey, dayStartHour: number): string {
  if (note.draft) return 'rascunho';
  if (cards.length === 0) return '';
  const active = cards.filter((c) => !c.suspended);
  if (active.length === 0) return 'suspenso';
  const learned = active.filter((c) => c.state !== 'new');
  if (learned.length === 0) return 'novo';
  const days = diffDays(today, dayKeyOf(Math.min(...learned.map((c) => c.due)), dayStartHour));
  if (days <= 0) return 'para hoje';
  return days === 1 ? 'amanhã' : `em ${days} dias`;
}

export function matchesQuery(n: Note, q: string): boolean {
  const key = normalize(q.trim());
  return !key || normalize(stripCloze(`${n.front}\n${n.back}\n${n.extra ?? ''}`)).includes(key);
}
