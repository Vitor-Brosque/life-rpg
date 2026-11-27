import type { DayKey, DayMode, DayState, ObservationSettings } from './types';
import { addDays, diffDays, isValidDayKey } from './dates';
import { periodDays } from './periods';
import { sleepMinutes } from './sleep';
import { dayIndex, type PatternData } from './trends';
import { CONCENTRATIONS, CONCENTRATION_LABEL, LOADS, LOAD_LABEL, MOODS, MOOD_LABEL, TIREDNESS, TIREDNESS_LABEL } from './dayClose';

// Observação de 14 dias (2026-11-23): an optional mode he turns on in the Diário. While it runs, the evening card says
// "Observação: dia N de 14" and nothing else; at the end, a summary of what was recorded, as counts of days, with
// "sem registro" apart and no interpretation. One observation at a time, kept in settings.

export const OBSERVATION_DAYS = 14;

export const OBSERVATION_INTRO = 'Por 14 dias, marque no "Como foi hoje?" o humor, a sobrecarga e a concentração, se quiser. '
  + 'No fim, aparece um resumo do que foi registrado. Nada é obrigatório e nada avisa.';
export const OBSERVATION_COUNT_NOTE = 'Cada número conta dias (no sono, a noite antes de cada dia).';
export const OBSERVATION_NOTE = 'É o que foi registrado, sem interpretação. Associação, não causa: 14 dias são poucos pontos '
  + 'e não sustentam conclusões. Para comparar com outra época, monte um relatório de período personalizado.';

/** `settings.observation` when it is usable (a valid start; an end only when valid and not before the start). */
export function observationOf(s?: { observation?: Partial<ObservationSettings> }): ObservationSettings | undefined {
  const o = s?.observation;
  if (!o || typeof o.startDay !== 'string' || !isValidDayKey(o.startDay)) return undefined;
  const ended = typeof o.endedDay === 'string' && isValidDayKey(o.endedDay) && o.endedDay >= o.startDay ? o.endedDay : undefined;
  return { startDay: o.startDay, ...(ended ? { endedDay: ended } : {}) };
}

export type ObservationState =
  | { kind: 'none' }
  | { kind: 'active'; start: DayKey; day: number; plannedEnd: DayKey }
  | { kind: 'ended'; start: DayKey; end: DayKey; days: number };

/**
 * None; active on day N of 14 (from the start day, which is day 1); or ended — by "Encerrar observação" (its day,
 * never past day 14) or because the 14 days went by (nothing is written for that).
 */
export function observationState(o: ObservationSettings | undefined, today: DayKey): ObservationState {
  if (!o) return { kind: 'none' };
  const plannedEnd = addDays(o.startDay, OBSERVATION_DAYS - 1);
  if (o.endedDay !== undefined || today > plannedEnd) {
    const end = o.endedDay !== undefined && o.endedDay < plannedEnd ? o.endedDay : plannedEnd;
    return { kind: 'ended', start: o.startDay, end, days: diffDays(o.startDay, end) + 1 };
  }
  return { kind: 'active', start: o.startDay, day: Math.max(1, diffDays(o.startDay, today) + 1), plannedEnd };
}

/** "Observação: dia 3 de 14" (the evening card). */
export const observationDayText = (day: number): string => `Observação: dia ${day} de ${OBSERVATION_DAYS}`;

export interface ObservationLine { label: string; text: string }
export interface ObservationSummary { start: DayKey; end: DayKey; days: number; lines: ObservationLine[] }

const DAY_MODES: readonly DayMode[] = ['normal', 'low', 'recovery', 'free'];
const DAY_MODE_TEXT: Record<DayMode, string> = { normal: 'Normal', low: 'Baixa energia', recovery: 'Recuperação', free: 'Livre' };
const SLEEP_BUCKETS: ReadonlyArray<{ label: string; below: number }> = [
  { label: 'menos de 6h', below: 360 }, { label: '6h a 7h', below: 420 }, { label: '7h a 8h', below: 480 },
  { label: '8h ou mais', below: Infinity },
];

/** "Ok 5 · Bem 3 · sem registro 6": the levels that happened, in order, then the days without a record. */
function distribution<T extends string>(values: readonly (T | undefined)[], order: readonly T[], label: (v: T) => string): string {
  const parts = order.flatMap((v) => {
    const n = values.filter((x) => x === v).length;
    return n > 0 ? [`${label(v)} ${n}`] : [];
  });
  const missing = values.filter((x) => x === undefined).length;
  if (missing > 0) parts.push(`sem registro ${missing}`);
  return parts.join(' · ');
}

/**
 * The summary of [start, end] (each day counted once): days with some record (the day started, typed or closed, a
 * state choice, a night, a block session or a workout); then, per day, the night before by duration, the day type,
 * humor, sobrecarga, concentração and cansaço, each with "sem registro" apart; and the blocks started of those
 * counted (days before today only, and only when a block session exists — otherwise "sem registro").
 */
export function observationSummary(data: PatternData, range: { start: DayKey; end: DayKey }): ObservationSummary {
  const days = periodDays(range);
  const states = new Map<DayKey, DayState>(data.dayStates.filter((s) => !s.deleted).map((s) => [s.id, s]));
  const nights = new Map(data.sleepLogs.filter((l) => !l.deleted).map((l) => [l.night, l]));
  const sessionDays = new Set(data.sessions.filter((s) => !s.deleted).map((s) => s.day));
  const workoutDays = new Set(data.workouts.filter((w) => !w.deleted).map((w) => w.day));
  const idx = dayIndex(data);

  const recorded = days.filter((d) => {
    const s = states.get(d);
    const night = nights.get(addDays(d, -1));
    return (s !== undefined && (s.startedAt !== undefined || s.mode !== undefined || s.closedAt !== undefined
      || s.tiredness !== undefined || s.mood !== undefined || s.load !== undefined || s.concentration !== undefined))
      || (night !== undefined && (night.bedAt !== undefined || night.wakeAt !== undefined))
      || sessionDays.has(d) || workoutDays.has(d);
  }).length;

  const sleep = days.map((d) => {
    const night = nights.get(addDays(d, -1));
    const min = night ? sleepMinutes(night) : undefined;
    return min === undefined ? undefined : SLEEP_BUCKETS.find((b) => min < b.below)!.label;
  });
  const modes = days.map((d) => idx.recordedMode(d) ?? (states.get(d)?.startedAt !== undefined ? idx.mode(d) : undefined));

  const blockDays = days.filter((d) => d < data.today);
  let blocks = 'sem registro';
  if (blockDays.some((d) => sessionDays.has(d))) {
    let planned = 0;
    let started = 0;
    let minimum = 0;
    for (const d of blockDays) {
      for (const cb of idx.blocks(d)) {
        planned += 1;
        if (cb.started) {
          started += 1;
          if (cb.minimum) minimum += 1;
        }
      }
    }
    if (planned > 0) {
      blocks = `${started} de ${planned} iniciados${minimum > 0 ? ` (versão mínima em ${minimum})` : ''}`
        + `${range.end >= data.today ? ' · até ontem' : ''}`;
    }
  }

  return {
    start: range.start,
    end: range.end,
    days: days.length,
    lines: [
      { label: 'Dias com algum registro', text: `${recorded} de ${days.length}` },
      { label: 'Sono', text: distribution(sleep, SLEEP_BUCKETS.map((b) => b.label), (v) => v) },
      { label: 'Tipo do dia', text: distribution(modes, DAY_MODES, (m) => DAY_MODE_TEXT[m]) },
      { label: 'Humor', text: distribution(days.map((d) => states.get(d)?.mood), MOODS, (v) => MOOD_LABEL[v]) },
      { label: 'Sobrecarga', text: distribution(days.map((d) => states.get(d)?.load), LOADS, (v) => LOAD_LABEL[v]) },
      { label: 'Concentração', text: distribution(days.map((d) => states.get(d)?.concentration), CONCENTRATIONS, (v) => CONCENTRATION_LABEL[v]) },
      { label: 'Cansaço', text: distribution(days.map((d) => states.get(d)?.tiredness), TIREDNESS, (v) => TIREDNESS_LABEL[v]) },
      { label: 'Blocos', text: blocks },
    ],
  };
}
