import { Link } from 'wouter';
import { FIVE_DAY_SPLIT, WEEKDAY_NAMES, blockWeekOf, capitalize, targetText, trainingDayOf } from '@life/shared';
import { useTrainingLog, useTrainingPlan } from '../../db/corpoData';
import { useToday } from '../../db/hooks';
import { applyFiveDaySplit } from '../../domain/trainingActions';
import { Button } from '../../ui/Button';
import { plural } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';

const useSplit = () => safeRun(applyFiveDaySplit().then(() => useToast.getState().show('Plano de treino criado.')));

/** "Treino de hoje" inside Corpo's Treino section, or the plan offer when there is no plan. Writes nothing on its own. */
export function TrainingToday() {
  const today = useToday();
  const plan = useTrainingPlan();
  const log = useTrainingLog(today);
  if (!today || plan === undefined || log === undefined) return null;

  if (!plan) {
    return (
      <Panel variant="stone" className="corpo__minimum" role="region" aria-labelledby="plano-title">
        <h3 id="plano-title" className="corpo__subtitle">Plano de treino</h3>
        <p>Monte o plano da semana: o nome de cada dia, os exercícios e, se quiser, séries, repetições e descanso. As cargas entram só quando você registrar.</p>
        <details className="corpo__why">
          <summary>Ver a divisão de exemplo de 5 dias</summary>
          <ul className="training-split">
            {FIVE_DAY_SPLIT.map((d) => (
              <li key={d.weekday}>{`${capitalize(WEEKDAY_NAMES[d.weekday]!)} — ${d.name}: ${d.exercises.map((e) => e.name).join(', ')}`}</li>
            ))}
          </ul>
        </details>
        <div className="body-block__actions">
          <Button variant="primary" onClick={() => useSplit()}>Usar a divisão de exemplo de 5 dias</Button>
          <Link href="/corpo/plano" className="body-card__link">Montar do zero</Link>
        </div>
      </Panel>
    );
  }

  const entry = trainingDayOf(plan, today);
  const name = log?.planName ?? entry?.name;
  if (!name) {
    return (
      <div className="stack">
        <p className="muted">Descanso da musculação.</p>
        <div className="body-block__actions">
          <Link href="/corpo/treino" className="body-card__link">Registrar cardio</Link>
          <Link href="/corpo/plano" className="body-card__link">Editar plano</Link>
        </div>
      </div>
    );
  }
  const items = log?.exercises ?? (entry?.exercises ?? []).map((p, i) => ({ id: `p${i}`, name: p.name, sets: [], status: undefined, replacedBy: undefined }));
  const target = log?.target ?? blockWeekOf(plan.block, today);
  return (
    <div className="stack">
      <h3 className="corpo__subtitle">{`Treino de hoje: ${name}`}</h3>
      {target && <p className="training__target">{targetText(target)}</p>}
      <ul className="training-today">
        {items.map((e) => (
          <li key={e.id}>
            {e.name}
            {e.status === 'feito' && ` — feito (${plural(e.sets.length, 'série', 'séries')})`}
            {e.status === 'trocado' && ` — trocado por ${e.replacedBy ?? ''}`}
            {e.status === 'pulado' && ' — pulado'}
          </li>
        ))}
      </ul>
      <div className="body-block__actions">
        <Link href="/corpo/treino" className="body-card__link">Abrir o treino de hoje</Link>
        <Link href="/corpo/plano" className="body-card__link">Editar plano</Link>
      </div>
    </div>
  );
}
