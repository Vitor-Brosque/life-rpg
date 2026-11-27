import { useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import type { Food } from '@life/shared';
import {
  FOOD_BASIS_LABEL, FOOD_GROUP_LABEL, FOOD_SOURCE_LABEL, estimateText, foodChoices, goodForText, isRecipe, nutrientsText,
} from '@life/shared';
import { useFoods } from '../../db/nutritionData';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE, focusWhenGone } from '../../ui/focusAfter';
import { Sheet } from '../../ui/Sheet';
import { FoodForm, RecipeForm } from './FoodForms';
import './nutrition.css';

type Editing = { kind: 'food' | 'recipe'; food?: Food };
const PATH = '/corpo/nutricao/alimentos';

/** "/corpo/nutricao/alimentos": foods and recipes with search, "Novo alimento" and "Nova receita" (spec §6). */
export function FoodsScreen() {
  const foods = useFoods();
  const [, navigate] = useLocation();
  const asked = new URLSearchParams(useSearch()).get('novo');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Editing | undefined>(() => (
    asked === 'alimento' ? { kind: 'food' } : asked === 'receita' ? { kind: 'recipe' } : undefined
  ));
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const shown = foods ? foodChoices(foods, query, [], '') : [];

  const open = (e: { currentTarget: HTMLElement }, next: Editing) => { opener.current = e.currentTarget; setEditing(next); };
  const close = () => {
    setEditing(undefined);
    // "?novo=" opened the form from another screen: it is done, a reload must not open it again.
    if (asked) navigate(PATH, { replace: true });
    // A deleted food's row leaves a moment after the sheet closes (the live query), taking the focus with it.
    focusWhenGone(opener.current, () => heading.current);
  };
  const title = editing?.food ? (editing.kind === 'recipe' ? 'Editar receita' : 'Editar alimento')
    : editing?.kind === 'recipe' ? 'Nova receita' : 'Novo alimento';

  return (
    <section className="screen nutri stack" aria-labelledby="foods-title">
      <Link href="/corpo/nutricao" className="settings__back">‹ Nutrição</Link>
      <h1 id="foods-title" ref={heading} tabIndex={-1} data-focus-target={FOCUS_PAGE}>Alimentos e receitas</h1>
      <div className="nutri__links">
        <Button variant="primary" icon="plus" onClick={(e) => open(e, { kind: 'food' })}>Novo alimento</Button>
        <Button icon="plus" onClick={(e) => open(e, { kind: 'recipe' })}>Nova receita</Button>
      </div>
      {foods && foods.length > 0 && (
        <label className="field">
          <span className="field__label">Buscar alimento</span>
          <input type="search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      {foods && foods.length === 0 && (
        <p className="muted">
          Nenhum alimento ainda. Cadastre os que você come com os valores por 100 g do rótulo ou de uma tabela; uma receita
          soma os ingredientes e divide pelo peso pronto.
        </p>
      )}
      {foods && foods.length > 0 && shown.length === 0 && <p className="muted">Nada encontrado.</p>}
      {shown.length > 0 && (
        <ul className="nutri-foods" aria-label="Alimentos e receitas">
          {shown.map((f) => {
            const details = [FOOD_BASIS_LABEL[f.basis], FOOD_SOURCE_LABEL[f.source], FOOD_GROUP_LABEL[f.group], goodForText(f)].filter(Boolean).join(' · ');
            const name = `${f.name}${isRecipe(f) ? ', receita' : ''}${f.source === 'estimativa' ? `, ${estimateText(true)}` : ''}`;
            return (
              <li key={f.id}>
                <button type="button" className="nutri-food" aria-label={`${name}. Por 100 g: ${nutrientsText(f.per100)}. ${details}`}
                  onClick={(e) => open(e, { kind: isRecipe(f) ? 'recipe' : 'food', food: f })}>
                  <span className="nutri-food__name">
                    {f.name}
                    {isRecipe(f) && <span className="nutri-tag">receita</span>}
                    {f.source === 'estimativa' && <span className="nutri-tag">{estimateText(true)}</span>}
                  </span>
                  <span className="nutri-food__meta">{`Por 100 g: ${nutrientsText(f.per100)}`}</span>
                  <span className="nutri-food__meta">{details}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Sheet open={!!editing} onClose={close} title={title} placement="top">
        {editing && foods && (editing.kind === 'recipe'
          ? <RecipeForm key={editing.food?.id ?? 'nova'} recipe={editing.food} foods={foods} onClose={close} />
          : <FoodForm key={editing.food?.id ?? 'novo'} food={editing.food} onClose={close} />)}
      </Sheet>
    </section>
  );
}
