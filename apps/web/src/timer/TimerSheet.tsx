import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { Mission, TimerMode } from '@life/shared';
import { todayList } from '@life/shared';
import { useEngine, useMissions, useNow, useSettings, useToday } from '../db/hooks';
import { useCompanion } from '../features/companion/store';
import { useTimerBridge } from '../features/mission/timerBridge';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Sheet } from '../ui/Sheet';
import { useToast } from '../ui/Toast';
import { playChime, primeChime } from './clock';
import { TimerActive } from './TimerControls';
import { DEFAULT_COUNTDOWN_MIN, setPomodoroConfig, useTimer, type PhaseEnd } from './store';
import './timer.css';

// ------------------------------------------------------------------ global opener

interface TimerSheetStore {
  isOpen: boolean;
  /** 'finish' opens straight on "Concluir" (the bar's stop button). */
  step?: 'finish';
  open(step?: 'finish'): void;
  close(): void;
}

export const useTimerSheet = create<TimerSheetStore>((set) => ({
  isOpen: false,
  step: undefined,
  open: (step) => set({ isOpen: true, step }),
  close: () => set({ isOpen: false, step: undefined }),
}));

// ------------------------------------------------------------------ setup (idle)

const MODES: Array<{ mode: TimerMode; label: string }> = [
  { mode: 'free', label: 'Livre' },
  { mode: 'pomodoro', label: 'Pomodoro' },
  { mode: 'countdown', label: 'Regressivo' },
];
export const COUNTDOWN_MINUTES = [5, 10, 15, 25, 45, 60];

/** Today's list first, then a few engine suggestions not already there. */
function useMissionOptions(): { today: Mission[]; suggested: Mission[] } {
  const missions = useMissions();
  const day = useToday();
  const now = useNow();
  const engine = useEngine();
  return useMemo(() => {
    const today = day ? todayList(missions, day, now) : [];
    const ids = new Set(today.map((m) => m.id));
    const suggested = (engine?.ranked ?? []).map((s) => s.mission).filter((m) => !ids.has(m.id)).slice(0, 5);
    return { today, suggested };
  }, [missions, day, now, engine]);
}

function TimerSetup({ onStarted }: { onStarted(): void }) {
  const lastMode = useTimer((s) => s.mode);
  const [mode, setMode] = useState<TimerMode>(lastMode);
  const [minutes, setMinutes] = useState(DEFAULT_COUNTDOWN_MIN);
  const [missionId, setMissionId] = useState('');
  const settings = useSettings();
  const { today, suggested } = useMissionOptions();
  const focusMin = settings?.pomodoro.focusMin ?? 25;
  const breakMin = settings?.pomodoro.breakMin ?? 5;

  const hint = mode === 'free' ? 'Conta o tempo até você concluir.'
    : mode === 'pomodoro' ? `${focusMin} min de foco e ${breakMin} de pausa. A pausa só começa quando você tocar.`
      : 'Avisa quando o tempo acabar.';

  const start = () => {
    primeChime();
    useTimer.getState().start(mode, {
      missionId: missionId || undefined,
      targetMin: mode === 'countdown' ? minutes : undefined,
    });
    onStarted();
  };

  return (
    <div className="timer-setup">
      <fieldset className="timer-setup__group">
        <legend className="field__label">Modo</legend>
        <div className="segmented">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              className="segmented__btn"
              aria-pressed={mode === m.mode}
              onClick={() => setMode(m.mode)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="timer-setup__hint">{hint}</p>

      {mode === 'countdown' && (
        <fieldset className="timer-setup__group">
          <legend className="field__label">Minutos</legend>
          <div className="cluster timer-setup__chips">
            {COUNTDOWN_MINUTES.map((n) => (
              <Chip key={n} selected={minutes === n} onClick={() => setMinutes(n)}>{`${n} min`}</Chip>
            ))}
          </div>
        </fieldset>
      )}

      <label className="field">
        <span className="field__label">Missão (opcional)</span>
        <select value={missionId} onChange={(e) => setMissionId(e.target.value)}>
          <option value="">Sem missão</option>
          {today.length > 0 && (
            <optgroup label="Hoje">
              {today.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </optgroup>
          )}
          {suggested.length > 0 && (
            <optgroup label="Sugestões">
              {suggested.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </optgroup>
          )}
        </select>
      </label>

      <Button variant="primary" size="lg" icon="play" className="timer-setup__start" onClick={start}>Iniciar</Button>
    </div>
  );
}

// ------------------------------------------------------------------ sheet + host

export interface TimerSheetProps { open: boolean; onClose(): void; step?: 'finish' }

/** Idle: mode, minutes, optional mission, Iniciar. Active: the big clock and its controls. */
export function TimerSheet({ open, onClose, step }: TimerSheetProps) {
  const idle = useTimer((s) => s.status === 'idle');
  return (
    <Sheet open={open} onClose={onClose} title="Cronômetro">
      {idle
        ? <TimerSetup onStarted={onClose} />
        : <TimerActive key={step ?? 'main'} initialStep={step} onDone={onClose} />}
    </Sheet>
  );
}

const toast = (msg: string) => useToast.getState().show(msg);

/** Chime (only if it just happened), companion and a toast at the end of a phase. */
function announcePhaseEnd(end: PhaseEnd): void {
  if (end.fresh) playChime();
  if (end.kind !== 'break') void useCompanion.getState().say('focusDone');
  if (end.recorded) {
    end.recorded
      .then(({ xp }) => toast(xp > 0 ? `Fim do foco · +${xp} XP — hora de uma pausa.` : 'Fim do foco — hora de uma pausa.'))
      .catch((e) => {
        console.error('timer: focus not recorded', e);
        toast('Não foi possível salvar o foco.');
      });
  } else {
    toast(end.kind === 'break' ? 'Pausa terminada.' : 'Tempo esgotado.');
  }
}

/** Checks the phase end every second while a timed phase runs, and right away on (re)open. */
function usePhaseEndWatcher(): void {
  const watching = useTimer((s) => s.status === 'running' && s.targetMs !== undefined && s.endedNotifiedAt === undefined);
  useEffect(() => {
    if (!watching) return;
    const check = () => {
      const end = useTimer.getState().checkPhaseEnd(Date.now());
      if (end) announcePhaseEnd(end);
    };
    check();
    const id = setInterval(check, 1000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, [watching]);
}

/** Mission sheet "Cronômetro": a free timer linked to the mission (never over a running one). */
function startFromMission(missionId: string): void {
  const t = useTimer.getState();
  if (t.status !== 'idle') {
    toast('Já há um cronômetro em andamento.');
    return;
  }
  primeChime();
  t.start('free', { missionId });
}

/** Mount once (App): the timer sheet, phase-end watcher, Pomodoro settings and the mission-sheet bridge. */
export function TimerHost() {
  const isOpen = useTimerSheet((s) => s.isOpen);
  const step = useTimerSheet((s) => s.step);
  const close = useTimerSheet((s) => s.close);
  const settings = useSettings();
  const focusMin = settings?.pomodoro.focusMin;
  const breakMin = settings?.pomodoro.breakMin;

  useEffect(() => {
    if (focusMin !== undefined && breakMin !== undefined) setPomodoroConfig({ focusMin, breakMin });
  }, [focusMin, breakMin]);

  useEffect(() => {
    useTimerBridge.setState({ start: startFromMission });
    return () => useTimerBridge.setState({ start: undefined });
  }, []);

  usePhaseEndWatcher();

  return <TimerSheet open={isOpen} step={step} onClose={close} />;
}
