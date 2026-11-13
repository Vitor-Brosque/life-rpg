import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { useAiStatus } from '../src/ai/aiStatus';
import { SettingsScreen } from '../src/features/settings/SettingsScreen';
import { connectServer, fail, mockFetch, resetAi } from './aiFixture';

beforeEach(async () => {
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  resetAi();
});
afterEach(() => { resetAi(); });

const aiRegion = () => screen.queryByRole('region', { name: /Inteligência \(opcional\)/ });

describe('Ajustes → Inteligência (opcional)', () => {
  it('does not exist when the server has no AI', async () => {
    await connectServer();
    mockFetch((r) => (r.url === '/api/ai/status' ? { status: 200, json: { available: false } } : fail(404)));
    render(<SettingsScreen />);
    await waitFor(() => expect(useAiStatus.getState().checked).toBe(true));
    expect(aiRegion()).toBeNull();
  });

  it('a server without the AI routes (404) hides it too', async () => {
    await connectServer();
    useAiStatus.setState({ available: true, checked: false });
    mockFetch(() => fail(404));
    render(<SettingsScreen />);
    await waitFor(() => expect(aiRegion()).toBeNull());
  });

  it('three aids, all off, each saying what it sends; ticking saves Settings.ai merged', async () => {
    await connectServer();
    mockFetch(() => ({ status: 200, json: { available: true, used: 2, limit: 30 } }));
    render(<SettingsScreen />);
    await screen.findByRole('region', { name: /Inteligência \(opcional\)/ });
    const hints = screen.getByRole('checkbox', { name: 'Pistas na sessão de prática' });
    const cards = screen.getByRole('checkbox', { name: 'Sugerir cards' });
    const weekly = screen.getByRole('checkbox', { name: 'Resumo da semana' });
    for (const box of [hints, cards, weekly]) expect(box).not.toBeChecked();
    expect(screen.getByText(/Erros e feedback não vão\./)).toBeInTheDocument();
    expect(screen.getByText('Vão só o texto que você colar (ou o da nota escolhida) e o nome do baralho.')).toBeInTheDocument();
    expect(screen.getByText('Vão só os números do Observado da semana. Suas respostas vão apenas se você marcar.')).toBeInTheDocument();
    expect(screen.getByText('Hoje: 2 de 30 pedidos usados.')).toBeInTheDocument();

    await userEvent.click(cards);
    await waitFor(async () => expect((await db.settings.get('settings'))?.ai).toEqual({ hints: false, cards: true, weekly: false }));
    await userEvent.click(weekly);
    await waitFor(async () => expect((await db.settings.get('settings'))?.ai).toEqual({ hints: false, cards: true, weekly: true }));
    expect(screen.getByRole('checkbox', { name: 'Sugerir cards' })).toBeChecked();
  });
});
