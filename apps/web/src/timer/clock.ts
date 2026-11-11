import { useEffect, useState } from 'react';
import type { IconName } from '../art/icons';
import { elapsedMs, remainingMs, type TimerData } from './store';

const pad = (n: number): string => String(n).padStart(2, '0');

/** 1500000 → "25:00"; 3725000 → "1:02:05". Remaining time rounds up so it reads 25:00 at the start. */
export function formatClock(ms: number, roundUp = false): string {
  const total = Math.max(0, roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** What the clock shows: remaining time (pomodoro/countdown) or elapsed time (free). */
export function clockText(s: TimerData, now: number): string {
  const rem = remainingMs(s, now);
  return rem !== undefined ? formatClock(rem, true) : formatClock(elapsedMs(s, now));
}

export function timerIcon(s: Pick<TimerData, 'mode' | 'phase'>): IconName {
  if (s.mode === 'pomodoro') return s.phase === 'break' ? 'moon' : 'flame';
  return 'timer';
}

/** Short phase label: "Foco", "Pausa", "Livre", "Regressivo". */
export function phaseLabel(s: Pick<TimerData, 'mode' | 'phase'>): string {
  if (s.mode === 'pomodoro') return s.phase === 'break' ? 'Pausa' : 'Foco';
  return s.mode === 'free' ? 'Livre' : 'Regressivo';
}

/** True when a countdown reached zero (it stays there until Concluir/Interromper). */
export function isTimeUp(s: TimerData, now: number): boolean {
  return s.status === 'running' && remainingMs(s, now) === 0;
}

/**
 * Current time for a ticking clock: updates right after each second boundary of the running
 * segment (`anchor`), only while running and while the page is visible.
 */
export function useTimerNow(running: boolean, anchor = 0): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    let id: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      clearTimeout(id);
      const t = Date.now();
      setNow(t);
      if (document.visibilityState === 'hidden') return;
      const into = (((t - anchor) % 1000) + 1000) % 1000;
      id = setTimeout(tick, 1000 - into + 15);
    };
    tick();
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearTimeout(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [running, anchor]);
  return now;
}

// ------------------------------------------------------------------ chime (WebAudio)

let ctx: AudioContext | undefined;

function audio(): AudioContext | undefined {
  try {
    const AC = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return undefined;
    ctx ??= new AC();
    return ctx;
  } catch {
    return undefined;
  }
}

/** Call from a tap (start/resume): iOS only lets audio play later if it was unlocked in a gesture. */
export function primeChime(): void {
  try {
    const c = audio();
    if (c?.state === 'suspended') void c.resume().catch(() => undefined);
  } catch { /* autoplay restrictions */ }
}

/** Short two-tone square-wave beep for the end of a phase. */
export function playChime(): void {
  try {
    const c = audio();
    if (!c) return;
    if (c.state === 'suspended') void c.resume().catch(() => undefined);
    const t0 = c.currentTime + 0.03;
    [660, 990].forEach((freq, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      const start = t0 + i * 0.2;
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.07, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain).connect(c.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  } catch { /* autoplay restrictions: the visual cue still shows */ }
}
