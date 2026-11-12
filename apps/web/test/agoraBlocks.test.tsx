import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import {
  createMission, saveWeekReview, setDayMode, setObjectives, startBlock,
} from '../src/domain/actions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { ResumePromptHost, useResumePrompt } from '../src/features/agora/ResumePrompt';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { PHRASES, renderPhrase, type PhraseCategory } from '../src/features/companion/phrases';
import { useCompanion } from '../src/features/companion/store';
import { ToastHost, useToast } from '../src/ui/Toast';
import { FIXTURE, at, block, pastXp, seedBlocks, xpBy } from './blockFixture';

beforeEach(async () => {
  // Only Date is faked: fake-indexeddb needs the real setImmediate/setTimeout.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 9, 30));
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: '2026-11-11', emptyDay: undefined });
  useResumePrompt.setState({ request: undefined });
  useCompanion.getState().clear();
  useToast.getState().dismiss();
});
afterEach(() => { vi.useRealTimers(); });

const renderAgora = () => render(<><AgoraScreen /><ResumePromptHost /><ToastHost /></>);
const banner = () => screen.findByRole('region', { name: 'Bloco atual' });
const dayCard = () => screen.queryByRole('region', { name: 'Como está hoje?' });
// startBlock reads every XP day and day state: give it room when the whole suite runs in parallel.
const SLOW = { timeout: 4000 };
/** The phrases of a category as the companion says them (name and companion filled in). */
const said = async (cat: PhraseCategory) => {
  const p = await db.profile.get('me');
  return PHRASES[cat].map((t) => renderPhrase(t, { name: p?.name, companion: p?.companionName }));
};

describe('day type', () => {
  it('a weekday without a mode asks "Como está hoje?" and the answer sets the mode', async () => {
    const user = userEvent.setup();
    renderAgora();
    const card = await screen.findByRole('region', { name: 'Como está hoje?' });
    expect(within(card).getByRole('button', { name: /Normal/ })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Recuperação/ })).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: /Baixa energia/ }));
    await waitFor(async () => expect(await db.dayState.get('2026-11-11'))
      .toMatchObject({ mode: 'low', startedAt: at(11, 9, 30) }));
    await waitFor(() => expect(dayCard()).not.toBeInTheDocument());
  });

  it('a weekday that already has a mode does not ask again', async () => {
    await setDayMode('normal');
    await createMission({ title: 'Ler um capítulo' });
    renderAgora();
    await screen.findByRole('region', { name: 'Missão agora' });
    expect(dayCard()).not.toBeInTheDocument();
  });

  it('the weekend is a free day: no suggestion, light missions folded, and "Quero fazer algo mesmo assim"', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(at(14, 10)); // Saturday
    await createMission({ title: 'Regar plantas', energy: 'light' });
    await createMission({ title: 'Projeto grande', durationMin: 120 });
    renderAgora();
    const free = await screen.findByRole('region', { name: 'Dia livre' });
    expect(within(free).getByText('Dia livre. Descanso também conta.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Missão agora' })).not.toBeInTheDocument();
    expect(screen.queryByText('Projeto grande')).not.toBeInTheDocument();
    expect(dayCard()).not.toBeInTheDocument();
    expect(within(free).getByText('Ver missões leves (1)')).toBeInTheDocument();

    await user.click(within(free).getByRole('button', { name: 'Quero fazer algo mesmo assim' }));
    await user.click(within(free).getByRole('button', { name: 'Normal' }));
    await waitFor(async () => expect((await db.dayState.get('2026-11-14'))?.mode).toBe('normal'));
    expect(await screen.findByRole('region', { name: 'Missão agora' })).toBeInTheDocument();
  });
});

describe('mode chip', () => {
  it('switches the day to low energy and the engine then filters heavy missions', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    await createMission({ title: 'Projeto pesado', energy: 'heavy', durationMin: 60 });
    await createMission({ title: 'Regar plantas', energy: 'light' });
    renderAgora();
    expect(await screen.findByText('Projeto pesado')).toBeInTheDocument();

    const chip = screen.getByRole('button', { name: 'Tipo do dia: Normal' });
    expect(screen.queryByRole('button', { name: 'Hoje está pesado' })).not.toBeInTheDocument();
    await user.click(chip);
    const picker = screen.getByRole('group', { name: 'Tipo do dia' });
    await user.click(within(picker).getByRole('button', { name: 'Baixa energia' }));
    await waitFor(async () => expect((await db.dayState.get('2026-11-11'))?.mode).toBe('low'));
    await waitFor(() => expect(screen.queryByText('Projeto pesado')).not.toBeInTheDocument());
    expect(screen.getByText('Regar plantas')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Tipo do dia: Baixa energia' })).toBeInTheDocument();
  });
});

describe('block banner', () => {
  beforeEach(async () => { await seedBlocks(); });

  it('shows the current block, its end and how much time is left', async () => {
    renderAgora();
    const b = await banner();
    expect(within(b).getByRole('heading', { name: 'Tech' })).toBeInTheDocument();
    expect(within(b).getByText('até 12:00')).toBeInTheDocument();
    expect(within(b).getByText('2h30 restantes')).toBeInTheDocument();
    expect(within(b).queryByText(/Bloco encolhido/)).not.toBeInTheDocument();
  });

  it('a late start keeps the end and says the block shrank', async () => {
    vi.setSystemTime(at(11, 10, 30));
    await startBlock('b1');
    renderAgora();
    const b = await banner();
    expect(within(b).getByText('até 12:00')).toBeInTheDocument();
    expect(within(b).getByText('Bloco encolhido: 1h30 de 3h')).toBeInTheDocument();
  });

  it('"Começar bloco" awards +5 XP once and then hides', async () => {
    const user = userEvent.setup();
    const first = renderAgora();
    await user.click(within(await banner()).getByRole('button', { name: 'Começar bloco' }));
    expect(await screen.findByText('Bloco iniciado · +5 XP', {}, SLOW)).toBeInTheDocument();
    await waitFor(async () => expect(await xpBy('block')).toBe(5));
    await waitFor(async () => expect(within(await banner()).queryByRole('button', { name: 'Começar bloco' }))
      .not.toBeInTheDocument());
    const blockStart = await said('blockStart');
    await waitFor(() => expect(blockStart).toContain(useCompanion.getState().message), SLOW);
    first.unmount();

    renderAgora();
    const b = await banner();
    expect(within(b).queryByRole('button', { name: 'Começar bloco' })).not.toBeInTheDocument();
    expect(await xpBy('block')).toBe(5);
    expect(await xpBy('resumption')).toBe(0);
  });

  it('starting after two quiet workdays is a resumption', async () => {
    const user = userEvent.setup();
    await pastXp('2026-11-06'); // Friday; Monday and Tuesday had nothing
    renderAgora();
    await user.click(within(await banner()).getByRole('button', { name: 'Começar bloco' }));
    expect(await screen.findByText('Bloco iniciado · +5 XP · Retomada · +10 XP', {}, SLOW)).toBeInTheDocument();
    await waitFor(async () => expect(await xpBy('resumption')).toBe(10));
    const resumption = await said('resumption');
    await waitFor(() => expect(resumption).toContain(useCompanion.getState().message), SLOW);
  });

  it('"Versão mínima" switches the version of today\'s session', async () => {
    const user = userEvent.setup();
    renderAgora();
    const toggle = within(await banner()).getByRole('button', { name: 'Versão mínima' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    await waitFor(async () => expect((await db.blockSessions.get('bs-b1-2026-11-11'))?.version).toBe('minimum'));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
  });

  it('shows the week objective of the block (checkable, +10 XP); the experiment sits above, once', async () => {
    const user = userEvent.setup();
    await setObjectives('2026-11-09', [
      { blockId: 'b1', text: 'Fechar a ingestão', done: false },
      { blockId: 'b2', text: 'Treinar 4×', done: false },
    ]);
    await saveWeekReview('2026-11-09', { worked: '', obstacle: '', adjustment: 'Começar pelo teste' });
    renderAgora();
    const b = await banner();
    expect(await screen.findByText('Experimento da semana: Começar pelo teste')).toBeInTheDocument();
    expect(within(b).queryByText(/Experimento da semana/)).not.toBeInTheDocument();
    expect(await within(b).findByRole('checkbox', { name: 'Fechar a ingestão' })).toBeInTheDocument();
    expect(within(b).queryByText('Treinar 4×')).not.toBeInTheDocument();
    await user.click(within(b).getByRole('checkbox', { name: 'Fechar a ingestão' }));
    await waitFor(async () => expect(await xpBy('objective')).toBe(10));
    expect(await within(b).findByRole('checkbox', { name: 'Fechar a ingestão' })).toBeChecked();
  });

  it('a routine block shows its checklist instead of a mission, ticks kept for the day', async () => {
    const user = userEvent.setup();
    await db.blocks.put(block({
      id: 'b0', name: 'Início do dia', order: -1, targetStart: '08:30', durationMin: 30, minimumMin: 15, kind: 'routine',
      checklist: [{ id: 'c1', text: 'Higiene', done: false }, { id: 'c2', text: 'Café', done: false }],
    }));
    await createMission({ title: 'Ler um capítulo' });
    vi.setSystemTime(at(11, 8, 40));
    const first = renderAgora();
    const b = await banner();
    expect(within(b).getByRole('heading', { name: 'Início do dia' })).toBeInTheDocument();
    await user.click(within(b).getByRole('checkbox', { name: 'Higiene' }));
    expect(within(b).getByRole('checkbox', { name: 'Higiene' })).toBeChecked();
    expect(screen.queryByRole('region', { name: 'Missão agora' })).not.toBeInTheDocument();
    first.unmount();

    renderAgora();
    expect(within(await banner()).getByRole('checkbox', { name: 'Higiene' })).toBeChecked();
    expect(within(await banner()).getByRole('checkbox', { name: 'Café' })).not.toBeChecked();
  });

  it('between blocks shows the next one, the free minutes and only missions that fit', async () => {
    // No day start recorded: Tech (09:00–12:00) is over, Treino is next. (Answering the day card
    // now would start the day at 12:15 and shrink Tech into the next 45 minutes instead.)
    vi.setSystemTime(at(11, 12, 15));
    await createMission({ title: 'Responder e-mail', durationMin: 10 });
    await createMission({ title: 'Estudar SQL', durationMin: 60 });
    renderAgora();
    const between = await screen.findByRole('region', { name: 'Entre blocos' });
    expect(within(between).getByText('Próximo: Treino às 12:30 · 15 min livres')).toBeInTheDocument();
    expect(await within(between).findByText('Responder e-mail')).toBeInTheDocument();
    expect(screen.queryByText('Estudar SQL')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Bloco atual' })).not.toBeInTheDocument();
  });

  it('a free day shows no block even when blocks exist for that weekday', async () => {
    await db.blocks.bulkPut(FIXTURE.map((b) => ({ ...b, weekdays: [0, 1, 2, 3, 4, 5, 6] })));
    vi.setSystemTime(at(14, 9, 30));
    renderAgora();
    expect(await screen.findByRole('region', { name: 'Dia livre' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Bloco atual' })).not.toBeInTheDocument();
  });
});
