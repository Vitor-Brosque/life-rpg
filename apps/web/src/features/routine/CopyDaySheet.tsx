import { useState } from 'react';
import { copyBlockDays } from '../../domain/actions';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { WeekdayToggles } from './BlockFields';
import { WEEKDAY_NAME, isWeekend } from './routineShared';

export interface CopyDaySheetProps {
  open: boolean;
  /** The weekday whose blocks are copied. */
  weekday: number;
  onClose(): void;
}

/** "Copiar este dia para…": the day's blocks also happen on the chosen weekdays. */
export function CopyDaySheet({ open, weekday, onClose }: CopyDaySheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={`Copiar ${WEEKDAY_NAME[weekday]} para…`}>
      <CopyForm key={weekday} weekday={weekday} onClose={onClose} />
    </Sheet>
  );
}

function CopyForm({ weekday, onClose }: Omit<CopyDaySheetProps, 'open'>) {
  const [days, setDays] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const toggle = (d: number) => setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]));
  const copy = async () => {
    if (days.length === 0 || busy) return;
    setBusy(true);
    try {
      await copyBlockDays(weekday, days);
      useToast.getState().show(`Blocos de ${WEEKDAY_NAME[weekday]} copiados.`);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="block-form">
      <p className="block-form__hint">
        Os blocos de {WEEKDAY_NAME[weekday]} passam a acontecer também nos dias marcados. O que já existe nesses dias continua.
      </p>
      <WeekdayToggles legend="Copiar para" value={days} onToggle={toggle} disabled={weekday} />
      {days.some(isWeekend) && (
        <p className="block-form__hint">
          Sábado e domingo começam como dia livre: os blocos aparecem quando você escolhe fazer algo no dia.
        </p>
      )}
      <div className="commit-form__actions">
        <Button variant="primary" icon="check" disabled={days.length === 0 || busy} onClick={() => safeRun(copy)}>Copiar</Button>
        <Button onClick={onClose}>Cancelar</Button>
      </div>
    </div>
  );
}
