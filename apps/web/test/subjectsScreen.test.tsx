import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Journey, Mission } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { newRecord, put } from '../src/db/repo';
import { concludePractice, createPracticeSession, setPracticeRating } from '../src/domain/practiceActions';
import { saveDeck, saveNote } from '../src/domain/studyActions';
import { StudyScreen } from '../src/features/study/StudyScreen';
import { SubjectsScreen } from '../src/features/study/SubjectsScreen';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); window.history.pushState({}, '', '/'); });

const journey = (id: string, title: string, order = 0) =>
  put('journeys', newRecord<Journey>({ id, title, status: 'active', order }));

describe('SubjectsScreen', () => {
  it('empty: explains when subjects appear', async () => {
    render(<SubjectsScreen />);
    expect(await screen.findByText('As matérias aparecem quando um baralho ou uma sessão de prática estiver ligado a uma jornada.')).toBeInTheDocument();
  });

  it('journey card: observed lines, progress bar with text alternative, links', async () => {
    await journey('j-sql', 'SQL');
    const deck = await saveDeck({ name: 'Consultas', journeyId: 'j-sql' });
    await saveNote({ deckId: deck.id, type: 'basic', front: 'a', back: 'b' });
    await saveNote({ deckId: deck.id, type: 'basic', front: 'c', back: 'd' });
    await saveNote({ deckId: deck.id, type: 'topic', front: 'Joins', back: 'inner\nleft' });
    const [first] = await db.cards.toArray();
    await db.cards.update(first!.id, { state: 'review' });
    await put('missions', newRecord<Mission>({ title: 'Entregar lista', checklist: [], status: 'open', important: false, shrunk: false, postponeCount: 0, journeyId: 'j-sql', deadline: '2026-11-20' }));
    const s = await createPracticeSession({ title: 'Join sem consultar', journeyId: 'j-sql' });
    await setPracticeRating(s.id, 'delivered', 2);
    await setPracticeRating(s.id, 'understood', 2);
    await setPracticeRating(s.id, 'autonomous', 2);
    await concludePractice(s.id);

    render(<SubjectsScreen />);
    const card = await screen.findByRole('article', { name: 'SQL' });
    expect(within(card).getByRole('link', { name: 'SQL' })).toHaveAttribute('href', '/jornadas/j-sql');
    expect(within(card).getByRole('progressbar', { name: '1 de 3 cards aprendidos' })).toHaveAttribute('aria-valuenow', '1');
    expect(within(card).getByText('Aparece com 20 revisões de cards aprendidos')).toBeInTheDocument();
    expect(within(card).getByText('0 min de revisão nesta semana')).toBeInTheDocument();
    expect(within(card).getByText('1 tópico')).toBeInTheDocument();
    expect(within(card).getByText('Prática: 1 sessão, 1 com Autônomo')).toBeInTheDocument();
    expect(within(card).getByText('Próxima entrega: Entregar lista, 20/11')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Ver baralho Consultas' })).toHaveAttribute('href', `/estudo/baralho/${deck.id}`);
    expect(within(card).getByRole('link', { name: 'Revisar Consultas' })).toHaveAttribute('href', `/estudo/revisar?baralho=${deck.id}`);
  });

  it('loose deck is its own subject and its name opens the deck', async () => {
    const deck = await saveDeck({ name: 'Inglês' });
    await saveNote({ deckId: deck.id, type: 'basic', front: 'a', back: 'b' });
    render(<SubjectsScreen />);
    const card = await screen.findByRole('article', { name: 'Inglês' });
    expect(within(card).getByRole('link', { name: 'Inglês' })).toHaveAttribute('href', `/estudo/baralho/${deck.id}`);
    expect(within(card).queryByText(/Próxima entrega/)).toBeNull();
    expect(within(card).queryByText(/Prática/)).toBeNull();
  });

  it('a journey with two decks lists both', async () => {
    await journey('j1', 'Faculdade');
    await saveDeck({ name: 'Cálculo', journeyId: 'j1' });
    await saveDeck({ name: 'Álgebra', journeyId: 'j1' });
    render(<SubjectsScreen />);
    const card = await screen.findByRole('article', { name: 'Faculdade' });
    expect(within(card).getByRole('link', { name: 'Ver baralho Cálculo' })).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Ver baralho Álgebra' })).toBeInTheDocument();
  });

  it('the Estudo screen links to Matérias', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/estudo');
    render(<StudyScreen />);
    await user.click(await screen.findByRole('button', { name: 'Matérias' }));
    await waitFor(() => expect(window.location.pathname).toBe('/estudo/materias'));
  });
});
