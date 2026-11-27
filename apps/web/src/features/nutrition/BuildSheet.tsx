import { useState } from 'react';
import { Link } from 'wouter';
import type { DayKey, Food, FoodLog, Hunger, NutritionBuild, NutritionMeal, NutritionSettings, PantryItem } from '@life/shared';
import { HUNGER_LABEL, NUTRITION_MEAL_LABEL, PLAN_BLOCKED_TEXT, pantryToday, remainingMeals, trainingMeals } from '@life/shared';
import { buildRestOfDay } from '../../domain/nutritionActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { attempt, toast } from './nutritionUi';

const HUNGERS: readonly Hunger[] = ['pouca', 'normal', 'muita'];

/** The toast of a build that planned nothing: the plan's result says what is missing. */
export const EMPTY_BUILD_TEXT = 'Nada do estoque coube nas refeições que faltam.';

/** "Pré-treino: Café da tarde · pós-treino: Jantar." or, training before the first meal, "Pós-treino: Café da manhã.". */
function trainingHint(meals: readonly NutritionMeal[], afterTraining?: NutritionMeal): string | undefined {
  const { pre, post } = trainingMeals(meals, afterTraining);
  if (!post) return undefined;
  const which = pre
    ? `Pré-treino: ${NUTRITION_MEAL_LABEL[pre]} · pós-treino: ${NUTRITION_MEAL_LABEL[post]}`
    : `Pós-treino: ${NUTRITION_MEAL_LABEL[post]}`;
  return `${which}. As que ainda faltam recebem mais carboidrato.`;
}

/**
 * "Montar o resto do dia" (spec §6): hunger (three buttons), "Treino hoje antes de…" (every meal left, or "Sem
 * treino") and "Montar". Training before a meal makes that meal pós-treino and the one before it, if any, pré-treino
 * (the stored `afterTraining` is that meal, so the first meal of the day can be chosen too). `build` is this device's
 * last build: today's choices come back. Without a target or without stock confirmed today it explains and leads there.
 */
export function BuildForm({ day, settings, build, logs, foods, pantry, hasTarget, onDone, onGoToStock }: {
  day: DayKey; settings: NutritionSettings; build?: NutritionBuild; logs: readonly FoodLog[]; foods: readonly Food[];
  pantry: readonly PantryItem[]; hasTarget: boolean; onDone(): void; onGoToStock(): void;
}) {
  const last = build?.day === day ? build : undefined;
  const remaining = remainingMeals(settings.meals, logs, day);
  const [hunger, setHunger] = useState<Hunger>(last?.hunger ?? 'normal');
  const [trainingAt, setTrainingAt] = useState<NutritionMeal | undefined>(
    last?.afterTraining && remaining.includes(last.afterTraining) ? last.afterTraining : undefined,
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (!hasTarget) {
    return (
      <div className="stack">
        <p>{PLAN_BLOCKED_TEXT['sem-meta']}</p>
        <p className="muted">O plano distribui o que falta da meta do dia. Sem metas, não há o que distribuir.</p>
        <div><Link href="/corpo/nutricao/metas" className="btn btn--primary btn--md">Definir metas</Link></div>
      </div>
    );
  }
  if (!pantryToday(pantry, day).some((p) => foods.some((f) => f.id === p.foodId))) {
    return (
      <div className="stack">
        <p>{PLAN_BLOCKED_TEXT['sem-estoque']}</p>
        <p className="muted">O plano usa só o que você confirmou que tem hoje. O estoque de ontem precisa ser confirmado de novo.</p>
        <div><Button variant="primary" onClick={onGoToStock}>Ir para o estoque de hoje</Button></div>
      </div>
    );
  }
  if (remaining.length === 0) return <p>{PLAN_BLOCKED_TEXT['sem-refeicao']}</p>;

  const hint = trainingHint(settings.meals, trainingAt);
  const run = () => {
    setBusy(true);
    setError(undefined);
    let blocked: string | undefined;
    let empty = false;
    void attempt(async () => {
      const outcome = await buildRestOfDay({ hunger, ...(trainingAt ? { afterTraining: trainingAt } : {}) });
      if (!outcome.ok) blocked = outcome.text;
      else empty = outcome.items.length === 0;
    }).then((ok) => {
      setBusy(false);
      if (!ok) return;
      if (blocked) { setError(blocked); return; }
      toast(empty ? EMPTY_BUILD_TEXT : 'Resto do dia montado.');
      onDone();
    });
  };

  return (
    <div className="stack nutri-build">
      <p className="muted">{`Refeições que faltam: ${remaining.map((m) => NUTRITION_MEAL_LABEL[m]).join(', ')}.`}</p>
      <div className="nutri-choice" role="group" aria-labelledby="nutri-hunger-label">
        <span id="nutri-hunger-label" className="field__label">Fome</span>
        <div className="nutri-chips">
          {HUNGERS.map((h) => <Chip key={h} selected={hunger === h} onClick={() => setHunger(h)}>{HUNGER_LABEL[h]}</Chip>)}
        </div>
      </div>
      <div className="nutri-choice" role="group" aria-labelledby="nutri-training-label">
        <span id="nutri-training-label" className="field__label">Treino hoje antes de…</span>
        <div className="nutri-chips">
          {remaining.map((m) => (
            <Chip key={m} selected={trainingAt === m} aria-label={`Treino hoje antes de ${NUTRITION_MEAL_LABEL[m]}`} onClick={() => setTrainingAt(m)}>
              {NUTRITION_MEAL_LABEL[m]}
            </Chip>
          ))}
          <Chip selected={trainingAt === undefined} onClick={() => setTrainingAt(undefined)}>Sem treino</Chip>
        </div>
        {hint && <p className="muted nutri-hint">{hint}</p>}
      </div>
      <p className="muted">Montar de novo troca os itens planejados das refeições sem nada comido. O que você comeu não muda.</p>
      {error && <p role="alert" className="nutri-error">{error}</p>}
      <div><Button variant="primary" disabled={busy} onClick={run}>Montar</Button></div>
    </div>
  );
}
