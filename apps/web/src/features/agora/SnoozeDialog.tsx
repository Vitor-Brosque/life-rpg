import { useEffect, useState } from 'react';
import type { DayKey, Mission } from '@life/shared';
import { addDays } from '@life/shared';
import { Button } from '../../ui/Button';
import { formatDay } from '../../ui/format';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { snoozeWithFeedback } from '../mission/missionFeedback';

export interface SnoozeDialogProps {
  mission?: Pick<Mission, 'id' | 'title'>;
  today: DayKey;
  onClose(): void;
}

/** "Agora não": later today, tomorrow or a chosen day. No judgement attached. */
export function SnoozeDialog({ mission, today, onClose }: SnoozeDialogProps) {
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState(addDays(today, 2));
  useEffect(() => { setPicking(false); setDate(addDays(today, 2)); }, [mission?.id, today]);

  const choose = async (option: 'later' | 'tomorrow' | { date: DayKey }) => {
    if (!mission) return;
    try {
      await snoozeWithFeedback(mission.id, option, today);
      onClose();
    } catch (e) {
      console.error('snooze failed', e);
      useToast.getState().show('Não foi possível guardar. Tente de novo.');
    }
  };

  return (
    <Sheet open={!!mission} onClose={onClose} title="Agora não">
      <div className="dialog-form">
        <p className="dialog-form__context">Tudo bem. Quando “{mission?.title}” volta?</p>
        <div className="snooze-options">
          <Button icon="snooze" onClick={() => { void choose('later'); }}>Mais tarde hoje</Button>
          <Button icon="moon" onClick={() => { void choose('tomorrow'); }}>Amanhã</Button>
          <Button icon="calendar" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>Escolher dia</Button>
        </div>
        {picking && (
          <div className="snooze-pick">
            <label className="field">
              <span className="field__label">Dia</span>
              <input type="date" value={date} min={addDays(today, 1)} onChange={(e) => setDate(e.target.value)} />
            </label>
            <Button variant="primary" disabled={!date || date <= today}
              onClick={() => { void choose({ date }); }}>
              Guardar para {date && date > today ? formatDay(date, today) : '…'}
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
