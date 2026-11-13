import { describe, expect, it } from 'vitest';
import { normalize, parseCapture, parseLines } from '../src/parser';

const today = '2026-11-11'; // Wednesday

interface Row {
  input: string;
  title: string;
  kind?: 'mission' | 'commitment';
  date?: string;
  time?: string;
  durationMin?: number;
  journeyName?: string;
  areaQuery?: string;
  important?: boolean;
}

const rows: Row[] = [
  { input: 'comprar pão', title: 'comprar pão' },
  { input: 'ligar dentista amanhã', title: 'ligar dentista', date: '2026-11-12' },
  { input: 'ligar dentista amanha', title: 'ligar dentista', date: '2026-11-12' },
  { input: 'dentista terça 15h', title: 'dentista', kind: 'commitment', date: '2026-11-17', time: '15:00' },
  { input: 'relatório sexta 2h', title: 'relatório', date: '2026-11-13', durationMin: 120 },
  { input: 'estudar 30min @estudo', title: 'estudar', durationMin: 30, areaQuery: 'estudo' },
  { input: 'pintar quarto #mudança !', title: 'pintar quarto', journeyName: 'mudança', important: true },
  { input: 'ligar banco!', title: 'ligar banco', important: true },
  { input: 'pagar boleto dia 15', title: 'pagar boleto', date: '2026-11-15' },
  { input: 'pagar boleto dia 5', title: 'pagar boleto', date: '2026-12-05' },
  { input: 'consulta 20/11 às 9', title: 'consulta', kind: 'commitment', date: '2026-11-20', time: '09:00' },
  { input: 'reunião 14:30', title: 'reunião', kind: 'commitment', date: '2026-11-11', time: '14:30' },
  { input: 'ler 1h30', title: 'ler', durationMin: 90 },
  { input: 'ler 1h30min', title: 'ler', durationMin: 90 },
  { input: 'treino hoje 7h', title: 'treino', kind: 'commitment', date: '2026-11-11', time: '07:00' },
  { input: 'correr 45 min', title: 'correr', durationMin: 45 },
  { input: 'revisar notas quarta', title: 'revisar notas', date: '2026-11-11' },
  { input: 'depois de amanhã lavar carro', title: 'lavar carro', date: '2026-11-13' },
  { input: 'próxima semana planejar viagem', title: 'planejar viagem', date: '2026-11-16' },
  { input: 'Revisar 15/12/2026', title: 'Revisar', date: '2026-12-15' },
  { input: 'aniversário 05/01', title: 'aniversário', date: '2027-01-05' },
  { input: 'seg academia', title: 'academia', date: '2026-11-16' },
  { input: 'Enviar Relatório ao João amanhã', title: 'Enviar Relatório ao João', date: '2026-11-12' },
  { input: 'comprar 2 pães', title: 'comprar 2 pães' },
  { input: 'às 18h jantar', title: 'jantar', kind: 'commitment', date: '2026-11-11', time: '18:00' },
  { input: '#Projeto-X tarefa', title: 'tarefa', journeyName: 'Projeto-X' },
  { input: 'prazo 31/02', title: 'prazo 31/02' },
  { input: 'dormir 6h', title: 'dormir', durationMin: 360 },
  { input: 'segundo pagamento', title: 'segundo pagamento' },
  // Ordinals that are also weekday names: a weekday only with context.
  { input: 'Adicionar segunda fonte de notícias', title: 'Adicionar segunda fonte de notícias' },
  { input: 'resolver quinta lista', title: 'resolver quinta lista' },
  { input: 'sexta questão da lista', title: 'sexta questão da lista' },
  { input: 'entregar na sexta', title: 'entregar', date: '2026-11-13' },
  { input: 'prova quinta 19h', title: 'prova', kind: 'commitment', date: '2026-11-12', time: '19:00' },
  { input: 'ler cap. 3 sexta 20min', title: 'ler cap. 3', date: '2026-11-13', durationMin: 20 },
  { input: 'entregar trabalho até segunda', title: 'entregar trabalho', date: '2026-11-16' },
  { input: 'dentista na terça 15h', title: 'dentista', kind: 'commitment', date: '2026-11-17', time: '15:00' },
  { input: 'lista de segunda', title: 'lista de', date: '2026-11-16' },
  { input: 'reunião segunda-feira', title: 'reunião', date: '2026-11-16' },
  { input: 'revisar a segunda parte quinta', title: 'revisar a segunda parte', date: '2026-11-12' },
  { input: 'ligar sexta #mudança !', title: 'ligar', date: '2026-11-13', journeyName: 'mudança', important: true },
  { input: 'ligar sexta!', title: 'ligar', date: '2026-11-13', important: true },
  { input: 'reunião quinta que vem', title: 'reunião', date: '2026-11-12' },
  { input: 'qui revisar', title: 'revisar', date: '2026-11-12' },
  {
    input: 'academia amanhã 8h 1h',
    title: 'academia',
    kind: 'commitment',
    date: '2026-11-12',
    time: '08:00',
    durationMin: 60,
  },
];

describe('parseCapture', () => {
  it.each(rows)('parses "$input"', (row) => {
    const p = parseCapture(row.input, today);
    expect(p.title).toBe(row.title);
    expect(p.kind).toBe(row.kind ?? 'mission');
    expect(p.date).toBe(row.date);
    expect(p.time).toBe(row.time);
    expect(p.durationMin).toBe(row.durationMin);
    expect(p.journeyName).toBe(row.journeyName);
    expect(p.areaQuery).toBe(row.areaQuery);
    expect(p.important).toBe(row.important ?? false);
  });

  it('reports token spans sorted by start', () => {
    expect(parseCapture('dentista terça 15h', today).tokens).toEqual([
      { type: 'date', text: 'terça', start: 9, end: 14 },
      { type: 'time', text: '15h', start: 15, end: 18 },
    ]);
  });

  it('keeps plain "as" not followed by a time in the title', () => {
    expect(parseCapture('ler as notas', today).title).toBe('ler as notas');
  });

  it('only the first token of each type counts', () => {
    const p = parseCapture('hoje amanhã tarefa', today);
    expect(p.date).toBe('2026-11-11');
    expect(p.title).toBe('amanhã tarefa');
  });
});

describe('parseLines', () => {
  it('splits on newlines and skips empty lines', () => {
    const r = parseLines('a\n\n b amanhã', today);
    expect(r).toHaveLength(2);
    expect(r[1]!.date).toBe('2026-11-12');
  });
});

describe('normalize', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalize('Ação')).toBe('acao');
  });
});

describe('recorrência na captura', () => {
  // today = 2026-11-11, quarta
  const rec = (input: string) => parseCapture(input, today);

  it('"toda seg" vira semanal [1], sai do título e a data é a próxima segunda', () => {
    const p = rec('lavar roupa toda seg');
    expect(p.title).toBe('lavar roupa');
    expect(p.recurrence).toEqual({ kind: 'weekly', weekdays: [1] });
    expect(p.date).toBe('2026-11-16');
    expect(p.kind).toBe('mission');
    expect(p.tokens.map((t) => t.type)).toEqual(['recurrence']);
  });

  it('lista com vírgula e "e", ordenada e sem repetição', () => {
    expect(rec('academia toda seg, qua e sex').recurrence).toEqual({ kind: 'weekly', weekdays: [1, 3, 5] });
    expect(rec('academia toda seg, qua e sex').title).toBe('academia');
    expect(rec('toda sex e seg e sex ler').recurrence).toEqual({ kind: 'weekly', weekdays: [1, 5] });
  });

  it('"todas as segundas e quartas ler artigo"', () => {
    const p = rec('todas as segundas e quartas ler artigo');
    expect(p.title).toBe('ler artigo');
    expect(p.recurrence).toEqual({ kind: 'weekly', weekdays: [1, 3] });
    expect(p.date).toBe('2026-11-11'); // hoje é quarta
  });

  it('plural com acento e domingo', () => {
    expect(rec('missa todos os domingos').recurrence).toEqual({ kind: 'weekly', weekdays: [0] });
    expect(rec('feira todos os sábados').recurrence).toEqual({ kind: 'weekly', weekdays: [6] });
    expect(rec('piano toda terça').recurrence).toEqual({ kind: 'weekly', weekdays: [2] });
  });

  it('diária', () => {
    for (const text of ['regar plantas todo dia', 'regar plantas todos os dias', 'regar plantas diariamente']) {
      const p = rec(text);
      expect(p.title).toBe('regar plantas');
      expect(p.recurrence).toEqual({ kind: 'daily' });
      expect(p.date).toBe('2026-11-11');
    }
  });

  it('mensal: "todo dia 5" e "todo mês dia 5"', () => {
    const a = rec('pagar aluguel todo dia 5');
    expect(a.title).toBe('pagar aluguel');
    expect(a.recurrence).toEqual({ kind: 'monthly', day: 5 });
    expect(a.date).toBe('2026-12-05');
    const b = rec('pagar aluguel todo mês dia 15');
    expect(b.recurrence).toEqual({ kind: 'monthly', day: 15 });
    expect(b.date).toBe('2026-11-15');
  });

  it('"toda semana" usa o dia da semana da data da missão (ou de hoje)', () => {
    expect(rec('revisar finanças toda semana').recurrence).toEqual({ kind: 'weekly', weekdays: [3] });
    expect(rec('revisar finanças toda semana 20/11').recurrence).toEqual({ kind: 'weekly', weekdays: [5] });
  });

  it('com data explícita mantém a data', () => {
    const p = rec('lavar roupa toda seg 25/11');
    expect(p.date).toBe('2026-11-25');
    expect(p.recurrence).toEqual({ kind: 'weekly', weekdays: [1] });
  });

  it('compromisso: semanal vira weekdays, diária vira os 7 dias, mensal só a data', () => {
    const a = rec('aula 19h toda ter e qui');
    expect(a.kind).toBe('commitment');
    expect(a.title).toBe('aula');
    expect(a.time).toBe('19:00');
    expect(a.recurrence).toEqual({ kind: 'weekly', weekdays: [2, 4] });
    expect(a.date).toBe('2026-11-12'); // próxima: quinta
    expect(rec('remédio 8h todo dia').recurrence).toEqual({ kind: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] });
    const m = rec('contador 10h todo dia 5');
    expect(m.kind).toBe('commitment');
    expect(m.recurrence).toBeUndefined();
    expect(m.date).toBe('2026-12-05');
    expect(m.title).toBe('contador');
  });

  it('"toda quarta" sozinho não quebra', () => {
    const p = rec('toda quarta');
    expect(p.recurrence).toEqual({ kind: 'weekly', weekdays: [3] });
    expect(p.title).toBe('');
  });

  it('palavras que não são recorrência ficam no título', () => {
    for (const text of ['todo o capítulo 3', 'toda terra é boa', 'todos os livros', 'todo diálogo ler']) {
      const p = rec(text);
      expect(p.recurrence, text).toBeUndefined();
    }
    expect(rec('todo o capítulo 3').title).toBe('todo o capítulo 3');
    expect(rec('toda terra é boa').title).toBe('toda terra é boa');
  });

  it('a marca de importante e a área continuam funcionando junto', () => {
    const p = rec('regar plantas todo dia @casa !');
    expect(p.important).toBe(true);
    expect(p.areaQuery).toBe('casa');
    expect(p.title).toBe('regar plantas');
  });
});
