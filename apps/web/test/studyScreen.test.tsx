import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { saveDeck, saveNote } from '../src/domain/studyActions';
import { ForecastBars } from '../src/features/study/ForecastBars';
import { StudyScreen } from '../src/features/study/StudyScreen';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 12, 10, 0)); // Thursday
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

async function deckWithCards(n: number) {
  const d = await saveDeck({ name: 'SQL' });
  for (let i = 0; i < n; i++) await saveNote({ deckId: d.id, type: 'basic', front: `pergunta ${i}`, back: 'r' });
  return d;
}

describe('StudyScreen', () => {
  it('empty: explains and creates the first deck', async () => {
    const user = userEvent.setup();
    render(<StudyScreen />);
    await user.click(await screen.findByRole('button', { name: 'Criar baralho' }));
    await user.type(screen.getByLabelText('Nome'), 'Faculdade');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('link', { name: /Faculdade/ })).toHaveAttribute('href', expect.stringMatching(/^\/estudo\/baralho\//));
    expect(await screen.findByText('Nenhum card ainda. Crie o primeiro.')).toBeInTheDocument();
  });

  it("today's plan: new cards, reason and the review button", async () => {
    await deckWithCards(3);
    render(<StudyScreen />);
    const today = await screen.findByLabelText('Hoje');
    expect(within(today).getByText('3 novos · ~2 min')).toBeInTheDocument();
    expect(within(today).getByText('Novos: todos os novos que estavam esperando.')).toBeInTheDocument();
    expect(within(today).getByRole('button', { name: 'Revisar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /SQL/ })).toHaveTextContent('0 hoje · 3 novos');
  });

  it('Saturday is a free day with "Revisar mesmo assim"', async () => {
    vi.setSystemTime(new Date(2026, 10, 14, 10, 0));
    await deckWithCards(2);
    render(<StudyScreen />);
    const today = await screen.findByLabelText('Hoje');
    expect(within(today).getByText('Dia livre')).toBeInTheDocument();
    expect(within(today).getByRole('button', { name: 'Revisar mesmo assim' })).toBeInTheDocument();
  });

  it('free day with a card due says it is waiting, without pressure', async () => {
    vi.setSystemTime(new Date(2026, 10, 14, 10, 0));
    await deckWithCards(1);
    await db.cards.toCollection().modify({ state: 'review', due: new Date(2026, 10, 13, 12, 0).getTime() });
    render(<StudyScreen />);
    const today = await screen.findByLabelText('Hoje');
    expect(within(today).getByText('1 revisão esperando, sem pressa.')).toBeInTheDocument();
  });

  it('draft with empty text still has an accessible name', async () => {
    await saveNote({ type: 'basic', front: 'x', back: '', draft: true });
    await db.notes.toCollection().modify({ front: '  ' });
    render(<StudyScreen />);
    expect(await screen.findByRole('link', { name: '(sem texto)' })).toBeInTheDocument();
  });

  it('lists drafts to complete', async () => {
    await saveNote({ type: 'basic', front: 'o que é idempotência', back: '', draft: true });
    render(<StudyScreen />);
    expect(await screen.findByText('Rascunhos para completar (1)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'o que é idempotência' })).toHaveAttribute('href', expect.stringMatching(/^\/estudo\/nota\//));
  });

  it('saves study preferences', async () => {
    const user = userEvent.setup();
    await deckWithCards(1);
    render(<StudyScreen />);
    await user.click(await screen.findByRole('button', { name: 'Preferências de estudo' }));
    const budget = screen.getByLabelText('Minutos de revisão por dia');
    await user.clear(budget);
    await user.type(budget, '25');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await vi.waitFor(async () => expect((await db.settings.get('settings'))!.study!.budgetMin).toBe(25));
  });
});

describe('ForecastBars', () => {
  it('draws the budget line on the same scale as the bars', () => {
    const days = ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'];
    const { container } = render(<ForecastBars forecast={days.map((day) => ({ day, min: 15 }))} budgetMin={15} />);
    expect(screen.getByLabelText('sex: cerca de 15 min')).toBeInTheDocument();
    const bar = container.querySelector<HTMLElement>('.forecast__bar')!;
    const line = container.querySelector<HTMLElement>('.forecast__line')!;
    expect(bar.style.height).toBe('100%');
    // ratio 1 (bar == budget): the line sits at the top of the bar area (jsdom folds calc(36px + (100% - 36px) * 1)).
    expect(line.style.bottom).toBe('calc(100% + 0px)');
  });
});
