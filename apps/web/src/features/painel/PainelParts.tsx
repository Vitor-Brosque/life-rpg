import { Companion, SpeechBubble } from '../../art/Companion';
import { useCharacterStats, useProfile } from '../../db/hooks';
import { TimerActive } from '../../timer/TimerControls';
import { useTimerSheet } from '../../timer/TimerSheet';
import { useTimer } from '../../timer/store';
import { Button } from '../../ui/Button';
import { Panel } from '../../ui/Panel';
import { WeekDots, workdaysText } from '../../ui/WeekDots';
import { useCompanion } from '../companion/store';

// Pieces of the Painel's Apoio column: the big timer, the companion and constancy.

export function PainelTimer() {
  const idle = useTimer((s) => s.status === 'idle');
  return (
    <Panel variant="stone" className="painel__timer px-border--gold">
      {idle ? (
        <div className="painel__timer-idle">
          <p className="timer-clock timer-clock--still" aria-hidden="true">00:00</p>
          <Button variant="primary" size="lg" icon="play" onClick={() => useTimerSheet.getState().open()}>
            Iniciar foco
          </Button>
          <p className="painel__hint">Livre, Pomodoro ou regressivo — só começa quando você mandar.</p>
        </div>
      ) : (
        <TimerActive size="lg" />
      )}
      <p className="painel__keys" aria-hidden="true"><kbd>Espaço</kbd> pausa/retoma · <kbd>C</kbd> conclui a missão</p>
    </Panel>
  );
}

export function PainelCompanion() {
  const message = useCompanion((s) => s.message);
  const profile = useProfile();
  return (
    <div className="painel__companion">
      <Companion scale={5} speaking={!!message} />
      <div className="painel__companion-side">
        <SpeechBubble message={message} className="painel__speech" />
        {!message && <p className="painel__companion-name">{profile?.companionName || 'Faísca'}</p>}
      </div>
    </div>
  );
}

/** Last 7 days in workdays (§9): free days are shown as "livre" and not counted. */
export function ConstancyCard() {
  const stats = useCharacterStats();
  if (!stats) return null;
  return (
    <Panel variant="stone" className="painel__week">
      <h2 className="painel__subheading">Constância</h2>
      <WeekDots week={stats.weekWorkdays} />
      <p className="painel__week-text">{`${workdaysText(stats.weekWorkdays)} — um dia parado não apaga nada.`}</p>
    </Panel>
  );
}
