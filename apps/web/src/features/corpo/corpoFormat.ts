import type { DayKey } from '@life/shared';
import { dayKeyToDate } from '@life/shared';
import { WEEKDAY_ABBR, plural } from '../../ui/format';

// Display helpers shared by Corpo and Casa (Marco 4).

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "sex 13/11" (always the date, never "hoje"). */
export function shortDay(day: DayKey): string {
  const d = dayKeyToDate(day);
  return `${WEEKDAY_ABBR[d.getDay()]} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

/** 0 → "nenhuma marmita", 1 → "1 marmita", 3 → "3 marmitas". */
export function marmitas(n: number): string {
  return n === 0 ? 'nenhuma marmita' : plural(n, 'marmita', 'marmitas');
}

/** Toast after "Comi uma" (Agora and Casa). */
export function eatToast(total: number, low: boolean): string {
  return `Bom proveito. No freezer: ${marmitas(total)}.${low ? ' Que tal marcar um preparo? Está em Planejar → Casa.' : ''}`;
}
