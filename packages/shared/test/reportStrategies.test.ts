import { describe, expect, it } from 'vitest';
import type { DayState, Strategy } from '../src/types';
import { REPORT_DEFAULTS, reportWeekPeriod, type ReportOptions } from '../src/report';
import { STRATEGY_CAVEAT, reportMarkdown, type ReportData } from '../src/reportSections';
import { FACUL, TECH, reportData } from './reportFixture';
import { base, block, checkin, session } from './patternFixture';

const WEEK = reportWeekPeriod('2026-11-09');
const md = (data: ReportData, options: Partial<ReportOptions>): string =>
  reportMarkdown({ data, period: WEEK, options: { ...REPORT_DEFAULTS, ...options } });
const doc = (...lines: string[]): string => `${lines.join('\n')}\n`;
const head = (theme: string): string[] => [
  `# Relatório — ${theme} — 09/11 a 15/11/2026`,
  'Exportado do LIFE RPG em 16/11/2026.',
  'Fatos vêm dos registros do app; percepções são minhas palavras; ausência de dado não é fracasso; interpretações são hipóteses.',
];
const strat = (id: string, p: Partial<Strategy> & Pick<Strategy, 'title' | 'startDay'>): Strategy => ({
  ...base, id, source: 'ideia', reviewDay: '2026-11-30', status: 'testando', ...p,
});
const dayState = (id: string, p: Partial<DayState>): DayState => ({ ...base, id, hardDay: false, reviewDone: false, ...p });
const habits = { theme: 'personalizado' as const, sections: ['habitos'] as ReportOptions['sections'], diary: 'nenhuma' as const };

describe('reportMarkdown: strategies (header and Hábitos)', () => {
  const strategies = [
    strat('s1', {
      title: 'Celular em outro cômodo', source: 'ia', sourceNote: 'Claude, 08/11', link: { kind: 'block', id: 'tech' },
      startDay: '2026-11-10', reviewDay: '2026-11-24', why: 'Menos escapes', observe: 'Escapes e início do bloco',
    }),
    strat('s2', { title: 'Dormir até meia-noite', startDay: '2026-10-26', status: 'mantida', decidedDay: '2026-11-12', decisionNote: 'Ajudou nas manhãs.' }),
    strat('s3', { title: 'Antiga', startDay: '2026-10-01', status: 'descartada', decidedDay: '2026-11-08', decisionNote: 'Não serviu' }),
    strat('s4', { title: 'Apagada', startDay: '2026-11-09', trashedAt: 5 }),
  ];
  const data = reportData({
    blocks: [TECH, FACUL],
    sessions: [
      session('tech', '2026-11-10'), session('tech', '2026-11-11', '09:00', 'minimum'), session('facul', '2026-11-12', '15:00'),
      session('tech', '2026-11-13'),
    ],
    checkins: [
      checkin('2026-11-11', '10:30', { kind: 'escape', escapedTo: 'youtube', blockId: 'tech' }),
      checkin('2026-11-12', '20:00', { kind: 'escape', escapedTo: 'youtube' }),
    ],
    strategies,
  });

  it('the header names what was tested; Hábitos shows each one, his words and the caveat', () => {
    expect(md(data, habits)).toBe(doc(...head('Personalizado'),
      'Estratégias em teste neste período: "Dormir até meia-noite" · "Celular em outro cômodo".',
      '', '## Hábitos',
      '**Registrado:**',
      '- Estratégia "Dormir até meia-noite" (Ideia minha): testada de 26/10 a 12/11, mantida; '
        + 'durante o teste, neste período: 3 de 8 blocos iniciados (versão mínima em 1) · Escapei 2×.',
      '- Estratégia "Celular em outro cômodo" (Conversa de IA: "Claude, 08/11" · bloco "Tech News"): em teste desde 10/11 '
        + '(decidir em 24/11); durante o teste, neste período: iniciado em 3 de 4 dias (versão mínima em 1) · Escapei 1×.',
      '',
      '**Minhas percepções:**',
      '- Decisão sobre "Dormir até meia-noite" (12/11): "Ajudou nas manhãs."',
      '- Por que testar "Celular em outro cômodo": "Menos escapes".',
      '- O que observar em "Celular em outro cômodo": "Escapes e início do bloco".',
      '',
      '**Para investigar (interpretação, não conclusão):**',
      `- ${STRATEGY_CAVEAT}`,
    ));
  });
  it('every theme carries the header line; none without strategies in the period', () => {
    expect(md(data, { theme: 'saude' })).toContain('\nEstratégias em teste neste período: "Dormir até meia-noite" · "Celular em outro cômodo".\n');
    expect(md(reportData({ strategies: [strategies[2]!, strategies[3]!] }), habits)).not.toContain('Estratégias em teste');
  });
  it('without a block session during the test: the strategy without numbers and no caveat', () => {
    const late = reportData({ blocks: [TECH], sessions: [session('tech', '2026-11-10')], strategies: [strat('s5', { title: 'Biblioteca', startDay: '2026-11-14' })] });
    expect(md(late, habits)).toBe(doc(...head('Personalizado'),
      'Estratégias em teste neste período: "Biblioteca".',
      '', '## Hábitos', '**Registrado:**',
      '- Estratégia "Biblioteca" (Ideia minha): em teste desde 14/11 (decidir em 30/11).',
    ));
  });
  it('Treino off: a strategy linked to a training block loses the block and the numbers; the others count no training block', () => {
    const gym = block({ id: 'gym', name: 'Treino', kind: 'body', targetStart: '18:00' });
    const withGym = reportData({
      blocks: [TECH, gym],
      sessions: [session('tech', '2026-11-10'), session('gym', '2026-11-10', '18:00'), session('gym', '2026-11-11', '18:00')],
      strategies: [
        strat('g', { title: 'Treinar de manhã', link: { kind: 'block', id: 'gym' }, startDay: '2026-11-09', reviewDay: '2026-11-23' }),
        strat('u', { title: 'Sem celular', startDay: '2026-11-09', reviewDay: '2026-11-23' }),
      ],
    });
    const on = md(withGym, habits);
    expect(on).toContain('- Estratégia "Treinar de manhã" (Ideia minha · bloco "Treino"): em teste desde 09/11 (decidir em 23/11); '
      + 'durante o teste, neste período: iniciado em 2 de 5 dias.');
    expect(on).toContain('- Estratégia "Sem celular" (Ideia minha): em teste desde 09/11 (decidir em 23/11); '
      + 'durante o teste, neste período: 3 de 10 blocos iniciados.');
    const off = md(withGym, { ...habits, health: { sono: true, treino: false, estado: true } });
    expect(off).toContain('- Estratégia "Treinar de manhã" (Ideia minha): em teste desde 09/11 (decidir em 23/11).');
    expect(off).toContain('- Estratégia "Sem celular" (Ideia minha): em teste desde 09/11 (decidir em 23/11); '
      + 'durante o teste, neste período: 1 de 5 blocos iniciados.');
    expect(off).not.toContain('bloco "Treino"');
  });
  it('a journey link is named; its numbers are those of every block', () => {
    const j = reportData({
      blocks: [TECH], sessions: [session('tech', '2026-11-10')],
      journeys: [{ ...base, id: 'j-tech', title: 'Tech News', status: 'active', order: 0 }],
      strategies: [strat('j', { title: 'Pauta na véspera', link: { kind: 'journey', id: 'j-tech' }, startDay: '2026-11-09' })],
    });
    expect(md(j, habits)).toContain('- Estratégia "Pauta na véspera" (Ideia minha · jornada "Tech News"): em teste desde 09/11 '
      + '(decidir em 30/11); durante o teste, neste período: 1 de 5 blocos iniciados.');
  });
});

describe('reportMarkdown: humor, sobrecarga and concentração (Estado do dia)', () => {
  const data = reportData({
    dayStates: [
      dayState('2026-11-09', { mood: 'ok', load: 'leve', concentration: 'boa' }),
      dayState('2026-11-10', { mood: 'bem', concentration: 'ok' }),
      dayState('2026-11-11', { tiredness: 'pouco' }),
    ],
  });
  it('Saúde: cansaço, humor and sobrecarga, each with its missing days', () => {
    expect(md(data, { theme: 'saude', diary: 'nenhuma' })).toBe(doc(...head('Saúde'),
      '', '## Saúde',
      '**Registrado:**',
      '- Cansaço no fechamento do dia: Pouco 1.',
      '- Humor no fechamento do dia: Ok 1 · Bem 1.',
      '- Sobrecarga no fechamento do dia: Leve 1.',
      '',
      '**Sem dados:**',
      '- Sem registro de sono neste período.',
      '- Sem registro de treino neste período.',
      '- Cansaço não registrado em 4 de 5 dias úteis.',
      '- Humor não registrado em 3 de 5 dias úteis.',
      '- Sobrecarga não registrada em 4 de 5 dias úteis.',
    ));
    const noTired = reportData({ dayStates: [dayState('2026-11-09', { mood: 'baixo' })] });
    expect(md(noTired, { theme: 'saude', diary: 'nenhuma' })).toContain('- Humor no fechamento do dia: Para baixo 1.');
    expect(md(noTired, { theme: 'saude', diary: 'nenhuma' })).toContain('- Cansaço não registrado neste período.');
  });
  it('Hábitos: concentração; Visão geral counts those days', () => {
    expect(md(data, habits)).toBe(doc(...head('Personalizado'),
      '', '## Hábitos',
      '**Registrado:**',
      '- Concentração no fechamento do dia: Ok 1 · Boa 1.',
      '',
      '**Sem dados:**',
      '- Concentração não registrada em 3 de 5 dias úteis.',
    ));
    expect(md(data, { ...habits, sections: ['visao'] })).toContain('- Dias com algum registro: 3 de 7.');
  });
  it('Estado do dia off: no trace of them anywhere', () => {
    const off = { health: { sono: true, treino: true, estado: false } };
    expect(md(data, { theme: 'saude', diary: 'nenhuma', ...off })).toBe(doc(...head('Saúde'),
      '', '## Saúde', '**Sem dados:**', '- Nenhum registro de sono ou treino neste período.'));
    expect(md(data, { ...habits, ...off })).toContain('- Nenhuma atividade, retomada ou experimento registrado neste período.');
    expect(md(data, { ...habits, sections: ['visao'], ...off })).toContain('- Nenhum registro neste período.');
  });
});

describe('reportMarkdown: a strategy whose link no longer resolves', () => {
  const sessions = [session('tech', '2026-11-10'), session('facul', '2026-11-11', '15:00')];
  it('a link to a block that is gone shows no numbers (never the numbers of every block as if they were its own)', () => {
    const data = reportData({
      blocks: [TECH, FACUL], sessions,
      checkins: [checkin('2026-11-11', '10:30', { kind: 'escape', escapedTo: 'youtube', blockId: 'tech' })],
      strategies: [strat('s1', { title: 'Sem celular', link: { kind: 'block', id: 'apagado' }, startDay: '2026-11-09' })],
    });
    const text = md(data, habits);
    expect(text).toContain('- Estratégia "Sem celular" (Ideia minha): em teste desde 09/11 (decidir em 30/11).');
    expect(text).not.toMatch(/\d+ de \d+/);
    expect(text).not.toContain('Escapei');
  });
});
