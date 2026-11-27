import { useRef, useState } from 'react';
import { Link } from 'wouter';
import type { Food, FoodLog, NutritionDay, NutritionMeal, PantryItem } from '@life/shared';
import {
  MACROS, MACRO_LETTER, MACRO_NAME, NUTRITION_MEAL_LABEL, capitalize, estimateText, intText, mealViews, nutrientsText, nutritionDay,
  nutritionNotes, stockLeft, trainingTags,
} from '@life/shared';
import { useFoodLogs, useFoods, useNutritionBuild, useNutritionSettings, useNutritionTargets, usePantry } from '../../db/nutritionData';
import { useToday } from '../../db/hooks';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { Sheet } from '../../ui/Sheet';
import { BuildForm } from './BuildSheet';
import { EatForm, MealSection } from './MealSection';
import { AddStockForm, PantrySection } from './PantrySection';
import './nutrition.css';

/** What is left of a value: "falta 90 g", "passou 12 g" or "0 g" (neutral words, never an alarm). */
function leftText(n: number, unit: 'g' | 'kcal'): string {
  const r = Math.round(n) || 0;
  if (r > 0) return `falta ${intText(r)} ${unit}`;
  if (r < 0) return `passou ${intText(-r)} ${unit}`;
  return `0 ${unit}`;
}

/** "/corpo/nutricao": the day's totals, the meals with eaten and planned items, the build and today's stock (spec §6). */
export function NutritionScreen() {
  const today = useToday();
  const settings = useNutritionSettings();
  const foods = useFoods();
  const pantry = usePantry();
  const targets = useNutritionTargets();
  const logs = useFoodLogs(today);
  const build = useNutritionBuild();
  const [eatMeal, setEatMeal] = useState<NutritionMeal>();
  const [building, setBuilding] = useState(false);
  const [addingStock, setAddingStock] = useState(false);
  const stockHeading = useRef<HTMLHeadingElement>(null);

  const loaded = today && settings && foods && pantry && targets && logs && build !== undefined;
  const day = loaded ? nutritionDay({ day: today, targets, logs }) : undefined;
  // The plan's result shows after a build made today on this device, even one that planned nothing (its sentences say
  // what is missing), and whenever something is planned.
  const builtToday = build?.day === today;
  const tags = loaded ? trainingTags(settings.meals, build ?? undefined, today) : {};

  const goToStock = () => {
    setBuilding(false);
    // After the sheet gave the focus back to its opener: the stock is where the next step is.
    setTimeout(() => {
      const h = stockHeading.current;
      if (!h) return;
      h.focus();
      h.scrollIntoView?.({ block: 'start' });
    }, 0);
  };

  return (
    <section className="screen nutri stack" aria-labelledby="nutri-title">
      <Link href="/corpo" className="settings__back">‹ Corpo</Link>
      <h1 id="nutri-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Nutrição</h1>
      <nav className="nutri__links" aria-label="Nutrição">
        <Link href="/corpo/nutricao/alimentos" className="btn btn--secondary btn--sm">Alimentos e receitas</Link>
        <Link href="/corpo/nutricao/metas" className="btn btn--secondary btn--sm">Metas e peso</Link>
      </nav>
      {loaded && day && (
        <>
          <DayTotals day={day} />

          <section className="stack" aria-labelledby="nutri-build-title">
            <h2 id="nutri-build-title" className="section-title">Resto do dia</h2>
            <p className="muted">Distribui o estoque de hoje nas refeições que faltam, perto da meta. O que você comeu não muda.</p>
            <div><Button variant="primary" onClick={() => setBuilding(true)}>Montar o resto do dia</Button></div>
            {day.target && day.afterPlan && (builtToday || day.planned.grams > 0) && (
              <PlanResult day={day} foods={foods} pantry={pantry} logs={logs} />
            )}
          </section>

          {mealViews(logs, today, settings.meals).map((view) => (
            <MealSection key={view.meal} view={view} tag={tags[view.meal]} foods={foods}
              onAdd={() => setEatMeal(view.meal)} />
          ))}

          <PantrySection day={today} foods={foods} pantry={pantry} headingRef={stockHeading} onAdd={() => setAddingStock(true)} />

          <Sheet open={eatMeal !== undefined} onClose={() => setEatMeal(undefined)} placement="top"
            title={eatMeal ? `O que comi: ${NUTRITION_MEAL_LABEL[eatMeal]}` : ''}>
            {eatMeal && <EatForm key={eatMeal} meal={eatMeal} day={today} foods={foods} pantry={pantry} onDone={() => setEatMeal(undefined)} />}
          </Sheet>
          <Sheet open={building} onClose={() => setBuilding(false)} title="Montar o resto do dia">
            {building && (
              <BuildForm day={today} settings={settings} build={build ?? undefined} logs={logs} foods={foods} pantry={pantry}
                hasTarget={day.target !== undefined}
                onDone={() => setBuilding(false)} onGoToStock={goToStock} />
            )}
          </Sheet>
          <Sheet open={addingStock} onClose={() => setAddingStock(false)} title="Adicionar ao estoque" placement="top">
            {addingStock && <AddStockForm day={today} foods={foods} pantry={pantry} onDone={() => setAddingStock(false)} />}
          </Sheet>
        </>
      )}
    </section>
  );
}

/** The top: the day's target, eaten, planned and what is left, in kcal and P/C/G, with bars. */
function DayTotals({ day }: { day: NutritionDay }) {
  const t = day.target;
  return (
    <section className="nutri-top stack" aria-labelledby="nutri-top-title">
      <div className="nutri-top__head">
        <h2 id="nutri-top-title" className="section-title">Hoje</h2>
        {day.estimate && <span className="nutri-tag">{estimateText(true)}</span>}
      </div>
      {t ? (
        <ul className="nutri-bars" aria-label="Totais de hoje">
          <TotalRow name="Calorias" unit="kcal" target={t.kcal} eaten={day.eaten.kcal} planned={day.planned.kcal} />
          {MACROS.map((m) => (
            <TotalRow key={m} name={capitalize(MACRO_NAME[m])} unit="g" target={t[m]} eaten={day.eaten[m]} planned={day.planned[m]} />
          ))}
        </ul>
      ) : (
        <>
          <p>{`Comido: ${nutrientsText(day.eaten)}`}</p>
          {day.planned.grams > 0 && <p>{`Planejado: ${nutrientsText(day.planned)}`}</p>}
          <p className="muted">Sem metas, a tela mostra o que foi comido, sem a falta e sem montar o resto do dia.</p>
          <div><Link href="/corpo/nutricao/metas" className="btn btn--secondary btn--md">Definir metas</Link></div>
        </>
      )}
      {day.eaten.fiber !== undefined && <p className="muted">{`Fibra comida: ${intText(day.eaten.fiber)} g`}</p>}
    </section>
  );
}

const pct = (n: number, max: number): number => (max > 0 ? Math.min(100, Math.max(0, (n / max) * 100)) : 0);

function TotalRow({ name, unit, target, eaten, planned }: { name: string; unit: 'g' | 'kcal'; target: number; eaten: number; planned: number }) {
  const eatenPct = pct(eaten, target);
  const plannedPct = Math.min(100 - eatenPct, pct(planned, target));
  const of = `${intText(eaten)} de ${intText(target)} ${unit}`;
  return (
    <li className="nutri-total">
      <div className="nutri-total__head">
        <span className="nutri-total__name">{name}</span>
        <span>{of}</span>
      </div>
      <div className="progress__track nutri-bar" role="progressbar" aria-label={`${name}: ${of}`}
        aria-valuemin={0} aria-valuemax={Math.round(target)} aria-valuenow={Math.round(Math.min(Math.max(eaten, 0), target))}>
        <div className="nutri-bar__eaten" style={{ width: `${eatenPct}%` }} />
        <div className="nutri-bar__planned" style={{ left: `${eatenPct}%`, width: `${plannedPct}%` }} />
      </div>
      <p className="nutri-total__detail">{`comido ${intText(eaten)} · planejado ${intText(planned)} · ${leftText(target - eaten, unit)}`}</p>
    </li>
  );
}

/**
 * After a build: the planned total, the difference to the target and the sentences of what is left or passed. The
 * suggestions count only the stock the planned items leave.
 */
function PlanResult({ day, foods, pantry, logs }: {
  day: NutritionDay; foods: readonly Food[]; pantry: readonly PantryItem[]; logs: readonly FoodLog[];
}) {
  const after = day.afterPlan!;
  const notes = nutritionNotes({ afterPlan: after, foods, pantry, day: day.day, left: stockLeft(pantry, logs, day.day) });
  return (
    <div className="nutri-plan stack" role="region" aria-label="Plano do resto do dia">
      <p>{`Planejado: ${nutrientsText(day.planned)}`}</p>
      <p>{`Depois do plano: ${[leftText(after.kcal, 'kcal'), ...MACROS.map((m) => `${MACRO_LETTER[m]} ${leftText(after[m], 'g')}`)].join(' · ')}`}</p>
      {notes.length > 0 && (
        <ul className="nutri-notes">
          {notes.map((n) => (
            <li key={n.macro}>
              {n.text}
              {n.suggestion && <span className="nutri-notes__suggestion">{` ${n.suggestion.text}`}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
