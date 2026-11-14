import { useId, useState } from 'react';
import type { Blocker } from '@life/shared';
import { BLOCKERS, blockerOption, dayKeyOf } from '@life/shared';
import { db } from '../../db/db';
import { saveCheckin, updateMission } from '../../domain/actions';
import { primeChime } from '../../timer/clock';
import { useTimer } from '../../timer/store';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { shrinkWithFeedback, startWithFeedback } from '../mission/missionFeedback';
import { currentBlockOf, hideCheckinToday, useCheckinCard, type CheckinRequest } from './startWithCheckin';
import './checkin.css';

// §6 "Card de início" (ACT / behavioural experiment, never a diagnosis): name what shows up, notice
// the thought, try 10 minutes. Always optional: Pular, "Não mostrar de novo hoje" or just close it.

export const FEELINGS: Array<{ value: string; label: string }> = [
  { value: 'ansiedade', label: 'Ansiedade' },
  { value: 'tédio', label: 'Tédio' },
  { value: 'incerteza', label: 'Incerteza' },
  { value: 'cansaço', label: 'Cansaço' },
  { value: 'medo de errar', label: 'Medo de errar' },
  { value: 'outro', label: 'Outro' },
];
export const EXPERIMENT_MIN = 10;

/** Willingness (ACT): the line names the feeling that was picked, else "Nomear ajuda a seguir.". */
export function helperText(feelings: string[]): string | undefined {
  if (feelings.includes('ansiedade')) return 'Dá para começar com a ansiedade junto.';
  if (feelings.includes('medo de errar')) return 'Dá para começar com o medo junto — errar faz parte do experimento.';
  return undefined;
}

/** "Abrir o modelo" → "abrir o modelo" inside a sentence; "API do jornal" keeps its capitals. */
export function inSentence(step: string): string {
  const [first, second] = step;
  return first && second && second !== second.toUpperCase() ? first.toLowerCase() + step.slice(1) : step;
}

const toast = (msg: string) => useToast.getState().show(msg);
const checkinLead = (xp: number) => (xp > 0 ? `Check-in · +${xp} XP` : undefined);

type Answer = 'experiment' | 'start' | 'skip' | 'off';

/** Saves what the card asked for, starts the mission and, for the experiment, the 10-min countdown. */
async function answer(
  kind: Answer, request: CheckinRequest, feelings: string[], thought: string, blocker?: Blocker,
): Promise<void> {
  const { mission } = request;
  if (kind === 'off') {
    const settings = await db.settings.get('settings');
    hideCheckinToday(dayKeyOf(Date.now(), settings?.dayStartHour ?? 4));
  }
  if (kind === 'skip' || kind === 'off') {
    await startWithFeedback(mission.id);
    request.onStarted?.();
    return;
  }
  const blockId = await currentBlockOf(mission);
  const { id, xp } = await saveCheckin({
    feelings, thought, missionId: mission.id, blockId, ...(blocker ? { blocker } : {}),
    ...(kind === 'experiment' ? { experimentMin: EXPERIMENT_MIN } : {}),
  });
  let timerBusy = false;
  if (kind === 'experiment') {
    const timer = useTimer.getState();
    timerBusy = timer.status !== 'idle';
    if (!timerBusy) timer.start('countdown', { missionId: mission.id, targetMin: EXPERIMENT_MIN, checkinId: id });
  }
  await startWithFeedback(mission.id, checkinLead(xp));
  if (timerBusy) toast('Já há um cronômetro em andamento.');
  request.onStarted?.();
}

function CheckinForm({ request, onDone }: { request: CheckinRequest; onDone(): void }) {
  const { mission } = request;
  const [feelings, setFeelings] = useState<string[]>([]);
  const [thought, setThought] = useState('');
  const [blocker, setBlocker] = useState<Blocker>();
  const [blockersOpen, setBlockersOpen] = useState(false);
  const [firstStep, setFirstStep] = useState(mission.firstStep);
  const [small, setSmall] = useState('');
  const thoughtId = useId();
  const blockersId = useId();
  const smallId = useId();
  const willing = helperText(feelings);
  const step = inSentence(firstStep || mission.title);
  const offer = blocker ? blockerOption(blocker) : undefined;

  const useStep = (text: string) => safeRun(async () => {
    await updateMission(mission.id, { firstStep: text });
    setFirstStep(text);
    toast('Primeiro passo salvo.');
  });
  const shrink = () => {
    const text = small.trim();
    if (!text) return;
    safeRun(async () => {
      await shrinkWithFeedback(mission.id, text);
      setFirstStep(text);
    });
  };

  const toggle = (value: string) =>
    setFeelings((list) => (list.includes(value) ? list.filter((f) => f !== value) : [...list, value]));
  const choose = (kind: Answer) => () => {
    if (kind === 'experiment') primeChime(); // inside the tap, so the end chime can play on iOS
    onDone();
    safeRun(answer(kind, request, feelings, thought, blocker));
  };

  return (
    <div className="checkin">
      {mission.firstStep && <p className="checkin__mission">{mission.title}</p>}
      <p className="checkin__intro">Leva meio minuto e dá para pular.</p>
      <fieldset className="checkin__group">
        <legend className="checkin__question">O que aparece agora?</legend>
        <div className="cluster checkin__chips">
          {FEELINGS.map((f) => (
            <Chip key={f.value} selected={feelings.includes(f.value)} onClick={() => toggle(f.value)}>{f.label}</Chip>
          ))}
        </div>
        <p className={willing ? 'checkin__helper checkin__helper--warm' : 'checkin__helper'} aria-live="polite">
          {willing ?? 'Nomear ajuda a seguir.'}
        </p>
      </fieldset>

      <label className="field" htmlFor={thoughtId}>
        <span className="checkin__question">O que o pensamento diz?</span>
        <input
          id={thoughtId}
          type="text"
          value={thought}
          enterKeyHint="done"
          placeholder="ex.: não sei por onde começar"
          onChange={(e) => setThought(e.target.value)}
        />
      </label>

      <Button variant="ghost" className="checkin__blockers-toggle" aria-expanded={blockersOpen} aria-controls={blockersId}
        onClick={() => setBlockersOpen((v) => !v)}>
        O que trava? (opcional)
      </Button>
      <div id={blockersId} hidden={!blockersOpen}>
        {blockersOpen && (
          <fieldset className="checkin__group">
            <legend className="checkin__question">O que trava?</legend>
            <div className="cluster checkin__chips">
              {BLOCKERS.map((b) => (
                <Chip key={b.key} selected={blocker === b.key} onClick={() => setBlocker((cur) => (cur === b.key ? undefined : b.key))}>
                  {b.label}
                </Chip>
              ))}
            </div>
            {offer?.offer === 'step' && offer.step && (
              <div className="checkin__offer">
                <p className="checkin__helper">{`Primeira ação sugerida: ${offer.step}`}</p>
                <Button size="sm" onClick={() => useStep(offer.step!)}>Usar como primeiro passo</Button>
              </div>
            )}
            {offer?.offer === 'shrink' && (
              <div className="checkin__offer">
                <label className="field" htmlFor={smallId}>
                  <span className="checkin__helper">Versão de 5 minutos</span>
                  <input id={smallId} type="text" value={small} enterKeyHint="done" autoComplete="off"
                    onChange={(e) => setSmall(e.target.value)} />
                </label>
                <Button size="sm" disabled={!small.trim()} onClick={shrink}>Encolher</Button>
              </div>
            )}
            {offer?.offer === 'experiment' && (
              <p className="checkin__helper">{`Experimento de ${EXPERIMENT_MIN} minutos: comece pelo botão abaixo.`}</p>
            )}
          </fieldset>
        )}
      </div>

      <p className="checkin__experiment">{`Experimento: só ${EXPERIMENT_MIN} minutos para ${step}`}</p>

      <div className="checkin__actions">
        <Button variant="primary" icon="timer" className="checkin__go" onClick={choose('experiment')}>
          {`Começar ${EXPERIMENT_MIN} min`}
        </Button>
        <Button onClick={choose('start')}>Só começar</Button>
        <Button variant="ghost" onClick={choose('skip')}>Pular</Button>
      </div>
      <button type="button" className="checkin__off" onClick={choose('off')}>Não mostrar de novo hoje</button>
    </div>
  );
}

export interface CheckinCardProps { request?: CheckinRequest; onClose(): void; formKey?: number }

/** Closing the sheet (X, Esc, backdrop) starts nothing. */
export function CheckinCard({ request, onClose, formKey }: CheckinCardProps) {
  return (
    <Sheet open={request !== undefined} onClose={onClose} title="Antes de começar">
      {request && <CheckinForm key={formKey} request={request} onDone={onClose} />}
    </Sheet>
  );
}

/** Mount once (App). */
export function CheckinCardHost() {
  const request = useCheckinCard((s) => s.request);
  const seq = useCheckinCard((s) => s.seq);
  const close = useCheckinCard((s) => s.close);
  return <CheckinCard request={request} formKey={seq} onClose={close} />;
}
