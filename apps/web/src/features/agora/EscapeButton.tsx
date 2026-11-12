import { useState } from 'react';
import type { ID, Mission } from '@life/shared';
import { Companion, SpeechBubble } from '../../art/Companion';
import { logEscape } from '../../domain/actions';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useCompanion } from '../companion/store';
import { currentBlockOf } from './startWithCheckin';
import './checkin.css';

// §6 "Escapei": noticing the escape is the useful part. It only records (for the weekly review):
// no XP change, no lecture, and it never pauses the timer.

export const ESCAPE_PLACES: Array<{ value: string; label: string }> = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'redes', label: 'Redes' },
  { value: 'outro', label: 'Outro' },
];

export interface EscapeButtonProps {
  /** Mission being worked on: linked to the record, its first step shown afterwards. */
  mission?: Mission;
  /** Block of the record; defaults to the current block (when the mission belongs to it). */
  blockId?: ID;
  /** Icon-only button (timer bar). */
  compact?: boolean;
}

export function EscapeButton({ mission, blockId, compact }: EscapeButtonProps) {
  const [open, setOpen] = useState(false);
  const [logged, setLogged] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The companion's answer, kept while the sheet is open (its bubble elsewhere fades after 6 s). */
  const [line, setLine] = useState<string>();
  const step = mission ? mission.firstStep || mission.title : undefined;

  const close = () => {
    setOpen(false);
    setLogged(false);
    setLine(undefined);
  };
  const pick = (escapedTo: string) => {
    setBusy(true);
    safeRun(async () => {
      try {
        await logEscape({ escapedTo, missionId: mission?.id, blockId: blockId ?? await currentBlockOf(mission) });
        await useCompanion.getState().say('escape'); // nothing when muted
        setLine(useCompanion.getState().message);
        setLogged(true);
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <>
      {compact ? (
        <Button size="sm" icon="door" aria-label="Escapei" aria-haspopup="dialog" onClick={() => setOpen(true)} />
      ) : (
        <Button size="sm" variant="ghost" icon="door" aria-haspopup="dialog" className="escape-btn" onClick={() => setOpen(true)}>
          Escapei
        </Button>
      )}
      <Sheet open={open} onClose={close} title={logged ? 'Registrado' : 'Para onde?'}>
        {logged ? (
          <div className="escape">
            {line && (
              <div className="escape__companion">
                <Companion scale={3} speaking />
                <SpeechBubble message={line} className="escape__speech" />
              </div>
            )}
            <p className="escape__step">
              {step ? `O primeiro passo continua aqui: ${step}` : 'Tudo certo. Dá para voltar quando quiser.'}
            </p>
            <Button variant="primary" icon="play" autoFocus className="escape__back" onClick={close}>Voltar agora</Button>
          </div>
        ) : (
          <div className="escape">
            <p className="escape__intro">Só um registro, nada mais.</p>
            <div className="escape__places">
              {ESCAPE_PLACES.map((p) => (
                <Button key={p.value} disabled={busy} onClick={() => pick(p.value)}>{p.label}</Button>
              ))}
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
