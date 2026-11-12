import { Icon } from '../art/icons';
import { EscapeButton } from '../features/agora/EscapeButton';
import { Button } from '../ui/Button';
import { clockText, isTimeUp, phaseLabel, timerIcon, useTimerNow } from './clock';
import { resumeTimer, useTimerMission } from './TimerControls';
import { useTimerSheet } from './TimerSheet';
import { isFocusing, useTimer, type TimerState } from './store';
import './timer.css';

function statusText(t: TimerState, timeUp: boolean): string | undefined {
  if (t.ready) return t.phase === 'break' ? 'hora da pausa' : 'pausa terminada';
  if (t.status === 'paused') return 'pausado';
  if (timeUp) return t.checkinId ? 'feito' : 'tempo esgotado';
  return undefined;
}

/**
 * Slim bar above the bottom nav while a timer is active (Layout `aboveNav`; the capture
 * button floats above it, never over it). Tapping it opens the timer sheet.
 */
export function TimerBar() {
  const active = useTimer((s) => s.status !== 'idle');
  return active ? <ActiveTimerBar /> : null;
}

function ActiveTimerBar() {
  const t = useTimer();
  const now = useTimerNow(t.status === 'running', t.segmentStartedAt);
  const mission = useTimerMission(t.missionId);
  const timeUp = isTimeUp(t, now);
  const status = statusText(t, timeUp);
  const attention = t.ready || timeUp;
  const cls = ['timer-bar', t.status === 'paused' && !t.ready && 'timer-bar--paused', attention && 'timer-bar--attention']
    .filter(Boolean).join(' ');

  return (
    <div className={cls} role="region" aria-label="Cronômetro">
      <button type="button" className="timer-bar__main" aria-haspopup="dialog" onClick={() => useTimerSheet.getState().open()}>
        <Icon name={timerIcon(t)} size={24} className="timer-bar__icon" />
        <span className="timer-bar__time">{clockText(t, now)}</span>
        <span className="timer-bar__info">
          <span className="timer-bar__phase">{t.checkinId ? 'Experimento' : phaseLabel(t)}{status ? ` · ${status}` : ''}</span>
          {mission && <span className="timer-bar__mission">{mission.title}</span>}
        </span>
      </button>
      {t.ready ? (
        <Button variant="primary" size="sm" icon="play" aria-label={t.phase === 'break' ? 'Iniciar pausa' : 'Voltar ao foco'}
          onClick={resumeTimer} />
      ) : timeUp ? null : t.status === 'running' ? (
        <Button size="sm" icon="pause" aria-label="Pausar" onClick={() => useTimer.getState().pause()} />
      ) : (
        <Button variant="primary" size="sm" icon="play" aria-label="Retomar" onClick={resumeTimer} />
      )}
      {isFocusing(t) && !timeUp && <EscapeButton compact mission={mission} />}
      {/* At the end of the experiment the sheet opens on its outcome (Continuar / Parar aqui). */}
      <Button size="sm" icon="stop" aria-label="Parar"
        onClick={() => useTimerSheet.getState().open(t.checkinId && timeUp ? undefined : 'finish')} />
    </div>
  );
}
