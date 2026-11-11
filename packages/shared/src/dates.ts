import type { DayKey, HHmm } from './types';

const pad = (n: number): string => String(n).padStart(2, '0');

export function toDayKey(d: Date): DayKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dayKeyOf(ts: number, dayStartHour: number): DayKey {
  const d = new Date(ts);
  d.setHours(d.getHours() - dayStartHour);
  return toDayKey(d);
}

export function dayKeyToDate(day: DayKey): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

export function addDays(day: DayKey, n: number): DayKey {
  const d = dayKeyToDate(day);
  d.setDate(d.getDate() + n);
  return toDayKey(d);
}

export function diffDays(from: DayKey, to: DayKey): number {
  return Math.round((dayKeyToDate(to).getTime() - dayKeyToDate(from).getTime()) / 86400000);
}

export function weekdayOf(day: DayKey): number {
  return dayKeyToDate(day).getDay();
}

export function parseHHmm(t: HHmm): number {
  const [h, m] = t.split(':').map(Number);
  return h! * 60 + m!;
}

export function formatHHmm(minutes: number): HHmm {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function timestampAt(day: DayKey, t: HHmm): number {
  const d = dayKeyToDate(day);
  d.setMinutes(parseHHmm(t));
  return d.getTime();
}

/**
 * Timestamp of time `t` within logical day `day` (§4): a time earlier than `dayStartHour`
 * belongs to the next calendar morning (02:00 on the 11th with day start 4 → 12th 02:00).
 */
export function logicalTimestamp(day: DayKey, t: HHmm, dayStartHour: number): number {
  return timestampAt(parseHHmm(t) < dayStartHour * 60 ? addDays(day, 1) : day, t);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

export function isValidDayKey(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toDayKey(dayKeyToDate(s)) === s;
}
