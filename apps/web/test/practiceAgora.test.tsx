import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Journey } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { newRecord, put } from '../src/db/repo';
import { createMission, setDayMode } from '../src/domain/actions';
import { concludePractice, createPracticeSession, pausePractice, setPracticeRating, updatePractice } from '../src/domain/practiceActions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { useCompanion } from '../src/features/companion/store';
import { PainelScreen } from '../src/features/painel/PainelScreen';
import { TIMER_IDLE, useTimer } from '../src/timer/store';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at, seedBlocks } from './blockFixture';

// Wednesday 2026-11-11 with the shared five-block fixture: 09:30 is inside "Tech" (focus, journey j-tech).

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 9, 30));
  localStorage.clear();
  useTimer.setState({ ...TIMER_IDLE });
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: '2026-11-11', emptyDay: undefined });
  useCompanion.getState().clear();
  useToast.getState().dismiss();
  await db.delete(); await db.open();
  await ensureSeed();
  await seedBlocks();
  await put('journeys', newRecord<Journey>({ id: 'j-tech', title: 'Tech News', status: 'active', order: 0 }));
});
afterEach(() => { vi.useRealTimers(); window.history.pushState({}, '', '/'); });

const SLOW = { timeout: 4000 };
const renderAgora = () => render(<><AgoraScreen /><ToastHost /></>);

describe('Agora practice line', () => {
  it('Tech block without sessions: "Sessão de prática" opens the sheet with the journey and the focus mission', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Segunda fonte', journeyId: 'j-tech' });
    renderAgora();
    await user.click(await screen.findByRole('button', { name: 'Sessão de prática' }, SLOW));
    const dialog = await screen.findByRole('dialog', { name: 'Nova sessão de prática' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Tech News' })).toHaveAttribute('aria-pressed', 'true'));
    await waitFor(() => expect(within(dialog).getByLabelText('Missão (opcional)')).toHaveValue(m.id));
    await user.type(within(dialog).getByLabelText('Sobre o que é?'), 'Dedup{Enter}');
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/pratica\//));
    expect(new URLSearchParams(window.location.search).get('voltar')).toBe('/');
  });

  it('an open session of the journey: "Retomar prática" with its note', async () => {
    const s = await createPracticeSession({ title: 'Dedup', journeyId: 'j-tech' });
    await pausePractice(s.id, 'testar com 2 fontes');
    renderAgora();
    const link = await screen.findByRole('link', { name: 'Retomar prática: Dedup' }, SLOW);
    expect(link).toHaveAttribute('href', `/pratica/${s.id}?voltar=%2F`);
    expect(link.parentElement).toHaveTextContent('Retomar prática: Dedup · testar com 2 fontes');
    expect(screen.queryByRole('button', { name: 'Sessão de prática' })).toBeNull();
  });

  it('offers the first action left by the last closed session and prefills the title', async () => {
    const user = userEvent.setup();
    const s = await createPracticeSession({ title: 'Dedup', journeyId: 'j-tech' });
    await updatePractice(s.id, { nextAction: 'ligar a segunda fonte' });
    await setPracticeRating(s.id, 'delivered', 2);
    await setPracticeRating(s.id, 'understood', 1);
    await setPracticeRating(s.id, 'autonomous', 1);
    await concludePractice(s.id);
    renderAgora();
    const button = await screen.findByRole('button', { name: 'Sessão de prática' }, SLOW);
    expect(button.parentElement).toHaveTextContent('Sessão de prática · próxima ação: ligar a segunda fonte');
    await user.click(button);
    expect(await screen.findByLabelText('Sobre o que é?')).toHaveValue('ligar a segunda fonte');
  });

  it('a study block without a journey shows it on a normal day', async () => {
    vi.setSystemTime(at(11, 15, 10)); // "Facul": study, protected
    await setDayMode('normal');
    renderAgora();
    expect(await screen.findByRole('button', { name: 'Sessão de prática' }, SLOW)).toBeInTheDocument();
  });

  it('nothing on a recovery day, even in a protected study block', async () => {
    vi.setSystemTime(at(11, 15, 10));
    await setDayMode('recovery');
    renderAgora();
    expect(await screen.findByRole('region', { name: 'Bloco atual' }, SLOW)).toHaveTextContent('Facul');
    expect(screen.queryByRole('button', { name: 'Sessão de prática' })).toBeNull();
  });

  it('nothing in a body block', async () => {
    vi.setSystemTime(at(11, 13, 0)); // "Treino": body
    renderAgora();
    expect(await screen.findByRole('region', { name: 'Bloco atual' }, SLOW)).toHaveTextContent('Treino');
    expect(screen.queryByRole('button', { name: 'Sessão de prática' })).toBeNull();
  });

  it('the Painel does not show it', async () => {
    render(<PainelScreen />);
    await screen.findByRole('region', { name: 'Bloco atual' }, SLOW);
    expect(screen.queryByRole('button', { name: 'Sessão de prática' })).toBeNull();
  });
});
