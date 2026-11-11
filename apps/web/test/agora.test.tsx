import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineOutput } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { createCommitment, createMission } from '../src/domain/actions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { freeTimeText } from '../src/features/agora/StatusStrip';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { MissionSheetHost, useMissionSheet } from '../src/features/mission/MissionSheet';
import { useTimerBridge } from '../src/features/mission/timerBridge';
import { ToastHost } from '../src/ui/Toast';

beforeEach(async () => {
  // setImmediate stays real: fake-indexeddb schedules transaction work with it.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 10, 0));
  await db.delete();
  await db.open();
  await ensureSeed();
  useAgoraSession.setState({ reviewDismissed: false }); // app-session state
  useMissionSheet.setState({ openId: undefined });
  useTimerBridge.setState({ start: undefined });
});
afterEach(() => { vi.useRealTimers(); });

const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
const renderAgora = () => render(<><AgoraScreen /><ToastHost /></>);
const mainCard = () => screen.findByRole('region', { name: 'Missão agora' });
const xpBy = async (reason: string) => (await db.xpEvents.toArray())
  .filter((x) => !x.deleted && x.reason === reason).reduce((s, x) => s + x.amount, 0);

describe('AgoraScreen', () => {
  it('shows the single mission, completes it with a toast and undo brings it back', async () => {
    const user = setup();
    await createMission({ title: 'Ler um capítulo' });
    renderAgora();
    const card = await mainCard();
    expect(within(card).getByText('Ler um capítulo')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Concluir' }));
    expect(await screen.findByText(/\+8 XP/)).toBeInTheDocument();
    expect(await screen.findByText(/Nada pendente/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    const back = await mainCard();
    expect(await within(back).findByText('Ler um capítulo')).toBeInTheDocument();
    expect(await xpBy('complete')).toBe(0);
  });

  it('highlights the first step as the main text', async () => {
    await createMission({ title: 'Escrever relatório', firstStep: 'Abrir o documento' });
    renderAgora();
    const card = await mainCard();
    expect(await within(card).findByRole('heading', { name: 'Abrir o documento' })).toBeInTheDocument();
    expect(within(card).getByText('Escrever relatório')).toBeInTheDocument();
  });

  it('shows the empty state when there is nothing to do', async () => {
    renderAgora();
    expect(await screen.findByText(/Nada pendente\. Capture algo com \+, ou descanse — descanso também conta\./))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Capturar' })).toBeInTheDocument();
  });

  it('quick review: "Hoje" moves a mission from yesterday and "Pronto" awards XP once', async () => {
    const user = setup();
    const m = await createMission({ title: 'Pagar a conta', date: '2026-11-10' });
    renderAgora();
    const review = await screen.findByRole('region', { name: /Revisão rápida/ });
    expect(within(review).getByText(/1 missão ficou para trás/)).toBeInTheDocument();
    const item = within(review).getByRole('group', { name: 'Pagar a conta' });

    await user.click(within(item).getByRole('button', { name: 'Hoje' }));
    await waitFor(async () => expect((await db.missions.get(m.id))!.date).toBe('2026-11-11'));

    await user.click(await within(review).findByRole('button', { name: 'Pronto' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: /Revisão rápida/ })).not.toBeInTheDocument());
    expect(await xpBy('review')).toBe(5);
    expect((await db.dayState.get('2026-11-11'))?.reviewDone).toBe(true);
  });

  it('deadline-passed items show a neutral "prazo passou" tag', async () => {
    await createMission({ title: 'Enviar formulário', deadline: '2026-11-09' });
    renderAgora();
    const review = await screen.findByRole('region', { name: /Revisão rápida/ });
    expect(within(review).getByText('prazo passou')).toBeInTheDocument();
  });

  it('"Outra" moves to the next suggestion and logs a skip', async () => {
    const user = setup();
    await createMission({ title: 'Primeira', important: true });
    await createMission({ title: 'Segunda' });
    renderAgora();
    const card = await mainCard();
    expect(await within(card).findByRole('heading', { name: 'Primeira' })).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Outra' }));
    expect(await within(card).findByRole('heading', { name: 'Segunda' })).toBeInTheDocument();
    await waitFor(async () => expect((await db.events.toArray()).some((e) => e.type === 'skipped')).toBe(true));
  });

  it('tapping an alternative promotes it to the main card', async () => {
    const user = setup();
    await createMission({ title: 'Primeira', important: true });
    await createMission({ title: 'Segunda' });
    renderAgora();
    const alt = await screen.findByRole('region', { name: 'Também cabe agora' });
    await user.click(within(alt).getByRole('button', { name: /Segunda/ }));
    const card = await mainCard();
    expect(await within(card).findByRole('heading', { name: 'Segunda' })).toBeInTheDocument();
  });

  it('inside a commitment the card shows it and what comes after', async () => {
    await createCommitment({ title: 'Reunião', date: '2026-11-11', start: '09:30', end: '11:00' });
    await createMission({ title: 'Responder e-mails' });
    renderAgora();
    const card = await mainCard();
    expect(await within(card).findByRole('heading', { name: 'Reunião' })).toBeInTheDocument();
    expect(within(card).getByText(/Depois:/)).toHaveTextContent('Depois: Responder e-mails');
  });

  it('lists today missions and commitments under "Hoje"', async () => {
    await createCommitment({ title: 'Dentista', date: '2026-11-11', start: '15:00' });
    await createMission({ title: 'Lavar louça', date: '2026-11-11' });
    renderAgora();
    const today = await screen.findByRole('region', { name: 'Hoje' });
    expect(await within(today).findByText('Lavar louça')).toBeInTheDocument();
    expect(within(today).getByText('Dentista')).toBeInTheDocument();
    expect(within(today).getByText('15:00–16:00')).toBeInTheDocument();
  });
});

describe('MissionSheet', () => {
  const renderWithSheet = () => render(<><AgoraScreen /><MissionSheetHost /><ToastHost /></>);

  it('opens from the "Hoje" list and saves the edited title on blur', async () => {
    const user = setup();
    const m = await createMission({ title: 'Lavar louça', date: '2026-11-11' });
    renderWithSheet();
    const today = await screen.findByRole('region', { name: 'Hoje' });
    await user.click(await within(today).findByText('Lavar louça'));
    const sheet = await screen.findByRole('dialog', { name: 'Missão' });
    const title = within(sheet).getByRole('textbox', { name: 'Título' });
    expect(title).toHaveValue('Lavar louça');

    await user.clear(title);
    await user.type(title, 'Lavar a louça do jantar');
    await user.click(within(sheet).getByRole('textbox', { name: 'Primeiro passo' }));
    await waitFor(async () => expect((await db.missions.get(m.id))!.title).toBe('Lavar a louça do jantar'));
  });

  it('"Começar" marks the mission as doing and opens its sheet', async () => {
    const user = setup();
    const m = await createMission({ title: 'Ler um capítulo' });
    renderWithSheet();
    const card = await mainCard();
    await user.click(within(card).getByRole('button', { name: 'Começar' }));
    expect(await screen.findByRole('dialog', { name: 'Missão' })).toBeInTheDocument();
    await waitFor(async () => expect((await db.missions.get(m.id))!.status).toBe('doing'));
    expect(await within(card).findByRole('button', { name: 'Continuar' })).toBeInTheDocument();
  });

  it('adds and checks checklist steps; the timer button appears only once a timer registers', async () => {
    const user = setup();
    const m = await createMission({ title: 'Mudança', date: '2026-11-11' });
    renderWithSheet();
    await user.click(await within(await screen.findByRole('region', { name: 'Hoje' })).findByText('Mudança'));
    const sheet = await screen.findByRole('dialog', { name: 'Missão' });
    expect(within(sheet).queryByRole('button', { name: 'Cronômetro' })).not.toBeInTheDocument();

    await user.type(within(sheet).getByRole('textbox', { name: 'Novo passo' }), 'Embalar livros{Enter}');
    await user.click(await within(sheet).findByRole('checkbox', { name: 'Embalar livros' }));
    await waitFor(async () => expect((await db.missions.get(m.id))!.checklist)
      .toMatchObject([{ text: 'Embalar livros', done: true }]));

    const start = vi.fn();
    act(() => useTimerBridge.setState({ start }));
    await user.click(await within(sheet).findByRole('button', { name: 'Cronômetro' }));
    expect(start).toHaveBeenCalledWith(m.id);
  });
});

describe('freeTimeText', () => {
  const base: EngineOutput = { mode: 'empty', alternatives: [], ranked: [], freeMinutes: 0 };
  const occ = (title: string, start: string, end: string) => ({
    commitment: {
      id: 'c', createdAt: 0, updatedAt: 0, deleted: false, title, date: '2026-11-11', start, end, remind: true,
    },
    date: '2026-11-11', startTs: 0, endTs: 0,
  });

  it('describes free time until the next commitment', () => {
    expect(freeTimeText({ ...base, freeMinutes: 100, nextCommitment: occ('Dentista', '15:00', '16:00') }, 23))
      .toBe('1h40 livre até Dentista 15:00');
  });
  it('describes free time until the end of the day', () => {
    expect(freeTimeText({ ...base, freeMinutes: 600 }, 23)).toBe('livre até 23:00');
  });
  it('describes the current commitment', () => {
    expect(freeTimeText({ ...base, currentCommitment: occ('Dentista', '14:00', '15:00') }, 23))
      .toBe('Em compromisso: Dentista até 15:00');
  });
});
