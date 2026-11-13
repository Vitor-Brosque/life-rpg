import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { saveDeck, saveNote, saveStudySettings } from '../src/domain/studyActions';
import { ReviewSession } from '../src/features/study/ReviewSession';
import { useSession } from '../src/features/study/sessionStore';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
  useSession.getState().reset();
  localStorage.clear();
  window.history.pushState({}, '', '/estudo/revisar');
});
afterEach(() => { vi.useRealTimers(); window.history.pushState({}, '', '/'); });

async function deck(n: number, type: 'basic' | 'code' = 'basic') {
  const d = await saveDeck({ name: 'SQL' });
  for (let i = 0; i < n; i++) {
    vi.setSystemTime(new Date(2026, 10, 12, 9, i));
    await saveNote({ deckId: d.id, type, front: `pergunta ${i}`, back: type === 'code' ? 'SELECT 1' : `resposta ${i}`, language: 'sql' });
  }
  vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
  return d;
}
const liveReviews = async () => (await db.reviews.toArray()).filter((r) => !r.deleted);

describe('ReviewSession', () => {
  it('reveal with Space, rate with 1–4, next card; Z undoes', async () => {
    const user = userEvent.setup();
    await deck(3);
    render(<ReviewSession />);
    expect(await screen.findByText('pergunta 0')).toBeInTheDocument();
    expect(screen.getByText(/^1\/3/)).toBeInTheDocument();
    await user.keyboard(' ');
    expect(await screen.findByText('resposta 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bom, próxima revisão em 10 minutos' })).toBeInTheDocument();
    await user.keyboard('3');
    expect(await screen.findByText('pergunta 1')).toBeInTheDocument();
    expect(await liveReviews()).toHaveLength(1);
    await user.keyboard('z');
    expect(await screen.findByText('pergunta 0')).toBeInTheDocument();
    await vi.waitFor(async () => expect(await liveReviews()).toHaveLength(0));
  });

  it('shortcuts do nothing while typing the answer', async () => {
    const user = userEvent.setup();
    await deck(1);
    render(<ReviewSession />);
    await user.click(await screen.findByRole('button', { name: 'Escrever antes' }));
    const answer = screen.getByLabelText('Sua resposta');
    await user.type(answer, '1 2 z');
    expect(answer).toHaveValue('1 2 z');
    expect(screen.queryByText('resposta 0')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mostrar resposta' }));
    expect(await screen.findByText('Sua resposta')).toBeInTheDocument();
    expect(screen.getByText('1 2 z')).toBeInTheDocument();
  });

  it('code cards open the editor and compare side by side', async () => {
    const user = userEvent.setup();
    await deck(1, 'code');
    render(<ReviewSession />);
    const editor = await screen.findByLabelText('Sua resposta (código)');
    await user.type(editor, 'SELECT 2');
    await user.click(screen.getByRole('button', { name: 'Mostrar resposta' }));
    expect(await screen.findByRole('heading', { name: 'Sua resposta' })).toBeInTheDocument();
    expect(screen.getAllByText((_, el) => el?.tagName === 'PRE' && el.textContent === 'SELECT 1')).toHaveLength(1);
  });

  it('topic: write, reveal the key points, tick them; the rating is suggested and coverage saved', async () => {
    const user = userEvent.setup();
    const d = await saveDeck({ name: 'BD' });
    await saveNote({ deckId: d.id, type: 'topic', front: 'Explique 1FN–3FN', back: '- atômico\n- dependência parcial\n- transitiva' });
    render(<ReviewSession />);
    await user.type(await screen.findByLabelText('Sua explicação'), 'valores atômicos e $x^2$');
    expect(screen.getByRole('region', { name: 'Pré-visualização da resposta' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mostrar resposta' }));
    await user.click(screen.getByRole('checkbox', { name: 'atômico' }));
    await user.click(screen.getByRole('checkbox', { name: 'dependência parcial' }));
    expect(screen.getByText('2 de 3 cobertos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Difícil,.*sugerido$/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Difícil,/ }));
    await vi.waitFor(async () => expect((await liveReviews())[0]!.coverage).toEqual({ covered: 2, total: 3 }));
  });

  it('shows "Meta de hoje feita" once when the goal is reached and cards remain', async () => {
    const user = userEvent.setup();
    await saveStudySettings({ budgetMin: 5 });
    await deck(6);
    render(<ReviewSession />);
    for (let i = 0; i < 5; i++) {
      await screen.findByRole('button', { name: 'Mostrar resposta' });
      await user.keyboard(' ');
      await screen.findByRole('button', { name: /^Bom,/ });
      vi.setSystemTime(Date.now() + 75_000);
      await user.keyboard('3');
    }
    expect(await screen.findByRole('heading', { name: 'Meta de hoje feita' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.queryByRole('heading', { name: 'Meta de hoje feita' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Mostrar resposta' })).toBeInTheDocument();
  });

  it('ends with a summary when nothing is left; Parar goes back to Estudo', async () => {
    const user = userEvent.setup();
    await deck(1);
    render(<ReviewSession />);
    await screen.findByText('pergunta 0');
    await user.keyboard(' ');
    await screen.findByRole('button', { name: /^Fácil,/ });
    vi.setSystemTime(Date.now() + 30_000);
    await user.keyboard('4');
    expect(await screen.findByText('1 card · 1 min')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voltar ao Estudo' }));
    expect(window.location.pathname).toBe('/estudo');
  });

  it('Editar opens the note editor and comes back to the session', async () => {
    const user = userEvent.setup();
    await deck(1);
    render(<ReviewSession />);
    await screen.findByText('pergunta 0');
    await user.keyboard('e');
    expect(window.location.pathname).toMatch(/^\/estudo\/nota\//);
    expect(window.location.search).toBe('?voltar=sessao');
  });

  it('Editar and back keeps the deck filter, counters and undo', async () => {
    const user = userEvent.setup();
    const d = await deck(3);
    window.history.pushState({}, '', `/estudo/revisar?baralho=${d.id}`);
    const first = render(<ReviewSession />);
    await screen.findByText('pergunta 0');
    await user.keyboard(' ');
    await screen.findByRole('button', { name: /^Bom,/ });
    await user.keyboard('3');
    await screen.findByText('pergunta 1');
    await user.keyboard('e');
    expect(window.location.search).toBe(`?voltar=sessao&baralho=${d.id}`);
    first.unmount();
    window.history.pushState({}, '', `/estudo/revisar?baralho=${d.id}`);
    render(<ReviewSession />);
    expect(await screen.findByText(/^2\//)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeEnabled();
  });

  it('with nothing to review says so', async () => {
    render(<ReviewSession />);
    expect(await screen.findByText('Nada para revisar agora.')).toBeInTheDocument();
  });
});
