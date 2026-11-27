import { describe, expect, it } from 'vitest';
import type { Goal, GoalProgress, Journey, Season, Week } from '../src/types';
import { REPORT_DEFAULTS, reportWeekPeriod, type ReportOptions } from '../src/report';
import { reportMarkdown, type ReportData } from '../src/reportSections';
import { reviewsBetween } from '../src/diary';
import { timestampAt } from '../src/dates';
import { at, reportData } from './reportFixture';
import { base, block, event, mission, session } from './patternFixture';

const WEEK = reportWeekPeriod('2026-11-09');
const md = (data: ReportData, options: Partial<ReportOptions>): string =>
  reportMarkdown({ data, period: WEEK, options: { ...REPORT_DEFAULTS, ...options } });
const doc = (...lines: string[]): string => `${lines.join('\n')}\n`;
const head = [
  '# Relatório — Personalizado — 09/11 a 15/11/2026',
  'Exportado do LIFE RPG em 16/11/2026.',
  'Fatos vêm dos registros do app; percepções são minhas palavras; ausência de dado não é fracasso; interpretações são hipóteses.',
];
const goal = (id: string, p: Partial<Goal> & Pick<Goal, 'title'>): Goal => ({ ...base, id, status: 'ativo', order: 0, ...p });
const journey = (id: string, p: Partial<Journey> & Pick<Journey, 'title'>): Journey => ({ ...base, id, status: 'active', order: 0, ...p });
const season = (id: string, p: Partial<Season> & Pick<Season, 'title' | 'startDay'>): Season => ({
  ...base, id, focus: [], plannedWeeks: 6, status: 'ativa', ...p,
});
const review = (id: string, answeredAt: number, goals: Record<string, GoalProgress>): Week => ({
  ...base, id, objectives: [], review: { worked: '', obstacle: '', adjustment: '', answeredAt, goals },
});

const data = reportData({
  goals: [
    goal('g1', { title: 'Carreira em Dados', horizon: '2027', why: 'Quero trabalhar com dados.' }),
    goal('g2', { title: 'Saúde', order: 1 }),
    goal('g3', { title: 'Inglês', status: 'pausado', order: 2 }),
    goal('g4', { title: 'Antigo', status: 'concluido', order: 3 }),
    goal('g5', { title: 'Arquivado', status: 'arquivado', order: 4 }),
  ],
  journeys: [journey('tech', { title: 'Tech News', goalId: 'g1' }), journey('j5', { title: 'Velha', goalId: 'g5' })],
  blocks: [block({ id: 'tech', name: 'Tech News', journeyId: 'tech' })],
  sessions: [session('tech', '2026-11-10'), session('tech', '2026-11-11')],
  missions: [
    mission({ id: 'm1', title: 'Escrever coletor', journeyId: 'tech', status: 'done', completedAt: at(10, 14) }),
    mission({ id: 'm2', title: 'Arquivo velho', journeyId: 'j5', status: 'done', completedAt: at(12, 10) }),
    mission({ id: 'm4', title: 'Lista 3' }),
  ],
  events: [event('partial', 'm4', '2026-11-13', '16:00', {})],
  weeks: [
    review('2026-11-09', at(9, 9), { g1: 'sim', g2: 'nao' }),
    review('2026-11-16', at(16, 9), { g1: 'um-pouco' }),
  ],
  seasons: [
    season('s0', {
      title: 'Começo', startDay: '2026-10-01', status: 'encerrada', endedDay: '2026-11-09',
      review: { progress: 'Criei o hábito', obstacle: '', next: 'Mais sono', answeredAt: at(9, 20) },
    }),
    season('s1', { title: 'Consistência no Tech', startDay: '2026-11-02', focus: [{ text: 'Bloco do Tech' }, { link: { kind: 'goal', id: 'g1' } }] }),
  ],
});

describe('reportMarkdown: objectives and seasons', () => {
  it('the header names the seasons; Visão geral the objectives; Revisões the season review', () => {
    expect(md(data, { theme: 'personalizado', sections: ['visao', 'revisoes'], diary: 'nenhuma' })).toBe(doc(...head,
      'Temporada neste período: "Começo" (de 01/10 a 09/11).',
      'Temporada neste período: "Consistência no Tech" (desde 02/11, planejada para 6 semanas); focos: "Bloco do Tech" · "Carreira em Dados".',
      '', '## Visão geral',
      '**Registrado:**',
      '- Dias com algum registro: 4 de 7.',
      '- Ligado ao objetivo "Carreira em Dados" (ativo, 2027): 1 missão concluída · 2 blocos iniciados.',
      '- Ligado ao objetivo "Arquivado" (arquivado): 1 missão concluída.',
      '',
      '**Minhas percepções:**',
      '- Por que "Carreira em Dados" importa: "Quero trabalhar com dados."',
      '- Avançou em "Carreira em Dados"? semana de 02/11: Sim.',
      '- Avançou em "Saúde"? semana de 02/11: Não desta vez.',
      '',
      '**Sem dados:**',
      '- Tipo do dia não registrado em 7 dias.',
      '- Objetivo "Saúde" (ativo): sem registro ligado a ele neste período.',
      '- Objetivo "Inglês" (pausado): sem registro ligado a ele neste período.',
      '', '## Revisões',
      '**Minhas percepções:** respostas da Nova semana, da reflexão do mês e da revisão da temporada, com as minhas palavras.',
      '', '### Temporada "Começo" (respondida em 09/11)',
      '- O que avançou: Criei o hábito',
      '- Para a próxima: Mais sono',
    ));
  });

  it('a deleted goal never enters; a season planned for one week reads "1 semana"', () => {
    const one = reportData({
      goals: [goal('gx', { title: 'Apagado', deleted: true }), goal('g1', { title: 'Saúde' })],
      sessions: [session('tech', '2026-11-10')], blocks: [block({ id: 'tech', name: 'Tech News' })],
      weeks: [review('2026-11-09', at(9, 9), { gx: 'sim' })],
      seasons: [season('s1', { title: 'Curta', startDay: '2026-11-09', plannedWeeks: 1 })],
    });
    const out = md(one, { theme: 'personalizado', sections: ['visao'], diary: 'nenhuma' });
    expect(out).not.toContain('Apagado');
    expect(out).toContain('Temporada neste período: "Curta" (desde 09/11, planejada para 1 semana).');
  });
  it('without goals or seasons the report is as before', () => {
    const plain = reportData({ blocks: [block({ id: 'tech', name: 'Tech News' })], sessions: [session('tech', '2026-11-10')] });
    const out = md(plain, { theme: 'personalizado', sections: ['visao', 'execucao'], diary: 'nenhuma' });
    expect(out).not.toMatch(/Temporada|objetivo/);
    expect(out).toContain('- Dias com algum registro: 1 de 7.');
  });

  it('only goals with nothing recorded: Visão geral says "Nenhum registro" (no goal line without any record)', () => {
    const quiet = reportData({ goals: [goal('g', { title: 'Saúde' })] });
    expect(md(quiet, { theme: 'personalizado', sections: ['visao'], diary: 'nenhuma' }))
      .toBe(doc(...head, '', '## Visão geral', '**Sem dados:**', '- Nenhum registro neste período.'));
  });
});

describe('season reviews among the reviews (diary and report)', () => {
  it('a season review answered in the range, with only the written answers; none when all are blank', () => {
    const seasons = [
      season('a', { title: ' Consistência ', startDay: '2026-11-02', status: 'encerrada', endedDay: '2026-11-12',
        review: { progress: 'Todo dia', obstacle: 'Provas', next: '', answeredAt: timestampAt('2026-11-12', '21:00') } }),
      season('b', { title: 'Vazia', startDay: '2026-10-01', status: 'encerrada', endedDay: '2026-11-11',
        review: { progress: '', obstacle: '', next: '', answeredAt: timestampAt('2026-11-11', '21:00') } }),
      season('c', { title: 'Sem revisão', startDay: '2026-11-02' }),
    ];
    expect(reviewsBetween({ weeks: [], months: [], seasons, from: '2026-11-09', to: '2026-11-15', dayStartHour: 4 })).toEqual([{
      kind: 'season', id: 'a', day: '2026-11-12', at: timestampAt('2026-11-12', '21:00'), title: 'Temporada "Consistência"',
      answers: [{ label: 'O que avançou', text: 'Todo dia' }, { label: 'O que atrapalhou', text: 'Provas' }],
    }]);
    expect(reviewsBetween({ weeks: [], months: [], from: '2026-11-09', to: '2026-11-15', dayStartHour: 4 })).toEqual([]);
  });
});
