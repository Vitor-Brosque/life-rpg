import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { createMission, endBlock, setDayMode, startBlock } from '../src/domain/actions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { ResumePromptHost, firstOpenStep, useResumePrompt } from '../src/features/agora/ResumePrompt';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { TimerHost, useTimerSheet } from '../src/timer/TimerSheet';
import { TIMER_IDLE, useTimer } from '../src/timer/store';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at, seedBlocks } from './blockFixture';

const MIN = 60_000;
const CHECKLIST = [
  { id: 'a', text: 'Ler a doc da API', done: true },
  { id: 'b', text: 'Escrever o teste', done: false },
  { id: 'c', text: 'Rodar o parser', done: false },
];

beforeEach(async () => {
  // Only Date is faked: fake-indexeddb needs the real setImmediate/setTimeout.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 9, 30));
  localStorage.clear();
  useTimer.setState({ ...TIMER_IDLE });
  useTimerSheet.setState({ isOpen: false, step: undefined });
  useResumePrompt.setState({ request: undefined });
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: '2026-11-11', emptyDay: undefined });
  useToast.getState().dismiss();
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
});
afterEach(() => { vi.useRealTimers(); });

const renderAgora = () => render(<><AgoraScreen /><ResumePromptHost /><ToastHost /></>);
const banner = () => screen.findByRole('region', { name: 'Bloco atual' });
const prompt = () => screen.findByRole('dialog', { name: 'Onde parou?' });
const field = (d: HTMLElement) => within(d).getByRole('textbox', { name: 'Qual a primeira ação da próxima vez?' });

describe('firstOpenStep', () => {
  it('is the first unchecked checklist item, or empty', () => {
    expect(firstOpenStep({ checklist: CHECKLIST })).toBe('Escrever o teste');
    expect(firstOpenStep({ checklist: [{ id: 'a', text: 'x', done: true }] })).toBe('');
    expect(firstOpenStep(undefined)).toBe('');
  });
});

describe('"Encerrar bloco"', () => {
  it('asks where you stopped, prefilled with the next step, and saving updates the mission', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    await startBlock('b1');
    const m = await createMission({ title: 'Parser de notícias', journeyId: 'j-tech', checklist: CHECKLIST });
    renderAgora();
    await within(await screen.findByRole('region', { name: 'Missão agora' })).findByText('Parser de notícias');
    await user.click(within(await banner()).getByRole('button', { name: 'Encerrar bloco' }));

    const dialog = await prompt();
    expect(field(dialog)).toHaveValue('Escrever o teste');
    await user.clear(field(dialog));
    await user.type(field(dialog), 'Escrever o teste do parser');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(async () => expect((await db.missions.get(m.id))?.firstStep).toBe('Escrever o teste do parser'));
    const session = await db.blockSessions.get('bs-b1-2026-11-11');
    expect(session).toMatchObject({ nextAction: 'Escrever o teste do parser', endedAt: at(11, 9, 30) });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Tech is over: the next block comes up.
    expect(await screen.findByText('Próximo: Treino às 11:45 · 2h15 livres')).toBeInTheDocument();
  });

  it('"Encerrar sem anotar" ends the block without a note', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    await startBlock('b1');
    renderAgora();
    await user.click(within(await banner()).getByRole('button', { name: 'Encerrar bloco' }));
    const dialog = await prompt();
    expect(field(dialog)).toHaveValue('');
    await user.click(within(dialog).getByRole('button', { name: 'Encerrar sem anotar' }));
    await waitFor(async () => expect((await db.blockSessions.get('bs-b1-2026-11-11'))?.endedAt).toBe(at(11, 9, 30)));
    expect((await db.blockSessions.get('bs-b1-2026-11-11'))?.nextAction).toBeUndefined();
  });

  it('closing the prompt keeps the block going', async () => {
    const user = userEvent.setup();
    await startBlock('b1');
    renderAgora();
    await user.click(within(await banner()).getByRole('button', { name: 'Encerrar bloco' }));
    await user.click(within(await prompt()).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await db.blockSessions.get('bs-b1-2026-11-11'))?.endedAt).toBeUndefined();
    expect(within(await banner()).getByRole('heading', { name: 'Tech' })).toBeInTheDocument();
  });
});

describe('"Onde você parou"', () => {
  it('the next day the note of the last session sits in the block banner', async () => {
    await endBlock('b1', 'Escrever o teste do parser');
    vi.setSystemTime(at(12, 9, 30));
    await createMission({ title: 'Parser de notícias', journeyId: 'j-tech' });
    renderAgora();
    const note = await within(await banner()).findByRole('note', { name: 'Onde você parou' });
    expect(note).toHaveTextContent('Onde você parou: Escrever o teste do parser');
  });

  it('is hidden when the block has no note', async () => {
    renderAgora();
    await banner();
    expect(screen.queryByRole('note', { name: 'Onde você parou' })).not.toBeInTheDocument();
  });
});

describe('timer → resumption prompt', () => {
  const timer = () => useTimer.getState();
  const renderTimer = () => render(<><TimerHost /><ResumePromptHost /><ToastHost /></>);
  const openTimer = () => {
    act(() => useTimerSheet.getState().open());
    return screen.findByRole('dialog', { name: 'Cronômetro' });
  };

  it('finishing without completing the linked mission asks where you stopped', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Parser de notícias', journeyId: 'j-tech', checklist: CHECKLIST });
    timer().start('free', { missionId: m.id });
    vi.setSystemTime(Date.now() + 20 * MIN);
    renderTimer();
    const sheet = await openTimer();
    await user.click(within(sheet).getByRole('button', { name: 'Concluir' }));
    await user.click(within(sheet).getByRole('button', { name: 'Concluir foco' }));

    const dialog = await prompt();
    expect(field(dialog)).toHaveValue('Escrever o teste');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.firstStep).toBe('Escrever o teste'));
    // The mission is of the current block (Tech): its session keeps the note too, without ending it.
    const session = await db.blockSessions.get('bs-b1-2026-11-11');
    expect(session).toMatchObject({ nextAction: 'Escrever o teste' });
    expect(session?.endedAt).toBeUndefined();
  });

  it('interrupting asks too', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Ler capítulo' });
    timer().start('free', { missionId: m.id });
    vi.setSystemTime(Date.now() + 10 * MIN);
    renderTimer();
    const sheet = await openTimer();
    await user.click(within(sheet).getByRole('button', { name: 'Interromper' }));
    await user.click(within(sheet).getByRole('button', { name: 'Só interromper' }));
    expect(await prompt()).toBeInTheDocument();
  });

  it('completing the linked mission from the timer does not ask', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Ler capítulo' });
    timer().start('free', { missionId: m.id });
    vi.setSystemTime(Date.now() + 20 * MIN);
    renderTimer();
    const sheet = await openTimer();
    await user.click(within(sheet).getByRole('button', { name: 'Concluir' }));
    await user.click(await within(sheet).findByRole('checkbox', { name: 'Marcar a missão como feita também?' }));
    await user.click(within(sheet).getByRole('button', { name: 'Concluir foco' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.status).toBe('done'));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByRole('dialog', { name: 'Onde parou?' })).not.toBeInTheDocument();
  });
});
