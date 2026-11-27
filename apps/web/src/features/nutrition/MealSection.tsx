import { useState, type FormEvent } from 'react';
import type { DayKey, Food, FoodLog, MealView, NutritionMeal, PantryItem } from '@life/shared';
import {
  NUTRITION_MEAL_LABEL, basisNote, estimateText, gramsText, logGramsIssue, nutrientsOf, nutrientsText, parseDecimal, portionText,
  unitCountText,
} from '@life/shared';
import { correctGrams, deleteLog, eatPlanned, logEaten, removePlanned, restoreLog } from '../../domain/nutritionActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { focusWhenGone } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { FoodPicker } from './FoodPicker';
import { EmptyFoods, MEAL_FROM, MEAL_IN, NumberField, attempt, decimalText, issueOf, toast } from './nutritionUi';

const headingIdOf = (meal: NutritionMeal): string => `nutri-meal-${meal}`;
const heading = (meal: NutritionMeal) => () => document.getElementById(headingIdOf(meal));

/** One meal switched on (or with items): what was eaten, what is planned, and "Adicionar o que comi". */
export function MealSection({ view, tag, foods, onAdd }: { view: MealView; tag?: string; foods: readonly Food[]; onAdd(): void }) {
  const label = NUTRITION_MEAL_LABEL[view.meal];
  const id = headingIdOf(view.meal);
  const empty = view.eaten.length === 0 && view.planned.length === 0;
  return (
    <section className="nutri-meal stack" aria-labelledby={id}>
      <div className="nutri-meal__head">
        <h2 id={id} className="nutri-meal__title" tabIndex={-1}>{label}</h2>
        {tag && <span className="nutri-tag">{tag}</span>}
      </div>
      {empty && <p className="muted">Nada registrado.</p>}
      {view.eaten.length > 0 && (
        <>
          <p className="nutri-meal__totals">{`Comido: ${nutrientsText(view.eatenTotals)}${view.eatenTotals.estimate ? ` · ${estimateText(true)}` : ''}`}</p>
          <ul className="nutri-items" aria-label={`Comido ${MEAL_IN[view.meal]}`}>
            {view.eaten.map((l) => <EatenRow key={l.id} log={l} meal={view.meal} />)}
          </ul>
        </>
      )}
      {view.planned.length > 0 && (
        <>
          <p className="nutri-meal__totals">{`Planejado: ${nutrientsText(view.plannedTotals)}`}</p>
          <ul className="nutri-items" aria-label={`Planejado ${MEAL_IN[view.meal]}`}>
            {view.planned.map((l) => <PlannedRow key={l.id} log={l} meal={view.meal} food={foods.find((f) => f.id === l.foodId)} />)}
          </ul>
        </>
      )}
      <div>
        <Button size="sm" icon="plus" aria-label={`Adicionar o que comi ${MEAL_IN[view.meal]}`} onClick={onAdd}>Adicionar o que comi</Button>
      </div>
    </section>
  );
}

/** An eaten item: tapping it opens the grams to correct; "Apagar" with Desfazer. */
function EatenRow({ log, meal }: { log: FoodLog; meal: NutritionMeal }) {
  const [editing, setEditing] = useState(false);
  const [grams, setGrams] = useState('');
  const [error, setError] = useState<string>();
  const rowId = `nutri-log-${log.id}`;
  const name = log.name;

  const start = () => { setGrams(decimalText(log.grams)); setError(undefined); setEditing(true); };
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const g = parseDecimal(grams);
    const issue = logGramsIssue(g);
    if (issue) { setError(issue); return; }
    void attempt(() => correctGrams(log.id, g!), (issues) => setError(issueOf(issues, 'grams') ?? issues[0]?.message)).then((ok) => {
      if (!ok) return;
      focusWhenGone(form, () => document.getElementById(rowId));
      setEditing(false);
    });
  };
  const cancel = (control: Element) => { focusWhenGone(control, () => document.getElementById(rowId)); setEditing(false); };
  const remove = (control: Element) => {
    focusWhenGone(control, heading(meal), { preventScroll: true });
    safeRun(async () => {
      const gone = await deleteLog(log.id);
      if (gone) toast('Item apagado.', { label: 'Desfazer', run: () => safeRun(restoreLog(gone)) });
    });
  };

  if (editing) {
    return (
      <li className="nutri-item">
        <p className="nutri-item__name">{name}</p>
        <form className="nutri-item__form" noValidate onSubmit={save}>
          <NumberField label={`Gramas${basisNote(log.basis)}`} ariaLabel={`Gramas comidas de ${name} ${MEAL_IN[meal]}`} value={grams}
            onChange={(v) => { setGrams(v); setError(undefined); }} error={error} autoFocus className="nutri-grams" />
          <Button type="submit" size="sm" variant="primary" aria-label={`Salvar gramas de ${name} ${MEAL_IN[meal]}`}>Salvar</Button>
          <Button size="sm" variant="ghost" aria-label={`Cancelar a correção de ${name}`} onClick={(e) => cancel(e.currentTarget)}>Cancelar</Button>
        </form>
      </li>
    );
  }
  const meta = `${gramsText(log.grams, log.basis)} · ${nutrientsText(nutrientsOf(log.per100, log.grams))}${log.estimate ? ` · ${estimateText(true)}` : ''}`;
  return (
    <li className="nutri-item">
      <button id={rowId} type="button" className="nutri-item__main" aria-label={`Corrigir gramas de ${name} ${MEAL_IN[meal]}: ${meta}`} onClick={start}>
        <span className="nutri-item__name">{name}</span>
        <span className="nutri-item__meta">{meta}</span>
      </button>
      <div className="nutri-item__actions">
        <Button size="sm" variant="ghost" icon="trash" aria-label={`Apagar ${name} ${MEAL_FROM[meal]}`} onClick={(e) => remove(e.currentTarget)}>Apagar</Button>
      </div>
    </li>
  );
}

/**
 * A planned item, in suggestion style and compact (a day can have 15 of them): the name; the suggestion; then one row
 * with the grams (no visible label: its accessible name says the food and the meal), "Comi" and "Tirar", all at the
 * left so the floating "+" of phones never covers them. The grams can be changed before "Comi"; "Tirar" has Desfazer.
 */
function PlannedRow({ log, meal, food }: { log: FoodLog; meal: NutritionMeal; food?: Food }) {
  const [grams, setGrams] = useState(() => decimalText(log.grams));
  const [error, setError] = useState<string>();
  const name = log.name;
  const portion = food ? portionText(log.grams, food) : gramsText(log.grams, log.basis);

  const eat = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const g = parseDecimal(grams);
    const issue = logGramsIssue(g);
    if (issue) { setError(issue); return; }
    focusWhenGone(form, heading(meal), { preventScroll: true });
    void attempt(() => eatPlanned(log.id, g === log.grams ? undefined : g!), (issues) => setError(issueOf(issues, 'grams') ?? issues[0]?.message));
  };
  const remove = (control: Element) => {
    focusWhenGone(control, heading(meal), { preventScroll: true });
    safeRun(async () => {
      const gone = await removePlanned(log.id);
      if (gone) toast('Item tirado do plano.', { label: 'Desfazer', run: () => safeRun(restoreLog(gone)) });
    });
  };

  return (
    <li className="nutri-item nutri-item--planned">
      <p className="nutri-item__text">
        <span className="nutri-item__name">{name}</span>
        <span className="nutri-item__meta">{`Sugestão: ${portion} · ${nutrientsText(nutrientsOf(log.per100, log.grams))}`}</span>
      </p>
      <form className="nutri-item__form nutri-item__form--row" noValidate onSubmit={eat}>
        <NumberField label={`Gramas${basisNote(log.basis)}`} ariaLabel={`Gramas de ${name} ${MEAL_IN[meal]}`} value={grams} hideLabel
          onChange={(v) => { setGrams(v); setError(undefined); }} error={error} className="nutri-grams nutri-grams--compact" />
        <Button type="submit" size="sm" variant="primary" aria-label={`Comi ${name} ${MEAL_IN[meal]}`}>Comi</Button>
        <Button size="sm" variant="ghost" aria-label={`Tirar ${name} ${MEAL_FROM[meal]}`} onClick={(e) => remove(e.currentTarget)}>Tirar</Button>
      </form>
    </li>
  );
}

const UNIT_COUNTS = [1, 2, 3, 4];

/** "Adicionar o que comi": the food (search, today's stock first), the grams (comma accepted, unit buttons) and "Registrar". */
export function EatForm({ meal, day, foods, pantry, onDone }: {
  meal: NutritionMeal; day: DayKey; foods: readonly Food[]; pantry: readonly PantryItem[]; onDone(): void;
}) {
  const [food, setFood] = useState<Food>();
  const [grams, setGrams] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (foods.length === 0) return <EmptyFoods />;

  const g = parseDecimal(grams);
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!food) return;
    const issue = logGramsIssue(g);
    if (issue) { setError(issue); return; }
    setBusy(true);
    void attempt(() => logEaten({ meal, foodId: food.id, grams: g!, day }), (issues) => setError(issueOf(issues, 'grams') ?? issues[0]?.message))
      .then((ok) => {
        setBusy(false);
        if (!ok) return;
        toast(`Registrado: ${food.name} ${MEAL_IN[meal]}.`);
        onDone();
      });
  };

  return (
    <form className="stack nutri-eat" noValidate onSubmit={save}>
      <FoodPicker foods={foods} pantry={pantry} day={day} selected={food}
        onSelect={(f) => { setFood(f); setGrams(''); setError(undefined); }} />
      {food && (
        <>
          <NumberField label={`Gramas${basisNote(food.basis)}`} ariaLabel={`Gramas de ${food.name} ${MEAL_IN[meal]}`} value={grams}
            onChange={(v) => { setGrams(v); setError(undefined); }} error={error} autoFocus className="nutri-grams" />
          {food.unit && (
            <div className="nutri-choice" role="group" aria-label={`Unidades de ${food.name}`}>
              <span className="field__label">{`Por unidade (${unitCountText(1, food.unit.name)} = ${gramsText(food.unit.grams)})`}</span>
              <div className="nutri-chips">
                {UNIT_COUNTS.map((n) => {
                  const total = n * food.unit!.grams;
                  return (
                    <Chip key={n} selected={g === total} onClick={() => { setGrams(decimalText(total)); setError(undefined); }}>
                      {unitCountText(n, food.unit!.name)}
                    </Chip>
                  );
                })}
              </div>
            </div>
          )}
          {typeof g === 'number' && g > 0 && <p className="muted">{nutrientsText(nutrientsOf(food.per100, g))}</p>}
          <div><Button type="submit" variant="primary" disabled={busy}>Registrar</Button></div>
        </>
      )}
    </form>
  );
}
