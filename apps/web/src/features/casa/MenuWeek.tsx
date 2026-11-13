import { useId, useRef, useState, type MouseEvent } from 'react';
import type { DayKey } from '@life/shared';
import { MEALS, MEAL_LABEL, addDays, slotOf, weekDays } from '@life/shared';
import { useAllRecipes, useMenu } from '../../db/casaData';
import { copyPreviousWeek } from '../../domain/mealActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { plural } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { shortDay } from '../corpo/corpoFormat';
import { focusHeadingIfLost } from './focusHeading';
import { RecipePicker, type PickTarget } from './RecipePicker';

/** "Cardápio": lunch and dinner for each day of the week, each a reusable recipe (spec §6.5). */
export function MenuWeek({ week }: { week: DayKey }) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const menu = useMenu(week);
  const previous = useMenu(addDays(week, -7));
  const recipes = useAllRecipes();
  const [picking, setPicking] = useState<PickTarget>();
  if (menu === undefined || previous === undefined || !recipes) {
    return <section className="casa__section" aria-labelledby={id} aria-busy="true"><h2 id={id} className="section-title">Cardápio</h2></section>;
  }
  const names = new Map(recipes.map((r) => [r.id, r.name]));
  const empty = !menu || menu.slots.length === 0;
  const canCopy = empty && !!previous && previous.slots.length > 0;
  const copy = (e: MouseEvent<HTMLButtonElement>) => {
    focusWhenGone(e.currentTarget, () => heading.current);
    safeRun(async () => {
      const n = await copyPreviousWeek(week);
      if (n > 0) useToast.getState().show(`Cardápio copiado: ${plural(n, 'refeição', 'refeições')}.`);
    });
  };
  const closePicker = () => {
    setPicking(undefined);
    focusHeadingIfLost(heading);
  };

  return (
    <section className="casa__section stack" aria-labelledby={id}>
      <h2 id={id} ref={heading} tabIndex={-1} className="section-title">Cardápio</h2>
      {canCopy && <div><Button onClick={copy}>Repetir a semana anterior</Button></div>}
      {empty && !canCopy && (
        <p className="muted">Escolha pratos simples para os dias de semana. Cada prato vira uma receita, com a lista de ingredientes.</p>
      )}
      <ul className="menu-week" aria-label="Cardápio da semana">
        {weekDays(week).map((day) => (
          <li key={day} className="menu-day">
            <span className="menu-day__label">{shortDay(day)}</span>
            {MEALS.map((meal) => {
              const slot = slotOf(menu ?? undefined, day, meal);
              const name = slot ? names.get(slot.recipeId) : undefined;
              const open = () => setPicking({ day, meal, ...(slot ? { recipeId: slot.recipeId } : {}) });
              return name ? (
                <button key={meal} type="button" className="menu-slot" onClick={open}
                  aria-label={`${MEAL_LABEL[meal]} de ${shortDay(day)}: ${name}`}>
                  <span className="menu-slot__meal">{MEAL_LABEL[meal]}</span>
                  <span className="menu-slot__dish">{name}</span>
                </button>
              ) : (
                <button key={meal} type="button" className="menu-slot menu-slot--empty" onClick={open}
                  aria-label={`Escolher ${MEAL_LABEL[meal].toLowerCase()} de ${shortDay(day)}`}>
                  {`+ ${MEAL_LABEL[meal]}`}
                </button>
              );
            })}
          </li>
        ))}
      </ul>
      <RecipePicker week={week} target={picking} onClose={closePicker} />
    </section>
  );
}
