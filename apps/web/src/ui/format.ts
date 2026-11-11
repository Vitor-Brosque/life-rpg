import type { DayKey, Energy, EnergyLevel } from '@life/shared';
import { addDays, dayKeyToDate } from '@life/shared';

// Display formatting shared by capture, Agora, mission sheet (and later Planejar / Painel).

export const WEEKDAY_ABBR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 20 → "20 min", 60 → "1h", 90 → "1h30", 65 → "1h05". */
export function formatDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h${pad2(rest)}`;
}

/** today → "hoje", tomorrow → "amanhã", otherwise "ter 17/11". */
export function formatDay(day: DayKey, today: DayKey): string {
  if (day === today) return 'hoje';
  if (day === addDays(today, 1)) return 'amanhã';
  const d = dayKeyToDate(day);
  return `${WEEKDAY_ABBR[d.getDay()]} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

/** Signed points with a real minus sign: +20, −5, 0. */
export function formatPoints(p: number): string {
  if (p > 0) return `+${p}`;
  if (p < 0) return `−${Math.abs(p)}`;
  return '0';
}

export const ENERGY_LABEL: Record<Energy, string> = { light: 'leve', medium: 'média', heavy: 'pesada' };
export const ENERGY_OPTIONS: Energy[] = ['light', 'medium', 'heavy'];
export const ENERGY_LEVEL_LABEL: Record<EnergyLevel, string> = { low: 'baixa', medium: 'média', high: 'alta' };

export const DURATION_OPTIONS = [5, 15, 30, 60, 90];

/** "1 missão" / "3 missões". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Elapsed time in PT-BR: "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias". */
export function relativeTime(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'ontem' : `há ${days} dias`;
}
