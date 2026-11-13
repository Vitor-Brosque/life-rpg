import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { setMeta } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { createCommitment, createMission } from '../src/domain/actions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { useTimerBridge } from '../src/features/mission/timerBridge';
import { syncCommitmentReminders } from '../src/features/reminders/reminders';
import { TimerBar } from '../src/timer/TimerBar';
import { TimerHost, useTimerSheet } from '../src/timer/TimerSheet';
import {
  TIMER_IDLE, TIMER_STORAGE_KEY, createTimerStore, elapsedMs, remainingMs, useTimer,
} from '../src/timer/store';
import { ToastHost } from '../src/ui/Toast';

const MIN = 60_000;
const T0 = new Date(2026, 10, 11, 10, 0).getTime();
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);
const timer = () => useTimer.getState();
const remaining = () => remainingMs(timer(), Date.now());
const sessions = async () => (await db.focusSessions.toArray()).filter((s) => !s.deleted);

function mockFetch() {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const callsTo = (fn: ReturnType<typeof mockFetch>, method: string) =>
  fn.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method);
const postedBodies = (fn: ReturnType<typeof mockFetch>) =>
  callsTo(fn, 'POST').map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

beforeEach(async () => {
  // Only Date is faked: fake-indexeddb needs the real setImmediate/setTimeout.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  localStorage.clear();
  useTimer.setState({ ...TIMER_IDLE });
  useTimerSheet.setState({ isOpen: false, step: undefined });
  useTimerBridge.setState({ start: undefined });
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('timer math', () => {
  it('elapsedMs adds the running segment and freezes while paused', () => {
    expect(elapsedMs({ status: 'running', accumulatedMs: 5000, segmentStartedAt: T0 - 3000 }, T0)).toBe(8000);
    expect(elapsedMs({ status: 'paused', accumulatedMs: 5000, segmentStartedAt: undefined }, T0 + MIN)).toBe(5000);
    expect(elapsedMs({ status: 'idle', accumulatedMs: 0, segmentStartedAt: undefined }, T0)).toBe(0);
  });

  it('a pomodoro starts with the focus length from settings (25 min)', () => {
    timer().start('pomodoro');
    expect(timer()).toMatchObject({ status: 'running', mode: 'pomodoro', phase: 'focus', startedAt: T0 });
    expect(remaining()).toBe(25 * MIN);
    advance(MIN);
    expect(remaining()).toBe(24 * MIN);
  });

  it('free mode has no remaining time; a countdown uses targetMin', () => {
    timer().start('free');
    advance(90_000);
    expect(remaining()).toBeUndefined();
    expect(elapsedMs(timer(), Date.now())).toBe(90_000);
    useTimer.setState({ ...TIMER_IDLE });
    timer().start('countdown', { targetMin: 10 });
    expect(remaining()).toBe(10 * MIN);
  });

  it('pausing freezes the remaining time until resumed', () => {
    timer().start('pomodoro');
    advance(5 * MIN);
    timer().pause();
    expect(remaining()).toBe(20 * MIN);
    advance(10_000);
    expect(remaining()).toBe(20 * MIN);
    timer().resume();
    expect(remaining()).toBe(20 * MIN);
    advance(MIN);
    expect(remaining()).toBe(19 * MIN);
  });

  it('never replaces a session that is already running', () => {
    timer().start('free', { missionId: 'a' });
    advance(MIN);
    timer().start('pomodoro', { missionId: 'b' });
    expect(timer()).toMatchObject({ mode: 'free', missionId: 'a', startedAt: T0 });
  });
});

describe('recording focus', () => {
  it('finish records a FocusSession without the paused time and returns focus XP', async () => {
    const m = await createMission({ title: 'Ler capítulo', areaId: 'area-intelecto' });
    timer().start('pomodoro', { missionId: m.id });
    advance(10 * MIN);
    timer().pause();
    advance(5 * MIN);
    timer().resume();
    advance(15 * MIN);
    const r = await timer().finish({ notes: 'Rendeu bem' });
    expect(r.xp).toBe(4);
    const list = await sessions();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      mode: 'pomodoro', outcome: 'finished', activeMs: 25 * MIN, missionId: m.id, areaId: 'area-intelecto',
      notes: 'Rendeu bem', startedAt: T0, endedAt: T0 + 30 * MIN,
    });
    expect(timer().status).toBe('idle');
  });

  it('finish can also complete the linked mission', async () => {
    const m = await createMission({ title: 'Ler capítulo' });
    timer().start('free', { missionId: m.id });
    advance(10 * MIN);
    await timer().finish({ completeMission: true });
    expect((await db.missions.get(m.id))?.status).toBe('done');
    expect(await sessions()).toHaveLength(1);
  });

  it('interrupt records outcome "interrupted" with the reason', async () => {
    timer().start('free');
    advance(12 * MIN);
    await timer().interrupt('Distração');
    const list = await sessions();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ mode: 'free', outcome: 'interrupted', interruptReason: 'Distração', activeMs: 12 * MIN });
    expect(timer().status).toBe('idle');
  });
});

describe('phase end', () => {
  it('pomodoro: the end of focus records it and the break waits for a tap', async () => {
    timer().start('pomodoro');
    advance(25 * MIN + 2000);
    expect(timer().checkPhaseEnd(Date.now())).toMatchObject({ kind: 'focus', fresh: true });
    expect(timer()).toMatchObject({ phase: 'break', status: 'paused', ready: true, pomodoroCount: 1 });
    await waitFor(async () => expect(await sessions()).toHaveLength(1));
    expect((await sessions())[0]).toMatchObject({ activeMs: 25 * MIN, outcome: 'finished', endedAt: T0 + 25 * MIN });

    advance(10 * MIN);
    expect(timer().checkPhaseEnd(Date.now())).toBeUndefined();
    expect(timer().status).toBe('paused'); // never starts by itself
    expect(remaining()).toBe(5 * MIN);

    timer().resume();
    advance(5 * MIN);
    expect(timer().checkPhaseEnd(Date.now())).toMatchObject({ kind: 'break' });
    expect(timer()).toMatchObject({ phase: 'focus', status: 'paused', ready: true });
    expect(remaining()).toBe(25 * MIN);
    expect(await sessions()).toHaveLength(1); // breaks are not focus
  });

  it('a focus phase end seen by two tabs is recorded once (same session id, one XP)', async () => {
    timer().start('pomodoro');
    advance(25 * MIN + 2000);
    const painel = createTimerStore(); // the other tab, hydrated from the same localStorage
    const a = timer().checkPhaseEnd(Date.now());
    const b = painel.getState().checkPhaseEnd(Date.now());
    await Promise.all([a?.recorded, b?.recorded]);
    const list = await sessions();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(`focus-${T0}-0`);
    const focusXp = (await db.xpEvents.toArray()).filter((x) => x.reason === 'focus' && !x.deleted);
    expect(focusXp).toHaveLength(1);
    expect(focusXp[0]!.id).toBe(`xp-focus-focus-${T0}-0`);
  });

  it('free and countdown sessions use their start time as id', async () => {
    timer().start('free');
    advance(12 * MIN);
    await timer().finish();
    expect((await sessions())[0]!.id).toBe(`focus-${T0}`);
  });

  it('countdown: the end is handled once and the active time is capped at the target', async () => {
    timer().start('countdown', { targetMin: 10 });
    advance(30 * MIN);
    expect(remaining()).toBe(0);
    // Reopened long after the end: no chime ("fresh" false), and never twice.
    expect(timer().checkPhaseEnd(Date.now())).toMatchObject({ kind: 'countdown', fresh: false });
    expect(timer().checkPhaseEnd(Date.now())).toBeUndefined();
    await timer().finish();
    expect((await sessions())[0]).toMatchObject({ activeMs: 10 * MIN, endedAt: T0 + 10 * MIN });
  });
});

describe('persistence', () => {
  it('survives re-creating the store from localStorage', () => {
    timer().start('pomodoro', { missionId: 'm1' });
    advance(2 * MIN);
    timer().pause();
    timer().setNotes('capítulo 3');
    expect(localStorage.getItem(TIMER_STORAGE_KEY)).toContain('"paused"');
    const fresh = createTimerStore();
    expect(fresh.getState()).toMatchObject({
      status: 'paused', mode: 'pomodoro', phase: 'focus', startedAt: T0, accumulatedMs: 2 * MIN,
      targetMs: 25 * MIN, missionId: 'm1', notes: 'capítulo 3',
    });
  });

  it('a running timer keeps counting from its timestamps while the app is closed', () => {
    timer().start('free');
    advance(7 * MIN);
    const fresh = createTimerStore();
    expect(elapsedMs(fresh.getState(), Date.now())).toBe(7 * MIN);
  });

  it('keeps working when storage throws (private mode)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(() => timer().start('free')).not.toThrow();
    expect(timer().status).toBe('running');
  });
});

describe('push', () => {
  it('schedules the end-of-phase push on start and cancels it on pause', async () => {
    const fetchMock = mockFetch();
    await setMeta('syncToken', 'tok');
    timer().start('pomodoro');
    await waitFor(() => expect(callsTo(fetchMock, 'POST')).toHaveLength(1));
    const [url, init] = callsTo(fetchMock, 'POST')[0]!;
    expect(url).toBe('/api/push/schedule');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer tok' });
    expect(postedBodies(fetchMock)[0]).toEqual({
      tag: 'timer', at: T0 + 25 * MIN, title: 'LIFE RPG', body: 'Fim do foco — hora de uma pausa.',
    });
    timer().pause();
    await waitFor(() => expect(callsTo(fetchMock, 'DELETE')).toHaveLength(1));
    expect(callsTo(fetchMock, 'DELETE')[0]![0]).toBe('/api/push/schedule/timer');
  });

  it('is a silent no-op without a sync token', async () => {
    const fetchMock = mockFetch();
    timer().start('countdown', { targetMin: 5 });
    timer().pause();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('syncCommitmentReminders', () => {
  it('schedules future reminders for today and tomorrow and cancels stale ones', async () => {
    const fetchMock = mockFetch();
    await setMeta('syncToken', 'tok');
    await createCommitment({ title: 'Café', date: '2026-11-11', start: '09:00' }); // already past
    const dentist = await createCommitment({ title: 'Dentista', date: '2026-11-11', start: '15:00' });
    const yoga = await createCommitment({ title: 'Yoga', date: '2026-11-01', start: '07:30', weekdays: [4] }); // Thu 12/11
    await createCommitment({ title: 'Sem aviso', date: '2026-11-11', start: '18:00', remind: false });
    const all = await db.commitments.toArray();

    await syncCommitmentReminders(all, '2026-11-11', 10, Date.now());
    const bodies = postedBodies(fetchMock);
    expect(bodies).toHaveLength(2);
    expect(bodies).toEqual(expect.arrayContaining([
      { tag: `commit:${dentist.id}:2026-11-11`, at: new Date(2026, 10, 11, 14, 50).getTime(), title: 'LIFE RPG', body: 'Dentista começa às 15:00' },
      { tag: `commit:${yoga.id}:2026-11-12`, at: new Date(2026, 10, 12, 7, 20).getTime(), title: 'LIFE RPG', body: 'Yoga começa às 07:30' },
    ]));

    fetchMock.mockClear();
    await syncCommitmentReminders(all, '2026-11-11', 10, Date.now());
    expect(fetchMock).not.toHaveBeenCalled(); // nothing changed

    await syncCommitmentReminders(all.filter((c) => c.id !== dentist.id), '2026-11-11', 10, Date.now());
    expect(callsTo(fetchMock, 'DELETE').map(([u]) => u))
      .toEqual([`/api/push/schedule/${encodeURIComponent(`commit:${dentist.id}:2026-11-11`)}`]);

    fetchMock.mockClear();
    await syncCommitmentReminders(all, '2026-11-11', 0, Date.now()); // reminders off
    expect(callsTo(fetchMock, 'POST')).toHaveLength(0);
    expect(callsTo(fetchMock, 'DELETE')).toHaveLength(1); // yoga
  });

  it('does nothing without a sync token', async () => {
    const fetchMock = mockFetch();
    await createCommitment({ title: 'Dentista', date: '2026-11-11', start: '15:00' });
    await expect(syncCommitmentReminders(await db.commitments.toArray(), '2026-11-11', 10, Date.now()))
      .resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('TimerBar', () => {
  it('is hidden while idle and shows time, mission and controls once started', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Escrever relatório' });
    render(<TimerBar />);
    expect(screen.queryByRole('region', { name: 'Cronômetro' })).not.toBeInTheDocument();

    act(() => timer().start('pomodoro', { missionId: m.id }));
    const bar = screen.getByRole('region', { name: 'Cronômetro' });
    expect(within(bar).getByText('25:00')).toBeInTheDocument();
    expect(await within(bar).findByText('Escrever relatório')).toBeInTheDocument();

    await user.click(within(bar).getByRole('button', { name: 'Pausar' }));
    expect(timer().status).toBe('paused');
    await user.click(within(bar).getByRole('button', { name: 'Retomar' }));
    expect(timer().status).toBe('running');
  });
});

describe('TimerSheet', () => {
  const renderHost = () => render(<><TimerHost /><ToastHost /></>);
  const openSheet = () => {
    act(() => useTimerSheet.getState().open());
    return screen.findByRole('dialog', { name: 'Cronômetro' });
  };

  it('starts a countdown from a minute chip and interrupts it with a reason', async () => {
    const user = userEvent.setup();
    renderHost();
    let dialog = await openSheet();
    await user.click(within(dialog).getByRole('button', { name: 'Regressivo' }));
    await user.click(within(dialog).getByRole('button', { name: '10 min' }));
    await user.click(within(dialog).getByRole('button', { name: 'Iniciar' }));
    expect(timer()).toMatchObject({ status: 'running', mode: 'countdown', targetMs: 10 * MIN });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    advance(4 * MIN);
    dialog = await openSheet();
    await user.click(within(dialog).getByRole('button', { name: 'Interromper' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cansaço' }));
    await waitFor(async () => expect(await sessions()).toHaveLength(1));
    expect((await sessions())[0]).toMatchObject({ outcome: 'interrupted', interruptReason: 'Cansaço', activeMs: 4 * MIN });
    expect(timer().status).toBe('idle');
  });

  it('"Concluir" can also mark the linked mission as done', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Ler capítulo' });
    timer().start('free', { missionId: m.id });
    advance(20 * MIN);
    renderHost();
    const dialog = await openSheet();
    await user.click(within(dialog).getByRole('button', { name: 'Concluir' }));
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Marcar a missão como feita também?' }));
    await user.click(within(dialog).getByRole('button', { name: 'Concluir foco' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.status).toBe('done'));
    expect((await sessions())[0]).toMatchObject({ activeMs: 20 * MIN, outcome: 'finished', missionId: m.id });
  });

  it('a pomodoro at the end of focus offers "Iniciar pausa" instead of starting it', async () => {
    const user = userEvent.setup();
    renderHost();
    act(() => timer().start('pomodoro'));
    advance(25 * MIN);
    await act(async () => { await timer().checkPhaseEnd(Date.now())?.recorded; });
    const dialog = await openSheet();
    expect(within(dialog).getByText('Fim do foco — hora de uma pausa.')).toBeInTheDocument();
    expect(timer().status).toBe('paused');
    await user.click(within(dialog).getByRole('button', { name: 'Iniciar pausa' }));
    expect(timer()).toMatchObject({ status: 'running', phase: 'break' });
  });

  it('the Agora status strip opens the timer setup (a timer never starts by itself)', async () => {
    const user = userEvent.setup();
    render(<><AgoraScreen /><TimerHost /></>);
    await user.click(await screen.findByRole('button', { name: 'Cronômetro' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cronômetro' });
    expect(within(dialog).getByRole('button', { name: 'Livre' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByText('Conta o tempo até você concluir. Pause quando sentir que caiu, ou ao fim de uma etapa.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Pomodoro' }));
    expect(within(dialog).getByText(/25 min de foco e 5 de pausa/)).toBeInTheDocument();
    expect(timer().status).toBe('idle');
  });

  it('the timer starts in free mode', () => {
    expect(TIMER_IDLE.mode).toBe('free');
  });

  it('registers the mission sheet "Cronômetro" starter', () => {
    renderHost();
    act(() => useTimerBridge.getState().start?.('m42'));
    expect(timer()).toMatchObject({ status: 'running', mode: 'free', missionId: 'm42' });
  });
});
