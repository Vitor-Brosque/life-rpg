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
