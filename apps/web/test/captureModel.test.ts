import { describe, expect, it } from 'vitest';
import type { Area, Deck, Journey } from '@life/shared';
import {
  buildRequests, choose, chooseKind, dayWhen, initialState, kindOf, linesOf, missing, prefill, removeSpans,
  type CaptureCtx, type CaptureState,
} from '../src/features/capture/captureModel';

// Quarta-feira, 2026-11-11 (como capture.test.tsx).
const TODAY = '2026-11-11';
const base = { createdAt: 1, updatedAt: 1, deleted: false };
const journeys: Journey[] = [
  { ...base, id: 'j-tech', title: 'Tech News', status: 'active', order: 0 },
  { ...base, id: 'j-calc', title: 'Cálculo II', status: 'active', order: 1, subject: true, areaId: 'area-facul' },
  { ...base, id: 'j-alg', title: 'Álgebra Linear', status: 'active', order: 2, subject: true, areaId: 'area-facul' },
];
const areas: Area[] = [
  { ...base, id: 'area-vigor', name: 'Corpo', attribute: 'Vigor', color: '#e5675d', icon: 'heart', order: 0, archived: false },
  { ...base, id: 'area-oficio', name: 'Trabalho', attribute: 'Ofício', color: '#e0a84a', icon: 'hammer', order: 3, archived: false },
];
const decks: Deck[] = [{ ...base, id: 'd-sql', name: 'SQL', journeyId: 'j-tech', order: 0, archived: false }];
const ctx: CaptureCtx = { today: TODAY, journeys, areas, decks };
const typed = (text: string, s: CaptureState = initialState()): CaptureState => ({ ...s, text });

describe('kindOf: o tipo vem do texto só enquanto não foi tocado', () => {
  it('linha comum, horário, "? " e prova', () => {
    expect(kindOf(typed('Ler artigo'), ctx)).toBe('tarefa');
    expect(kindOf(typed('dentista amanhã 15h'), ctx)).toBe('compromisso');
    expect(kindOf(typed('? o que é um índice'), ctx)).toBe('card');
    expect(kindOf(typed('prova #calculo dia 3/12'), ctx)).toBe('avaliacao');
    expect(kindOf(typed('estudar para prova #calculo dia 3/12'), ctx)).toBe('tarefa');
    expect(kindOf(typed('prova #tech dia 3/12'), ctx)).toBe('tarefa'); // Tech News não é disciplina
  });

  it('várias linhas ficam em Tarefa; o tipo tocado vence o texto', () => {
    expect(kindOf(typed('reunião 15h\ncomprar pão'), ctx)).toBe('tarefa');
    expect(kindOf(typed('dentista 15h', chooseKind(initialState(), 'tarefa')), ctx)).toBe('tarefa');
  });

  it('com a Jornada tocada, "prova" no texto não troca o tipo', () => {
    const s = choose(initialState(), 'task', 'journey', { id: 'j-tech' });
    expect(kindOf(typed('prova #calculo dia 3/12', s), ctx)).toBe('tarefa');
  });

  it('trocar para um tipo de uma linha junta as linhas', () => {
    const s = chooseKind(typed('Dentista\ncom a Ana'), 'compromisso');
    expect(s.text).toBe('Dentista com a Ana');
    expect(linesOf(s)).toEqual(['Dentista com a Ana']);
    expect(linesOf(chooseKind(typed('a\nb'), 'card'))).toEqual(['a', 'b']);
  });
});

describe('prefill: o texto preenche só o que não foi tocado', () => {
  it('data, duração, jornada, área e importante', () => {
    const v = prefill(typed('ler 20min amanhã #tech @of !'), ctx);
    expect(v.kind).toBe('tarefa');
    expect(v.task).toEqual({
      when: { kind: 'day', day: '2026-11-12' }, recurrence: null, journey: { id: 'j-tech' }, areaId: 'area-oficio',
      durationMin: 20, energy: null, important: true,
    });
  });

  it('um toque vence o texto', () => {
    const s = choose(typed('ler 20min amanhã'), 'task', 'when', dayWhen(TODAY));
    expect(prefill(s, ctx).task).toMatchObject({ when: { kind: 'day', day: TODAY }, durationMin: 20 });
    expect(prefill(choose(typed('ler 20min'), 'task', 'durationMin', null), ctx).task.durationMin).toBeNull();
  });

  it('jornada que não existe vira "Nova jornada"', () => {
    expect(prefill(typed('ler #leituras'), ctx).task.journey).toEqual({ newName: 'leituras' });
  });

  it('repetição do texto dá o primeiro dia; repetição tocada também', () => {
    expect(prefill(typed('lavar roupa toda seg'), ctx).task).toMatchObject({
      recurrence: { kind: 'weekly', weekdays: [1] }, when: { kind: 'day', day: '2026-11-16' },
    });
    const s = choose(typed('ler'), 'task', 'recurrence', { kind: 'weekly', weekdays: [1, 4] });
    expect(prefill(s, ctx).task.when).toEqual({ kind: 'day', day: '2026-11-12' });
    const after = choose(typed('regar'), 'task', 'recurrence', { kind: 'afterDays', days: 3 });
    expect(prefill(after, ctx).task.when).toEqual({ kind: 'none' });
  });

  it('o dia com que o "+" foi aberto é o padrão de Quando e de Dia', () => {
    const opened = { ...ctx, defaultDate: '2026-11-20' };
    expect(prefill(typed('comprar pão'), opened).task.when).toEqual({ kind: 'day', day: '2026-11-20' });
    expect(prefill(typed(''), opened).task.when).toEqual({ kind: 'day', day: '2026-11-20' });
    expect(prefill(typed('dentista 15h'), opened).commitment.day).toBe('2026-11-20');
    expect(prefill(typed(''), ctx).task.when).toEqual({ kind: 'none' });
  });

  it('horário: Compromisso com dia, início e fim', () => {
    const v = prefill(typed('dentista amanhã 15h'), ctx);
    expect(v.kind).toBe('compromisso');
    expect(v.commitment).toEqual({ day: '2026-11-12', start: '15:00', end: undefined, weekdays: [], until: undefined, remind: true });
    expect(prefill(typed('dentista 15h 30min'), ctx).commitment).toMatchObject({ day: TODAY, start: '15:00', end: '15:30' });
    expect(prefill(typed('aula 19h toda ter e qui'), ctx).commitment).toMatchObject({ day: '2026-11-12', weekdays: [2, 4] });
  });

  it('Tarefa tocada com horário: o horário sai e o dia fica hoje (o antigo "Missão")', () => {
    const s = typed('dentista 15h', chooseKind(initialState(), 'tarefa'));
    expect(prefill(s, ctx).task.when).toEqual({ kind: 'day', day: TODAY });
    expect(buildRequests(s, ctx)).toEqual([{ type: 'mission', fields: { title: 'dentista', important: false, date: TODAY } }]);
    const weekly = typed('aula 19h toda ter e qui', chooseKind(initialState(), 'tarefa'));
    expect(buildRequests(weekly, ctx)[0]).toMatchObject({
      fields: { title: 'aula', recurrence: { kind: 'weekly', weekdays: [2, 4] }, date: '2026-11-12' },
    });
  });

  it('prova: tipo, matéria e data acendem', () => {
    expect(prefill(typed('prova #calculo dia 3/12'), ctx).assessment).toEqual({ kind: 'prova', journeyId: 'j-calc', date: '2026-12-03' });
    expect(prefill(chooseKind(initialState(), 'avaliacao'), ctx).assessment).toEqual({ kind: 'prova', journeyId: undefined, date: undefined });
  });

  it('card: a #jornada com baralho escolhe o baralho', () => {
    expect(prefill(typed('? o que é join #tech'), ctx).card).toEqual({ deckId: 'd-sql' });
    expect(prefill(typed('? o que é join'), ctx).card).toEqual({ deckId: null });
  });
});

describe('missing', () => {
  it('Tarefa sem título', () => {
    expect(missing(typed(''), ctx)).toBe('Escreva o que precisa fazer.');
    expect(missing(typed('amanhã'), ctx)).toBe('Escreva o que precisa fazer.');
    expect(missing(typed('Ler artigo'), ctx)).toBeUndefined();
  });

  it('Compromisso: título, dia e início, fim depois do início', () => {
    const c = chooseKind(initialState(), 'compromisso');
    expect(missing(c, ctx)).toBe('Escreva o que precisa fazer.');
    expect(missing(typed('Dentista', c), ctx)).toBe('Escolha o dia e o início.');
    const started = choose(typed('Dentista', c), 'commitment', 'start', '15:00');
    expect(missing(started, ctx)).toBeUndefined();
    expect(missing(choose(started, 'commitment', 'end', '14:00'), ctx)).toBe('O fim precisa ser depois do início.');
    expect(missing(choose(started, 'commitment', 'day', undefined), ctx)).toBe('Escolha o dia e o início.');
  });

  it('Prova ou trabalho: matéria e data; o conteúdo é opcional', () => {
    const a = chooseKind(initialState(), 'avaliacao');
    expect(missing(a, ctx)).toBe('Escolha a matéria e a data.');
    expect(missing(choose(a, 'assessment', 'journeyId', 'j-calc'), ctx)).toBe('Escolha a matéria e a data.');
    expect(missing(choose(choose(a, 'assessment', 'journeyId', 'j-calc'), 'assessment', 'date', '2026-12-03'), ctx)).toBeUndefined();
  });

  it('Card sem frente', () => {
    expect(missing(chooseKind(initialState(), 'card'), ctx)).toBe('Escreva a frente do card.');
    expect(missing(typed('?  ', chooseKind(initialState(), 'card')), ctx)).toBe('Escreva a frente do card.');
  });
});

describe('buildRequests', () => {
  it('a linha comum continua uma tarefa sem data', () => {
    expect(buildRequests(typed('Ler artigo'), ctx)).toEqual([{ type: 'mission', fields: { title: 'Ler artigo', important: false } }]);
  });

  it('tarefa só por toques', () => {
    let s = typed('Revisar o coletor');
    s = choose(s, 'task', 'when', dayWhen('2026-11-12'));
    s = choose(s, 'task', 'recurrence', { kind: 'weekly', weekdays: [1, 4] });
    s = choose(s, 'task', 'journey', { id: 'j-tech' });
    s = choose(s, 'task', 'durationMin', 30);
    s = choose(s, 'task', 'energy', 'heavy');
    s = choose(s, 'task', 'areaId', 'area-oficio');
    s = choose(s, 'task', 'important', true);
    expect(buildRequests(s, ctx)).toEqual([{
      type: 'mission',
      fields: {
        title: 'Revisar o coletor', important: true, date: '2026-11-12', recurrence: { kind: 'weekly', weekdays: [1, 4] },
        durationMin: 30, energy: 'heavy', areaId: 'area-oficio', journeyId: 'j-tech',
      },
    }]);
  });

  it('o texto reconhecido sai do título', () => {
    expect(buildRequests(typed('ler 20min amanhã #tech @of !'), ctx)).toEqual([{
      type: 'mission',
      fields: { title: 'ler', important: true, date: '2026-11-12', durationMin: 20, areaId: 'area-oficio', journeyId: 'j-tech' },
    }]);
  });

  it('jornada nova vai junto, para ser criada só ao salvar', () => {
    const s = choose(typed('ler'), 'task', 'journey', { newName: 'Leituras' });
    expect(buildRequests(s, ctx)).toEqual([{ type: 'mission', fields: { title: 'ler', important: false }, newJourneyName: 'Leituras' }]);
  });

  it('várias linhas: tocado vale para todas, o resto vem de cada linha, na ordem', () => {
    let s = typed('ler 20min amanhã\nescrever\n\ntrês');
    s = choose(s, 'task', 'journey', { id: 'j-tech' });
    expect(buildRequests(s, ctx)).toEqual([
      { type: 'mission', fields: { title: 'ler', important: false, date: '2026-11-12', durationMin: 20, journeyId: 'j-tech' } },
      { type: 'mission', fields: { title: 'escrever', important: false, journeyId: 'j-tech' } },
      { type: 'mission', fields: { title: 'três', important: false, journeyId: 'j-tech' } },
    ]);
    const all15 = choose(typed('ler 20min\nescrever'), 'task', 'durationMin', 15);
    expect(buildRequests(all15, ctx).map((r) => r.type === 'mission' && r.fields.durationMin)).toEqual([15, 15]);
  });

  it('várias linhas: horário vira compromisso, "? " vira card, prova vira avaliação, linha vazia some', () => {
    expect(buildRequests(typed('reunião 15h\n? o que é idempotência\nprova #calculo dia 3/12\namanhã\ncomprar pão'), ctx)).toEqual([
      { type: 'commitment', fields: { title: 'reunião', date: TODAY, start: '15:00', remind: true } },
      { type: 'card', front: 'o que é idempotência' },
      { type: 'assessment', input: { kind: 'prova', journeyId: 'j-calc', date: '2026-12-03' } },
      { type: 'mission', fields: { title: 'comprar pão', important: false } },
    ]);
    const tomorrow = choose(typed('reunião 15h\ncomprar pão'), 'task', 'when', dayWhen('2026-11-12'));
    expect(buildRequests(tomorrow, ctx)).toEqual([
      { type: 'commitment', fields: { title: 'reunião', date: '2026-11-12', start: '15:00', remind: true } },
      { type: 'mission', fields: { title: 'comprar pão', important: false, date: '2026-11-12' } },
    ]);
  });

  it('compromisso: um toque em Dia vence o texto; Toda semana, Até e Lembrar', () => {
    const s = choose(typed('dentista amanhã 15h'), 'commitment', 'day', TODAY);
    expect(kindOf(s, ctx)).toBe('compromisso');
    expect(buildRequests(s, ctx)).toEqual([{ type: 'commitment', fields: { title: 'dentista', date: TODAY, start: '15:00', remind: true } }]);
    let t = typed('Aula de inglês', chooseKind(initialState(), 'compromisso'));
    t = choose(t, 'commitment', 'day', '2026-11-12');
    t = choose(t, 'commitment', 'start', '18:00');
    t = choose(t, 'commitment', 'end', '19:30');
    t = choose(t, 'commitment', 'weekdays', [4, 2]);
    t = choose(t, 'commitment', 'until', '2026-12-17');
    t = choose(t, 'commitment', 'remind', false);
    expect(buildRequests(t, ctx)).toEqual([{
      type: 'commitment',
      fields: { title: 'Aula de inglês', date: '2026-11-12', start: '18:00', end: '19:30', weekdays: [2, 4], untilDate: '2026-12-17', remind: false },
    }]);
    // Sem dias da semana, "Até" não vale.
    expect(buildRequests(choose(t, 'commitment', 'weekdays', []), ctx)[0]).toEqual({
      type: 'commitment', fields: { title: 'Aula de inglês', date: '2026-11-12', start: '18:00', end: '19:30', remind: false },
    });
  });

  it('prova ou trabalho', () => {
    let s = typed('integrais por partes', chooseKind(initialState(), 'avaliacao'));
    s = choose(s, 'assessment', 'journeyId', 'j-calc');
    s = choose(s, 'assessment', 'date', '2026-12-03');
    expect(buildRequests(s, ctx)).toEqual([{
      type: 'assessment', input: { kind: 'prova', journeyId: 'j-calc', date: '2026-12-03', content: 'integrais por partes' },
    }]);
    expect(buildRequests(choose(s, 'assessment', 'kind', 'trabalho'), ctx)[0]).toMatchObject({ input: { kind: 'trabalho' } });
    expect(buildRequests(typed('prova #calculo dia 3/12'), ctx)).toEqual([
      { type: 'assessment', input: { kind: 'prova', journeyId: 'j-calc', date: '2026-12-03' } },
    ]);
    expect(buildRequests(typed('trabalho final #calculo dia 3/12'), ctx)).toEqual([
      { type: 'assessment', input: { kind: 'trabalho', journeyId: 'j-calc', date: '2026-12-03', content: 'final' } },
    ]);
  });

  it('card: baralho tocado vale para todas as linhas; sem toque, a #jornada escolhe', () => {
    const s = choose(typed('O que é um índice composto?\nO que é VACUUM?', chooseKind(initialState(), 'card')), 'card', 'deckId', 'd-sql');
    expect(buildRequests(s, ctx)).toEqual([
      { type: 'card', front: 'O que é um índice composto?', deckId: 'd-sql' },
      { type: 'card', front: 'O que é VACUUM?', deckId: 'd-sql' },
    ]);
    expect(buildRequests(typed('? o que é join #tech'), ctx)).toEqual([{ type: 'card', front: 'o que é join', deckId: 'd-sql' }]);
    expect(buildRequests(typed('? pergunta #semdeck'), ctx)).toEqual([{ type: 'card', front: 'pergunta #semdeck' }]);
  });

  it('as linhas do Tech News sem etiquetas viram tarefas simples', () => {
    const text = [
      'Dependências do Tech News num requirements.txt',
      '.env.example com os nomes das variáveis',
      'schema.sql da tabela noticias',
      'Escrever o formato padrão de uma notícia',
      'Decidir o destino dos rascunhos teste_api',
      'Explorar o feed da InfoQ e salvar um exemplo',
      'Mapear InfoQ para o formato padrão (id e data)',
      'Coletor da InfoQ no formato padrão',
      'Teste da normalização da InfoQ com o exemplo salvo',
      'Ligar HN + InfoQ no main e conferir o resumo do log',
    ].join('\n');
    const reqs = buildRequests(choose(typed(text), 'task', 'journey', { id: 'j-tech' }), ctx);
    expect(reqs).toHaveLength(10);
    expect(reqs.every((r) => r.type === 'mission' && r.fields.journeyId === 'j-tech' && r.fields.date === undefined
      && r.fields.durationMin === undefined)).toBe(true);
    expect(reqs.map((r) => r.type === 'mission' && r.fields.title)).toEqual(text.split('\n'));
  });
});

describe('removeSpans (movido de captureSave)', () => {
  it('tira os trechos e arruma os espaços', () => {
    expect(removeSpans('ler 20min amanhã', [{ start: 4, end: 9 }])).toBe('ler amanhã');
  });
});
