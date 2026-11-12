import { create, type Mutate, type StoreApi, type UseBoundStore } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { TimerMode } from '@life/shared';
import { db } from '../db/db';
import { recordFocus } from '../domain/actions';
import { completeWithFeedback } from '../features/mission/missionFeedback';
import { cancelTimerPush, scheduleTimerPush } from './push';

// Focus timer (§10). Built on timestamps, never on counters: the elapsed time is always
// `accumulatedMs + (now − segmentStartedAt)`, so it survives closing the app. It never
// starts by itself — every start/resume comes from a tap.

export type { TimerMode };
export type TimerStatus = 'idle' | 'running' | 'paused';
export type TimerPhase = 'focus' | 'break';

export interface TimerData {
  status: TimerStatus;
  mode: TimerMode;
  phase: TimerPhase;
  /** When the current focus session started (wall clock). */
  startedAt?: number;
  /** When the current running segment started; undefined while paused. */
  segmentStartedAt?: number;
  /** Active time before the current segment. */
  accumulatedMs: number;
  /** Length of the current phase (pomodoro/countdown); undefined for 'free'. */
  targetMs?: number;
  missionId?: string;
  notes: string;
  /** Focus phases completed in this Pomodoro session. */
  pomodoroCount: number;
  /** Pomodoro between phases: the next phase is set up and waits for a tap. */
  ready: boolean;
  /** When the end of a countdown was handled, so its chime never fires twice. */
  endedNotifiedAt?: number;
  /** Start card check-in whose "só 10 minutos" experiment this countdown is (its outcome is asked at the end). */
  checkinId?: string;
}

export interface PhaseEnd {
  kind: 'focus' | 'break' | 'countdown';
  /** When the phase actually ended. */
  endedAt: number;
  /** True when the end happened just now (the app was open): play the chime. */
  fresh: boolean;
  /** The focus session recorded for a finished Pomodoro focus phase. */
  recorded?: Promise<{ xp: number }>;
}

export interface TimerState extends TimerData {
  start(mode: TimerMode, opts?: { missionId?: string; targetMin?: number; checkinId?: string }): void;
  pause(): void;
  resume(): void;
  finish(opts?: { notes?: string; completeMission?: boolean }): Promise<{ xp: number }>;
  interrupt(reason?: string): Promise<void>;
  nextPhase(): void;
  setNotes(n: string): void;
  /** Detects the end of the current phase (call every second while running and on reopen). */
  checkPhaseEnd(now?: number): PhaseEnd | undefined;
}

export const TIMER_STORAGE_KEY = 'life-rpg-timer';
const MIN = 60_000;
/** A phase end detected within this window counts as "just now" (background tabs tick once a minute). */
const FRESH_MS = 65_000;
export const DEFAULT_COUNTDOWN_MIN = 25;
const PUSH_TITLE = 'LIFE RPG';

export const TIMER_IDLE: TimerData = {
  status: 'idle',
  mode: 'pomodoro',
  phase: 'focus',
  startedAt: undefined,
  segmentStartedAt: undefined,
  accumulatedMs: 0,
  targetMs: undefined,
  missionId: undefined,
  notes: '',
  pomodoroCount: 0,
  ready: false,
  endedNotifiedAt: undefined,
  checkinId: undefined,
};

// Pomodoro lengths come from settings (Dexie, async); the TimerHost keeps this copy current.
let pomodoro = { focusMin: 25, breakMin: 5 };
export function setPomodoroConfig(cfg: { focusMin: number; breakMin: number }): void {
  pomodoro = { focusMin: Math.max(1, cfg.focusMin), breakMin: Math.max(1, cfg.breakMin) };
}

export function elapsedMs(s: Pick<TimerState, 'accumulatedMs' | 'segmentStartedAt' | 'status'>, now: number): number {
  const running = s.status === 'running' && s.segmentStartedAt !== undefined ? now - s.segmentStartedAt : 0;
  return Math.max(0, s.accumulatedMs + Math.max(0, running));
}

export function remainingMs(s: TimerState | TimerData, now: number): number | undefined {
  if (s.mode === 'free' || s.targetMs === undefined) return undefined;
  return Math.max(0, s.targetMs - elapsedMs(s, now));
}

/** When the current phase reaches its target (running only). */
function phaseEndAt(s: TimerData): number | undefined {
  if (s.targetMs === undefined || s.status !== 'running' || s.segmentStartedAt === undefined) return undefined;
  return s.segmentStartedAt + (s.targetMs - s.accumulatedMs);
}

/** Does the current phase count as focus time? (Pomodoro breaks and "ready" states do not.) */
export function isFocusing(s: TimerData): boolean {
  return s.status !== 'idle' && !(s.mode === 'pomodoro' && (s.phase === 'break' || s.ready));
}

export function pushBody(s: Pick<TimerData, 'mode' | 'phase'>): string {
  if (s.mode === 'countdown') return 'Tempo esgotado.';
  return s.phase === 'break' ? 'Pausa terminada.' : 'Fim do foco — hora de uma pausa.';
}

function schedulePhasePush(s: TimerData, now: number): void {
  const rem = remainingMs(s, now);
  if (rem !== undefined && rem > 0) void scheduleTimerPush(now + rem, PUSH_TITLE, pushBody(s));
}

/** Records the focus of snapshot `s` (active time capped at the phase target). */
async function recordSession(
  s: TimerData, now: number, outcome: 'finished' | 'interrupted',
  extra: { notes?: string; interruptReason?: string },
): Promise<{ xp: number }> {
  const elapsed = elapsedMs(s, now);
  const activeMs = s.targetMs !== undefined ? Math.min(elapsed, s.targetMs) : elapsed;
  const end = phaseEndAt(s);
  const endedAt = end !== undefined && end < now ? end : now;
  const mission = s.missionId ? await db.missions.get(s.missionId) : undefined;
  const notes = extra.notes?.trim();
  const startedAt = s.startedAt ?? endedAt - activeMs;
  return recordFocus({
    // Deterministic per session (and per Pomodoro focus phase): two tabs recording it store one.
    id: s.mode === 'pomodoro' ? `focus-${startedAt}-${s.pomodoroCount}` : `focus-${startedAt}`,
    startedAt,
    endedAt,
    activeMs,
    mode: s.mode,
    missionId: s.missionId,
    areaId: mission?.areaId,
    outcome,
    interruptReason: extra.interruptReason,
    notes: notes ? notes : undefined,
  });
}

/** Never throws: private mode can make every storage call fail. */
const safeStorage: StateStorage = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode / quota */ } },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const DATA_KEYS = Object.keys(TIMER_IDLE) as Array<keyof TimerData>;

/** The persisted part of the state (no actions). */
function pickData(s: TimerData): TimerData {
  const out: Record<string, unknown> = {};
  for (const k of DATA_KEYS) out[k] = s[k];
  return out as unknown as TimerData;
}

export type TimerStore = UseBoundStore<Mutate<StoreApi<TimerState>, [['zustand/persist', unknown]]>>;

/** Creates a timer store persisted to localStorage (hydrates synchronously). */
export function createTimerStore(): TimerStore {
  return create<TimerState>()(persist((set, get) => {
    /** Back to idle; the last mode is kept so the setup remembers it. */
    const reset = () => set({ ...TIMER_IDLE, mode: get().mode });

    /** Moves a Pomodoro to its next phase, ready for a tap. Records a finished focus phase. */
    const advance = (now: number): Promise<{ xp: number }> | undefined => {
      const s = get();
      if (s.mode !== 'pomodoro' || s.status === 'idle') return undefined;
      const fromFocus = s.phase === 'focus' && !s.ready;
      set({
        status: 'paused',
        phase: s.phase === 'focus' ? 'break' : 'focus',
        segmentStartedAt: undefined,
        accumulatedMs: 0,
        targetMs: (s.phase === 'focus' ? pomodoro.breakMin : pomodoro.focusMin) * MIN,
        pomodoroCount: s.pomodoroCount + (fromFocus ? 1 : 0),
        ready: true,
        endedNotifiedAt: undefined,
      });
      void cancelTimerPush();
      if (!fromFocus) return undefined;
      const recorded = recordSession(s, now, 'finished', { notes: s.notes });
      // Callers may ignore the promise: never let a failed write become an unhandled rejection.
      recorded.catch((e) => console.error('timer: focus not recorded', e));
      return recorded;
    };

    /** Ends the session; only focus time is recorded. Restores the timer if saving fails. */
    const end = async (
      outcome: 'finished' | 'interrupted', extra: { notes?: string; interruptReason?: string },
    ): Promise<{ xp: number }> => {
      const s = get();
      if (s.status === 'idle') return { xp: 0 };
      const now = Date.now();
      reset();
      void cancelTimerPush();
      if (!isFocusing(s)) return { xp: 0 };
      try {
        return await recordSession(s, now, outcome, extra);
      } catch (e) {
        set(pickData(s));
        throw e;
      }
    };

    return {
      ...TIMER_IDLE,

      start(mode, opts = {}) {
        if (get().status !== 'idle') return; // never replace a running session
        const now = Date.now();
        const targetMin = mode === 'pomodoro' ? opts.targetMin ?? pomodoro.focusMin
          : mode === 'countdown' ? opts.targetMin ?? DEFAULT_COUNTDOWN_MIN : undefined;
        set({
          ...TIMER_IDLE,
          status: 'running',
          mode,
          startedAt: now,
          segmentStartedAt: now,
          targetMs: targetMin !== undefined ? Math.max(1, targetMin) * MIN : undefined,
          missionId: opts.missionId,
          checkinId: mode === 'countdown' ? opts.checkinId : undefined,
        });
        schedulePhasePush(get(), now);
      },

      pause() {
        const s = get();
        if (s.status !== 'running') return;
        set({ status: 'paused', accumulatedMs: elapsedMs(s, Date.now()), segmentStartedAt: undefined });
        void cancelTimerPush();
      },

      resume() {
        const s = get();
        if (s.status !== 'paused') return;
        const now = Date.now();
        // A "ready" focus phase is a new focus session.
        const startedAt = s.ready && s.phase === 'focus' ? now : s.startedAt ?? now;
        set({ status: 'running', segmentStartedAt: now, startedAt, ready: false, endedNotifiedAt: undefined });
        schedulePhasePush(get(), now);
      },

      async finish(opts = {}) {
        const { missionId, notes } = get();
        const result = await end('finished', { notes: opts.notes ?? notes });
        if (opts.completeMission && missionId) await completeWithFeedback(missionId);
        return result;
      },

      async interrupt(reason) {
        await end('interrupted', { notes: get().notes, interruptReason: reason });
      },

      nextPhase() {
        advance(Date.now());
      },

      setNotes(n) {
        set({ notes: n });
      },

      checkPhaseEnd(now = Date.now()) {
        const s = get();
        if (s.status !== 'running' || s.targetMs === undefined || s.endedNotifiedAt !== undefined) return undefined;
        if ((remainingMs(s, now) ?? 1) > 0) return undefined;
        const endedAt = phaseEndAt(s) ?? now;
        const fresh = now - endedAt <= FRESH_MS;
        if (s.mode === 'countdown') {
          set({ endedNotifiedAt: now });
          void cancelTimerPush();
          return { kind: 'countdown', endedAt, fresh };
        }
        const kind = s.phase === 'break' ? 'break' : 'focus';
        return { kind, endedAt, fresh, recorded: advance(now) };
      },
    };
  }, {
    name: TIMER_STORAGE_KEY,
    version: 1,
    storage: createJSONStorage(() => safeStorage),
    partialize: (s) => pickData(s),
  }));
}

export const useTimer = createTimerStore();

// Another tab (e.g. the Painel on the second monitor) changed the timer: pick it up.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === TIMER_STORAGE_KEY) void useTimer.persist.rehydrate();
  });
}
