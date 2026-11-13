import { useState, type MouseEvent } from 'react';
import { MEAL_LABEL } from '@life/shared';
import { Icon } from '../../art/icons';
import { useMealNow } from '../../db/casaData';
import { eatPortion, undoFreezerMove } from '../../domain/mealActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { eatToast } from '../corpo/corpoFormat';

/** "Almoço: Frango com arroz · 4 no freezer" + "Comi uma" (spec §6.1); nothing without a planned dish. */
export function MealRow() {
  const meal = useMealNow();
  const [busy, setBusy] = useState(false);
  if (!meal || meal.eaten) return null;

  const eat = (e: MouseEvent<HTMLButtonElement>) => {
    focusWhenGone(e.currentTarget);
    setBusy(true);
    safeRun(eatPortion(meal.recipeId, meal.meal).then((r) => {
      if (!r.move) return;
      const id = r.move.id;
      useToast.getState().show(eatToast(r.total, r.low), { label: 'Desfazer', run: () => safeRun(undoFreezerMove(id)) });
    }).finally(() => setBusy(false)));
  };

  return (
    <div className="care-row" role="group" aria-label="Refeição">
      <Icon name="leaf" size={24} className="care-row__icon" />
      <span className="care-row__text">
        {`${MEAL_LABEL[meal.meal]}: ${meal.name}`}
        {meal.portions > 0 && <span className="care-row__meta">{` · ${meal.portions} no freezer`}</span>}
      </span>
      {meal.portions > 0 && (
        <span className="care-row__actions">
          <Button size="sm" disabled={busy} aria-label={`Comi uma: ${meal.name}`} onClick={eat}>Comi uma</Button>
        </span>
      )}
    </div>
  );
}
