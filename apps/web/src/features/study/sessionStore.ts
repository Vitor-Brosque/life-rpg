import { create } from 'zustand';
import type { DayKey, ID } from '@life/shared';

// The running review session survives navigation (e.g. "Editar" and back): counters, the undo
// stack and whether today's "Meta de hoje feita" was already shown. Reset on Parar / Voltar,
// and when the day or the deck filter changes.

interface UndoEntry { reviewId: ID; durationMs: number }

interface SessionState {
  day?: DayKey;
  deckId?: ID;
  reviewed: number;
  spentMs: number;
  xp: number;
  undo: UndoEntry[];
  goalShown: boolean;
  start(day: DayKey, deckId?: ID): void;
  rated(reviewId: ID, durationMs: number, xp: number): void;
  undone(): UndoEntry | undefined;
  markGoalShown(): void;
  reset(): void;
}

const EMPTY = { day: undefined, deckId: undefined, reviewed: 0, spentMs: 0, xp: 0, undo: [] as UndoEntry[], goalShown: false };

export const useSession = create<SessionState>((set, get) => ({
  ...EMPTY,
  start(day, deckId) {
    const s = get();
    if (s.day !== day || s.deckId !== deckId) set({ ...EMPTY, day, deckId, goalShown: s.day === day && s.goalShown });
  },
  rated(reviewId, durationMs, xp) {
    set((s) => ({ reviewed: s.reviewed + 1, spentMs: s.spentMs + durationMs, xp: s.xp + xp, undo: [...s.undo, { reviewId, durationMs }] }));
  },
  undone() {
    const s = get();
    const last = s.undo[s.undo.length - 1];
    if (!last) return undefined;
    set({ reviewed: Math.max(0, s.reviewed - 1), spentMs: Math.max(0, s.spentMs - last.durationMs), undo: s.undo.slice(0, -1) });
    return last;
  },
  markGoalShown() { set({ goalShown: true }); },
  reset() { set({ ...EMPTY }); },
}));
