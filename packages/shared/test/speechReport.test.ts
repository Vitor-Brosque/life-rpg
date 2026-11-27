import { describe, expect, it } from 'vitest';
import type { SpeechProgram, SpeechRecording, SpeechSession, SpeechSituation } from '../src/types';
import { SPEECH_REPEATS_NOTE, SPEECH_WPM_NOTE, speechReportBlock } from '../src/speechReport';
import { REPORT_DEFAULTS, SPEECH_NONE, reportWeekPeriod } from '../src/report';
import { reportMarkdown } from '../src/reportSections';
import { base } from './patternFixture';
import { reportData } from './reportFixture';

const WEEK = { start: '2026-11-09', end: '2026-11-15' };
const rec = (hash: string, at: number, durationMs = 60_000, p: Partial<SpeechRecording> = {}): SpeechRecording => ({ hash, at, durationMs, ...p });
const sess = (id: string, p: Partial<SpeechSession> = {}): SpeechSession => ({
  ...base, id, day: '2026-11-10', kind: 'explicacao', recordings: [], ratings: {}, ...p,
});
const sit = (id: string, p: Partial<SpeechSituation> = {}): SpeechSituation => ({
  ...base, id, day: '2026-11-11', at: 100, context: 'aula', ...p,
});
const prog = (p: Partial<SpeechProgram> = {}): SpeechProgram => ({
  ...base, id: 'p1', startDay: '2026-11-02', week: 2, status: 'ativo', phaseNotes: {}, ...p,
});
const block = (p: Partial<Parameters<typeof speechReportBlock>[0]>) =>
  speechReportBlock({ sessions: [], situations: [], programs: [], range: WEEK, ...p });

describe('Prática de fala: nothing recorded', () => {
  it('only the "Sem dados" line: open drafts, deleted records, other weeks and a program alone do not count', () => {
    const empty = { facts: [], mine: [], missing: [SPEECH_NONE], ideas: [] };
    expect(block({})).toEqual(empty);
    expect(block({
      sessions: [sess('open'), sess('del', { done: true, deleted: true }), sess('late', { done: true, day: '2026-11-16' })],
      situations: [sit('del', { deleted: true }), sit('early', { day: '2026-11-08' })],
      programs: [prog()],
    })).toEqual(empty);
  });
});

describe('Prática de fala: sessions', () => {
  const sessions = [
    sess('r1', {
      kind: 'leitura', passage: 'feira', size: 5, day: '2026-11-09', ratings: { clareza: 3, conforto: 4 },
      recordings: [rec('a', 1, 60_000), rec('b', 2, 66_000), rec('c', 3, 5_000)],
    }),
    sess('e1', {
      kind: 'explicacao', size: 15, day: '2026-11-10', topic: 'explicar um JOIN', content: 'em-parte',
      ratings: { clareza: 4 }, notes: 'Travei no LEFT JOIN.', recordings: [rec('d', 4, 95_000)],
    }),
    sess('x1', { kind: 'exercicio', exercise: 'pausas', day: '2026-11-12', done: true, closedAt: 9 }),
  ];
  it('facts, speed of reference readings only, perceptions and notes', () => {
    expect(block({ sessions, programs: [prog()] })).toEqual({
      facts: [
        'Programa de fala desde 02/11; hoje na semana 2 de 12 (a semana é escolhida por mim).',
        'Sessões de fala: 3 — Leitura de referência 1 · Explicação espontânea 1 · Exercício 1.',
        'Tamanho escolhido: 5 min 1 · 15 min 1.',
        'Exercícios: Pausas 1.',
        'Gravações (só a lista; o áudio fica no app): 09/11 Leitura de referência "A feira de sábado" (1:00) · '
          + '09/11 Leitura de referência "A feira de sábado" (1:06) · 09/11 Leitura de referência "A feira de sábado" (0:05) · '
          + '10/11 Explicação espontânea "explicar um JOIN" (1:35).',
        'Velocidade na leitura de referência "A feira de sábado" (palavras do texto ÷ duração da gravação): 09/11 132 · 09/11 120 palavras por minuto.',
        SPEECH_WPM_NOTE,
      ],
      mine: [
        'Autoavaliação nas sessões (percepção, 1 a 5: quanto ficou como eu queria): Clareza percebida 3,5 (2 sessões) · Conforto vocal 4,0 (1 sessão).',
        '"Consegui explicar?" (conteúdo, separado da fala): Em parte 1.',
        'Nota da sessão de 10/11 (Explicação espontânea "explicar um JOIN"): "Travei no LEFT JOIN."',
      ],
      missing: [
        'Leitura de referência sem velocidade em 1 gravação (menos de 10 segundos ou parada no limite de 3 minutos).',
        'Nenhuma situação real registrada neste período.',
      ],
      ideas: [],
    });
  });
  it('an ended program in the period; a program started after the period is left out', () => {
    expect(block({ sessions, programs: [prog({ status: 'encerrado', endedDay: '2026-11-14' })] }).facts[0])
      .toBe('Programa de fala de 02/11 a 14/11.');
    expect(block({ sessions, programs: [prog({ startDay: '2026-11-20' })] }).facts[0]).toMatch(/^Sessões de fala/);
  });
});

describe('Prática de fala: real situations and phase notes', () => {
  it('contexts, repetition requests (never a zero), perceptions, his sentence; the caveat as interpretation', () => {
    const out = block({
      situations: [
        sit('s1', { context: 'aula', repeats: 0, clarity: 4, comfort: 3, at: 1, note: 'Perguntei sem travar' }),
        sit('s2', { context: 'conversa', repeats: 3, clarity: 3, at: 2 }),
        sit('s3', { context: 'aula', at: 3 }),
      ],
      programs: [prog({ phaseNotes: { 1: { text: 'Falo mais devagar nas aulas.', day: '2026-11-15', answeredAt: 5 } } })],
    });
    expect(out).toEqual({
      facts: [
        'Programa de fala desde 02/11; hoje na semana 2 de 12 (a semana é escolhida por mim).',
        'Situações reais registradas: 3 — Aula 2 · Conversa 1.',
        'Pediram para repetir: nenhuma vez em 1 situação · 3 ou mais vezes em 1 situação.',
      ],
      mine: [
        'Nas situações reais (percepção, 1 a 5): Clareza 3,5 (2 situações) · Conforto 3,0 (1 situação).',
        'Situação real de 11/11 (Aula): "Perguntei sem travar".',
        'O que mudou nas situações reais, no fim da fase 1 (15/11): "Falo mais devagar nas aulas."',
      ],
      missing: ['Nenhuma sessão de fala neste período.', '"Pediram para repetir?" sem resposta em 1 situação.'],
      ideas: [SPEECH_REPEATS_NOTE],
    });
  });
});

describe('the Comunicação oral report', () => {
  it('the section replaces the placeholder when there is practice', () => {
    const md = reportMarkdown({
      data: reportData({ speechSessions: [sess('x1', { kind: 'exercicio', exercise: 'ritmo', done: true })] }),
      period: reportWeekPeriod('2026-11-09'),
      options: { ...REPORT_DEFAULTS, theme: 'comunicacao', diary: 'nenhuma' },
    });
    expect(md).toContain([
      '## Prática de fala', '**Registrado:**', '- Sessões de fala: 1 — Exercício 1.', '- Exercícios: Ritmo 1.', '',
      '**Sem dados:**', '- Nenhuma situação real registrada neste período.',
    ].join('\n'));
    expect(md).not.toContain(SPEECH_NONE);
  });
});
