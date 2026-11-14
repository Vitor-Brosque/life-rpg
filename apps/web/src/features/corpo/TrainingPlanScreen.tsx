import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import type { TrainingPlan } from '@life/shared';
import { FIVE_DAY_SPLIT, TRAINING_NAME_MAX, WEEKDAY_NAMES, capitalize, exercisesFromText } from '@life/shared';
import { useTrainingPlan } from '../../db/corpoData';
import { saveTrainingPlan } from '../../domain/trainingActions';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import './corpo.css';

const ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
type Draft = Record<number, { name: string; text: string }>;

const draftOf = (days: readonly { weekday: number; name: string; exercises: readonly string[] }[]): Draft =>
  Object.fromEntries(ORDER.map((wd) => {
    const d = days.find((x) => x.weekday === wd);
    return [wd, { name: d?.name ?? '', text: d ? d.exercises.join('\n') : '' }];
  }));

/** "/corpo/plano": the week's plan, one fieldset per day. Only "Salvar plano" writes. */
export function TrainingPlanScreen() {
  const plan = useTrainingPlan();
  return (
    <section className="screen training stack" aria-labelledby="plan-title">
      <Link href="/corpo" className="settings__back">‹ Corpo</Link>
      <h1 id="plan-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Plano de treino</h1>
      {plan !== undefined && <PlanForm plan={plan} />}
    </section>
  );
}

function PlanForm({ plan }: { plan: TrainingPlan | null }) {
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState<Draft>(() => draftOf(plan?.days ?? []));
  const set = (wd: number, patch: Partial<Draft[number]>) => setDraft((d) => ({ ...d, [wd]: { ...d[wd]!, ...patch } }));

  const save = () => safeRun((async () => {
    await saveTrainingPlan(ORDER.map((wd) => ({ weekday: wd, name: draft[wd]!.name, exercises: exercisesFromText(draft[wd]!.text) })));
    useToast.getState().show('Plano de treino salvo.');
    navigate('/corpo');
  })());

  return (
    <>
      <p>Para cada dia, o nome do treino e os exercícios, um por linha. Dia vazio fica como descanso da musculação.</p>
      {!plan && (
        <div><Button onClick={() => setDraft(draftOf(FIVE_DAY_SPLIT))}>Preencher com a divisão de exemplo de 5 dias</Button></div>
      )}
      {ORDER.map((wd) => {
        const day = capitalize(WEEKDAY_NAMES[wd]!);
        return (
          <fieldset key={wd} className="stack training-plan__day">
            <legend className="corpo__subtitle">{day}</legend>
            <label className="field">
              <span className="field__label">Nome do treino</span>
              <input aria-label={`Nome do treino de ${day}`} maxLength={TRAINING_NAME_MAX} value={draft[wd]!.name}
                onChange={(e) => set(wd, { name: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">Exercícios (um por linha)</span>
              <textarea aria-label={`Exercícios de ${day}, um por linha`} rows={4} value={draft[wd]!.text}
                onChange={(e) => set(wd, { text: e.target.value })} />
            </label>
          </fieldset>
        );
      })}
      <div className="body-block__actions">
        <Button variant="primary" onClick={save}>Salvar plano</Button>
        <Button variant="ghost" onClick={() => navigate('/corpo')}>Cancelar</Button>
      </div>
    </>
  );
}
