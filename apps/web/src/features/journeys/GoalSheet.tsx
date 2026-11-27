import { useId, useState } from 'react';
import type { Goal, GoalDraft, ID } from '@life/shared';
import {
  GOAL_HORIZON_MAX, GOAL_STATUSES, GOAL_STATUS_LABEL, GOAL_TITLE_MAX, GOAL_WHY_MAX, activeGoals, goalDraftOf, goalIssue,
  goalNeedsPause, newGoalDraft,
} from '@life/shared';
import { useGoals } from '../../db/goalData';
import { GoalError, createGoal, updateGoal } from '../../domain/goalActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import '../plan/plan.css';

/** What the sheet shows: a new goal or a stored one, as it was when tapped. */
export type GoalTarget = { kind: 'new' } | { kind: 'edit'; goal: Goal };

const toast = (msg: string) => useToast.getState().show(msg);

/** A journey's "Objetivo" chips: Sem objetivo and `goals` (pickableGoals). A value outside `goals` shows as Sem objetivo. */
export function GoalChips({ goals, value, legend, onChange }: {
  goals: readonly Goal[]; value?: ID; legend: string; onChange(id: ID | undefined): void;
}) {
  const current = value !== undefined && goals.some((g) => g.id === value) ? value : undefined;
  return (
    <fieldset className="goal-form__chips">
      <legend className="field__label">{legend}</legend>
      <Chip selected={current === undefined} onClick={() => onChange(undefined)}>Sem objetivo</Chip>
      {goals.map((g) => <Chip key={g.id} selected={current === g.id} onClick={() => onChange(g.id)}>{g.title}</Chip>)}
    </fieldset>
  );
}

/** "Novo objetivo" / "Objetivo". Opening writes nothing; every write is a button. */
export function GoalSheet({ target, onClose }: { target?: GoalTarget; onClose(): void }) {
  return (
    <Sheet open={target !== undefined} onClose={onClose} title={target?.kind === 'edit' ? 'Objetivo' : 'Novo objetivo'}>
      {target && <GoalForm key={target.kind === 'edit' ? target.goal.id : 'new'} target={target} onClose={onClose} />}
    </Sheet>
  );
}

function GoalForm({ target, onClose }: { target: GoalTarget; onClose(): void }) {
  const goals = useGoals();
  const editing = target.kind === 'edit' ? target.goal : undefined;
  // The values when the sheet opened: "Salvar" writes only what differs from them (goalChanges).
  const [initial] = useState<GoalDraft>(() => (editing ? goalDraftOf(editing) : newGoalDraft()));
  const [draft, setDraft] = useState<GoalDraft>(initial);
  const [pauseId, setPauseId] = useState<ID>();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const id = useId();
  const list = goals ?? [];
  const asks = goalNeedsPause(list, draft.status, { id: editing?.id, wasActive: editing?.status === 'ativo' });
  const others = activeGoals(list).filter((g) => g.id !== editing?.id);
  const set = (changes: Partial<GoalDraft>) => setDraft((d) => ({ ...d, ...changes }));

  const save = () => {
    setBusy(true);
    setRefusal('');
    safeRun((async () => {
      try {
        await write();
      } catch (e) {
        // A refusal of the rules: its own message, here; the sheet stays open with what he typed.
        if (!(e instanceof GoalError)) throw e;
        setRefusal(e.message);
      }
    })().finally(() => setBusy(false)));
  };
  const write = async () => {
    const pause = asks ? pauseId : undefined;
    if (!editing) {
      const r = await createGoal(draft, pause);
      toast(r.paused ? `Objetivo criado. “${r.paused}” ficou pausado.`
        : r.keptPaused ? 'Objetivo criado como pausado: já há 5 ativos.' : 'Objetivo criado.');
    } else {
      const r = await updateGoal(editing.id, initial, draft, pause);
      if (r.keptPaused) toast('Já há 5 objetivos ativos: ele fica pausado.');
      else if (r.saved) toast(r.paused ? `Objetivo salvo. “${r.paused}” ficou pausado.` : 'Objetivo salvo.');
    }
    onClose();
  };

  return (
    <div className="goal-form stack">
      <label className="field" htmlFor={`${id}-title`}>
        <span className="field__label">Objetivo</span>
        <input id={`${id}-title`} type="text" value={draft.title} maxLength={GOAL_TITLE_MAX} autoFocus={!editing}
          placeholder="Ex.: Primeira vaga em Engenharia de Dados" onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="field" htmlFor={`${id}-why`}>
        <span className="field__label">Por que importa? (opcional)</span>
        <input id={`${id}-why`} type="text" value={draft.why} maxLength={GOAL_WHY_MAX}
          placeholder="Ex.: quero trabalhar com dados e pipelines" onChange={(e) => set({ why: e.target.value })} />
      </label>
      <label className="field" htmlFor={`${id}-horizon`}>
        <span className="field__label">Horizonte (opcional)</span>
        <input id={`${id}-horizon`} type="text" value={draft.horizon} maxLength={GOAL_HORIZON_MAX}
          placeholder="Ex.: 2027 ou julho de 2027" onChange={(e) => set({ horizon: e.target.value })} />
      </label>
      {editing && (
        <fieldset className="goal-form__chips">
          <legend className="field__label">Situação</legend>
          {GOAL_STATUSES.map((s) => (
            <Chip key={s} selected={draft.status === s} onClick={() => set({ status: s })}>{GOAL_STATUS_LABEL[s]}</Chip>
          ))}
        </fieldset>
      )}
      {asks && (
        <fieldset className="goal-form__chips">
          <legend className="field__label">Já há 5 objetivos ativos. Pausar qual? (opcional)</legend>
          {others.map((g) => (
            <Chip key={g.id} selected={pauseId === g.id} onClick={() => setPauseId((cur) => (cur === g.id ? undefined : g.id))}>{g.title}</Chip>
          ))}
          <p className="goal-form__note">Sem escolher, ele fica pausado.</p>
        </fieldset>
      )}
      <p className="goal-form__note" aria-live="polite">{refusal}</p>
      <div className="cluster">
        <Button variant="primary" disabled={busy || !goals || goalIssue(draft) !== undefined} onClick={save}>
          {editing ? 'Salvar' : 'Criar objetivo'}
        </Button>
        {!editing && <Button variant="ghost" onClick={onClose}>Cancelar</Button>}
      </div>
    </div>
  );
}
