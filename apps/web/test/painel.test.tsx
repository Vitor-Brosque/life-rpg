import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Commitment, CommitmentOccurrence } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { createCommitment, createMission } from '../src/domain/actions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { PainelScreen } from '../src/features/painel/PainelScreen';
import { freeWindows, timelineRange } from '../src/features/painel/Timeline';
import { TIMER_IDLE, useTimer } from '../src/timer/store';
import { ToastHost } from '../src/ui/Toast';

const at = (h: number, m = 0) => new Date(2026, 10, 11, h, m).getTime();
const timer = () => useTimer.getState();

beforeEach(async () => {
  // Only Date is faked: fake-indexeddb needs the real setImmediate/setTimeout.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(10, 20));
  localStorage.clear();
  useTimer.setState({ ...TIMER_IDLE });
  useAgoraSession.setState({ reviewDismissed: false });
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const renderPainel = () => render(<><PainelScreen /><ToastHost /></>);

describe('PainelScreen', () => {
  it('renders the three regions "Agora", "Hoje" and "Apoio"', async () => {
    renderPainel();
    expect(await screen.findByRole('region', { name: 'Agora' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Hoje' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Apoio' })).toBeInTheDocument();
  });

  it('AgoraScreen switches to the Painel on wide screens', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes('1200px'), media: query,
        addEventListener: () => {}, removeEventListener: () => {},
      }),
    });
    try {
      render(<AgoraScreen />);
      expect(await screen.findByRole('region', { name: 'Apoio' })).toBeInTheDocument();
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });

  it('the "Hoje" timeline shows commitments, free windows and the current time', async () => {
    await createCommitment({ title: 'Dentista', date: '2026-11-11', start: '15:00', end: '16:00' });
    await createMission({ title: 'Lavar louça', date: '2026-11-11' });
    renderPainel();
    const hoje = await screen.findByRole('region', { name: 'Hoje' });
    expect(await within(hoje).findByText('Dentista')).toBeInTheDocument();
    expect(within(hoje).getByText('livre 4h40')).toBeInTheDocument();
    expect(within(hoje).getByText('livre 7h')).toBeInTheDocument();
    expect(within(hoje).getByText('10:20')).toBeInTheDocument();
    expect(await within(hoje).findByText('Lavar louça')).toBeInTheDocument();
  });

  it('Apoio offers "Iniciar foco" while idle and shows the big clock once running', async () => {
    renderPainel();
    const apoio = await screen.findByRole('region', { name: 'Apoio' });
    expect(within(apoio).getByRole('button', { name: 'Iniciar foco' })).toBeInTheDocument();
    expect(within(apoio).getByRole('textbox', { name: 'Capturar' })).toBeInTheDocument();
    act(() => timer().start('pomodoro'));
    expect(within(apoio).getByRole('timer')).toHaveTextContent('25:00');
    expect(within(apoio).getByRole('button', { name: 'Pausar' })).toBeInTheDocument();
  });

  it('keyboard: Space pauses/resumes the timer and "n" focuses the capture field', async () => {
    const user = userEvent.setup();
    renderPainel();
    const apoio = await screen.findByRole('region', { name: 'Apoio' });
    act(() => timer().start('free'));
    await user.keyboard(' ');
    expect(timer().status).toBe('paused');
    await user.keyboard(' ');
    expect(timer().status).toBe('running');

    await user.keyboard('n');
    const field = within(apoio).getByRole('textbox', { name: 'Capturar' });
    expect(field).toHaveFocus();
    expect(field).toHaveValue('');
    await user.keyboard(' '); // typing in the field never toggles the timer
    expect(timer().status).toBe('running');
  });

  it('keyboard: "c" completes the main mission', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Ler um capítulo' });
    renderPainel();
    const agora = await screen.findByRole('region', { name: 'Agora' });
    expect(await within(agora).findByText('Ler um capítulo')).toBeInTheDocument();
    await user.keyboard('c');
    await waitFor(async () => expect((await db.missions.get(m.id))?.status).toBe('done'));
  });
});

describe('timeline helpers', () => {
  const occ = (title: string, start: number, end: number): CommitmentOccurrence => ({
    commitment: { id: title, title } as Commitment, date: '2026-11-11', startTs: start, endTs: end,
  });

  it('starts one hour before now (never before the day start) and ends at the day end', () => {
    expect(timelineRange(at(10, 20), at(4), at(23))).toEqual({ start: at(9, 20), end: at(23) });
    expect(timelineRange(at(4, 30), at(4), at(23))).toEqual({ start: at(4), end: at(23) });
    // After the day end it still shows the next hour.
    expect(timelineRange(at(23, 30), at(4), at(23))).toEqual({ start: at(22, 30), end: at(24, 30) });
  });

  it('finds the free windows from now until the day end', () => {
    const list = [occ('A', at(11), at(12)), occ('B', at(12), at(13)), occ('C', at(15), at(15, 10))];
    expect(freeWindows(list, at(10, 20), at(23))).toEqual([
      { start: at(10, 20), end: at(11) },
      { start: at(13), end: at(15) },
      { start: at(15, 10), end: at(23) },
    ]);
    // Inside a commitment the first window starts when it ends; tiny gaps are skipped.
    expect(freeWindows([occ('A', at(10), at(11)), occ('B', at(11, 10), at(12))], at(10, 20), at(13)))
      .toEqual([{ start: at(12), end: at(13) }]);
  });
});
