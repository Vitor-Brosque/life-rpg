import { describe, expect, it } from 'vitest';
import type { DayState } from '../src/types';
import { timestampAt } from '../src/dates';
import { observationDayText, observationOf, observationState, observationSummary } from '../src/observation';
import { base, block, emptyData, night, session, workout } from './patternFixture';

const dayState = (id: string, p: Partial<DayState>): DayState => ({ ...base, id, hardDay: false, reviewDone: false, ...p });

describe('the observation in settings', () => {
  it('a valid start is needed; an end before the start is dropped', () => {
    expect(observationOf(undefined)).toBeUndefined();
    expect(observationOf({})).toBeUndefined();
    expect(observationOf({ observation: { startDay: '2026-13-01' } })).toBeUndefined();
    expect(observationOf({ observation: { startDay: '2026-11-23', endedDay: '2026-11-20' } })).toEqual({ startDay: '2026-11-23' });
    expect(observationOf({ observation: { startDay: '2026-11-23', endedDay: '2026-11-27' } })).toEqual({ startDay: '2026-11-23', endedDay: '2026-11-27' });
  });
  it('none, day N of 14, ended by the 14 days or by "Encerrar"', () => {
    expect(observationState(undefined, '2026-11-23')).toEqual({ kind: 'none' });
    expect(observationState({ startDay: '2026-11-23' }, '2026-11-23')).toEqual({ kind: 'active', start: '2026-11-23', day: 1, plannedEnd: '2026-12-06' });
    expect(observationState({ startDay: '2026-11-23' }, '2026-12-06')).toMatchObject({ kind: 'active', day: 14 });
    expect(observationState({ startDay: '2026-11-23' }, '2026-12-07')).toEqual({ kind: 'ended', start: '2026-11-23', end: '2026-12-06', days: 14 });
    expect(observationState({ startDay: '2026-11-23', endedDay: '2026-11-27' }, '2026-11-27')).toEqual({ kind: 'ended', start: '2026-11-23', end: '2026-11-27', days: 5 });
    expect(observationState({ startDay: '2026-11-23', endedDay: '2026-12-20' }, '2026-12-20')).toMatchObject({ end: '2026-12-06', days: 14 });
    expect(observationState({ startDay: '2026-11-23' }, '2026-11-22')).toMatchObject({ kind: 'active', day: 1 });
    expect(observationDayText(3)).toBe('Observação: dia 3 de 14');
  });
});

describe('observationSummary', () => {
  const TECH = block({ id: 'tech', name: 'Tech News' });
  const data = emptyData({
    today: '2026-11-23',
    blocks: [TECH],
    sessions: [session('tech', '2026-11-09'), session('tech', '2026-11-10', '09:00', 'minimum'), session('tech', '2026-11-12')],
    dayStates: [
      dayState('2026-11-09', { startedAt: timestampAt('2026-11-09', '08:00'), mood: 'ok', load: 'media', concentration: 'boa', tiredness: 'medio' }),
      dayState('2026-11-10', { mode: 'low', mood: 'baixo', load: 'pesada', concentration: 'dificil', tiredness: 'muito' }),
      dayState('2026-11-11', { closedAt: timestampAt('2026-11-11', '22:00'), mood: 'ok' }),
      dayState('2026-11-14', { mode: 'free' }),
      { ...dayState('2026-11-16', { mood: 'bem' }), deleted: true },
    ],
    sleepLogs: [night('2026-11-08', '23:30', 450), night('2026-11-09', '00:10', 400), night('2026-11-10', '23:50'), night('2026-11-12', '23:00', 300)],
    workouts: [workout('2026-11-15', 'cardio', 20)],
  });
  const RANGE = { start: '2026-11-09', end: '2026-11-22' };

  it('counts days, with "sem registro" apart and only the levels that happened', () => {
    expect(observationSummary(data, RANGE)).toEqual({
      start: '2026-11-09', end: '2026-11-22', days: 14,
      lines: [
        { label: 'Dias com algum registro', text: '7 de 14' },
        { label: 'Sono', text: 'menos de 6h 1 · 6h a 7h 1 · 7h a 8h 1 · sem registro 11' },
        { label: 'Tipo do dia', text: 'Normal 1 · Baixa energia 1 · Livre 1 · sem registro 11' },
        { label: 'Humor', text: 'Para baixo 1 · Ok 2 · sem registro 11' },
        { label: 'Sobrecarga', text: 'Média 1 · Pesada 1 · sem registro 12' },
        { label: 'Concentração', text: 'Difícil 1 · Boa 1 · sem registro 12' },
        { label: 'Cansaço', text: 'Médio 1 · Muito 1 · sem registro 12' },
        { label: 'Blocos', text: '3 de 10 iniciados (versão mínima em 1)' },
      ],
    });
  });
  it('no block session: "sem registro", never "0 de N"; nothing at all: every line says so', () => {
    const empty = observationSummary(emptyData({ today: '2026-11-23', blocks: [TECH] }), RANGE);
    expect(empty.lines).toEqual([
      { label: 'Dias com algum registro', text: '0 de 14' },
      { label: 'Sono', text: 'sem registro 14' },
      { label: 'Tipo do dia', text: 'sem registro 14' },
      { label: 'Humor', text: 'sem registro 14' },
      { label: 'Sobrecarga', text: 'sem registro 14' },
      { label: 'Concentração', text: 'sem registro 14' },
      { label: 'Cansaço', text: 'sem registro 14' },
      { label: 'Blocos', text: 'sem registro' },
    ]);
  });
  it('ended today: the blocks count until yesterday and say so', () => {
    const s = observationSummary({ ...data, today: '2026-11-12' }, { start: '2026-11-09', end: '2026-11-12' });
    expect(s.days).toBe(4);
    expect(s.lines.at(-1)).toEqual({ label: 'Blocos', text: '2 de 3 iniciados (versão mínima em 1) · até ontem' });
  });
});
