import { useState } from 'react';
import type { DayKey, Mission } from '@life/shared';
import { addDays } from '@life/shared';
import { Button } from '../../ui/Button';
import { CapacityWarning } from '../agora/CapacityWarning';
import { nextBlockButton, useBlockFit } from '../agora/capacity';

/** "Escolher dia": the date only applies with "Mover", so scrolling the picker never moves anything. */
function PickDay({ mission, onPick }: { mission: Mission; onPick(day: DayKey): void }) {
  const [date, setDate] = useState<DayKey>(mission.date ?? '');
  return (
    <div className="move-panel__date">
      <label className="field">
        <span className="field__label">Escolher dia</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <Button size="sm" variant="primary" disabled={!date || date === mission.date} onClick={() => onPick(date)}>
        Mover
      </Button>
    </div>
  );
}

export interface MoveOptionsProps {
  mission: Mission;
  today: DayKey;
  /** Move to a day, or to the backlog with `null`; the panel closes afterwards. */
  onMove(day: DayKey | null): void;
}

/**
 * Inside the open "Mover para…" panel: pick a day, Hoje / Amanhã / Sem data, and for block missions
 * "Próximo bloco (qui)". "Hoje" over the block's time today asks first, inline (§5).
 */
export function MoveOptions({ mission, today, onMove }: MoveOptionsProps) {
  const fit = useBlockFit()(mission);
  const [warn, setWarn] = useState(false);
  const toToday = () => {
    if (fit?.full && mission.date !== today) setWarn(true);
    else onMove(today);
  };
  return (
    <>
      <PickDay mission={mission} onPick={onMove} />
      <div className="cluster">
        <Button size="sm" onClick={toToday}>Hoje</Button>
        <Button size="sm" onClick={() => onMove(addDays(today, 1))}>Amanhã</Button>
        <Button size="sm" onClick={() => onMove(null)}>Sem data</Button>
        {fit?.nextDay && <Button size="sm" onClick={() => onMove(fit.nextDay!)}>{nextBlockButton(fit)}</Button>}
      </div>
      {warn && fit && (
        <CapacityWarning fit={fit} onNext={fit.nextDay ? () => onMove(fit.nextDay!) : undefined} onToday={() => onMove(today)} />
      )}
    </>
  );
}
