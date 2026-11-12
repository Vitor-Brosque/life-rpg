import { useId, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Mission } from '@life/shared';
import { Icon } from '../art/icons';
import { db } from '../db/db';
import { firstOpenStep, useResumePrompt } from '../features/agora/ResumePrompt';
import { useCompanion } from '../features/companion/store';
import { Button } from '../ui/Button';
import { formatDuration, plural } from '../ui/format';
import { useToast } from '../ui/Toast';
import { clockText, isTimeUp, primeChime, timerIcon, useTimerNow } from './clock';
import { isFocusing, remainingMs, useTimer, type TimerData } from './store';
import './timer.css';

export const INTERRUPT_REASONS = ['Distração', 'Interrupção externa', 'Cansaço'];

const toast = (msg: string) => useToast.getState().show(msg);

/** The linked mission (live), if any. */
export function useTimerMission(id: string | undefined): Mission | undefined {
  return useLiveQuery(async () => {
    if (!id) return undefined;
    const m = await db.missions.get(id);
    return m && !m.deleted ? m : undefined;
  }, [id]);
}

function headLabel(t: TimerData): string {
  if (t.mode === 'pomodoro') return t.phase === 'break' ? 'Pausa' : `Foco ${t.pomodoroCount + 1}`;
  if (t.mode === 'free') return 'Cronômetro livre';
  return `Regressivo · ${formatDuration(Math.round((t.targetMs ?? 0) / 60_000))}`;
}

function phaseMessage(t: TimerData, timeUp: boolean): string | undefined {
  if (t.ready) return t.phase === 'break' ? 'Fim do foco — hora de uma pausa.' : 'Pausa terminada.';
  if (timeUp) return 'Tempo esgotado.';
  return undefined;
}

/** Resume from a tap (also unlocks the chime on iOS). */
export function resumeTimer(): void {
  primeChime();
  useTimer.getState().resume();
}

/**
 * "Onde parou?" after a session that did not complete its mission: the note becomes the mission's
 * first step (and the current block's note when the mission belongs to it).
 */
function askWhereStopped(mission: Mission | undefined): void {
  if (!mission || mission.status === 'done' || mission.status === 'dropped') return;
  useResumePrompt.getState().open({ missionId: mission.id, suggestion: firstOpenStep(mission), linkCurrentBlock: true });
}

type Step = 'main' | 'finish' | 'interrupt';

export interface TimerActiveProps {
  /** 'lg' for the Painel (read from a distance). */
  size?: 'md' | 'lg';
  /** Open straight on the "Concluir" step (the bar's stop button). */
  initialStep?: 'finish';
  /** Called as soon as the session is being finished/interrupted (the sheet closes). */
  onDone?(): void;
}

/** Running/paused timer: big clock, Pausar/Retomar, Concluir (notes + "also complete"), Interromper (reasons). */
export function TimerActive({ size = 'md', initialStep, onDone }: TimerActiveProps) {
  const t = useTimer();
  const now = useTimerNow(t.status === 'running', t.segmentStartedAt);
  const mission = useTimerMission(t.missionId);
  const [step, setStep] = useState<Step>(initialStep ?? 'main');
  const [alsoComplete, setAlsoComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const notesId = useId();

  const timeUp = isTimeUp(t, now);
  const focusing = isFocusing(t);
  const canComplete = !!mission && mission.status !== 'done' && mission.status !== 'dropped';
  const message = phaseMessage(t, timeUp);
  const remaining = remainingMs(t, now);

  const end = async (work: () => Promise<void>) => {
    setBusy(true);
    onDone?.();
    try {
      await work();
    } catch (e) {
      console.error('timer: session not saved', e);
      toast('Não foi possível salvar o foco. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  const finish = () => end(async () => {
    const complete = alsoComplete && canComplete;
    const { mode, pomodoroCount } = t;
    const { xp } = await useTimer.getState().finish({ completeMission: complete });
    if (complete) return; // the completion toast (with "Desfazer") already shows
    if (focusing) {
      toast(xp > 0 ? `Foco registrado · +${xp} XP` : 'Foco registrado');
      void useCompanion.getState().say('focusDone');
    } else {
      toast(mode === 'pomodoro' ? `Pomodoro encerrado · ${plural(pomodoroCount, 'foco', 'focos')}` : 'Cronômetro encerrado');
    }
    askWhereStopped(mission);
  });

  const interrupt = (reason?: string) => end(async () => {
    await useTimer.getState().interrupt(reason);
    toast('Foco interrompido e registrado. Tudo bem.');
    askWhereStopped(mission);
  });

  const big = size === 'lg';

  return (
    <div className={big ? 'timer-active timer-active--lg' : 'timer-active'}>
      <div className="timer-active__head">
        <Icon name={timerIcon(t)} size={big ? 36 : 24} className="timer-active__icon" />
        <span className="timer-active__phase">{headLabel(t)}</span>
        {t.status === 'paused' && !t.ready && <span className="tag tag--stone">Pausado</span>}
      </div>

      <p className={t.status === 'paused' && !t.ready ? 'timer-clock timer-clock--still' : 'timer-clock'} role="timer">
        <span className="visually-hidden">{remaining !== undefined ? 'Tempo restante: ' : 'Tempo decorrido: '}</span>
        {clockText(t, now)}
      </p>
      <p className="timer-active__msg" role="status">{message}</p>
      {mission && (
        <p className="timer-active__mission">
          <span className="visually-hidden">Missão: </span>{mission.title}
        </p>
      )}

      {step === 'main' && (
        <div className="timer-active__buttons">
          {t.ready ? (
            <Button variant="primary" icon="play" disabled={busy} onClick={resumeTimer}>
              {t.phase === 'break' ? 'Iniciar pausa' : 'Voltar ao foco'}
            </Button>
          ) : timeUp ? null : t.status === 'running' ? (
            <Button icon="pause" disabled={busy} onClick={() => useTimer.getState().pause()}>Pausar</Button>
          ) : (
            <Button variant="primary" icon="play" disabled={busy} onClick={resumeTimer}>Retomar</Button>
          )}
          <Button variant={timeUp ? 'primary' : 'secondary'} icon="check" disabled={busy} onClick={() => setStep('finish')}>
            Concluir
          </Button>
          {focusing && (
            <Button variant="ghost" icon="stop" disabled={busy} onClick={() => setStep('interrupt')}>Interromper</Button>
          )}
        </div>
      )}

      {step === 'finish' && (
        <div className="timer-active__confirm" role="group" aria-label="Concluir">
          {canComplete && (
            <label className="timer-check">
              <input
                type="checkbox"
                className="px-checkbox"
                checked={alsoComplete}
                onChange={(e) => setAlsoComplete(e.target.checked)}
              />
              Marcar a missão como feita também?
            </label>
          )}
          <div className="timer-active__buttons">
            <Button variant="primary" icon="check" disabled={busy} onClick={() => { void finish(); }}>
              {focusing ? 'Concluir foco' : 'Encerrar'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setStep('main')}>Voltar</Button>
          </div>
        </div>
      )}

      {step === 'interrupt' && (
        <div className="timer-active__confirm" role="group" aria-label="Interromper">
          <p className="timer-active__label">Motivo (opcional):</p>
          <div className="timer-active__reasons">
            {INTERRUPT_REASONS.map((r) => (
              <Button key={r} size="sm" disabled={busy} onClick={() => { void interrupt(r); }}>{r}</Button>
            ))}
          </div>
          <div className="timer-active__buttons">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void interrupt(); }}>Só interromper</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStep('main')}>Voltar</Button>
          </div>
        </div>
      )}

      {/* The Painel shows notes only when concluding (its column has to fit one screen). */}
      {(!big || step === 'finish') && (
        <label className="field timer-active__notes" htmlFor={notesId}>
          <span className="field__label">Notas (opcional)</span>
          <textarea
            id={notesId}
            rows={2}
            value={t.notes}
            placeholder="O que rendeu, onde parou…"
            onChange={(e) => useTimer.getState().setNotes(e.target.value)}
          />
        </label>
      )}
    </div>
  );
}
