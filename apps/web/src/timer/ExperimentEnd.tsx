import { useState } from 'react';
import { setCheckinOutcome } from '../domain/actions';
import { Button } from '../ui/Button';
import { safeRun } from '../ui/safeRun';

export type NextMode = 'pomodoro' | 'free';

export interface ExperimentEndProps {
  checkinId: string;
  busy: boolean;
  /** "Parar aqui — já valeu" (the caller records 'stopped' and finishes the countdown). */
  onStop(): void;
  /** After "Continuar": finish the countdown and start the next session for the same mission. */
  onContinue(mode: NextMode): void;
}

/** End of the start card's "só 10 minutos" (§6): keep going or stop here — both count. */
export function ExperimentEnd({ checkinId, busy, onStop, onContinue }: ExperimentEndProps) {
  const [continuing, setContinuing] = useState(false);
  const keepGoing = () => {
    setContinuing(true);
    safeRun(setCheckinOutcome(checkinId, 'continued'));
  };

  if (continuing) {
    return (
      <div className="timer-active__confirm" role="group" aria-label="Como seguir?">
        <p className="timer-active__label">Como seguir?</p>
        <div className="timer-active__buttons">
          <Button variant="primary" icon="flame" disabled={busy} onClick={() => onContinue('pomodoro')}>Pomodoro</Button>
          <Button icon="timer" disabled={busy} onClick={() => onContinue('free')}>Livre</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="timer-active__confirm" role="group" aria-label="Fim do experimento">
      <p className="timer-active__label">Quer continuar?</p>
      <div className="timer-active__buttons">
        <Button variant="primary" icon="play" disabled={busy} onClick={keepGoing}>Continuar</Button>
        <Button icon="check" disabled={busy} onClick={onStop}>Parar aqui — já valeu</Button>
      </div>
    </div>
  );
}
