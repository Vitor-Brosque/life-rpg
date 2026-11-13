import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearch } from 'wouter';
import type { DayKey, ShoppingRow } from '@life/shared';
import { SHOPPING_TEXT_MAX, dishCounts, isValidDayKey, planningWeek, shoppingRows, weekKey } from '@life/shared';
import { useAllRecipes, useMenu, useShoppingList } from '../../db/casaData';
import { useToday } from '../../db/hooks';
import { addShoppingItem, removeShoppingItem, toggleShoppingItem } from '../../domain/mealActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { weekLabel } from './casaFormat';
import './casa.css';

/** A `?semana=` that is a valid Monday, else the Casa tab's default week. */
function weekFrom(param: string | null, today: DayKey): DayKey {
  return param && isValidDayKey(param) && weekKey(param) === param ? param : planningWeek(today);
}

/** "/casa/compras": the week's list for the store — one hand, big rows, offline (spec §6.7). */
export function ShoppingScreen() {
  const today = useToday();
  const param = new URLSearchParams(useSearch()).get('semana');
  const week = today ? weekFrom(param, today) : undefined;
  const menu = useMenu(week);
  const list = useShoppingList(week);
  const recipes = useAllRecipes();
  const [text, setText] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  if (!today || !week || menu === undefined || list === undefined || !recipes) {
    return <section className="screen" aria-busy="true" aria-label="Lista de compras" />;
  }

  const rows = shoppingRows({ menu: menu ?? undefined, recipes, list: list ?? undefined });
  const dishes = dishCounts(menu ?? undefined, recipes);
  const bare = dishes.filter((d) => (recipes.find((r) => r.id === d.recipeId)?.ingredients.length ?? 0) === 0);
  const todo = rows.filter((r) => !r.checked);
  const done = rows.filter((r) => r.checked);
  const add = (e: FormEvent) => {
    e.preventDefault();
    const value = text;
    setText('');
    safeRun(addShoppingItem(week, value));
  };

  return (
    <section className="screen casa-screen stack" aria-labelledby="compras-title">
      <Link href="/planejar?aba=casa" className="settings__back">‹ Casa</Link>
      <h1 id="compras-title" ref={heading} tabIndex={-1}>Lista de compras</h1>
      <p className="casa__week-label">{weekLabel(week, today)}</p>
      {dishes.length > 0 && (
        <p className="shopping__dishes">{`Pratos da semana: ${dishes.map((d) => `${d.name} ×${d.count}`).join(' · ')}`}</p>
      )}
      {bare.length > 0 && (
        <p className="muted">
          {`Sem ingredientes: ${bare.map((d) => d.name).join(', ')}. Complete em `}
          <Link href="/casa/receitas">Receitas</Link>.
        </p>
      )}
      <form className="shopping__add" onSubmit={add}>
        <input aria-label="Novo item" placeholder="Adicionar item" value={text} maxLength={SHOPPING_TEXT_MAX}
          onChange={(e) => setText(e.target.value)} />
        <Button type="submit">Adicionar</Button>
      </form>
      {rows.length === 0 && (
        <p className="muted">A lista nasce do cardápio da semana. Escolha os pratos em Planejar → Casa ou adicione itens aqui.</p>
      )}
      {todo.length > 0 && (
        <ul className="shopping" aria-label="Para comprar">
          {todo.map((r) => <ShoppingItemRow key={r.key} row={r} week={week} heading={heading} />)}
        </ul>
      )}
      {done.length > 0 && (
        <section className="stack" aria-labelledby="carrinho-title">
          <h2 id="carrinho-title" className="section-title">{`No carrinho (${done.length})`}</h2>
          <ul className="shopping shopping--done" aria-label="No carrinho">
            {done.map((r) => <ShoppingItemRow key={r.key} row={r} week={week} heading={heading} />)}
          </ul>
        </section>
      )}
    </section>
  );
}

function ShoppingItemRow({ row, week, heading }: { row: ShoppingRow; week: DayKey; heading: React.RefObject<HTMLHeadingElement | null> }) {
  return (
    <li className={row.checked ? 'shopping-row is-done' : 'shopping-row'}>
      <label className="shopping-row__label">
        <input type="checkbox" className="px-checkbox" aria-label={row.text} data-shop-key={row.key} checked={row.checked}
          onChange={(e) => {
            // The row hops to the other list (a new element): follow it so focus never falls to <body>.
            const key = row.key;
            focusWhenGone(e.currentTarget, () =>
              document.querySelector<HTMLElement>(`input[data-shop-key="${CSS.escape(key)}"]`) ?? heading.current);
            safeRun(toggleShoppingItem(week, key));
          }} />
        <span className="shopping-row__text">
          {row.text}
          {row.from.length > 0 && <span className="shopping-row__from">{row.from.join(', ')}</span>}
        </span>
      </label>
      {row.manualId && (
        <Button size="sm" variant="ghost" aria-label={`Remover ${row.text}`}
          onClick={(e) => {
            focusWhenGone(e.currentTarget, () => heading.current);
            safeRun(removeShoppingItem(week, row.manualId!));
          }}>Remover</Button>
      )}
    </li>
  );
}
