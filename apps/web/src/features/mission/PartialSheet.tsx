import { useId, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { create } from 'zustand';
import type { DayKey, Mission } from '@life/shared';
import { addDays, dayKeyOf, RESULT_MAX } from '@life/shared';
import { db } from '../../db/db';
import { useToday } from '../../db/hooks';
import { FIRST_STEP_MAX, type PartialWhen } from '../../domain/missionActions';
import { Button } from '../../ui/Button';
import { formatDay } from '../../ui/format';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { finishTimerFor } from '../agora/blockFeedback';
import { firstOpenStep } from '../agora/ResumePrompt';
import { partialWithFeedback } from './missionFeedback';
import '../agora/agora.css';

interface PartialSheetStore { missionId?: string; open(id: string): void; close(): void }

/** Global opener of "Parcial" (the Agora card and the mission sheet). Mount `PartialSheetHost` once. */
export const usePartialSheet = create<PartialSheetStore>((set) => ({
  missionId: undefined,
  open: (id) => set({ missionId: id }),
  close: () => set({ missionId: undefined }),
}));

/** "Parcial": a started mission stays open; what came out is noted and it comes back later. Not a postponement. */
function PartialForm({ mission, today, onDone }: { mission: Mission; today: DayKey; onDone(): void }) {
  const [result, setResult] = useState('');
  const [next, setNext] = useState(mission.firstStep ?? firstOpenStep(mission));
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState(addDays(today, 2));
  const [busy, setBusy] = useState(false);
  const resultId = useId();
  const nextId = useId();
  const nextHintId = useId();

  const choose = async (when: PartialWhen) => {
    if (busy) return;
    setBusy(true);
    try {
      await finishTimerFor(mission.id); // the focus is recorded first, as in "Encerrar bloco"
      await partialWithFeedback(mission.id, { result, next, when }, today);
      onDone();
    } catch (e) {
      console.error('partial failed', e);
      useToast.getState().show('Não foi possível guardar. Tente de novo.');
      setBusy(false);
    }
  };

  return (
    <div className="dialog-form">
      <p className="dialog-form__context">{`“${mission.title}” fica aberta. O que já saiu fica anotado.`}</p>
      <label className="field" htmlFor={resultId}>
        <span className="field__label">O que saiu? (opcional)</span>
        <input id={resultId} type="text" value={result} maxLength={RESULT_MAX} enterKeyHint="next" autoComplete="off"
          placeholder="ex.: dedupe por URL feito, falta o teste" onChange={(e) => setResult(e.target.value)} />
      </label>
      <label className="field" htmlFor={nextId}>
        <span className="field__label">Próxima ação (opcional)</span>
        <input id={nextId} type="text" value={next} maxLength={FIRST_STEP_MAX} enterKeyHint="done" autoComplete="off"
          aria-describedby={nextHintId} onChange={(e) => setNext(e.target.value)} />
      </label>
      <p id={nextHintId} className="resume-form__hint">Vira o primeiro passo da próxima vez.</p>
      <fieldset className="opt-group">
        <legend className="dialog-form__question">Quando volta?</legend>
        <div className="snooze-options">
          <Button icon="snooze" disabled={busy} onClick={() => { void choose('later'); }}>Mais tarde hoje</Button>
          <Button icon="moon" disabled={busy} onClick={() => { void choose('tomorrow'); }}>Amanhã</Button>
          <Button icon="calendar" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>Escolher dia</Button>
        </div>
        {picking && (
          <div className="snooze-pick">
            <label className="field">
              <span className="field__label">Dia</span>
              <input type="date" value={date} min={addDays(today, 1)} onChange={(e) => setDate(e.target.value)} />
            </label>
            <Button variant="primary" disabled={busy || !date || date <= today}
              onClick={() => { void choose({ date }); }}>
              Guardar para {date && date > today ? formatDay(date, today) : '…'}
            </Button>
          </div>
        )}
      </fieldset>
    </div>
  );
}

export function PartialSheet({ missionId, onClose }: { missionId?: string; onClose(): void }) {
  const today = useToday() ?? dayKeyOf(Date.now(), 4);
  const mission = useLiveQuery(async () => (missionId ? await db.missions.get(missionId) : undefined), [missionId]);
  const live = !!mission && mission.id === missionId && !mission.deleted && (mission.status === 'open' || mission.status === 'doing');
  return (
    <Sheet open={live} onClose={onClose} title="Parcial">
      {live && <PartialForm key={mission.id} mission={mission} today={today} onDone={onClose} />}
    </Sheet>
  );
}

/** Mount once (App). */
export function PartialSheetHost() {
  const missionId = usePartialSheet((s) => s.missionId);
  const close = usePartialSheet((s) => s.close);
  return <PartialSheet missionId={missionId} onClose={close} />;
}
