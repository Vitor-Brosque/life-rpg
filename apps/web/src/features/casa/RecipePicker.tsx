import { useState, type KeyboardEvent } from 'react';
import type { DayKey, ID, MealKind } from '@life/shared';
import { MEAL_LABEL, RECIPE_NAME_MAX, cleanText, ingredientKey } from '@life/shared';
import { useAllRecipes } from '../../db/casaData';
import { ensureRecipe, setMenuSlot } from '../../domain/mealActions';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { shortDay } from '../corpo/corpoFormat';

export interface PickTarget { day: DayKey; meal: MealKind; recipeId?: ID }

/** "Almoço de seg 09/11": pick a recipe, create one by typing its name, or clear the meal (spec §6.5). */
export function RecipePicker({ week, target, onClose }: { week: DayKey; target?: PickTarget; onClose(): void }) {
  const title = target ? `${MEAL_LABEL[target.meal]} de ${shortDay(target.day)}` : '';
  return (
    <Sheet open={!!target} onClose={onClose} title={title} placement="top">
      {target && <PickerBody key={`${target.day}-${target.meal}`} week={week} target={target} onClose={onClose} />}
    </Sheet>
  );
}

const MAX_OPTIONS = 8;

function PickerBody({ week, target, onClose }: { week: DayKey; target: PickTarget; onClose(): void }) {
  const recipes = useAllRecipes();
  const [query, setQuery] = useState('');
  const live = (recipes ?? []).filter((r) => !r.deleted);
  const q = ingredientKey(query);
  const options = live
    .filter((r) => ingredientKey(r.name).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, MAX_OPTIONS);
  const exact = q ? live.find((r) => ingredientKey(r.name) === q) : undefined;

  const choose = (recipeId: ID | null) => safeRun(setMenuSlot(week, target.day, target.meal, recipeId).then(onClose));
  const create = () => safeRun(ensureRecipe(query)
    .then((r) => setMenuSlot(week, target.day, target.meal, r.id))
    .then(onClose));
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (exact) choose(exact.id);
    else if (q) create();
  };

  return (
    <div className="recipe-picker stack">
      <label className="field">
        <span className="field__label">Prato</span>
        {/* The sheet opens to type a dish: focusing the field is the point here. */}
        <input autoFocus value={query} placeholder="ex.: frango com arroz" maxLength={RECIPE_NAME_MAX}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} />
      </label>
      {options.length > 0 && (
        <ul className="recipe-picker__options" aria-label="Receitas">
          {options.map((r) => (
            <li key={r.id}>
              <Button variant="ghost" className="recipe-picker__option" onClick={() => choose(r.id)}>{r.name}</Button>
            </li>
          ))}
        </ul>
      )}
      {q && !exact && <Button variant="primary" onClick={create}>{`Criar “${cleanText(query, RECIPE_NAME_MAX)}”`}</Button>}
      {target.recipeId && <Button variant="ghost" onClick={() => choose(null)}>Tirar do cardápio</Button>}
    </div>
  );
}
