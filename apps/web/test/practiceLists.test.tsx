import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Journey, PracticeScore } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { newRecord, put } from '../src/db/repo';
import { createMission } from '../src/domain/actions';
import { concludePractice, createPracticeSession, pausePractice, setPracticeRating } from '../src/domain/practiceActions';
import { JourneyDetail } from '../src/features/journeys/JourneyDetail';
import { PracticeListScreen } from '../src/features/practice/PracticeListScreen';
import { PracticePanel } from '../src/features/practice/PracticePanel';
import { StudyScreen } from '../src/features/study/StudyScreen';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); window.history.pushState({}, '', '/'); });

const tech = () => put('journeys', newRecord<Journey>({ id: 'j-tech', title: 'Tech News', status: 'active', order: 0 }));
const rateAndClose = async (id: string, [d, u, a]: [PracticeScore, PracticeScore, PracticeScore]) => {
  await setPracticeRating(id, 'delivered', d);
  await setPracticeRating(id, 'understood', u);
  await setPracticeRating(id, 'autonomous', a);
  await concludePractice(id);
};

describe('Nova sessão and the Estudo section', () => {
  it('the title is required; Tech News by default; missions of the journey; Começar opens the session', async () => {
    const user = userEvent.setup();
    await tech();
    await put('journeys', newRecord<Journey>({ id: 'j-sql', title: 'SQL', status: 'active', order: 1 }));
    await createMission({ title: 'Segunda fonte', journeyId: 'j-tech' });
    window.history.pushState({}, '', '/estudo');
    render(<PracticePanel />);
    expect(await screen.findByText('Pratique no seu método: problema, passos, código, testes e reconstruir sem consultar.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nova sessão' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nova sessão de prática' });
    expect(within(dialog).getByRole('button', { name: 'Começar' })).toBeDisabled();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Tech News' })).toHaveAttribute('aria-pressed', 'true'));
    await within(dialog).findByRole('option', { name: 'Segunda fonte' });
    await user.selectOptions(within(dialog).getByLabelText('Missão (opcional)'), 'Segunda fonte');
    await user.type(within(dialog).getByLabelText('Sobre o que é?'), 'Dedup por URL{Enter}');
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/pratica\//));
    expect(new URLSearchParams(window.location.search).get('voltar')).toBe('/estudo');
    expect((await db.practiceSessions.toArray())[0]).toMatchObject({ title: 'Dedup por URL', journeyId: 'j-tech', missionId: expect.any(String) });
  });

  it('lists up to 3 open sessions with the next action, and Ver todas; the Estudo tab shows it', async () => {
    const ids: string[] = [];
    for (const [i, t] of ['A', 'B', 'C', 'D'].entries()) {
      vi.setSystemTime(new Date(2026, 10, 13, 10, i));
      ids.push((await createPracticeSession({ title: t })).id);
    }
    await pausePractice(ids[3]!, 'testar com 2 fontes');
    const { unmount } = render(<PracticePanel />);
    expect(await screen.findAllByRole('link', { name: /Passo: Problema/ })).toHaveLength(3);
    expect(screen.getByRole('link', { name: /Próxima ação: testar com 2 fontes/ }))
      .toHaveAttribute('href', `/pratica/${ids[3]}?voltar=%2Festudo`);
    expect(screen.queryByRole('link', { name: /^A/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Ver todas' })).toHaveAttribute('href', '/estudo/praticas');
    unmount();
    render(<StudyScreen />);
    expect(await screen.findByRole('heading', { name: 'Prática técnica' })).toBeInTheDocument();
  });
});

describe('PracticeListScreen', () => {
  it('open and closed sessions, the journey filter and its removal', async () => {
    const user = userEvent.setup();
    await tech();
    await createPracticeSession({ title: 'Dedup', journeyId: 'j-tech' });
    const join = await createPracticeSession({ title: 'JOIN', journeyId: 'j-tech' });
    await rateAndClose(join.id, [1, 1, 2]);
    await createPracticeSession({ title: 'Solta' });
    window.history.pushState({}, '', '/estudo/praticas?jornada=j-tech');
    render(<PracticeListScreen />);
    expect(await screen.findByRole('heading', { name: 'Em aberto (1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Encerradas (1)' })).toBeInTheDocument();
    // Journeys load in their own live query: wait for the journey name in the row.
    await waitFor(() => expect(screen.getByRole('link', { name: /JOIN/ })).toHaveTextContent('13/11 · Tech News'));
    expect(screen.getByRole('link', { name: /JOIN/ })).toHaveTextContent('Entregue: parcial · Compreendido: em parte · Autônomo: sim');
    expect(screen.queryByRole('link', { name: /Solta/ })).toBeNull();
    expect(await screen.findByText('Jornada: Tech News')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remover filtro de jornada' }));
    expect(await screen.findByRole('heading', { name: 'Em aberto (2)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Solta/ })).toBeInTheDocument();
    // Focus never stays on <body> after removing the chip.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });

  it('empty: explains the method', async () => {
    window.history.pushState({}, '', '/estudo/praticas');
    render(<PracticeListScreen />);
    expect(await screen.findByText(/^Nenhuma sessão ainda\. Uma sessão segue o método/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nova sessão' })).toBeInTheDocument();
  });

  it('history: hidden under 2 closed sessions; then three rows with counts, labelled as observed', async () => {
    const one = await createPracticeSession({ title: 'S1' });
    await rateAndClose(one.id, [0, 1, 0]);
    window.history.pushState({}, '', '/estudo/praticas');
    const { unmount } = render(<PracticeListScreen />);
    await screen.findByRole('heading', { name: 'Encerradas (1)' });
    expect(screen.queryByRole('region', { name: 'Observado · suas autoavaliações' })).toBeNull();
    unmount();
    vi.setSystemTime(new Date(2026, 10, 13, 11, 0));
    const two = await createPracticeSession({ title: 'S2' });
    await rateAndClose(two.id, [2, 2, 1]);
    vi.setSystemTime(new Date(2026, 10, 13, 12, 0));
    const three = await createPracticeSession({ title: 'S3' });
    await rateAndClose(three.id, [2, 1, 2]);
    render(<PracticeListScreen />);
    const history = await screen.findByRole('region', { name: 'Observado · suas autoavaliações' });
    expect(within(history).getAllByRole('listitem')).toHaveLength(3);
    expect(within(history).getAllByText('Nível máximo em 2 das últimas 3')).toHaveLength(1);
    expect(within(history).getAllByText('Nível máximo em 1 das últimas 3')).toHaveLength(2);
    expect(within(history).getByText('Da mais antiga para a mais recente: 0, 2, 2.')).toBeInTheDocument();
    expect(within(history).getByText(/São autoavaliações, não notas/)).toBeInTheDocument();
  });
});

describe('Jornada', () => {
  it('the journey detail links to its filtered list, with counts', async () => {
    await tech();
    render(<JourneyDetail id="j-tech" />);
    expect(await screen.findByText(/· nenhuma ainda/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sessões de prática' })).toHaveAttribute('href', '/estudo/praticas?jornada=j-tech');
    await createPracticeSession({ title: 'Dedup', journeyId: 'j-tech' });
    expect(await screen.findByText(/· 1 em aberto · 0 encerradas/)).toBeInTheDocument();
  });
});
