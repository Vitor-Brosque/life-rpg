import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { BlockSession, MonthReview, XpEvent } from '@life/shared';
import { timestampAt } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { setDayMode } from '../src/domain/actions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { useMonthSession } from '../src/features/patterns/monthCycle';
import { PatternsScreen } from '../src/features/patterns/PatternsScreen';
import { useWeekSession } from '../src/features/week/weekCycle';
import { ToastHost } from '../src/ui/Toast';
import { seedBlocks } from './blockFixture';

const base = { createdAt: 1, updatedAt: 1, deleted: false };
const xpOn = (dayKey: string) => put('xpEvents', newRecord<XpEvent>({ at: timestampAt(dayKey, '10:00'), amount: 5, reason: 'start', dayKey }));
const OBS = { workdays: 22, activeWorkdays: 1, blocksPlanned: 0, blocksStarted: 0, minimumUsed: 0, resumptions: 0, reviews: 0, practiceClosed: 0, workouts: 0, escapes: 0 };

async function at(day: number, h = 9, m = 30): Promise<void> {
  vi.setSystemTime(new Date(2026, 10, day, h, m));
  const key = `2026-11-${String(day).padStart(2, '0')}`;
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: key, emptyDay: undefined });
}
const renderAgora = () => render(<><AgoraScreen /><ToastHost /></>);
const agoraReady = () => screen.findByRole('heading', { name: 'Agora' });
const monthCard = () => screen.findByRole('region', { name: 'Reflexão de outubro' });
const renderPatterns = () => {
  const { hook } = memoryLocation({ path: '/padroes' });
  return render(<Router hook={hook}><PatternsScreen /><ToastHost /></Router>);
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  await at(4);   // Wednesday 2026-11-04
  try { localStorage.clear(); } catch { /* ignore */ }
  useWeekSession.setState({ dismissed: undefined, opened: undefined, started: undefined });
  useMonthSession.setState({ dismissed: undefined, started: undefined });
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

describe('month card on the Agora', () => {
  it('offers last month\'s reflection after the day type, with its numbers, and saves it', async () => {
    const user = userEvent.setup();
    await xpOn('2026-10-20');
    await setDayMode('normal');
    renderAgora();
    const card = await monthCard();
    expect(within(card).getByText('· ~3 min')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Começar' }));
    const open = await monthCard();
    expect(await within(open).findByRole('heading', { name: 'Observado em outubro' })).toBeInTheDocument();
    expect(await within(open).findByText('1 de 22')).toBeInTheDocument();
    await user.type(within(open).getByLabelText('O que mostra que você avançou neste mês?'), 'Três sessões de prática');
    await user.click(within(open).getByRole('button', { name: 'Salvar reflexão' }));
    await waitFor(async () => expect((await db.monthReviews.get('month-2026-10'))?.answers)
      .toEqual({ progress: 'Três sessões de prática', obstacle: '', next: '' }));
    expect((await db.monthReviews.get('month-2026-10'))!.observed).toMatchObject({ workdays: 22, activeWorkdays: 1 });
    expect(await screen.findByText('Reflexão de outubro salva.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Reflexão de outubro' })).not.toBeInTheDocument());
  });

  it('"Agora não" hides it until the app opens again; "Pular este mês" for good', async () => {
    const user = userEvent.setup();
    await xpOn('2026-10-20');
    await setDayMode('normal');
    const first = renderAgora();
    await user.click(within(await monthCard()).getByRole('button', { name: 'Agora não' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Reflexão de outubro' })).not.toBeInTheDocument());
    first.unmount();
    useMonthSession.setState({ dismissed: undefined, started: undefined });   // a new app session
    const second = renderAgora();
    await user.click(within(await monthCard()).getByRole('button', { name: 'Começar' }));
    await user.click(await within(await monthCard()).findByRole('button', { name: 'Pular este mês' }));
    await waitFor(async () => expect((await db.monthReviews.get('month-2026-10'))?.skipped).toBe(true));
    expect(await screen.findByText('Tudo bem. Dá para responder depois em Personagem → Padrões.')).toBeInTheDocument();
    second.unmount();
    useMonthSession.setState({ dismissed: undefined, started: undefined });
    renderAgora();
    await agoraReady();
    expect(screen.queryByRole('region', { name: 'Reflexão de outubro' })).not.toBeInTheDocument();
  });

  it('not after day 7, not on a free day, not without activity last month', async () => {
    await xpOn('2026-10-20');
    await at(9);
    await setDayMode('normal');
    const a = renderAgora();
    await agoraReady();
    expect(screen.queryByRole('region', { name: 'Reflexão de outubro' })).not.toBeInTheDocument();
    a.unmount();
    await at(4);
    await setDayMode('free');
    const b = renderAgora();
    await agoraReady();
    expect(screen.queryByRole('region', { name: 'Reflexão de outubro' })).not.toBeInTheDocument();
    b.unmount();
    await db.xpEvents.clear();
    await setDayMode('normal');
    renderAgora();
    await agoraReady();
    expect(screen.queryByRole('region', { name: 'Reflexão de outubro' })).not.toBeInTheDocument();
  });

  it('on a Monday, the "Nova semana" card comes first; the month waits', async () => {
    const user = userEvent.setup();
    await at(2);   // Monday 2026-11-02
    await seedBlocks();
    const s: BlockSession = { ...base, id: 'bs-b1-2026-10-26', blockId: 'b1', day: '2026-10-26', version: 'normal', startedAt: timestampAt('2026-10-26', '09:00'), endedAt: timestampAt('2026-10-26', '10:00') };
    await db.blockSessions.put(s);
    await xpOn('2026-10-26');
    await setDayMode('normal');
    renderAgora();
    const week = await screen.findByRole('region', { name: 'Nova semana' });
    expect(screen.queryByRole('region', { name: 'Reflexão de outubro' })).not.toBeInTheDocument();
    await user.click(within(week).getByRole('button', { name: 'Fazer depois' }));
    expect(await monthCard()).toBeInTheDocument();
  });
});

describe('Reflexões do mês in Padrões', () => {
  it('answers the open month in a sheet; editing keeps the saved numbers', async () => {
    const user = userEvent.setup();
    await at(13);
    await xpOn('2026-10-20');
    renderPatterns();
    const section = await screen.findByRole('region', { name: 'Reflexões do mês' });
    expect(within(section).getByText('A reflexão de outubro ainda está aberta.')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Responder agora' }));
    const sheet = await screen.findByRole('dialog', { name: 'Reflexão de outubro' });
    await user.type(within(sheet).getByLabelText('Que mudança pequena você quer levar para o próximo mês?'), 'Deitar 23h30');
    await user.click(within(sheet).getByRole('button', { name: 'Salvar reflexão' }));
    const article = await within(section).findByRole('article', { name: 'Outubro de 2026' });
    expect(within(article).getByText('Deitar 23h30')).toBeInTheDocument();
    expect(within(article).getAllByText('—')).toHaveLength(2);
    expect(within(section).queryByText('A reflexão de outubro ainda está aberta.')).not.toBeInTheDocument();
    const saved = (await db.monthReviews.get('month-2026-10'))!;
    await user.click(within(article).getByRole('button', { name: 'Editar a reflexão de outubro' }));
    const edit = await screen.findByRole('dialog', { name: 'Reflexão de outubro' });
    expect(within(edit).getByLabelText('Que mudança pequena você quer levar para o próximo mês?')).toHaveValue('Deitar 23h30');
    await user.type(within(edit).getByLabelText('O que mais atrapalhou, e em que momentos?'), 'Provas');
    await user.click(within(edit).getByRole('button', { name: 'Salvar reflexão' }));
    await waitFor(async () => expect((await db.monthReviews.get('month-2026-10'))!.answers!.obstacle).toBe('Provas'));
    expect((await db.monthReviews.get('month-2026-10'))!.observed).toEqual(saved.observed);
  });

  it('a skipped month can still be answered; nothing at all explains the card', async () => {
    await at(13);
    await xpOn('2026-11-02');
    await db.monthReviews.put({ ...base, id: 'month-2026-09', month: '2026-09', skipped: true, observed: OBS, answeredAt: 1 } satisfies MonthReview);
    const { unmount } = renderPatterns();
    const article = await screen.findByRole('article', { name: 'Setembro de 2026' });
    expect(within(article).getByText('Pulada.')).toBeInTheDocument();
    expect(within(article).getByRole('button', { name: 'Responder a reflexão de setembro' })).toBeInTheDocument();
    unmount();
    await db.monthReviews.clear();
    renderPatterns();
    expect(await screen.findByText('No começo de cada mês, o Agora oferece uma reflexão curta e opcional. Ela fica guardada aqui.')).toBeInTheDocument();
  });
});
