import { describe, expect, it } from 'vitest';
import type { TrendPoint, WatchNotice } from '@life/shared';
import { monthPeriod, weekPeriod } from '@life/shared';
import {
  balanceText, blocksText, checkinsText, decimal, methodLines, monthObservedRows, monthTitle, postponeTotalsText,
  practiceText, resumptionsText, reviewsText, seriesText, sleepBlocksLines, sleepModeLines, sleepText, span,
  watchExperiment, watchObservedText, workoutsText,
} from '../src/features/patterns/patternText';

const pt = (monday: string, p: Partial<TrendPoint> = {}): TrendPoint => ({
  period: weekPeriod(monday), workdays: 5, activeWorkdays: 0, blocksPlanned: 0, blocksStarted: 0, minimumUsed: 0,
  resumptions: 0, reviews: 0, learnedReviews: 0, learnedCorrect: 0, practiceClosed: 0,
  practiceTop: { delivered: 0, understood: 0, autonomous: 0 }, sleepNights: 0, workouts: 0, workoutMinutes: 0,
  cardio: 0, startCheckins: 0, escapes: 0, ...p,
});
const two = [
  pt('2026-10-26', {
    blocksPlanned: 5, blocksStarted: 3, minimumUsed: 1, reviews: 28, learnedReviews: 25, learnedCorrect: 20,
    practiceClosed: 1, workouts: 1, workoutMinutes: 60, startCheckins: 1, escapes: 1, sleepNights: 2,
  }),
  pt('2026-11-02', {
    blocksPlanned: 4, blocksStarted: 2, resumptions: 1, reviews: 10, learnedReviews: 10, learnedCorrect: 10,
    practiceClosed: 2, practiceTop: { delivered: 2, understood: 1, autonomous: 1 }, workouts: 2, workoutMinutes: 60,
    cardio: 1, startCheckins: 1, escapes: 2, sleepNights: 3, sleepAvgMin: 440, bedSpreadMin: 37,
  }),
];

describe('trend sentences', () => {
  it('span', () => {
    expect(span('week', 8).window).toBe('nas últimas 8 semanas');
    expect(span('week', 1).window).toBe('na última semana');
    expect(span('month', 6)).toEqual({ window: 'nos últimos 6 meses', last: 'No mês mais recente', each: 'Por mês' });
    expect(span('month', 1).window).toBe('no último mês');
  });
  it('blocks, resumptions, reviews, practice', () => {
    expect(blocksText(two, 'week')).toBe('5 de 9 blocos iniciados nas últimas 2 semanas; versão mínima em 1. Na semana mais recente: 2 de 4.');
    expect(blocksText([pt('2026-11-02')], 'week')).toBe('Nenhum bloco planejado na última semana.');
    expect(resumptionsText(two, 'week')).toBe('1 retomada depois de dias parados nas últimas 2 semanas.');
    expect(resumptionsText([pt('2026-11-02')], 'week')).toBe('Nenhuma retomada na última semana.');
    expect(reviewsText(two, 'week')).toBe('38 revisões nas últimas 2 semanas; acerto de 86% nos cards já aprendidos. Na semana mais recente: 10.');
    expect(reviewsText([pt('2026-11-02', { reviews: 1, learnedReviews: 1, learnedCorrect: 1 })], 'week'))
      .toBe('1 revisão na última semana. Na semana mais recente: 1.');
    expect(practiceText(two, 'week')).toBe('3 sessões encerradas nas últimas 2 semanas. Nível máximo: entregue em 2, compreendido em 1, autônomo em 1.');
    expect(practiceText([pt('2026-11-02')], 'week')).toBe('Nenhuma sessão de prática encerrada na última semana.');
  });
  it('sleep uses the most recent period with an average', () => {
    expect(sleepText(two, 'week')).toBe('Na semana de 02/11: duração média de 7h20 em 3 noites; o horário de deitar variou ±37 min.');
    expect(sleepText([two[1]!, pt('2026-11-09')], 'week')).toBe('Na semana de 02/11: duração média de 7h20 em 3 noites; o horário de deitar variou ±37 min.');
    expect(sleepText([{ ...two[1]!, period: monthPeriod('2026-10') }], 'month')).toBe('Em outubro: duração média de 7h20 em 3 noites; o horário de deitar variou ±37 min.');
    expect(sleepText([two[0]!], 'week')).toBe('Registre algumas noites (Deitei e Acordei) para ver a tendência do sono.');
  });
  it('workouts, check-ins, balance and the screen-reader list', () => {
    expect(workoutsText(two, 'week')).toBe('3 treinos nas últimas 2 semanas, 2h no total; 1 de cardio.');
    expect(workoutsText([pt('2026-11-02')], 'week')).toBe('Nenhum treino registrado na última semana.');
    expect(checkinsText(two, 'week')).toBe('2 cards de início e 3 vezes “Escapei” nas últimas 2 semanas.');
    expect(checkinsText([pt('2026-11-02', { startCheckins: 1, escapes: 1 })], 'week')).toBe('1 card de início e 1 vez “Escapei” na última semana.');
    expect(checkinsText([pt('2026-11-02')], 'week')).toBe('Nenhum card de início nem “Escapei” na última semana.');
    expect(balanceText('month', 6, true)).toBe('Esforço registrado (XP) por área nos últimos 6 meses. XP mede esforço registrado, não valor nem tempo.');
    expect(balanceText('week', 8, false)).toBe('Nenhum XP registrado nas últimas 8 semanas.');
    expect(seriesText(two, 'week', (p) => `${p.blocksStarted} de ${p.blocksPlanned}`))
      .toBe('Por semana, da mais antiga para a mais recente: 26/10: 3 de 5; 02/11: 2 de 4.');
  });
});

describe('weeks 5–8 sentences', () => {
  const n: WatchNotice = {
    key: 'block:tech:2026-09-28', habitKey: 'block:tech', name: 'Bloco 1 · Tech News', minimumMin: 45,
    anchor: '2026-09-28', weekNumber: 6, base: { started: 12, planned: 18 }, recent: { started: 4, planned: 12, weeks: 2 },
  };
  it('observed and experiment', () => {
    expect(watchObservedText(n)).toBe('Nas 4 primeiras semanas, você começou 12 de 18 (67%). Nas últimas 2 semanas, 4 de 12 (33%).');
    expect(watchObservedText({ ...n, recent: { started: 1, planned: 5, weeks: 1 } }))
      .toBe('Nas 4 primeiras semanas, você começou 12 de 18 (67%). Na última semana, 1 de 5 (20%).');
    expect(watchExperiment(n)).toBe('Nesta semana, a meta de Bloco 1 · Tech News é só a versão mínima (45 min).');
  });
});

describe('association sentences', () => {
  it('sleep and blocks', () => {
    expect(sleepBlocksLines({ pairs: 19, enough: true, thresholdMin: 400, shorter: { days: 9, started: 19 / 9, planned: 4 }, longer: { days: 10, started: 2.9, planned: 4.1 } })).toEqual([
      'Depois das noites mais curtas (até 6h40, 9 dias): 2,1 de 4,0 blocos iniciados, em média.',
      'Depois das noites mais longas (mais de 6h40, 10 dias): 2,9 de 4,1.',
    ]);
    expect(sleepBlocksLines({ pairs: 6, enough: false, reason: 'poucos' })).toEqual(['Aparece com 14 dias úteis que tenham a noite anterior registrada. Até agora: 6.']);
    expect(sleepBlocksLines({ pairs: 20, enough: false, reason: 'variacao' })).toEqual(['As noites registradas ainda variam pouco para comparar.']);
  });
  it('sleep and day type', () => {
    expect(sleepModeLines({ pairs: 19, enough: true, thresholdMin: 400, shorter: { days: 9, lowDays: 4 }, longer: { days: 10, lowDays: 1 } })).toEqual([
      'Depois das noites mais curtas (até 6h40, 9 dias): Baixa energia ou Recuperação em 4 de 9.',
      'Depois das noites mais longas (mais de 6h40, 10 dias): em 1 de 10.',
    ]);
    expect(sleepModeLines({ pairs: 6, enough: false, reason: 'poucos' }))
      .toEqual(['Aparece com 14 dias em que você escolheu o tipo do dia e registrou a noite anterior. Até agora: 6.']);
  });
  it('review methods', () => {
    const all = [
      { method: 'wrote' as const, reviews: 120, correct: 103 }, { method: 'drew' as const, reviews: 0, correct: 0 },
      { method: 'spoke' as const, reviews: 3, correct: 3 }, { method: 'none' as const, reviews: 300, correct: 234 },
    ];
    expect(methodLines({ all, rows: [all[0]!, all[3]!], enough: true })).toEqual([
      'Escreveu antes: 86% de acerto em 120 revisões.', 'Só pensou: 78% de acerto em 300 revisões.',
    ]);
    expect(methodLines({ all: [{ ...all[0]!, reviews: 40 }, all[1]!, all[2]!, { ...all[3]!, reviews: 12 }], rows: [], enough: false })).toEqual([
      'Aparece com 30 revisões de cards já aprendidos em “Só pensou” e em pelo menos um outro jeito. Até agora: só pensou 12, escreveu 40, desenhou 0, falou 3.',
    ]);
  });
});

describe('postponement and month sentences', () => {
  it('totals', () => {
    const o = { from: '', to: '', atypicalWeeks: 0, postponed: 14, started: 22, shrunk: 3, dropped: 2, byDim: {} as never, missions: [], feelings: [] };
    expect(postponeTotalsText(o)).toBe('Nas últimas 4 semanas: adiou 14 vezes, começou 22, encolheu 3 e soltou 2.');
    expect(postponeTotalsText({ ...o, postponed: 1 })).toBe('Nas últimas 4 semanas: adiou 1 vez, começou 22, encolheu 3 e soltou 2.');
    expect(postponeTotalsText({ ...o, postponed: 0, started: 0, shrunk: 0, dropped: 0 })).toBe('Nenhum adiamento nem começo de missão nas últimas 4 semanas.');
  });
  it('month title and rows', () => {
    expect(monthTitle('2026-10')).toBe('Outubro de 2026');
    expect(decimal(2)).toBe('2,0');
    expect(monthObservedRows({
      workdays: 21, activeWorkdays: 17, blocksPlanned: 80, blocksStarted: 48, minimumUsed: 12, resumptions: 2,
      reviews: 310, accuracy: 0.851, practiceClosed: 4, workouts: 14, sleepAvgMin: 410, escapes: 9,
    })).toEqual([
      { label: 'Dias úteis ativos', value: '17 de 21' }, { label: 'Blocos iniciados', value: '48 de 80' },
      { label: 'Versão mínima', value: '12×' }, { label: 'Retomadas', value: '2' },
      { label: 'Revisões', value: '310 · acerto 85%' }, { label: 'Sessões de prática encerradas', value: '4' },
      { label: 'Treinos', value: '14' }, { label: 'Sono médio', value: '6h50' }, { label: 'Escapei', value: '9×' },
    ]);
    expect(monthObservedRows({
      workdays: 21, activeWorkdays: 0, blocksPlanned: 0, blocksStarted: 0, minimumUsed: 0, resumptions: 0,
      reviews: 3, practiceClosed: 0, workouts: 0, escapes: 0,
    }).map((r) => r.label)).toEqual(['Dias úteis ativos', 'Blocos iniciados', 'Versão mínima', 'Retomadas', 'Revisões', 'Escapei']);
  });
});
