import type { DayKey, SleepNight, SleepSpread, WorkoutKind } from '@life/shared';
import { WORKOUT_KINDS, WORKOUT_LABEL, clockFromNoon, dayKeyToDate } from '@life/shared';
import { WEEKDAY_ABBR, formatDuration, plural } from '../../ui/format';

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

/** "2 musculação · 1 cardio": only the kinds that happened, in the usual order. */
export function kindsText(byKind: Record<WorkoutKind, number>): string {
  return WORKOUT_KINDS.filter((k) => byKind[k] > 0).map((k) => `${byKind[k]} ${WORKOUT_LABEL[k].toLowerCase()}`).join(' · ');
}

/** "00:40 em média · variação típica ±55 min". */
export function spreadText(s: SleepSpread): string {
  return `${clockFromNoon(s.meanMin)} em média · variação típica ±${formatDuration(s.spreadMin)}`;
}

/** "entre 23:10 e 02:30". */
export function rangeText(s: SleepSpread): string {
  return `entre ${clockFromNoon(s.earliestMin)} e ${clockFromNoon(s.latestMin)}`;
}

/** "23:40 → 07:10, 7h30" · "23:40 → —" · "— → 07:10" · "sem registro". */
export function nightText(n: SleepNight): string {
  if (n.bedMin === undefined && n.wakeMin === undefined) return 'sem registro';
  const bed = n.bedMin !== undefined ? clockFromNoon(n.bedMin) : '—';
  const wake = n.wakeMin !== undefined ? clockFromNoon(n.wakeMin) : '—';
  return `${bed} → ${wake}${n.minutes !== undefined ? `, ${formatDuration(n.minutes)}` : ''}`;
}
