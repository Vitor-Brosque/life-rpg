import type { DayKey } from '@life/shared';
import { addDays, dayKeyToDate, weekKey } from '@life/shared';
import { plural } from '../../ui/format';

// Display helpers of the Casa tab and screens (Marco 4).

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "09–15/11", or "30/11–06/12" across months. */
export function weekRange(week: DayKey): string {
  const a = dayKeyToDate(week);
  const b = dayKeyToDate(addDays(week, 6));
  const end = `${pad2(b.getDate())}/${pad2(b.getMonth() + 1)}`;
  return a.getMonth() === b.getMonth() ? `${pad2(a.getDate())}–${end}` : `${pad2(a.getDate())}/${pad2(a.getMonth() + 1)}–${end}`;
}

/** "Esta semana · 09–15/11" · "Próxima semana · 16–22/11" · "Semana de 02–08/11". */
export function weekLabel(week: DayKey, today: DayKey): string {
  const current = weekKey(today);
  if (week === current) return `Esta semana · ${weekRange(week)}`;
  if (week === addDays(current, 7)) return `Próxima semana · ${weekRange(week)}`;
  return `Semana de ${weekRange(week)}`;
}

/** "12 itens · 3 no carrinho" or "Nenhum item ainda.". */
export function itemsText(total: number, checked: number): string {
  return total === 0 ? 'Nenhum item ainda.' : `${plural(total, 'item', 'itens')} · ${checked} no carrinho`;
}

/** "5 ingredientes" · "1 ingrediente" · "sem ingredientes". */
export function ingredientsText(n: number): string {
  return n === 0 ? 'sem ingredientes' : plural(n, 'ingrediente', 'ingredientes');
}

/** The low-freezer suggestion. */
export function lowText(total: number): string {
  const head = total === 0 ? 'O freezer está vazio.' : total === 1 ? 'Resta 1 marmita.' : `Restam ${total} marmitas.`;
  return `${head} Que tal marcar um preparo em lote?`;
}
