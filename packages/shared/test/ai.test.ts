import { describe, expect, it } from 'vitest';
import type { ChecklistItem, PracticeFeedback, PracticeSession, PracticeStep } from '../src/types';
import { newPracticeFields, normalizePractice } from '../src/practice';
import {
  AI_LIMITS, HINT_CODE_OMITTED, aiSettingsOf, cardsPrompt, cleanHint, cleanSuggestions, cleanWeekSummary, clip,
  hintPreview, hintPrompt, hintRequestOf, hintStepState, hintsForStep, isAiServerError, nextHintLevel,
  noteSourceText, suggestionErrors, weekPrompt,
} from '../src/ai';

const item = (text: string, done = false): ChecklistItem => ({ id: text || 'vazio', text, done });
const hint = (id: string, step: PracticeStep, level: 1 | 2 | 3, at = 1, text = `h${level}`): PracticeFeedback =>
  ({ id, at, source: 'ai', text, hint: { step, level } });

const session = (over: Partial<PracticeSession> = {}): PracticeSession => ({
  id: 's1', createdAt: 1, updatedAt: 1, deleted: false,
  ...newPracticeFields({ title: ' Remover notícias repetidas ' }),
  problem: 'Tirar URLs repetidas', inputs: 'lista de artigos', outputs: '',
  basics: [item('set'), item('  ')],
  plan: [item('normalizar URL', true), item('filtrar')],
  decision: 'usar set', language: 'python',
  code: '\ndef f(xs):\n    return list(set(xs))\n\n',
  tests: [item('[] → []', true)],
  feedback: [
    hint('a', 'plan', 2, 5, 'Olhe o passo 2.'),
    hint('b', 'plan', 1, 3, 'O que entra?'),
    { id: 'c', at: 9, source: 'person', text: 'ok' },
  ],
  ...over,
} as PracticeSession);

describe('settings and helpers', () => {
  it('aiSettingsOf: everything off unless set', () => {
    expect(aiSettingsOf(undefined)).toEqual({ hints: false, cards: false, weekly: false });
    expect(aiSettingsOf({ ai: { cards: true } })).toEqual({ hints: false, cards: true, weekly: false });
  });
  it('aiSettingsOf tolerates bad stored values and never switches anything on by accident', () => {
    const off = { hints: false, cards: false, weekly: false };
    expect(aiSettingsOf({ ai: { hints: 'no' } } as never)).toEqual(off);
    expect(aiSettingsOf({ ai: { hints: 1 } } as never)).toEqual(off);
    expect(aiSettingsOf({ ai: 'abc' } as never)).toEqual(off);
    expect(aiSettingsOf({ ai: null } as never)).toEqual(off);
    expect(aiSettingsOf({ ai: { hints: true, extra: true } } as never)).toEqual({ ...off, hints: true });
  });
  it('clip does not split a surrogate pair', () => {
    const out = clip('abcdefgh😀ijkl', 10);
    expect(out).toBe('abcdefgh…');
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(out)).toBe(false);
  });
  it('clip keeps short text and cuts at a word with an ellipsis', () => {
    expect(clip('abc', 3)).toBe('abc');
    expect(clip('uma frase bem comprida aqui', 15)).toBe('uma frase bem…');
    expect(clip('abcdefghijklmnop', 10)).toBe('abcdefghi…');
  });
  it('isAiServerError', () => {
    expect(isAiServerError('busy')).toBe(true);
    expect(isAiServerError('nope')).toBe(false);
    expect(isAiServerError(undefined)).toBe(false);
  });
});

describe('hints: state', () => {
  it('hintsForStep keeps AI hints of the step, by level', () => {
    expect(hintsForStep(session(), 'plan').map((h) => h.id)).toEqual(['b', 'a']);
    expect(hintsForStep(session(), 'code')).toEqual([]);
  });
  it('nextHintLevel', () => {
    expect(nextHintLevel([])).toBe(1);
    expect(nextHintLevel(hintsForStep(session(), 'plan'))).toBe(3);
    expect(nextHintLevel([hint('x', 'plan', 2)])).toBe(3);
    expect(nextHintLevel([hint('x', 'plan', 3)])).toBeUndefined();
  });
  it('hintStepState', () => {
    expect(hintStepState(session(), 'feedback')).toEqual({ kind: 'hidden' });
    expect(hintStepState(session(), 'close')).toEqual({ kind: 'hidden' });
    expect(hintStepState(session(), 'rebuild')).toEqual({ kind: 'hidden' });
    expect(hintStepState(session({ rebuild: { code: 'x', startedAt: 1, comparedAt: 2 } }), 'rebuild')).toEqual({ kind: 'hidden' });
    expect(hintStepState(session({ rebuild: { code: 'x', startedAt: 1 } }), 'rebuild')).toEqual({ kind: 'ready', hints: [], next: 1 });
    expect(hintStepState(session({ rebuild: { code: '', startedAt: 1 } }), 'code')).toEqual({ kind: 'paused' });
    expect(hintStepState(session({ rebuild: { code: '', startedAt: 1 } }), 'test')).toEqual({ kind: 'paused' });
    expect(hintStepState(session({ rebuild: { code: '', startedAt: 1, peeked: true } }), 'code').kind).toBe('ready');
    const plan = hintStepState(session(), 'plan');
    expect(plan.kind === 'ready' && plan.next).toBe(3);
  });
});

describe('hints: request and prompt', () => {
  it('hintRequestOf trims, drops empty items, sends no code outside code/test/rebuild', () => {
    expect(hintRequestOf(session(), 'plan', 3)).toEqual({
      step: 'plan', level: 3, title: 'Remover notícias repetidas',
      problem: 'Tirar URLs repetidas', inputs: 'lista de artigos', outputs: '',
      basics: ['set'],
      plan: [{ text: 'normalizar URL', done: true }, { text: 'filtrar', done: false }],
      alternatives: '', decision: 'usar set',
      tests: [{ text: '[] → []', done: true }],
      language: 'python', code: '',
      previous: [{ level: 1, text: 'O que entra?' }, { level: 2, text: 'Olhe o passo 2.' }],
    });
  });
  it('code: the implementation on code/test, only the rebuild on rebuild', () => {
    expect(hintRequestOf(session(), 'code', 1).code).toBe('def f(xs):\n    return list(set(xs))');
    expect(hintRequestOf(session(), 'test', 1).code).toBe('def f(xs):\n    return list(set(xs))');
    const rebuilding = session({ rebuild: { code: 'def g():\n    pass\n', startedAt: 1 } });
    expect(hintRequestOf(rebuilding, 'rebuild', 1).code).toBe('def g():\n    pass');
    expect(hintRequestOf(session({ rebuild: undefined }), 'rebuild', 1).code).toBe('');
  });
  it('previous only has lower levels', () => {
    expect(hintRequestOf(session(), 'plan', 2).previous).toEqual([{ level: 1, text: 'O que entra?' }]);
    expect(hintRequestOf(session(), 'plan', 1).previous).toEqual([]);
  });
  it('hintPrompt: context sections and the ask with earlier hints', () => {
    const p = hintPrompt(hintRequestOf(session(), 'plan', 3));
    expect(p.context).toBe([
      '<sessao>',
      'Sessão de prática: Remover notícias repetidas',
      'Passo atual: 3. Decompor',
      'Linguagem: Python',
      '',
      '## Problema',
      'Tirar URLs repetidas',
      'Entradas: lista de artigos',
      '',
      '## Conceitos',
      '- set',
      '',
      '## Passos da decomposição',
      '1. [x] normalizar URL',
      '2. [ ] filtrar',
      '',
      '## Decisão',
      'usar set',
      '',
      '## Casos de teste',
      '- [x] [] → []',
      '</sessao>',
    ].join('\n'));
    expect(p.ask).toBe([
      'Pistas que ele já recebeu neste passo:',
      'Pista 1 (pergunta): O que entra?',
      'Pista 2 (direção): Olhe o passo 2.',
      '',
      'Dê agora a pista 3 (próximo passo) sobre o passo "Decompor".',
    ].join('\n'));
  });
  it('hintPrompt: code block with language; rebuild labelled; four backticks when needed', () => {
    const code = hintPrompt(hintRequestOf(session(), 'code', 1));
    expect(code.context).toContain('Passo atual: 5. Implementar');
    expect(code.context).toContain('## Código da implementação\n```python\ndef f(xs):\n    return list(set(xs))\n```\n</sessao>');
    expect(code.ask).toBe('Dê agora a pista 1 (pergunta) sobre o passo "Implementar".');
    const rb = hintPrompt(hintRequestOf(session({ rebuild: { code: 'x = 1', startedAt: 1 } }), 'rebuild', 1));
    expect(rb.context).toContain('## Reconstrução (escrita de memória, sem consultar)\n```python\nx = 1\n```');
    expect(rb.context).not.toContain('def f(xs)');
    const fenced = hintPrompt(hintRequestOf(session({ code: 'print("```")', language: 'sql' }), 'code', 1));
    expect(fenced.context).toContain('````sql\nprint("```")\n````');
  });
  it('hintPreview of an empty session', () => {
    const empty = session({
      title: '', problem: '', inputs: '', basics: [], plan: [], decision: '', tests: [], code: '', feedback: [],
    });
    expect(hintPreview(hintRequestOf(empty, 'problem', 1))).toBe([
      '<sessao>',
      'Sessão de prática: (sem título)',
      'Passo atual: 1. Problema',
      'Linguagem: Python',
      '</sessao>',
      '',
      'Dê agora a pista 1 (pergunta) sobre o passo "Problema".',
    ].join('\n'));
  });
});

describe('cleanHint', () => {
  it('trims and keeps plain text', () => {
    expect(cleanHint('  Pense no que entra.  ')).toBe('Pense no que entra.');
  });
  it('omits a code block longer than 2 lines and keeps a short one', () => {
    expect(cleanHint('Tente isto:\n```python\nseen = set()\nfor u in urls:\n    pass\n```\nE teste.'))
      .toBe(`Tente isto:\n${HINT_CODE_OMITTED}\nE teste.`);
    expect(cleanHint('Use:\n```python\nseen = set()\n```')).toBe('Use:\n```python\nseen = set()\n```');
  });
  it('cuts an unclosed fence', () => {
    expect(cleanHint('Comece:\n```python\na = 1\nb = 2\nc = 3')).toBe(`Comece:\n${HINT_CODE_OMITTED}`);
  });
  it('collapses blank lines and caps the length', () => {
    expect(cleanHint('a\n\n\n\nb')).toBe('a\n\nb');
    expect(cleanHint('x'.repeat(1200))).toHaveLength(AI_LIMITS.hintText);
    expect(cleanHint('palavra '.repeat(200)).endsWith('palavra…')).toBe(true);
    expect(cleanHint('   ')).toBe('');
  });
});

describe('card suggestions', () => {
  it('cardsPrompt', () => {
    expect(cardsPrompt({ text: '  Texto.  ', deckName: '' }))
      .toBe('Baralho: Caixa de entrada\n\n<texto>\nTexto.\n</texto>\n\nProponha os cards.');
    expect(cardsPrompt({ text: 'T', deckName: ' SQL ' }).startsWith('Baralho: SQL\n')).toBe(true);
  });
  it('suggestionErrors', () => {
    expect(suggestionErrors({ type: 'basic', front: ' ', back: '', extra: '' }))
      .toEqual({ front: 'Escreva a pergunta.', back: 'Escreva a resposta.' });
    expect(suggestionErrors({ type: 'cloze', front: '', back: '', extra: '' })).toEqual({ front: 'Escreva o texto.' });
    expect(suggestionErrors({ type: 'cloze', front: 'sem', back: '', extra: '' })).toEqual({ front: 'Marque ao menos uma lacuna.' });
    expect(suggestionErrors({ type: 'cloze', front: 'com {{1::x}}', back: '', extra: '' })).toEqual({});
  });
  it('cleanSuggestions keeps only valid, distinct, tidy cards', () => {
    expect(cleanSuggestions(null)).toEqual([]);
    expect(cleanSuggestions({ cards: 'x' })).toEqual([]);
    expect(cleanSuggestions({ cards: [
      { type: 'basic', front: ' O que é HAVING? ', back: ' Filtro de grupos ', extra: ' porque sim ' },
      { type: 'basic', front: 'Sem verso', back: '  ', extra: '' },
      { type: 'cloze', front: 'PK não aceita {{nulos}}.', back: 'ignorado', extra: '' },
      { type: 'cloze', front: 'Sem lacuna', back: '', extra: '' },
      { type: 'other', front: 'x', back: 'y', extra: '' },
      { type: 'basic', front: 'o que é having?', back: 'dup', extra: '' },
      { type: 'basic', front: 'Longo', back: 'b', extra: 'e'.repeat(501) },
      { type: 'basic', front: 'f'.repeat(1001), back: 'b', extra: '' },
      'lixo',
    ] })).toEqual([
      { type: 'basic', front: 'O que é HAVING?', back: 'Filtro de grupos', extra: 'porque sim' },
      { type: 'cloze', front: 'PK não aceita {{1::nulos}}.', back: '', extra: '' },
      { type: 'basic', front: 'Longo', back: 'b', extra: '' },
    ]);
  });
  it('at most 5', () => {
    const cards = Array.from({ length: 7 }, (_, i) => ({ type: 'basic', front: `P${i}`, back: 'R', extra: '' }));
    expect(cleanSuggestions({ cards })).toHaveLength(5);
  });
  it('noteSourceText', () => {
    expect(noteSourceText({ type: 'basic', front: 'Frente', back: 'Verso', extra: ' Porque ' })).toBe('Frente\n\nVerso\n\nPorque');
    expect(noteSourceText({ type: 'cloze', front: 'A {{1::PK}} é única.', back: '', extra: undefined })).toBe('A PK é única.');
    expect(noteSourceText({ type: 'code', front: 'Some a lista', back: 'sum(xs)\n', extra: '', language: 'python' }))
      .toBe('Some a lista\n\n```python\nsum(xs)\n```');
    expect(noteSourceText({ type: 'topic', front: 'Explique: índices', back: 'B-tree\nseletividade', extra: '' }))
      .toBe('Explique: índices\n\nB-tree\nseletividade');
  });
});

describe('weekly summary', () => {
  it('weekPrompt with facts only', () => {
    expect(weekPrompt({ weekStart: '2026-11-09', facts: [
      { label: 'Blocos iniciados', value: '7 de 10' }, { label: 'Escapei', value: '2×' },
    ] })).toBe([
      '<semana>',
      'Semana de 09/11 a 15/11 (segunda a domingo). Sábado e domingo são de descanso.',
      '',
      'Números observados pelo app:',
      '- Blocos iniciados: 7 de 10',
      '- Escapei: 2×',
      '</semana>',
      '',
      'Escreva o resumo.',
    ].join('\n'));
  });
  it('weekPrompt with the reading (only answered questions), across months', () => {
    const text = weekPrompt({
      weekStart: '2026-10-26', facts: [{ label: 'Retomadas', value: '1' }],
      reading: { worked: ' manhãs ', obstacle: '', adjustment: 'dormir cedo' },
    });
    expect(text).toContain('Semana de 26/10 a 01/11');
    expect(text).toContain('Leitura do próprio estudante:\n- O que funcionou: manhãs\n- Ajuste que quer testar: dormir cedo\n</semana>');
    expect(text).not.toContain('Maior obstáculo');
  });
  it('an empty reading is left out', () => {
    expect(weekPrompt({ weekStart: '2026-11-09', facts: [], reading: { worked: ' ', obstacle: '', adjustment: '' } }))
      .not.toContain('Leitura');
  });
  it('cleanWeekSummary', () => {
    expect(cleanWeekSummary('x')).toBeUndefined();
    expect(cleanWeekSummary({ observed: '  ', hypothesis: 'h' })).toBeUndefined();
    expect(cleanWeekSummary({ observed: ' Você iniciou\n7 blocos. ', hypothesis: 5, suggestion: ' Teste X. ' }))
      .toEqual({ observed: 'Você iniciou 7 blocos.', hypothesis: '', suggestion: 'Teste X.' });
    expect(cleanWeekSummary({ observed: 'a '.repeat(300) })!.observed.length).toBeLessThanOrEqual(AI_LIMITS.weekField);
  });
});

describe('normalizePractice keeps a valid hint', () => {
  it('keeps it and drops a broken one', () => {
    const s = normalizePractice({
      ...session(),
      feedback: [
        { id: 'f', at: 1, source: 'ai', text: 'x', hint: { step: 'plan', level: 2 } },
        { id: 'g', at: 2, source: 'ai', text: 'y', hint: { step: 'nope', level: 9 } },
      ],
    } as unknown as PracticeSession);
    expect(s.feedback[0]!.hint).toEqual({ step: 'plan', level: 2 });
    expect('hint' in s.feedback[1]!).toBe(false);
  });
});

describe('rebuild rule in the builders', () => {
  const rebuilding = (over = {}) => session({ rebuild: { startedAt: 1, code: 'def g(): pass', ...over } } as never);
  it('hintRequestOf has no code for code/test while a rebuild is unfinished and not peeked', () => {
    for (const step of ['code', 'test'] as const) {
      const r = hintRequestOf(rebuilding(), step, 1);
      expect(r.code).toBe('');
      expect(hintPreview(r)).not.toContain('def f');
    }
    expect(hintRequestOf(rebuilding({ peeked: true }), 'code', 1).code).toContain('def f');
    expect(hintRequestOf(rebuilding({ comparedAt: 5 }), 'code', 1).code).toContain('def f');
  });
  it('hintPrompt ignores code on steps other than code/test/rebuild', () => {
    const r = { ...hintRequestOf(session(), 'code', 1), step: 'problem' as const };
    expect(r.code).not.toBe('');
    expect(hintPrompt(r).context).not.toContain('def f');
  });
});

describe('cleanHint: other code forms', () => {
  const O = HINT_CODE_OMITTED;
  it('strips ~~~ fences with the same 2-line rule', () => {
    expect(cleanHint('a\n~~~\n1\n2\n3\n~~~\nb')).toBe(`a\n${O}\nb`);
    expect(cleanHint('a\n~~~\n1\n~~~\nb')).toBe('a\n~~~\n1\n~~~\nb');
  });
  it('drops runs of 3+ indented code lines', () => {
    expect(cleanHint('a\n    x = 1\n    y = 2\n    z = 3\nb')).toBe(`a\n${O}\nb`);
    expect(cleanHint('a\n\tx = 1\n\ty = 2\n\tz = 3\nb')).toBe(`a\n${O}\nb`);
    expect(cleanHint('a\n    x = 1\n    y = 2\nb')).toBe('a\n    x = 1\n    y = 2\nb');
  });
  it('handles longer fences: closer must match char and be at least as long', () => {
    expect(cleanHint('a\n````\n1\n```\n2\n3\n````\nb')).toBe(`a\n${O}\nb`);
    expect(cleanHint('a\n~~~~\n1\n~~~\n2\n3\n~~~~\nb')).toBe(`a\n${O}\nb`);
    expect(cleanHint('a\n```\n1\n~~~\n2\n3\n```\nb')).toBe(`a\n${O}\nb`);
  });
  it('a single-line fence does not cut the rest', () => {
    expect(cleanHint('Use ```set()``` aqui.\nDepois filtre.')).toBe('Use ```set()``` aqui.\nDepois filtre.');
    expect(cleanHint('```set()```\nDepois filtre.')).toBe('```set()```\nDepois filtre.');
  });
  it('never leaves an unclosed fence after the length clip', () => {
    const fits = cleanHint(`${'a'.repeat(980)}\n\`\`\`\nx = 1\n\`\`\``);
    expect(fits.match(/^`{3}/gm) ?? []).toHaveLength(2);
    const cut = cleanHint(`${'a'.repeat(990)}\n\`\`\`\nx = 1\n\`\`\``);
    expect(cut).not.toContain('```');
    expect(cut.length).toBeLessThanOrEqual(AI_LIMITS.hintText);
  });
});

describe('normalizePractice hint source', () => {
  it('keeps hint only on ai feedback', () => {
    const s = normalizePractice({
      ...session(),
      feedback: [{ id: 'p', at: 1, source: 'person', text: 'x', hint: { step: 'plan', level: 1 } }],
    } as unknown as PracticeSession);
    expect('hint' in s.feedback[0]!).toBe(false);
  });
});
