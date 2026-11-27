import { describe, expect, it } from 'vitest';
import type { Checkin } from '../src/types';
import { addDays, weekdayOf } from '../src/dates';
import { REPORT_DEFAULTS, REPORT_SECTIONS, reportMonthPeriod, reportWeekPeriod, type ReportOptions, type ReportPeriod } from '../src/report';
import { reportMarkdown, type ReportData } from '../src/reportSections';
import { FACUL, TECH, at, reportData, weekData } from './reportFixture';
import { base, block, event, mission, night, practice, review, session, workout, xp } from './patternFixture';

const WEEK = reportWeekPeriod('2026-11-09');
const md = (data: ReportData, options: Partial<ReportOptions>, period: ReportPeriod = WEEK): string =>
  reportMarkdown({ data, period, options: { ...REPORT_DEFAULTS, ...options } });
const doc = (...lines: string[]): string => `${lines.join('\n')}\n`;
const head = (theme: string, period = '09/11 a 15/11/2026', day = '16/11/2026'): string[] => [
  `# Relatório — ${theme} — ${period}`,
  `Exportado do LIFE RPG em ${day}.`,
  'Fatos vêm dos registros do app; percepções são minhas palavras; ausência de dado não é fracasso; interpretações são hipóteses.',
];

// The fixture week's sections, as every theme that carries them shows them.
const VISAO = [
  '', '## Visão geral',
  '**Registrado:**',
  '- Dias com algum registro: 6 de 7.',
  '- Tipo dos dias: 3 Normal · 1 Baixa energia.',
  '', '**Sem dados:**',
  '- Tipo do dia não registrado em 3 dias.',
];
const EXECUCAO = [
  '', '## Execução',
  '**Registrado:**',
  '- Blocos: 5 de 10 iniciados (versão mínima em 1).',
  '- Como foi o bloco: Feito 1 · Parcial 1.',
  '- Planejado × executado (2 dias com foto do plano): 3h executados de 7h planejados.',
  '- Por área: Tech News 2h de 4h · Faculdade 1h de 3h.',
  '- Missões concluídas: 3 — Ler 20 min 2× · Escrever pauta.',
  '- Parcial em 1 missão.',
  '- Adiamentos: 3 (motivos marcados: Sem tempo 1 · Sem energia 1).',
  '- Foco cronometrado: 50 min em 1 sessão.',
  '- Escapei: 1 (YouTube 1).',
  '',
  '**Minhas percepções:**',
  '- O que saiu do bloco "Faculdade" (seg 09/11): "Lista 3 quase toda".',
  '- O que saiu de "Escrever pauta" (ter 10/11): "Pauta da semana pronta".',
  '- Parcial em "Lista de Cálculo" (qua 11/11): "Fiz 5 de 10".',
];
const APRENDIZAGEM = [
  '', '## Aprendizagem',
  '**Registrado:**',
  '- Revisões: 24 em 3 dias (12 min, 12 cards diferentes).',
  '- Acerto em cards já aprendidos: 80% (20 revisões).',
  '- Prática técnica: 2 sessões encerradas.',
  '- Autoavaliação: Entregue: sim 1, parcial 1 · Compreendido: em parte 1, sem resposta 1 · Autônomo: com consulta 1, sem resposta 1.',
  '- Pistas pedidas: 1.',
  '- Reconstruções comparadas: 1 (1 sem olhar a implementação).',
  '',
  '**Minhas percepções:**',
  '- Explicação de "Join de tabelas" (qua 11/11): "Entendi joins, mas travei para escrever sem olhar."',
];
const MATERIAS = [
  '', '## Matérias',
  '**Registrado:**',
  '- Matemática Discreta: aula ter · 19:30–22:30; avaliação no período: Prova 1 (12/11); próxima avaliação: Trabalho 2 (25/11); '
    + 'exercícios: 1 lista, 8 de 10 feitos, 5 sem ajuda; assuntos: 1 entendi · 1 vi na aula.',
  '- Banco de Dados: aula ainda sem horário; sem contato há 31 dias de estudo.',
];
const HABITOS = [
  '', '## Hábitos',
  '**Registrado:**',
  '- Dias úteis com alguma atividade (XP): 4 de 5.',
  '- Retomadas depois de dias parados: 1.',
  '- Recorrentes concluídas: 2 — Ler 20 min 2×.',
  '- Experimento da semana de 09/11: "Celular em outro cômodo no bloco Tech" (blocos iniciados naquela semana: 5 de 10).',
];
const ADIAMENTOS = [
  '', '## Adiamentos e travas',
  '**Registrado:**',
  '- Cards de início ("Antes de começar"): 2.',
  '- Sentimentos marcados: ansiedade 2 · tédio 1.',
  '- O que trava: Não sei por onde começar 1.',
  '- Começar 10 min: continuou em 1 de 2.',
  '- Missões adiadas 2 vezes ou mais: "Revisar PR" 3×.',
  '',
  '**Minhas percepções:**',
  '- Antes de começar "Revisar PR" (seg 09/11): "Vai ficar ruim".',
];
const SAUDE = [
  '', '## Saúde',
  '**Registrado:**',
  '- Sono: 5 noites com Deitei e Acordei.',
  '- Duração média: 7h04; deitar por volta de 23:58 (variação típica ±35 min); acordar por volta de 07:02 (±10 min).',
  '- Qualidade percebida (1 a 5): média 3,0 em 3 noites.',
  '- Treinos registrados: 3 — Musculação 2 (2h10) · Cardio 1 (20 min, 1 versão mínima).',
  '- Treino do dia: 3 dias (Peito e tríceps · Costas e bíceps): 9 exercícios feitos, 1 trocado, 1 pulado.',
  '- Intensidade do cardio marcada (1 a 10): 6.',
  '- Cansaço no fechamento do dia: Médio 1 · Muito 2.',
  '',
  '**Sem dados:**',
  '- Sono sem Deitei e Acordei em 2 de 7 noites.',
  '- Cansaço não registrado em 2 de 5 dias úteis.',
];
const DIARIO_HEAD = ['', '## Diário', '**Minhas percepções:** entradas do diário, com as minhas palavras, sem edição.'];
const D1 = ['', '### Terça-feira, 10/11 · 21:05 · fechamento do dia', 'Dia corrido, mas a aula rendeu.', '', '_Temas: Faculdade_'];
const D2 = ['', '### Quarta-feira, 11/11 · 22:40', 'Travei no join.\nAmanhã tento de novo.', '', '_Temas: Estudo · Ligado a: missão "Lista de Cálculo"_'];
const D3 = ['', '### Quinta-feira, 12/11 · 23:00 · privada', 'Coisa minha.', '', '_Temas: Sentimentos_'];
const D4 = ['', '### Sábado, 14/11 · 10:00', 'Dormi mal.', '', '_Temas: Sono_'];
const NO_DIARY = ['', '## Diário', '**Sem dados:**', '- Nenhuma entrada do diário para este relatório.'];
const REVISOES = [
  '', '## Revisões',
  '**Minhas percepções:** respostas da Nova semana, da reflexão do mês e da revisão da temporada, com as minhas palavras.',
  '', '### Nova semana (respondida em 09/11)', '- O que funcionou: Blocos curtos', '- Ajuste para testar: Dormir antes',
  '', '### Reflexão de outubro (respondida em 09/11)', '- Avanços: Terminei o módulo de SQL', '- O que atrapalhou: Cansaço à noite',
];

describe('reportMarkdown: each theme of the fixture week (seen on Monday 16/11)', () => {
  it('Geral: every section but Prática de fala; the diary of the theme is every non-private entry', () => {
    const text = md(weekData(), {});
    expect(text).toBe(doc(...head('Geral'), ...VISAO, ...EXECUCAO, ...APRENDIZAGEM, ...MATERIAS, ...HABITOS, ...ADIAMENTOS, ...SAUDE,
      ...DIARIO_HEAD, ...D1, ...D2, ...D4, ...REVISOES));
    expect(text.split(/\s+/).length).toBeLessThan(3000);
  });
  it('Aprendizagem: only the study blocks, Aprendizagem, Matérias; diary estudo/faculdade/carreira/projetos', () => {
    expect(md(weekData(), { theme: 'aprendizagem' })).toBe(doc(...head('Aprendizagem'),
      '', '## Execução', '**Registrado:**', '- Blocos de estudo: 2 de 5 iniciados.',
      '', '**Minhas percepções:**',
      '- Como foi o bloco: Feito 1.',
      '- O que saiu do bloco "Faculdade" (seg 09/11): "Lista 3 quase toda".',
      ...APRENDIZAGEM, ...MATERIAS, ...DIARIO_HEAD, ...D1, ...D2));
  });
  it('Hábitos e comportamento: Execução, Hábitos, Adiamentos e travas; diary sentimentos/ideias or linked to a mission', () => {
    expect(md(weekData(), { theme: 'habitos' })).toBe(doc(...head('Hábitos e comportamento'),
      ...EXECUCAO, ...HABITOS, ...ADIAMENTOS, ...DIARIO_HEAD, ...D2));
  });
  it('Saúde: only the Saúde section and the diary saude/treino/sono', () => {
    expect(md(weekData(), { theme: 'saude' })).toBe(doc(...head('Saúde'), ...SAUDE, ...DIARIO_HEAD, ...D4));
  });
  it('Comunicação oral: no speech practice yet (a fact, not a failure) and no entry of that theme', () => {
    expect(md(weekData(), { theme: 'comunicacao' })).toBe(doc(...head('Comunicação oral'),
      '', '## Prática de fala', '**Sem dados:**', '- Ainda não há prática de fala registrada.', ...NO_DIARY));
  });
  it('Personalizado: the chosen sections in order; none chosen and no diary says so', () => {
    expect(md(weekData(), { theme: 'personalizado', sections: ['revisoes', 'fala', 'visao'], diary: 'nenhuma' })).toBe(doc(...head('Personalizado'),
      ...VISAO, '', '## Prática de fala', '**Sem dados:**', '- Ainda não há prática de fala registrada.', ...REVISOES));
    expect(md(weekData(), { theme: 'personalizado', sections: [], diary: 'nenhuma' })).toBe(doc(...head('Personalizado'), '', 'Nenhuma seção escolhida.'));
  });
});

describe('reportMarkdown: what goes in and what does not', () => {
  it('a section without data shows only its "Sem dados" line, never a number', () => {
    const text = md(reportData(), { theme: 'personalizado', sections: REPORT_SECTIONS, diary: 'todas' });
    expect(text).toBe(doc(...head('Personalizado'),
      '', '## Visão geral', '**Sem dados:**', '- Nenhum registro neste período.',
      '', '## Execução', '**Sem dados:**', '- Nenhum bloco, missão, foco ou adiamento registrado neste período.',
      '', '## Aprendizagem', '**Sem dados:**', '- Nenhuma revisão nem prática técnica registrada neste período.',
      '', '## Matérias', '**Sem dados:**', '- Nenhuma disciplina cadastrada.',
      '', '## Hábitos', '**Sem dados:**', '- Nenhuma atividade, retomada ou experimento registrado neste período.',
      '', '## Adiamentos e travas', '**Sem dados:**', '- Nenhum card de início nem missão adiada duas vezes ou mais neste período.',
      '', '## Saúde', '**Sem dados:**', '- Nenhum registro de sono, treino ou cansaço neste período.',
      '', '## Prática de fala', '**Sem dados:**', '- Ainda não há prática de fala registrada.',
      ...NO_DIARY,
      '', '## Revisões', '**Sem dados:**', '- Nenhuma revisão escrita neste período.'));
    expect(text.split('\n').slice(3).filter((l) => /\d/.test(l))).toEqual([]);
  });
  it('planned blocks without any session are not data (no "0 de N")', () => {
    expect(md(reportData({ blocks: [TECH, FACUL] }), { theme: 'personalizado', sections: ['execucao'], diary: 'nenhuma' })).toBe(doc(...head('Personalizado'),
      '', '## Execução', '**Sem dados:**', '- Nenhum bloco, missão, foco ou adiamento registrado neste período.'));
  });
  it('private entries go in only with the switch, whatever the diary choice', () => {
    for (const diary of ['tema', 'escolher', 'todas'] as const) {
      expect(md(weekData(), { theme: 'habitos', diary, chosen: ['d3'] })).not.toContain('Coisa minha.');
    }
    expect(md(weekData(), { includePrivate: true })).toBe(doc(...head('Geral'), ...VISAO, ...EXECUCAO, ...APRENDIZAGEM, ...MATERIAS,
      ...HABITOS, ...ADIAMENTOS, ...SAUDE, ...DIARIO_HEAD, ...D1, ...D2, ...D3, ...D4, ...REVISOES));
    expect(md(weekData(), { theme: 'habitos', diary: 'escolher', chosen: ['d3'], includePrivate: true })).toContain(D3.join('\n'));
  });
  it('a health type switched off leaves no trace; all off removes the section', () => {
    expect(md(weekData(), { theme: 'saude', diary: 'nenhuma', health: { sono: false, treino: true, estado: true } })).toBe(doc(...head('Saúde'),
      '', '## Saúde',
      '**Registrado:**',
      '- Treinos registrados: 3 — Musculação 2 (2h10) · Cardio 1 (20 min, 1 versão mínima).',
      '- Treino do dia: 3 dias (Peito e tríceps · Costas e bíceps): 9 exercícios feitos, 1 trocado, 1 pulado.',
      '- Intensidade do cardio marcada (1 a 10): 6.',
      '- Cansaço no fechamento do dia: Médio 1 · Muito 2.',
      '',
      '**Sem dados:**',
      '- Cansaço não registrado em 2 de 5 dias úteis.'));
    expect(md(weekData(), { theme: 'personalizado', sections: ['visao', 'saude'], diary: 'nenhuma', health: { sono: false, treino: false, estado: false } }))
      .toBe(doc(...head('Personalizado'), ...VISAO));
    expect(md(reportData(), { theme: 'saude', health: { sono: false, treino: true, estado: false } })).toBe(doc(...head('Saúde'),
      '', '## Saúde', '**Sem dados:**', '- Nenhum registro de treino neste período.', ...NO_DIARY));
  });
  it('a week in progress: cut at today, blocks counted until yesterday', () => {
    const data = reportData({ today: '2026-11-18', blocks: [TECH, FACUL], sessions: [session('tech', '2026-11-16', '09:00'), session('tech', '2026-11-18', '09:00')] });
    expect(md(data, { theme: 'personalizado', sections: ['execucao'], diary: 'nenhuma' }, reportWeekPeriod('2026-11-16'))).toBe(doc(
      ...head('Personalizado', '16/11 a 22/11/2026 (até hoje, 18/11)', '18/11/2026'),
      '', '## Execução',
      '**Registrado:**',
      '- Blocos: 1 de 4 iniciados.',
      '',
      '**Sem dados:**',
      '- Nenhum dia com foto do plano para comparar planejado × executado.',
      '- Os blocos contam até ontem; hoje ainda está em andamento.'));
  });
  it('an atypical week and its reason (his words)', () => {
    const data = weekData({ weeks: [{ ...base, id: '2026-11-09', objectives: [], atypical: { reason: 'Provas', returnDay: '2026-11-18' } }] });
    expect(md(data, { theme: 'personalizado', sections: ['visao'], diary: 'nenhuma' })).toBe(doc(...head('Personalizado'),
      '', '## Visão geral',
      '**Registrado:**',
      '- Dias com algum registro: 6 de 7.',
      '- Tipo dos dias: 3 Normal · 1 Baixa energia.',
      '- Semana atípica: 09/11 a 15/11 (volta ao ritmo em 18/11).',
      '',
      '**Minhas percepções:**',
      '- Motivo da semana atípica de 09/11: "Provas".',
      '',
      '**Sem dados:**',
      '- Tipo do dia não registrado em 3 dias.'));
  });
  it('an atypical week alone: no "0 de N" and no day types, only the atypical fact', () => {
    const data = reportData({ weeks: [{ ...base, id: '2026-11-09', objectives: [], atypical: { reason: '', returnDay: '2026-11-18' } }] });
    expect(md(data, { theme: 'personalizado', sections: ['visao'], diary: 'nenhuma' })).toBe(doc(...head('Personalizado'),
      '', '## Visão geral', '**Registrado:**', '- Semana atípica: 09/11 a 15/11 (volta ao ritmo em 18/11).'));
  });
  it('Visão geral coverage with the three health switches off ignores sleep, workouts, training and tiredness', () => {
    const off = { sono: false, treino: false, estado: false };
    const data = reportData({
      sleepLogs: [night('2026-11-09', '23:30', 450)],
      workouts: [{ ...workout('2026-11-10', 'musculacao', 60) }],
      dayStates: [{ ...base, id: '2026-11-11', hardDay: false, reviewDone: false, tiredness: 'muito' }],
    });
    expect(md(data, { theme: 'personalizado', sections: ['visao'], diary: 'nenhuma', health: off })).toBe(doc(...head('Personalizado'),
      '', '## Visão geral', '**Sem dados:**', '- Nenhum registro neste período.'));
    expect(md(data, { theme: 'personalizado', sections: ['visao'], diary: 'nenhuma' })).toContain('- Dias com algum registro: 2 de 7.');
  });
  it('Aprendizagem: no planned study block and no session is only "Sem dados", never the in-progress note alone', () => {
    const data = reportData({ today: '2026-11-18', blocks: [TECH, FACUL] });
    expect(md(data, { theme: 'aprendizagem', diary: 'nenhuma' }, reportWeekPeriod('2026-11-16'))).not.toContain('Os blocos contam até ontem');
    const only = reportData({ today: '2026-11-18', blocks: [TECH, FACUL], sessions: [session('facul', '2026-11-18', '15:00')] });
    const text = md(only, { theme: 'aprendizagem', diary: 'nenhuma' }, reportWeekPeriod('2026-11-16'));
    expect(text).toContain(['## Execução', '**Sem dados:**', '- Nenhum bloco de estudo registrado neste período.'].join('\n'));
  });
  it('a past month reads the subjects as they were at its end', () => {
    expect(md(weekData(), { theme: 'personalizado', sections: ['materias'], diary: 'nenhuma' }, reportMonthPeriod('2026-10'))).toBe(doc(
      ...head('Personalizado', 'outubro de 2026'),
      '', '## Matérias', '**Registrado:**', '- Banco de Dados: aula ainda sem horário; sem contato há 21 dias de estudo.'));
  });
  it('long lists keep the first 8', () => {
    const missions = Array.from({ length: 10 }, (_, i) => mission({ id: `c${i}`, title: `Missão ${i + 1}`, status: 'done', completedAt: at(9, 8 + i) }));
    const checkins: Checkin[] = Array.from({ length: 10 }, (_, i) => ({ ...base, id: `k${i}`, at: at(10, 8 + i), kind: 'start', feelings: [], thought: `Pensamento ${i + 1}` }));
    const text = md(reportData({ missions, checkins }), { theme: 'habitos', diary: 'nenhuma' });
    expect(text).toContain('- Missões concluídas: 10 — Missão 1 · Missão 2 · Missão 3 · Missão 4 · Missão 5 · Missão 6 · Missão 7 · Missão 8 · e mais 2.');
    expect(text).toContain([
      '- Antes de começar (ter 10/11): "Pensamento 8".',
      '- E mais 2.',
    ].join('\n'));
    expect(text).not.toContain('Pensamento 9');
  });
});

describe('reportMarkdown: Para investigar (Padrões rules, labelled as interpretation)', () => {
  // 9 postponements of a mission never started (4 weeks up to 15/11); 30 + 30 learned reviews in October, one
  // just thought and one written first; 20 workdays with the night before (6 h or 8 h) and the block started after 8 h.
  const workdays: string[] = [];
  for (let d = '2026-10-19'; d <= '2026-11-13'; d = addDays(d, 1)) if (weekdayOf(d) >= 1 && weekdayOf(d) <= 5) workdays.push(d);
  const data = reportData({
    blocks: [TECH],
    missions: [mission({ id: 'big', title: 'Relatório anual' })],
    events: Array.from({ length: 9 }, (_, i) => event('snoozed', 'big', addDays('2026-10-20', i * 3), '10:00')),
    reviews: [
      ...Array.from({ length: 30 }, (_, i) => review(addDays('2026-10-01', i), i < 24 ? 3 : 1)),
      ...Array.from({ length: 30 }, (_, i) => review(addDays('2026-10-01', i), i < 27 ? 3 : 1, { wrote: true })),
      review('2026-11-10', 3, {}, 'new'),
    ],
    sleepLogs: workdays.map((d, i) => night(addDays(d, -1), '23:00', i % 2 === 0 ? 360 : 480)),
    sessions: workdays.filter((_, i) => i % 2 === 1).map((d) => session('tech', d, '09:00')),
  });
  const text = md(data, { theme: 'personalizado', sections: ['aprendizagem', 'adiamentos', 'saude'], diary: 'nenhuma' });
  it('postponement hypotheses of the 4 weeks up to the last day read', () => {
    expect(text).toContain([
      '## Adiamentos e travas',
      '**Registrado:**',
      '- Missões adiadas 2 vezes ou mais: "Relatório anual" 2×.',
      '',
      '**Para investigar (interpretação, não conclusão):**',
      '- Pode ser que “Relatório anual” esteja grande ou pouco clara. Base (4 semanas até 15/11): “Relatório anual” foi adiada 9 vezes nas últimas 4 semanas e não foi começada.',
    ].join('\n'));
  });
  it('associations of the 90 days up to the last day read, only when Padrões shows them', () => {
    expect(text).toContain([
      '**Para investigar (interpretação, não conclusão):**',
      '- Jeito de responder e acerto (90 dias até 15/11): Escreveu antes 90% em 30 revisões · Só pensou 80% em 30 revisões. Associação, não causa.',
    ].join('\n'));
    expect(text).toContain('- Sono e blocos do dia seguinte (90 dias até 15/11): depois das noites mais curtas (até 6h, 10 dias), 0,0 de 1,0 blocos iniciados, '
      + 'em média; depois das mais longas (10 dias), 1,0 de 1,0. Associação, não causa.');
    expect(text).not.toContain('Sono e tipo do dia');   // no day type chosen: not enough pairs
  });
  it('no interpretation in a section without data in the period', () => {
    const quiet = md(data, { theme: 'personalizado', sections: ['saude'], diary: 'nenhuma' }, reportWeekPeriod('2026-11-16'));
    expect(quiet).not.toContain('Para investigar');
  });
  it('a postponement list below the minimum gives no hypothesis', () => {
    const few = reportData({
      blocks: [TECH], missions: [mission({ id: 'small', title: 'Pequena' })],
      events: Array.from({ length: 3 }, (_, i) => event('snoozed', 'small', addDays('2026-10-20', i * 3), '10:00')),
      // one start card inside the period: the section has data, so only the threshold keeps the hypothesis out
      checkins: [{ ...base, id: 'k1', at: at(10, 9), kind: 'start', feelings: [] }],
    });
    const text = md(few, { theme: 'personalizado', sections: ['adiamentos'], diary: 'nenhuma' });
    expect(text).toContain('- Cards de início ("Antes de começar"): 1.');
    expect(text).not.toContain('Para investigar');
    // the same data with 9 postponements does give it: the threshold is what held it back
    const many = { ...few, events: Array.from({ length: 9 }, (_, i) => event('snoozed', 'small', addDays('2026-10-20', i * 3), '10:00')) };
    expect(md(many, { theme: 'personalizado', sections: ['adiamentos'], diary: 'nenhuma' })).toContain('Pode ser que');
  });
  it('fewer than the minimum reviews per method gives no association', () => {
    const few = reportData({
      reviews: [...Array.from({ length: 5 }, (_, i) => review(addDays('2026-10-01', i), 3)), ...Array.from({ length: 5 }, (_, i) => review(addDays('2026-10-01', i), 3, { wrote: true }))],
    });
    const text = md({ ...few, reviews: [...few.reviews, review('2026-11-10', 3)] }, { theme: 'personalizado', sections: ['aprendizagem'], diary: 'nenhuma' });
    expect(text).toContain('- Revisões: 1 em 1 dia');   // a review inside the period: the section is reached
    expect(text).not.toContain('Jeito de responder');
    // 30 + 30 reviews in October give it, so the threshold is what kept it out; and without a review in the period it stays out
    const enough = reportData({
      reviews: [...Array.from({ length: 30 }, (_, i) => review(addDays('2026-10-01', i), 3)), ...Array.from({ length: 30 }, (_, i) => review(addDays('2026-10-01', i), 3, { wrote: true }))],
    });
    expect(md(enough, { theme: 'personalizado', sections: ['aprendizagem'], diary: 'nenhuma' })).toContain('Nenhuma revisão nem prática');
    expect(md(enough, { theme: 'personalizado', sections: ['aprendizagem'], diary: 'nenhuma' })).not.toContain('Jeito de responder');
    // a closed practice session but no review in the period: no review association either
    const practiceOnly = { ...enough, practice: [practice({ id: 'px', title: 'Join', createdAt: at(11, 21), endedAt: at(11, 22), ratings: { delivered: 2 } })] };
    expect(md(practiceOnly, { theme: 'personalizado', sections: ['aprendizagem'], diary: 'nenhuma' })).toContain('Prática técnica: 1 sessão encerrada');
    expect(md(practiceOnly, { theme: 'personalizado', sections: ['aprendizagem'], diary: 'nenhuma' })).not.toContain('Jeito de responder');
    expect(md({ ...enough, reviews: [...enough.reviews, review('2026-11-10', 3)] }, { theme: 'personalizado', sections: ['aprendizagem'], diary: 'nenhuma' }))
      .toContain('Jeito de responder e acerto');
  });
});

describe('reportMarkdown: no counts against nothing, Treino off, Aprendizagem words', () => {
  const done = [mission({ id: 'm1', title: 'Escrever pauta', status: 'done', completedAt: at(10, 14) })];
  const week = [{ ...base, id: '2026-11-09', objectives: [], experiment: 'Celular fora do quarto' }];
  const xps = [xp('2026-11-10')];
  const sections = { theme: 'personalizado' as const, sections: ['execucao', 'habitos'] as ReportOptions['sections'], diary: 'nenhuma' as const };

  it('planned blocks without a single session never read "0 de N"', () => {
    const text = md(reportData({ blocks: [TECH, FACUL], missions: done, xpEvents: [], weeks: week }), sections);
    expect(text).toContain('- Missões concluídas: 1 — Escrever pauta.');
    expect(text).toContain('- Experimento da semana de 09/11: "Celular fora do quarto".');
    expect(text).not.toMatch(/\d+ de \d+/);
    expect(text).not.toContain('Planejado × executado');
  });
  it('with a session the counts appear', () => {
    const text = md(reportData({ blocks: [TECH, FACUL], missions: done, xpEvents: xps, weeks: week, sessions: [session('tech', '2026-11-10')] }), sections);
    expect(text).toContain('- Blocos: 1 de 10 iniciados.');
    expect(text).toContain('Dias úteis com alguma atividade (XP): 1 de 5.');
    expect(text).toContain('(blocos iniciados naquela semana: 1 de 10)');
  });
  it('no day with XP gives no "0 de N" line either', () => {
    const text = md(reportData({ blocks: [TECH], missions: [], weeks: week }), { ...sections, sections: ['habitos'] });
    expect(text).not.toContain('Dias úteis com alguma atividade');
  });
  it('Treino off takes the training blocks out of Execução; on, they count', () => {
    const gym = block({ id: 'gym', name: 'Treino', kind: 'body', targetStart: '18:00' });
    const data = reportData({
      blocks: [TECH, gym],
      sessions: [{ ...session('tech', '2026-11-10'), outcome: 'feito' }, { ...session('gym', '2026-11-10', '18:00'), outcome: 'parcial', result: 'Só pernas' }],
    });
    const on = md(data, { theme: 'personalizado', sections: ['execucao'], diary: 'nenhuma' });
    expect(on).toContain('- Blocos: 2 de 10 iniciados.');
    expect(on).toContain('Como foi o bloco: Feito 1 · Parcial 1.');
    expect(on).toContain('Só pernas');
    const off = md(data, { theme: 'personalizado', sections: ['execucao'], diary: 'nenhuma', health: { sono: true, treino: false, estado: true } });
    expect(off).toContain('- Blocos: 1 de 5 iniciados.');
    expect(off).toContain('Como foi o bloco: Feito 1.');
    expect(off).not.toContain('Só pernas');
    expect(off).not.toContain('Treino');
  });
  it('Treino off takes the training blocks out of the experiment counts in Hábitos too', () => {
    const gym = block({ id: 'gym', name: 'Treino', kind: 'body', targetStart: '18:00' });
    const data = reportData({
      blocks: [TECH, gym], weeks: week,
      sessions: [session('tech', '2026-11-10'), session('gym', '2026-11-10', '18:00'), session('gym', '2026-11-11', '18:00')],
    });
    const on = md(data, { ...sections, sections: ['habitos'] });
    expect(on).toContain('(blocos iniciados naquela semana: 3 de 10)');
    const off = md(data, { ...sections, sections: ['habitos'], health: { sono: true, treino: false, estado: true } });
    expect(off).toContain('(blocos iniciados naquela semana: 1 de 5)');
    const gymOnly = reportData({ blocks: [TECH, gym], weeks: week, sessions: [session('gym', '2026-11-10', '18:00')] });
    const offGymOnly = md(gymOnly, { ...sections, sections: ['habitos'], health: { sono: true, treino: false, estado: true } });
    expect(offGymOnly).toContain('- Experimento da semana de 09/11: "Celular fora do quarto".');
    expect(offGymOnly).not.toMatch(/\d+ de \d+/);
  });
});
