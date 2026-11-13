import { useEffect, useId, useState } from 'react';
import type { Block, DayKey, Mission } from '@life/shared';
import { addDays, cueBlockDay, defaultDayMode } from '@life/shared';
import { useBlocks, useDayMode, useSettings } from '../../db/hooks';
import { updateMission } from '../../domain/actions';
import { FIRST_STEP_MAX } from '../../domain/missionActions';
import { Button } from '../../ui/Button';
import { formatDay, WEEKDAY_ABBR } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { planWithFeedback, snoozeWithFeedback } from '../mission/missionFeedback';

export interface SnoozeDialogProps {
  mission?: Pick<Mission, 'id' | 'title'> & Partial<Pick<Mission, 'postponeCount' | 'firstStep'>>;
  today: DayKey;
  onClose(): void;
}

/** "Seg, qua · 09:00": the block's days and time, short. */
function blockWhen(b: Block): string {
  const days = b.weekdays.length === 7
    ? 'todos os dias'
    : [...b.weekdays].sort((x, y) => x - y).map((d) => WEEKDAY_ABBR[d]).join(', ');
  return `${days} · ${b.targetStart}`;
}

/**
 * "Agora não": later today, tomorrow or a chosen day. No judgement attached. From the second
 * postponement on, an optional if-then plan ("quando?" + "então, o primeiro passo") can be made.
 */
export function SnoozeDialog({ mission, today, onClose }: SnoozeDialogProps) {
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState(addDays(today, 2));
  const [planning, setPlanning] = useState(false);
  const [cueId, setCueId] = useState('');
  const [step, setStep] = useState('');
  const dayStartHour = useSettings()?.dayStartHour ?? 4;
  const todayMode = useDayMode(today);
  const blocks = useBlocks().filter((b) => b.kind !== 'routine');
  const planId = useId();
  useEffect(() => {
    setPicking(false); setDate(addDays(today, 2));
    setPlanning(false); setCueId(''); setStep(mission?.firstStep ?? '');
  }, [mission?.id, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const canPlan = (mission?.postponeCount ?? 0) >= 1;
  const cue = blocks.find((b) => b.id === cueId);
  const cueDay = cue ? cueBlockDay(cue, Date.now(), dayStartHour, (d) => (d === today ? todayMode : defaultDayMode(d))) : undefined;

  const choose = async (option: 'later' | 'tomorrow' | { date: DayKey }) => {
    if (!mission) return;
    // A typed first step or a chosen block is a plan, whichever way the mission is postponed.
    const planned = planning && (!!cue || step.trim() !== (mission.firstStep ?? '').trim());
    try {
      if (planned && option !== 'later') {
        await planWithFeedback(mission.id, {
          ...(cue ? { cueBlockId: cue.id } : {}),
          firstStep: step,
          date: option === 'tomorrow' ? addDays(today, 1) : option.date,
        }, today);
      } else {
        await snoozeWithFeedback(mission.id, option, today);
        if (planned) {
          const first = step.trim().slice(0, FIRST_STEP_MAX).trim();
          await updateMission(mission.id, { firstStep: first || undefined, cueBlockId: cue?.id });
        }
      }
      onClose();
    } catch (e) {
      console.error('snooze failed', e);
      useToast.getState().show('Não foi possível guardar. Tente de novo.');
    }
  };

  const savePlan = () => {
    if (!mission || !cue || !cueDay) return;
    safeRun(async () => {
      await planWithFeedback(mission.id, { cueBlockId: cue.id, firstStep: step, date: cueDay }, today);
      onClose();
    });
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
        {canPlan && (
          <div className="snooze-plan">
            <Button variant="ghost" className="snooze-plan__toggle" aria-expanded={planning} aria-controls={planId}
              onClick={() => setPlanning((v) => !v)}>
              Fazer um plano (opcional)
            </Button>
            {planning && (
              <div id={planId} className="snooze-pick">
                <label className="field">
                  <span className="field__label">Quando?</span>
                  <select value={cueId} onChange={(e) => setCueId(e.target.value)}>
                    <option value="">Sem bloco</option>
                    {blocks.map((b) => <option key={b.id} value={b.id}>{`${b.name} · ${blockWhen(b)}`}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Então, o primeiro passo:</span>
                  <input type="text" value={step} maxLength={FIRST_STEP_MAX} enterKeyHint="done" autoComplete="off"
                    onChange={(e) => setStep(e.target.value)} />
                </label>
                {cue && (
                  <Button variant="primary" disabled={!cueDay} onClick={savePlan}>Guardar para o próximo {cue.name}</Button>
                )}
                {cue && !cueDay && <p className="snooze-plan__hint">Esse bloco não acontece nas próximas duas semanas.</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
