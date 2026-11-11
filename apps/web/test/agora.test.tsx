import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitmentOccurrence, EngineOutput, Mission, Suggestion } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { completeMission, createCommitment, createMission, dropMission } from '../src/domain/actions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { MainCard } from '../src/features/agora/MainCard';
import { freeTimeText } from '../src/features/agora/StatusStrip';
import { useAgoraSession, type AgoraActions } from '../src/features/agora/useAgora';
import { PHRASES } from '../src/features/companion/phrases';
import { useCompanion } from '../src/features/companion/store';
import { ChecklistEditor } from '../src/features/mission/ChecklistEditor';
import { MissionSheet, MissionSheetHost, useMissionSheet } from '../src/features/mission/MissionSheet';
import { useTimerBridge } from '../src/features/mission/timerBridge';
import { ToastHost, useToast } from '../src/ui/Toast';

beforeEach(async () => {
  // setImmediate stays real: fake-indexeddb schedules transaction work with it.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 10, 0));
  await db.delete();
  await db.open();
  await ensureSeed();
  // App-session state; the greeting is marked as done so it stays out of the way.
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: '2026-11-11', emptyDay: undefined });
  useMissionSheet.setState({ openId: undefined });
  useTimerBridge.setState({ start: undefined });
  useCompanion.getState().clear();
  useToast.getState().dismiss();
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
    // Query the region afresh: the empty card is a different element than the mission card.
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Missão agora' }))
      .getByText('Ler um capítulo')).toBeInTheDocument());
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
    expect(within(review).getByRole('heading', { name: 'Revisão rápida — 1 missão para reavaliar' })).toBeInTheDocument();
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

describe('day boundaries of the Agora moments', () => {
  const reviewRegion = () => screen.queryByRole('region', { name: /Revisão rápida/ });

  it('"Dispensar" hides the quick review for the rest of the day only', async () => {
    const user = setup();
    await createMission({ title: 'Pagar a conta', date: '2026-11-10' });
    const first = renderAgora();
    const review = await screen.findByRole('region', { name: /Revisão rápida/ });
    await user.click(within(review).getByRole('button', { name: 'Dispensar revisão' }));
    expect(reviewRegion()).not.toBeInTheDocument();
    first.unmount();

    // Same day: stays hidden.
    const second = renderAgora();
    await mainCard();
    expect(reviewRegion()).not.toBeInTheDocument();
    second.unmount();

    // Next day: the mission is still behind, so the card comes back.
    vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
    renderAgora();
    expect(await screen.findByRole('region', { name: /Revisão rápida/ })).toBeInTheDocument();
  });

  it('the companion greets once per day, not once per app session', async () => {
    useAgoraSession.setState({ greetedDay: undefined });
    await createMission({ title: 'Ler um capítulo' });
    const first = renderAgora();
    await waitFor(() => expect(useCompanion.getState().message).toBeDefined());
    act(() => useCompanion.getState().clear());
    first.unmount();

    const second = renderAgora();
    await mainCard();
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(useCompanion.getState().message).toBeUndefined();
    second.unmount();

    vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
    renderAgora();
    await waitFor(() => expect(useCompanion.getState().message).toBeDefined());
  });

  it('an empty Agora makes the companion speak its "empty" line once per day', async () => {
    const first = renderAgora();
    expect(await screen.findByText(/Nada pendente/)).toBeInTheDocument();
    await waitFor(() => expect(PHRASES.empty).toContain(useCompanion.getState().message));
    act(() => useCompanion.getState().clear());
    first.unmount();

    renderAgora();
    expect(await screen.findByText(/Nada pendente/)).toBeInTheDocument();
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(useCompanion.getState().message).toBeUndefined();
  });

  it('a commitment earlier than the day start belongs to the end of the logical day', async () => {
    // 23:00 on the 11th; the day starts at 04:00, so 02:00–03:00 is still ahead (12/11 02:00).
    vi.setSystemTime(new Date(2026, 10, 11, 23, 0));
    await createCommitment({ title: 'Plantão', date: '2026-11-11', start: '02:00', end: '03:00' });
    renderAgora();
    const today = await screen.findByRole('region', { name: 'Hoje' });
    const row = (await within(today).findByText('Plantão')).closest('li')!;
    expect(row).not.toHaveClass('commit-row--past');
  });
});

describe('quick review decisions', () => {
  it('"Pronto" without any decision just hides the card for today: no XP, review not done', async () => {
    const user = setup();
    await createMission({ title: 'Pagar a conta', date: '2026-11-10' });
    const first = renderAgora();
    const review = await screen.findByRole('region', { name: /Revisão rápida/ });
    await user.click(within(review).getByRole('button', { name: 'Pronto' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: /Revisão rápida/ })).not.toBeInTheDocument());
    expect(await xpBy('review')).toBe(0);
    expect((await db.dayState.get('2026-11-11'))?.reviewDone).toBeFalsy();
    first.unmount();
    renderAgora();
    await mainCard();
    expect(screen.queryByRole('region', { name: /Revisão rápida/ })).not.toBeInTheDocument();
  });

  it('undoing a "Soltar" brings the mission back to the review list', async () => {
    const user = setup();
    const m = await createMission({ title: 'Pagar a conta', date: '2026-11-10' });
    await createMission({ title: 'Ligar para a Ana', date: '2026-11-09' });
    renderAgora();
    const review = await screen.findByRole('region', { name: /Revisão rápida/ });
    const item = within(review).getByRole('group', { name: 'Pagar a conta' });
    await user.click(within(item).getByRole('button', { name: 'Soltar' }));
    await user.click(within(item).getByRole('button', { name: 'só soltar' }));
    await waitFor(() => expect(within(review).queryByRole('group', { name: 'Pagar a conta' })).not.toBeInTheDocument());

    await user.click(await screen.findByRole('button', { name: 'Desfazer' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.status).toBe('open'));
    expect(await within(review).findByRole('group', { name: 'Pagar a conta' })).toBeInTheDocument();
  });
});

describe('MainCard inside a commitment', () => {
  const occ = (id: string, title: string, startTs: number): CommitmentOccurrence => ({
    commitment: {
      id, title, createdAt: 0, updatedAt: 0, deleted: false, date: '2026-11-11', start: '09:00', end: '10:00', remind: true,
    },
    date: '2026-11-11', startTs, endTs: startTs + 3_600_000,
  });
  const actions = {
    start: vi.fn(), open: vi.fn(), complete: vi.fn(), other: vi.fn(), shrink: vi.fn(), snooze: vi.fn(),
    split: vi.fn(), drop: vi.fn(), promote: vi.fn(),
  } satisfies AgoraActions;

  it('"Ver a missão agora" resets when the next commitment starts', async () => {
    const user = setup();
    const mission = await createMission({ title: 'Responder e-mails' });
    const suggestion: Suggestion = { mission, score: 0, reasons: [], postponedHint: false };
    const card = (o: CommitmentOccurrence) =>
      <MainCard suggestion={suggestion} commitment={o} canSkip={false} actions={actions} />;
    const { rerender } = render(card(occ('a', 'Reunião', 1000)));
    await user.click(screen.getByRole('button', { name: 'Ver a missão agora' }));
    expect(screen.getByRole('heading', { name: 'Responder e-mails' })).toBeInTheDocument();

    rerender(card(occ('b', 'Aula', 5000)));
    expect(screen.getByRole('heading', { name: 'Aula' })).toBeInTheDocument();
    expect(screen.getByText('Em compromisso')).toBeInTheDocument();
  });
});

describe('reopening finished missions', () => {
  const renderSheet = (id: string) => render(<><MissionSheet missionId={id} onClose={() => {}} /><ToastHost /></>);

  it('"Reabrir" on a done mission undoes the completion and its XP', async () => {
    const user = setup();
    const m = await createMission({ title: 'Lavar louça', date: '2026-11-11' });
    await completeMission(m.id);
    expect(await xpBy('complete')).toBeGreaterThan(0);
    renderSheet(m.id);
    const sheet = await screen.findByRole('dialog', { name: 'Missão' });
    await user.click(within(sheet).getByRole('button', { name: 'Reabrir' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.status).toBe('open'));
    expect((await db.missions.get(m.id))?.completedAt).toBeUndefined();
    expect(await xpBy('complete')).toBe(0);
  });

  it('"Reabrir" on a done mission whose completion event is gone still reopens it', async () => {
    const user = setup();
    const m = await createMission({ title: 'Feita em outro aparelho', status: 'done', completedAt: Date.now() });
    renderSheet(m.id);
    await user.click(within(await screen.findByRole('dialog', { name: 'Missão' })).getByRole('button', { name: 'Reabrir' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.status).toBe('open'));
    expect((await db.missions.get(m.id))?.completedAt).toBeUndefined();
  });

  it('"Reabrir" on a dropped mission makes it open again without the reason', async () => {
    const user = setup();
    const m = await createMission({ title: 'Trocar o pneu' });
    await dropMission(m.id, 'não depende de mim');
    renderSheet(m.id);
    const sheet = await screen.findByRole('dialog', { name: 'Missão' });
    expect(within(sheet).getByText('Solta')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Reabrir' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.status).toBe('open'));
    expect((await db.missions.get(m.id))?.dropReason).toBeUndefined();
  });

  it('open missions have no "Reabrir"', async () => {
    const m = await createMission({ title: 'Aberta' });
    renderSheet(m.id);
    const sheet = await screen.findByRole('dialog', { name: 'Missão' });
    expect(within(sheet).queryByRole('button', { name: 'Reabrir' })).not.toBeInTheDocument();
  });
});

describe('ChecklistEditor', () => {
  it('two quick taps both stick (each write starts from the saved checklist)', async () => {
    const user = setup();
    const m: Mission = await createMission({
      title: 'Mudança',
      checklist: [{ id: 'a', text: 'Embalar livros', done: false }, { id: 'b', text: 'Desmontar a cama', done: false }],
    });
    // The props stay as rendered: the second tap happens before the first write comes back.
    render(<ChecklistEditor mission={m} />);
    await user.click(screen.getByRole('checkbox', { name: 'Embalar livros' }));
    await user.click(screen.getByRole('checkbox', { name: 'Desmontar a cama' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.checklist.map((c) => c.done)).toEqual([true, true]));

    await user.click(screen.getByRole('button', { name: 'Remover passo Embalar livros' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.checklist)
      .toEqual([{ id: 'b', text: 'Desmontar a cama', done: true }]));
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
