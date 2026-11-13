import { useId, useState } from 'react';
import { Link } from 'wouter';
import type { DayKey } from '@life/shared';
import { addDays, planningWeek, shoppingRows } from '@life/shared';
import { useAllRecipes, useMenu, useShoppingList } from '../../db/casaData';
import { useToday } from '../../db/hooks';
import { Button } from '../../ui/Button';
import { itemsText, weekLabel } from './casaFormat';
import { FreezerSection } from './FreezerSection';
import { MenuWeek } from './MenuWeek';
import './casa.css';

/** Planejar → "Casa": the week's menu, the shopping list summary and the freezer (spec §6.5). */
export function CasaView() {
  const today = useToday();
  const recipes = useAllRecipes();
  const [chosen, setChosen] = useState<DayKey>();
  const week = chosen ?? (today ? planningWeek(today) : undefined);
  if (!today || !week) return null;
  const liveRecipes = (recipes ?? []).filter((r) => !r.deleted).length;
  return (
    <div className="casa stack">
      <div className="casa__week">
        <Button size="sm" variant="ghost" aria-label="Semana anterior" onClick={() => setChosen(addDays(week, -7))}>‹</Button>
        <p className="casa__week-label" aria-live="polite">{weekLabel(week, today)}</p>
        <Button size="sm" variant="ghost" aria-label="Próxima semana" onClick={() => setChosen(addDays(week, 7))}>›</Button>
      </div>
      <MenuWeek week={week} />
      <ShoppingSummary week={week} />
      <FreezerSection week={week} today={today} />
      <Link href="/casa/receitas" className="casa__link">{`Receitas (${liveRecipes})`}</Link>
    </div>
  );
}

function ShoppingSummary({ week }: { week: DayKey }) {
  const id = useId();
  const menu = useMenu(week);
  const list = useShoppingList(week);
  const recipes = useAllRecipes();
  const rows = menu !== undefined && list !== undefined && recipes
    ? shoppingRows({ menu: menu ?? undefined, recipes, list: list ?? undefined }) : undefined;
  return (
    <section className="casa__section stack" aria-labelledby={id}>
      <h2 id={id} className="section-title">Compras</h2>
      {rows && <p>{itemsText(rows.length, rows.filter((r) => r.checked).length)}</p>}
      <Link href={`/casa/compras?semana=${week}`} className="casa__link">Abrir lista de compras</Link>
    </section>
  );
}
