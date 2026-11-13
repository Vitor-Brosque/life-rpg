import type { DayKey } from './types';
import { addDays, diffDays } from './dates';
import { weekKey } from './weekStats';

/** Calendar month, 'YYYY-MM'. */
export type MonthKey = string;
export type PeriodKind = 'week' | 'month';
/** A week (Monday to Sunday) or a calendar month; `end` is included. */
export interface Period { kind: PeriodKind; key: string; start: DayKey; end: DayKey; label: string }

export const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
] as const;
export const MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;
export const WEEKDAY_NAMES = [
  'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado',
] as const;

export type PartOfDay = 'manha' | 'tarde' | 'noite';
export const PARTS_OF_DAY: readonly PartOfDay[] = ['manha', 'tarde', 'noite'];
export const PART_LABEL: Record<PartOfDay, string> = { manha: 'manhã', tarde: 'tarde', noite: 'noite' };

const pad2 = (n: number): string => String(n).padStart(2, '0');
const monthIndex = (month: MonthKey): number => Number(month.slice(5, 7)) - 1;

export const monthKeyOf = (day: DayKey): MonthKey => day.slice(0, 7);

export function addMonths(month: MonthKey, n: number): MonthKey {
  const d = new Date(Number(month.slice(0, 4)), monthIndex(month) + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export const monthStart = (month: MonthKey): DayKey => `${month}-01`;
export const monthEnd = (month: MonthKey): DayKey => addDays(monthStart(addMonths(month, 1)), -1);
/** 'outubro'. */
export const monthName = (month: MonthKey): string => MONTH_NAMES[monthIndex(month)]!;

export function weekPeriod(monday: DayKey): Period {
  return {
    kind: 'week', key: monday, start: monday, end: addDays(monday, 6),
    label: `${monday.slice(8, 10)}/${monday.slice(5, 7)}`,
  };
}

export function monthPeriod(month: MonthKey): Period {
  return { kind: 'month', key: month, start: monthStart(month), end: monthEnd(month), label: MONTH_ABBR[monthIndex(month)]! };
}

/** The `count` whole weeks before the week of `today`, oldest → newest. */
export function completedWeeks(today: DayKey, count: number): Period[] {
  const last = addDays(weekKey(today), -7);
  return Array.from({ length: count }, (_, i) => weekPeriod(addDays(last, -7 * (count - 1 - i))));
}

/** The `count` whole months before the month of `today`, oldest → newest. */
export function completedMonths(today: DayKey, count: number): Period[] {
  const last = addMonths(monthKeyOf(today), -1);
  return Array.from({ length: count }, (_, i) => monthPeriod(addMonths(last, -(count - 1 - i))));
}

export function periodDays(p: Pick<Period, 'start' | 'end'>): DayKey[] {
  return Array.from({ length: diffDays(p.start, p.end) + 1 }, (_, i) => addDays(p.start, i));
}

/** Drops the periods that ended before `firstDay` (the first day with any activity); none without it. */
export function periodsSince(periods: readonly Period[], firstDay: DayKey | undefined): Period[] {
  return firstDay === undefined ? [] : periods.filter((p) => p.end >= firstDay);
}

/** Morning from the day start to 12h, afternoon from 12h to 18h, night otherwise. */
export function partOfDay(ts: number, dayStartHour: number): PartOfDay {
  const h = new Date(ts).getHours();
  if (h >= dayStartHour && h < 12) return 'manha';
  if (h >= 12 && h < 18) return 'tarde';
  return 'noite';
}
