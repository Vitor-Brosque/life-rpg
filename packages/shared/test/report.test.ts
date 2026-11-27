import { describe, expect, it } from 'vitest';
import type { DiaryEntry, DiaryTheme, MonthReview, Week } from '../src/types';
import { DIARY_THEMES, DIARY_THEME_LABEL, reviewsBetween } from '../src/diary';
import {
  REPORT_DEFAULTS, REPORT_NOTE, REPORT_SECTIONS, THEME_SECTIONS, customPeriodIssue, defaultReportWeek, renderReportBlock,
  renderReportDiary, renderReportReviews, reportDate, reportDecimal, reportDiaryCandidates, reportDiaryEntries, reportDiaryMatch,
  reportDuration, reportFileName, reportHeader, reportList, reportMonthPeriod, reportMonthTitle, reportPct, reportPeriodLabel,
  reportQuote, reportRange, reportSaid, reportSectionsOf, reportShortDay, reportWeekPeriod, reportCustomPeriod,
  type ReportOptions,
} from '../src/report';
import { base } from './patternFixture';

const at = (day: number, h: number, m = 0): number => new Date(2026, 10, day, h, m).getTime();
const entry = (id: string, p: Partial<DiaryEntry> & Pick<DiaryEntry, 'day' | 'at'>): DiaryEntry => ({
  ...base, id, kind: 'livre', text: id, themes: [], links: [], private: false, ...p,
});
const opts = (p: Partial<ReportOptions>): ReportOptions => ({ ...REPORT_DEFAULTS, ...p });
const WEEK = { start: '2026-11-09', end: '2026-11-15' };

describe('diary theme Comunicação and reviewsBetween', () => {
  it('thirteen diary themes: Comunicação comes last', () => {
    expect(DIARY_THEMES).toHaveLength(13);
    expect(DIARY_THEMES[12]).toBe('comunicacao');
    expect(DIARY_THEME_LABEL.comunicacao).toBe('Comunicação');
  });
  it('reviewsBetween keeps the answers of the days from `from` to `to`, oldest first', () => {
    const weeks: Week[] = [
      { ...base, id: '2026-11-02', objectives: [], review: { worked: 'Blocos curtos', obstacle: '', adjustment: '', answeredAt: at(2, 9) } },
      { ...base, id: '2026-11-09', objectives: [], review: { worked: '', obstacle: 'Sono', adjustment: '', answeredAt: at(9, 9) } },
    ];
    const months: MonthReview[] = [{
      ...base, id: 'month-2026-10', month: '2026-10', answeredAt: at(3, 2),   // 02:00 belongs to day 2 (day start 4)
      answers: { progress: 'Terminei o módulo', obstacle: '', next: '' },
      observed: { workdays: 0, activeWorkdays: 0, blocksPlanned: 0, blocksStarted: 0, minimumUsed: 0, resumptions: 0, reviews: 0, practiceClosed: 0, workouts: 0, escapes: 0 },
    }];
    expect(reviewsBetween({ weeks, months, from: '2026-11-01', to: '2026-11-08', dayStartHour: 4 }).map((r) => [r.title, r.day, r.answers])).toEqual([
      ['Nova semana', '2026-11-02', [{ label: 'O que funcionou', text: 'Blocos curtos' }]],
      ['Reflexão de outubro', '2026-11-02', [{ label: 'Avanços', text: 'Terminei o módulo' }]],
    ]);
    expect(reviewsBetween({ weeks, months, from: '2026-11-09', to: '2026-11-09', dayStartHour: 4 }).map((r) => r.id)).toEqual(['2026-11-09']);
  });
});

describe('themes, sections and options', () => {
  it('each theme is a fixed subset of sections, in order; Personalizado uses the chosen ones', () => {
    expect(REPORT_SECTIONS).toEqual(['visao', 'execucao', 'aprendizagem', 'materias', 'habitos', 'adiamentos', 'saude', 'fala', 'revisoes']);
    expect(reportSectionsOf({ theme: 'geral', sections: [] })).toEqual(['visao', 'execucao', 'aprendizagem', 'materias', 'habitos', 'adiamentos', 'saude', 'revisoes']);
    expect(reportSectionsOf({ theme: 'aprendizagem', sections: [] })).toEqual(['execucao', 'aprendizagem', 'materias']);
    expect(reportSectionsOf({ theme: 'habitos', sections: [] })).toEqual(['execucao', 'habitos', 'adiamentos']);
    expect(reportSectionsOf({ theme: 'saude', sections: [] })).toEqual(['saude']);
    expect(reportSectionsOf({ theme: 'comunicacao', sections: [] })).toEqual(['fala']);
    expect(reportSectionsOf({ theme: 'personalizado', sections: ['revisoes', 'fala', 'visao'] })).toEqual(['visao', 'fala', 'revisoes']);
  });
  it('defaults: Geral, diary "Do tema", private out, every health type in', () => {
    expect(REPORT_DEFAULTS).toEqual({
      theme: 'geral', sections: THEME_SECTIONS.geral, diary: 'tema', chosen: [], includePrivate: false,
      health: { sono: true, treino: true, estado: true },
    });
  });
});

describe('periods', () => {
  it('the screen opens on the last complete week on Monday and Tuesday, else on the current week', () => {
    expect(defaultReportWeek('2026-11-16')).toBe('2026-11-09');
    expect(defaultReportWeek('2026-11-17')).toBe('2026-11-09');
    expect(defaultReportWeek('2026-11-18')).toBe('2026-11-16');
    expect(defaultReportWeek('2026-11-22')).toBe('2026-11-16');
  });
  it('week, month and custom periods', () => {
    expect(reportWeekPeriod('2026-11-09')).toEqual({ kind: 'semana', start: '2026-11-09', end: '2026-11-15' });
    expect(reportMonthPeriod('2026-11')).toEqual({ kind: 'mes', start: '2026-11-01', end: '2026-11-30' });
    expect(reportMonthPeriod('2028-02')).toEqual({ kind: 'mes', start: '2028-02-01', end: '2028-02-29' });
    expect(reportCustomPeriod('2026-11-01', '2026-11-10')).toEqual({ kind: 'personalizado', start: '2026-11-01', end: '2026-11-10' });
  });
  it('custom dates: both, in order, up to today, at most 92 days', () => {
    const today = '2026-11-18';
    expect(customPeriodIssue('', '2026-11-10', today)).toBe('missing');
    expect(customPeriodIssue('2026-11-10', '2026-11-09', today)).toBe('order');
    expect(customPeriodIssue('2026-11-10', '2026-11-19', today)).toBe('future');
    expect(customPeriodIssue('2026-08-18', '2026-11-18', today)).toBe('long');
    expect(customPeriodIssue('2026-08-19', '2026-11-18', today)).toBeUndefined();
    expect(customPeriodIssue('2026-11-18', '2026-11-18', today)).toBeUndefined();
  });
  it('the range is the period cut at today', () => {
    expect(reportRange(reportWeekPeriod('2026-11-16'), '2026-11-18')).toEqual({ start: '2026-11-16', end: '2026-11-18', clamped: true });
    expect(reportRange(reportWeekPeriod('2026-11-09'), '2026-11-18')).toEqual({ start: '2026-11-09', end: '2026-11-15', clamped: false });
    expect(reportRange(reportWeekPeriod('2026-11-23'), '2026-11-18')).toEqual({ start: '2026-11-18', end: '2026-11-18', clamped: true });
  });
  it('labels and file names', () => {
    expect(reportPeriodLabel(reportWeekPeriod('2026-11-09'), '2026-11-18')).toBe('09/11 a 15/11/2026');
    expect(reportPeriodLabel(reportWeekPeriod('2026-11-16'), '2026-11-18')).toBe('16/11 a 22/11/2026 (até hoje, 18/11)');
    expect(reportPeriodLabel(reportWeekPeriod('2026-12-28'), '2027-01-10')).toBe('28/12/2026 a 03/01/2027');
    expect(reportPeriodLabel(reportMonthPeriod('2026-10'), '2026-11-18')).toBe('outubro de 2026');
    expect(reportPeriodLabel(reportMonthPeriod('2026-11'), '2026-11-18')).toBe('novembro de 2026 (até hoje, 18/11)');
    expect(reportPeriodLabel(reportCustomPeriod('2026-11-01', '2026-11-10'), '2026-11-18')).toBe('01/11 a 10/11/2026');
    expect(reportMonthTitle('2026-11')).toBe('Novembro de 2026');
    expect(reportFileName('geral', WEEK)).toBe('relatorio-geral-2026-11-09_a_2026-11-15.md');
    expect(reportFileName('comunicacao', { start: '2026-11-16', end: '2026-11-18' })).toBe('relatorio-comunicacao-2026-11-16_a_2026-11-18.md');
  });
});

describe('text helpers', () => {
  it('durations, percentages, decimals, days', () => {
    expect([0, 45, 60, 65, 90, 600].map(reportDuration)).toEqual(['0 min', '45 min', '1h', '1h05', '1h30', '10h']);
    expect(reportPct(0.844)).toBe('84%');
    expect(reportDecimal(2.25)).toBe('2,3');
    expect(reportDecimal(3.8)).toBe('3,8');
    expect(reportShortDay('2026-11-10')).toBe('ter 10/11');
    expect(reportDate('2026-11-10')).toBe('10/11/2026');
  });
  it('lists keep the first 8 and say how many more; quotes collapse only the whitespace; no second full stop', () => {
    expect(reportList(['a', 'b', 'c'])).toBe('a · b · c');
    expect(reportList(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])).toBe('1 · 2 · 3 · 4 · 5 · 6 · 7 · 8 · e mais 2');
    expect(reportQuote('  Entendi\n  joins,  mas travei ')).toBe('"Entendi joins, mas travei"');
    expect(reportSaid('Motivo', 'Provas')).toBe('Motivo: "Provas".');
    expect(reportSaid('Explicação', 'Entendi joins.')).toBe('Explicação: "Entendi joins."');
    expect(reportSaid('Pensamento', 'Será?')).toBe('Pensamento: "Será?"');
  });
});

describe('which diary entries go in', () => {
  const entries = [
    entry('a', { day: '2026-11-10', at: at(10, 21), themes: ['estudo'] }),
    entry('b', { day: '2026-11-11', at: at(11, 22), themes: ['sentimentos'], private: true }),
    entry('c', { day: '2026-11-12', at: at(12, 8), links: [{ kind: 'mission', id: 'm1' }] }),
    entry('d', { day: '2026-11-13', at: at(13, 23), themes: ['sono'] }),
    entry('e', { day: '2026-11-14', at: at(14, 10), themes: ['comunicacao'] }),
    entry('f', { day: '2026-11-16', at: at(16, 10), themes: ['estudo'] }),
    entry('g', { day: '2026-11-11', at: at(11, 9), themes: ['estudo'], trashedAt: at(12, 9) }),
    entry('h', { day: '2026-11-12', at: at(12, 9), themes: ['estudo'], deleted: true }),
  ];
  const ids = (es: DiaryEntry[]): string[] => es.map((e) => e.id);
  it('candidates: visible, in the range, private only with the switch, by time', () => {
    expect(ids(reportDiaryCandidates(entries, WEEK, false))).toEqual(['a', 'c', 'd', 'e']);
    expect(ids(reportDiaryCandidates(entries, WEEK, true))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('"Do tema" of each theme; Personalizado joins what its sections bring', () => {
    expect(reportDiaryMatch({ theme: 'geral', sections: [] })).toBe('all');
    expect(ids(reportDiaryEntries(entries, WEEK, opts({ theme: 'geral' })))).toEqual(['a', 'c', 'd', 'e']);
    expect(ids(reportDiaryEntries(entries, WEEK, opts({ theme: 'aprendizagem' })))).toEqual(['a']);
    expect(ids(reportDiaryEntries(entries, WEEK, opts({ theme: 'habitos' })))).toEqual(['c']);
    expect(ids(reportDiaryEntries(entries, WEEK, opts({ theme: 'habitos', includePrivate: true })))).toEqual(['b', 'c']);
    expect(ids(reportDiaryEntries(entries, WEEK, opts({ theme: 'saude' })))).toEqual(['d']);
    expect(ids(reportDiaryEntries(entries, WEEK, opts({ theme: 'comunicacao' })))).toEqual(['e']);
    expect(reportDiaryMatch({ theme: 'personalizado', sections: ['materias', 'fala'] }))
      .toEqual({ themes: ['faculdade', 'estudo', 'comunicacao'] satisfies DiaryTheme[], missionLinks: false });
    expect(ids(reportDiaryEntries(entries, WEEK, opts({ theme: 'personalizado', sections: ['materias', 'fala'] })))).toEqual(['a', 'e']);
    expect(ids(reportDiaryEntries(entries, WEEK, opts({ theme: 'personalizado', sections: ['visao', 'revisoes'] })))).toEqual([]);
  });
  it('Nenhuma, Todas and Escolher (the ticked ones that are still candidates)', () => {
    expect(reportDiaryEntries(entries, WEEK, opts({ diary: 'nenhuma' }))).toEqual([]);
    expect(ids(reportDiaryEntries(entries, WEEK, opts({ theme: 'saude', diary: 'todas' })))).toEqual(['a', 'c', 'd', 'e']);
    expect(ids(reportDiaryEntries(entries, WEEK, opts({ diary: 'escolher', chosen: ['d', 'b', 'f', 'g'] })))).toEqual(['d']);
    expect(ids(reportDiaryEntries(entries, WEEK, opts({ diary: 'escolher', chosen: ['d', 'b'], includePrivate: true })))).toEqual(['b', 'd']);
  });
});

describe('Markdown of the parts', () => {
  it('header: theme, period (cut at today), export day and the fixed note', () => {
    expect(reportHeader('saude', reportWeekPeriod('2026-11-16'), '2026-11-18')).toEqual([
      '# Relatório — Saúde — 16/11 a 22/11/2026 (até hoje, 18/11)',
      'Exportado do LIFE RPG em 18/11/2026.',
      'Fatos vêm dos registros do app; percepções são minhas palavras; ausência de dado não é fracasso; interpretações são hipóteses.',
    ]);
    expect(REPORT_NOTE).toBe('Fatos vêm dos registros do app; percepções são minhas palavras; ausência de dado não é fracasso; interpretações são hipóteses.');
  });
  it('a block shows its non-empty parts in order; "Minhas percepções" keeps 8 and "E mais N."', () => {
    const mine = Array.from({ length: 10 }, (_, i) => `Fala ${i + 1}.`);
    expect(renderReportBlock('Execução', { facts: ['Blocos: 3 de 5 iniciados.', 'Escapei: 1 (YouTube 1).'], mine, missing: ['Sem foto.'], ideas: ['Pode ser que x.'] })).toEqual([
      '', '## Execução',
      '**Registrado:**', '- Blocos: 3 de 5 iniciados.', '- Escapei: 1 (YouTube 1).',
      '',
      '**Minhas percepções:**', '- Fala 1.', '- Fala 2.', '- Fala 3.', '- Fala 4.', '- Fala 5.', '- Fala 6.', '- Fala 7.', '- Fala 8.', '- E mais 2.',
      '',
      '**Sem dados:**', '- Sem foto.',
      '',
      '**Para investigar (interpretação, não conclusão):**', '- Pode ser que x.',
    ]);
    expect(renderReportBlock('Prática de fala', { facts: [], mine: [], missing: ['Ainda não há prática de fala registrada.'], ideas: [] })).toEqual([
      '', '## Prática de fala', '**Sem dados:**', '- Ainda não há prática de fala registrada.',
    ]);
  });
  it('Diário: the words untouched, time, fechamento, privada, themes and named links (unknown ones left out)', () => {
    const es = [
      entry('a', { day: '2026-11-10', at: at(10, 21, 5), kind: 'fechamento', text: '  Dia corrido.\n\nMas rendeu.  ', themes: ['familia', 'xyz' as DiaryTheme], links: [{ kind: 'journey', id: 'j1' }, { kind: 'mission', id: 'gone' }] }),
      entry('b', { day: '2026-11-12', at: at(12, 22, 10), text: 'Só meu.', private: true }),
    ];
    expect(renderReportDiary(es, { 'journey:j1': 'Tech News' })).toEqual([
      '', '## Diário',
      '**Minhas percepções:** entradas do diário, com as minhas palavras, sem edição.',
      '', '### Terça-feira, 10/11 · 21:05 · fechamento do dia', 'Dia corrido.\n\nMas rendeu.',
      '', '_Temas: Família · Ligado a: jornada "Tech News"_',
      '', '### Quinta-feira, 12/11 · 22:10 · privada', 'Só meu.',
    ]);
    expect(renderReportDiary([], {})).toEqual(['', '## Diário', '**Sem dados:**', '- Nenhuma entrada do diário para este relatório.']);
  });
  it('Revisões: the answers in his words; none says so', () => {
    expect(renderReportReviews([{
      kind: 'week', id: '2026-11-09', day: '2026-11-09', at: at(9, 9), title: 'Nova semana',
      answers: [{ label: 'O que funcionou', text: 'Blocos curtos' }, { label: 'Ajuste para testar', text: 'Dormir antes' }],
    }])).toEqual([
      '', '## Revisões',
      '**Minhas percepções:** respostas da Nova semana, da reflexão do mês e da revisão da temporada, com as minhas palavras.',
      '', '### Nova semana (respondida em 09/11)', '- O que funcionou: Blocos curtos', '- Ajuste para testar: Dormir antes',
    ]);
    expect(renderReportReviews([])).toEqual(['', '## Revisões', '**Sem dados:**', '- Nenhuma revisão escrita neste período.']);
  });
});
