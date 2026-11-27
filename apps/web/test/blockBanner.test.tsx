import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import {
  createCommitment, createMission, saveNextAction, setDayMode, skipBlock, startBlock,
} from '../src/domain/actions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { ResumePromptHost, useResumePrompt } from '../src/features/agora/ResumePrompt';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { PHRASES, renderPhrase, type PhraseCategory } from '../src/features/companion/phrases';
import { useCompanion } from '../src/features/companion/store';
import { PainelScreen } from '../src/features/painel/PainelScreen';
import { TIMER_IDLE, useTimer } from '../src/timer/store';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at, block, seedBlocks } from './blockFixture';

// Final review of the Agora with blocks: a block past its time, "Pular hoje", the resume prefill,
// the gap before a commitment, the status strip inside a block, the mode picker and focus.

const CHECKLIST = [
  { id: 'a', text: 'Ler a doc da API', done: true },
  { id: 'b', text: 'Escrever o teste', done: false },
];
const ROUTINE = block({
  id: 'b0', name: 'Início do dia', order: -1, targetStart: '08:00', durationMin: 30, minimumMin: 15, kind: 'routine',
  checklist: [{ id: 'c1', text: 'Beber água', done: false }, { id: 'c2', text: 'Separar o material', done: false }],
});

beforeEach(async () => {
  // Only Date is faked: fake-indexeddb needs the real setImmediate/setTimeout.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 9, 30));
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
  useTimer.setState({ ...TIMER_IDLE });
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: '2026-11-11', emptyDay: undefined });
  useResumePrompt.setState({ request: undefined });
  useCompanion.getState().clear();
  useToast.getState().dismiss();
});
afterEach(() => { vi.useRealTimers(); });

const renderAgora = () => render(<><AgoraScreen /><ResumePromptHost /><ToastHost /></>);
const banner = () => screen.findByRole('region', { name: 'Bloco atual' });
const prompt = () => screen.findByRole('dialog', { name: 'Onde parou?' });
const field = (d: HTMLElement) => within(d).getByRole('textbox', { name: 'Qual a primeira ação da próxima vez?' });
const session = (id: string) => db.blockSessions.get(`bs-${id}-2026-11-11`);
const SLOW = { timeout: 4000 };
const said = async (cat: PhraseCategory) => {
  const p = await db.profile.get('me');
  return PHRASES[cat].map((t) => renderPhrase(t, { name: p?.name, companion: p?.companionName }));
};
/** Starts `id` at h:m, then moves the clock to the second time. */
async function startedAt(id: string, h: number, m: number, nowH: number, nowM: number) {
  vi.setSystemTime(at(11, h, m));
  await startBlock(id);
  vi.setSystemTime(at(11, nowH, nowM));
}

describe('a block past its time (overrun)', () => {
  it('says the time is over and "Encerrar e seguir para Treino" ends it (with the note prompt)', async () => {
    const user = userEvent.setup();
    await startedAt('b1', 8, 30, 11, 25);
    renderAgora();
    const b = await banner();
    expect(within(b).getByRole('heading', { name: 'Tech' })).toBeInTheDocument();
    expect(within(b).getByText('O horário do bloco acabou')).toBeInTheDocument();
    expect(within(b).queryByText(/restantes?$/)).not.toBeInTheDocument();
    expect(within(b).queryByRole('button', { name: 'Encerrar bloco' })).not.toBeInTheDocument();
    await user.click(within(b).getByRole('button', { name: 'Encerrar e seguir para Treino' }));

    const dialog = await prompt();
    await user.click(within(dialog).getByRole('button', { name: 'Encerrar sem anotar' }));
    await waitFor(async () => expect((await session('b1'))?.endedAt).toBe(at(11, 11, 25)));
    expect(await screen.findByText('Próximo: Treino às 11:45 · 20 min livres')).toBeInTheDocument();
  });

  it('with no block after it the button is "Encerrar bloco"', async () => {
    await startedAt('b5', 16, 45, 17, 25);
    renderAgora();
    const b = await banner();
    expect(within(b).getByRole('heading', { name: 'Compl' })).toBeInTheDocument();
    expect(within(b).getByText('O horário do bloco acabou')).toBeInTheDocument();
    expect(within(b).getByRole('button', { name: 'Encerrar bloco' })).toHaveClass('btn--primary');
  });

  it('a routine block ends without the note prompt and the next block comes up', async () => {
    const user = userEvent.setup();
    await db.blocks.put(ROUTINE);
    await startedAt('b0', 8, 0, 8, 40);
    renderAgora();
    const b = await banner();
    expect(within(b).getByText('O horário do bloco acabou')).toBeInTheDocument();
    await user.click(within(b).getByRole('button', { name: 'Encerrar e seguir para Tech' }));
    await waitFor(async () => expect((await session('b0'))?.endedAt).toBe(at(11, 8, 40)));
    expect(screen.queryByRole('dialog', { name: 'Onde parou?' })).not.toBeInTheDocument();
    expect(await within(await banner()).findByRole('heading', { name: 'Tech' })).toBeInTheDocument();
  });

  it('an open session 30+ min past its end is closed by the plan: no banner for it', async () => {
    await startedAt('b1', 8, 30, 11, 46);
    renderAgora();
    const b = await banner();
    expect(within(b).getByRole('heading', { name: 'Treino' })).toBeInTheDocument();
    expect(screen.queryByText('O horário do bloco acabou')).not.toBeInTheDocument();
  });
});

describe('routine checklist', () => {
  it('all items ticked: "Concluir rotina" ends the routine, no prompt', async () => {
    const user = userEvent.setup();
    await db.blocks.put(ROUTINE);
    vi.setSystemTime(at(11, 8, 10));
    renderAgora();
    const b = await banner();
    expect(within(b).queryByRole('button', { name: 'Concluir rotina' })).not.toBeInTheDocument();
    await user.click(within(b).getByRole('checkbox', { name: 'Beber água' }));
    await user.click(within(b).getByRole('checkbox', { name: 'Separar o material' }));
    await user.click(within(b).getByRole('button', { name: 'Concluir rotina' }));
    await waitFor(async () => expect(await session('b0')).toMatchObject({ startedAt: at(11, 8, 10), endedAt: at(11, 8, 10) }));
    expect(screen.queryByRole('dialog', { name: 'Onde parou?' })).not.toBeInTheDocument();
    expect(await screen.findByText('Próximo: Tech às 08:30 · 20 min livres')).toBeInTheDocument();
  });
});

describe('"Pular hoje"', () => {
  it('an unstarted block offers Começar and Pular hoje; Pular skips it with no prompt', async () => {
    const user = userEvent.setup();
    renderAgora();
    const b = await banner();
    expect(within(b).getByRole('button', { name: 'Começar bloco' })).toBeInTheDocument();
    expect(within(b).queryByRole('button', { name: 'Encerrar bloco' })).not.toBeInTheDocument();
    await user.click(within(b).getByRole('button', { name: 'Pular hoje' }));

    await waitFor(async () => expect(await session('b1')).toMatchObject({ skipped: true }));
    expect((await session('b1'))?.startedAt).toBeUndefined();
    expect(screen.queryByRole('dialog', { name: 'Onde parou?' })).not.toBeInTheDocument();
    const neutral = await said('blockSkip');
    await waitFor(() => expect(neutral).toContain(useCompanion.getState().message));
    expect(await screen.findByText('Próximo: Treino às 11:45 · 2h15 livres')).toBeInTheDocument();
  });

  it('once started, "Encerrar bloco" replaces "Pular hoje"', async () => {
    const user = userEvent.setup();
    renderAgora();
    await user.click(within(await banner()).getByRole('button', { name: 'Começar bloco' }));
    const b = await banner();
    expect(await within(b).findByRole('button', { name: 'Encerrar bloco' }, SLOW)).toBeInTheDocument();
    expect(within(b).queryByRole('button', { name: 'Pular hoje' })).not.toBeInTheDocument();
  });

  it('the Painel marks a block the user skipped as "pulado hoje"', async () => {
    await skipBlock('b1');
    render(<PainelScreen />);
    const hoje = await screen.findByRole('region', { name: 'Hoje' });
    const list = await within(hoje).findByRole('list', { name: 'Linha do tempo' });
    const tech = (await within(list).findByText('Tech')).closest('li')!;
    expect(tech).toHaveAttribute('data-state', 'skipped');
    expect(within(tech).getByText('pulado hoje')).toBeInTheDocument();
  });
});

describe('"Onde parou?" from Encerrar', () => {
  const parser = (extra: Record<string, unknown> = {}) => createMission({
    title: 'Parser de notícias', journeyId: 'j-tech', firstStep: 'Abrir o arquivo do parser', checklist: CHECKLIST, ...extra,
  });
  const openPrompt = async (user: ReturnType<typeof userEvent.setup>) => {
    renderAgora();
    await within(await screen.findByRole('region', { name: 'Missão agora' })).findByText('Parser de notícias');
    await user.click(within(await banner()).getByRole('button', { name: 'Encerrar bloco' }));
    return prompt();
  };

  it('prefills today\'s note of the block first', async () => {
    const user = userEvent.setup();
    await startedAt('b1', 8, 30, 9, 30);
    await parser();
    await saveNextAction({ blockId: 'b1', text: 'Rodar o teste do parser' });
    expect(field(await openPrompt(user))).toHaveValue('Rodar o teste do parser');
  });

  it('then the mission\'s first step, before the checklist', async () => {
    const user = userEvent.setup();
    await startedAt('b1', 8, 30, 9, 30);
    await parser();
    expect(field(await openPrompt(user))).toHaveValue('Abrir o arquivo do parser');
  });

  it('with the timer running for the block\'s mission, Encerrar finishes the timer first: one prompt', async () => {
    const user = userEvent.setup();
    await startedAt('b1', 8, 30, 9, 30);
    const m = await parser();
    useTimer.getState().start('free', { missionId: m.id });
    vi.setSystemTime(at(11, 9, 50));
    const dialog = await openPrompt(user);
    await waitFor(() => expect(useTimer.getState().status).toBe('idle'));
    const sessions = (await db.focusSessions.toArray()).filter((s) => !s.deleted);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ missionId: m.id, outcome: 'finished' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'Encerrar sem anotar' })).toBeInTheDocument();
  });
});

describe('between blocks with a commitment first', () => {
  it('names the commitment and hides "Começar Treino agora"', async () => {
    vi.setSystemTime(at(11, 11, 30));
    await createCommitment({ title: 'Dentista', date: '2026-11-11', start: '11:35', end: '11:43' });
    renderAgora();
    const between = await screen.findByRole('region', { name: 'Entre blocos' });
    expect(within(between).getByText('Próximo: Dentista às 11:35 · 5 min livres')).toBeInTheDocument();
    expect(within(between).queryByRole('button', { name: 'Começar Treino agora' })).not.toBeInTheDocument();
  });

  it('with no commitment before it, the next block and "Começar Treino agora"', async () => {
    vi.setSystemTime(at(11, 11, 30));
    renderAgora();
    const between = await screen.findByRole('region', { name: 'Entre blocos' });
    expect(within(between).getByText('Próximo: Treino às 11:45 · 15 min livres')).toBeInTheDocument();
    expect(within(between).getByRole('button', { name: 'Começar Treino agora' })).toBeInTheDocument();
  });
});

describe('status strip inside a block', () => {
  it('shows the time until the end of the block instead of the free time', async () => {
    await setDayMode('normal');
    renderAgora();
    await banner();
    expect(await screen.findByText('1h45 até o fim do bloco')).toBeInTheDocument();
    expect(screen.queryByText(/livre até/)).not.toBeInTheDocument();
  });
});

describe('mode picker', () => {
  it('Esc closes it (focus back on the chip) and so does a click outside', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    renderAgora();
    const chip = await screen.findByRole('button', { name: 'Tipo do dia: Normal' });
    await user.click(chip);
    expect(screen.getByRole('group', { name: 'Tipo do dia' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Tipo do dia' })).not.toBeInTheDocument();
    expect(chip).toHaveFocus();

    await user.click(chip);
    expect(screen.getByRole('group', { name: 'Tipo do dia' })).toBeInTheDocument();
    await user.click(await banner());
    expect(screen.queryByRole('group', { name: 'Tipo do dia' })).not.toBeInTheDocument();
  });
});

describe('focus after a tapped control goes away', () => {
  const heading = async (name: string) => within(await banner()).findByRole('heading', { name });

  it('answering the day type moves focus to the block heading', async () => {
    const user = userEvent.setup();
    renderAgora();
    const card = await screen.findByRole('region', { name: 'Como está hoje?' });
    await user.click(within(card).getByRole('button', { name: /Normal/ }));
    await waitFor(async () => expect(await heading('Tech')).toHaveFocus());
  });

  it('"Começar bloco" moves focus to the block heading', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    renderAgora();
    await user.click(within(await banner()).getByRole('button', { name: 'Começar bloco' }));
    await waitFor(async () => expect(await heading('Tech')).toHaveFocus(), SLOW);
  });

  it('picking a day type in the mode picker moves focus to the block heading', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    renderAgora();
    await user.click(await screen.findByRole('button', { name: 'Tipo do dia: Normal' }));
    await user.click(within(screen.getByRole('group', { name: 'Tipo do dia' })).getByRole('button', { name: 'Baixa energia' }));
    await waitFor(async () => expect(await heading('Tech')).toHaveFocus());
  });

  it('free day: "Normal / Baixa energia" are plain buttons; picking one focuses the main heading', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(at(14, 10)); // Saturday: no blocks
    renderAgora();
    const free = await screen.findByRole('region', { name: 'Dia livre' });
    await user.click(within(free).getByRole('button', { name: 'Quero fazer algo mesmo assim' }));
    for (const name of ['Normal', 'Baixa energia']) {
      expect(within(free).getByRole('button', { name })).not.toHaveAttribute('aria-pressed');
    }
    await user.click(within(free).getByRole('button', { name: 'Normal' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Agora' })).toHaveFocus());
  });
});

describe('timer prompt', () => {
  it('after the timer the prompt offers "Agora não"', async () => {
    const m = await createMission({ title: 'Ler capítulo' });
    render(<ResumePromptHost />);
    act(() => useResumePrompt.getState().open({ missionId: m.id, linkCurrentBlock: true }));
    const dialog = await prompt();
    expect(within(dialog).getByRole('button', { name: 'Agora não' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Encerrar sem anotar' })).not.toBeInTheDocument();
  });
});
