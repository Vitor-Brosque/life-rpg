import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Button } from '../../ui/Button';

// Treino detalhado (2026-11-25): the rest countdown after a saved set. Only on screen: no sound, no
// notification (the iPhone's browser cannot vibrate). It follows the clock, so it is right when the screen
// wakes up again, and goes away by itself 2 minutes after the maximum rest.

export const REST_LINGER_MS = 120_000;

interface RestState {
  exercise?: string;
  minSec: number;
  maxSec?: number;
  startedAt: number;
  pausedAt?: number;
  pausedMs: number;
  start(r: { exercise: string; minSec: number; maxSec?: number }, now?: number): void;
  togglePause(now?: number): void;
  stop(): void;
}

export const useRestTimer = create<RestState>((set, get) => ({
  minSec: 0, startedAt: 0, pausedMs: 0,
  start: ({ exercise, minSec, maxSec }, now = Date.now()) =>
    set({ exercise, minSec, maxSec, startedAt: now, pausedAt: undefined, pausedMs: 0 }),
  togglePause: (now = Date.now()) => {
    const s = get();
    if (s.pausedAt === undefined) set({ pausedAt: now });
    else set({ pausedAt: undefined, pausedMs: s.pausedMs + (now - s.pausedAt) });
  },
  stop: () => set({ exercise: undefined, pausedAt: undefined, pausedMs: 0 }),
}));

/** Milliseconds of rest so far (paused time excluded). */
export function restElapsed(s: Pick<RestState, 'startedAt' | 'pausedAt' | 'pausedMs'>, now: number): number {
  return Math.max(0, (s.pausedAt ?? now) - s.startedAt - s.pausedMs);
}

/** "1:58". */
export const clockText = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** The bar above the bottom navigation while a rest runs. */
export function RestBar() {
  const s = useRestTimer();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!s.exercise) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [s.exercise]);
  const elapsed = s.exercise ? restElapsed(s, now) : 0;
  const longest = (s.maxSec ?? s.minSec) * 1000;
  useEffect(() => {
    if (s.exercise && s.pausedAt === undefined && elapsed > longest + REST_LINGER_MS) s.stop();
  }, [s, elapsed, longest]);
  if (!s.exercise) return null;
  const left = s.minSec * 1000 - elapsed;
  const ready = left <= 0;
  const status = ready ? 'Descanso terminado' : 'Descansando';
  return (
    <div className={ready ? 'rest-bar rest-bar--ready' : 'rest-bar'} role="region" aria-label="Descanso">
      {/* The time first and never cut; only the exercise name shortens on a narrow screen. */}
      <span className="rest-bar__time">{ready ? 'Pode ir' : clockText(left)}</span>
      <span className="rest-bar__text">
        {ready
          ? `${s.maxSec !== undefined ? `até ${clockText(s.maxSec * 1000)} · ` : ''}${s.exercise}`
          : `Descanso · ${s.exercise}`}
        {s.pausedAt !== undefined && ' (pausado)'}
      </span>
      <span className="visually-hidden" aria-live="polite">{status}</span>
      <Button size="sm" onClick={() => s.togglePause()}>{s.pausedAt !== undefined ? 'Continuar' : 'Pausar'}</Button>
      <Button size="sm" variant="ghost" onClick={() => s.stop()}>Pular</Button>
    </div>
  );
}
