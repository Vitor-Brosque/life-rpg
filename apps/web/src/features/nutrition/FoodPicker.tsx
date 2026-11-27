import { useRef, useState } from 'react';
import type { DayKey, Food, ID, PantryItem } from '@life/shared';
import { basisNote, foodChoices, inStockToday, isRecipe } from '@life/shared';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';

const MAX_OPTIONS = 20;

/**
 * Choosing a food (spec §6): a search by name (any case or accent) and the list, today's stock first. Once chosen it
 * shows the food and "Trocar". Used by "Adicionar o que comi", "Adicionar ao estoque" and the recipe ingredients.
 */
export function FoodPicker({ foods, pantry, day, selected, onSelect, exclude, label = 'Alimento', autoFocus }: {
  foods: readonly Food[]; pantry: readonly PantryItem[]; day: DayKey; selected?: Food; onSelect(f: Food | undefined): void;
  exclude?: ID; label?: string;
  /** The search takes the focus when it appears (it replaced the button that opened it). */
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);

  if (selected) {
    return (
      <div className="nutri-picked">
        <span className="field__label">{label}</span>
        <p className="nutri-picked__name">{`${selected.name}${basisNote(selected.basis)}`}</p>
        <Button size="sm" variant="ghost" aria-label={`Trocar ${selected.name}`}
          onClick={(e) => { focusWhenGone(e.currentTarget, () => search.current); onSelect(undefined); }}>
          Trocar
        </Button>
      </div>
    );
  }

  const list = foodChoices(foods, query, pantry, day).filter((f) => f.id !== exclude);
  return (
    <div className="nutri-picker">
      <label className="field">
        <span className="field__label">{`${label}: buscar pelo nome`}</span>
        <input ref={search} type="search" autoComplete="off" autoFocus={autoFocus} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {list.length === 0 ? (
        <p className="muted">Nada encontrado.</p>
      ) : (
        <ul className="nutri-picker__list" aria-label="Alimentos">
          {list.slice(0, MAX_OPTIONS).map((f) => {
            const stock = inStockToday(pantry, f.id, day);
            const name = `${f.name}${basisNote(f.basis)}`;
            return (
              <li key={f.id}>
                <button type="button" className="nutri-picker__option" onClick={() => onSelect(f)}
                  aria-label={`${name}${isRecipe(f) ? ', receita' : ''}${stock ? ', tem hoje' : ''}`}>
                  <span className="nutri-picker__name">{name}</span>
                  {isRecipe(f) && <span className="nutri-tag">receita</span>}
                  {stock && <span className="nutri-tag">tem hoje</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {list.length > MAX_OPTIONS && <p className="muted">Busque pelo nome para ver os outros.</p>}
    </div>
  );
}
