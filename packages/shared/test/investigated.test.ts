import { describe, expect, it } from 'vitest';
import { REPORT_DEFAULTS, reportWeekPeriod } from '../src/report';
import { reportMarkdown } from '../src/reportSections';
import { dayCloseSummary } from '../src/dayClose';
import { BLOCK_OUTCOMES, BLOCK_OUTCOME_LABEL, INVESTIGATED_HINT, investigatedPartial } from '../src/outcomes';
import { reportData } from './reportFixture';
import { block, event, mission, session } from './patternFixture';

describe('"Investiguei" as an outcome', () => {
  it('a block outcome between Parcial and Não deu, with its hint', () => {
    expect(BLOCK_OUTCOMES).toEqual(['feito', 'parcial', 'investiguei', 'nao-deu']);
    expect(BLOCK_OUTCOME_LABEL.investiguei).toBe('Investiguei');
    expect(INVESTIGATED_HINT).toBe('Pesquisa ou exploração, sem entrega ainda: conta como trabalho, não como adiamento.');
    expect(investigatedPartial({ data: { investigated: true } })).toBe(true);
    expect(investigatedPartial({ data: { investigated: 'yes' } })).toBe(false);
    expect(investigatedPartial({})).toBe(false);
  });

  it('the day close marks a mission whose last Parcial of the day was "Investiguei"', () => {
    const D = '2026-11-11';
    const out = dayCloseSummary({
      day: D, dayStartHour: 4, occurrences: [],
      missions: [mission({ id: 'a', title: 'API' }), mission({ id: 'b', title: 'Lista' }), mission({ id: 'c', title: 'Doc' })],
      events: [
        event('partial', 'a', D, '10:00', { investigated: true }),
        event('partial', 'b', D, '11:00', { investigated: true }),
        event('partial', 'b', D, '15:00', {}),
        event('partial', 'c', D, '16:00', {}),
        event('partial', 'c', D, '17:00', { investigated: true }),
      ],
      focus: [], reviews: [], practice: [], workouts: [],
    });
    expect(out.partial).toEqual([
      { missionId: 'a', title: 'API', investigated: true },
      { missionId: 'b', title: 'Lista' },
      { missionId: 'c', title: 'Doc', investigated: true },
    ]);
  });

  it('Execução counts "Investiguei" apart from Parcial and from "Não deu", with his words', () => {
    const data = reportData({
      blocks: [block({ id: 'tech', name: 'Tech News' })],
      sessions: [{ ...session('tech', '2026-11-10'), outcome: 'investiguei' }, { ...session('tech', '2026-11-11'), outcome: 'nao-deu' }],
      missions: [mission({ id: 'm3', title: 'Integrar API', status: 'open' }), mission({ id: 'm4', title: 'Lista 3' })],
      events: [
        event('partial', 'm3', '2026-11-12', '16:00', { investigated: true, result: 'Li a doc da API' }),
        event('partial', 'm4', '2026-11-13', '16:00', {}),
      ],
    });
    const out = reportMarkdown({
      data, period: reportWeekPeriod('2026-11-09'),
      options: { ...REPORT_DEFAULTS, theme: 'personalizado', sections: ['execucao'], diary: 'nenhuma' },
    });
    expect(out.split('\n').slice(3)).toEqual([
      '', '## Execução',
      '**Registrado:**',
      '- Blocos: 2 de 5 iniciados.',
      '- Como foi o bloco: Investiguei 1 · Não deu 1.',
      '- Parcial em 1 missão.',
      '- Investiguei (pesquisa ou exploração, sem entrega ainda) em 1 missão.',
      '',
      '**Minhas percepções:**',
      '- Investiguei em "Integrar API" (qui 12/11): "Li a doc da API".',
      '',
      '**Sem dados:**',
      '- Nenhum dia com foto do plano para comparar planejado × executado.',
      '',
    ]);
  });
});
