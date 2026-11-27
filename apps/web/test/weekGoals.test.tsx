import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockSession, GoalDraft, Journey, XpEvent } from '@life/shared';
import { newGoalDraft } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { createMission, setDayMode } from '../src/domain/actions';
import { createGoal } from '../src/domain/goalActions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { useCompanion } from '../src/features/companion/store';
import { useWeekSession } from '../src/features/week/weekCycle';
import { ToastHost } from '../src/ui/Toast';
import { at, seedBlocks } from './blockFixture';

// Monday 2026-11-16 (week '2026-11-16'); last week is 2026-11-09 … 15. "Tech" (b1) belongs to the journey j-tech.
const WEEK = '2026-11-16';
const base = { createdAt: 1, updatedAt: 1, deleted: false };
const session = (blockId: string, d: number): BlockSession => {
  const day = `2026-11-${String(d).padStart(2, '0')}`;
  return { ...base, id: `bs-${blockId}-${day}`, blockId, day, startedAt: at(d, 9), endedAt: at(d, 9, 40), version: 'normal' };
};
const xp = (id: string, dayKey: string): XpEvent => ({ ...base, id, at: 1, amount: 5, reason: 'block', dayKey });
const goal = (title: string, p: Partial<GoalDraft> = {}) => createGoal({ ...newGoalDraft(), title, ...p });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(16, 9, 30));
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: WEEK, emptyDay: undefined });
  useWeekSession.setState({ dismissed: undefined, opened: undefined, started: undefined });
  useCompanion.getState().clear();
  await db.blockSessions.bulkPut([session('b1', 9), session('b1', 10)]);
  await db.xpEvents.bulkPut([xp('x1', '2026-11-09'), xp('x2', '2026-11-10')]);
  await setDayMode('normal');
});
afterEach(() => { vi.useRealTimers(); });

const openCard = async (user: ReturnType<typeof userEvent.setup>) => {
  render(<><AgoraScreen /><ToastHost /></>);
  const card = await screen.findByRole('region', { name: 'Nova semana' }, { timeout: 3000 });
  await user.click(within(card).getByRole('button', { name: 'Começar' }));
  return card;
};

describe('"Avançou nos seus objetivos?" in the Nova semana', () => {
  it('per active goal: what was linked last week and the chips; only the tapped ones are saved', async () => {
    const user = userEvent.setup();
    const { goal: career } = await goal('Carreira em Dados');
    await goal('Saúde');
    await goal('Inglês', { status: 'pausado' });
    await put('journeys', newRecord<Journey>({ id: 'j-tech', title: 'Tech News', status: 'active', order: 0, goalId: career.id }));
    await createMission({ title: 'Coletor', journeyId: 'j-tech', status: 'done', completedAt: at(11, 15) });
    const card = await openCard(user);
    expect(await within(card).findByRole('heading', { name: 'Avançou nos seus objetivos?' })).toBeInTheDocument();
    expect(within(card).getByText('Na semana passada, do seu jeito. Tudo opcional.')).toBeInTheDocument();
    const c = within(card).getByRole('group', { name: 'Carreira em Dados' });
    expect(within(c).getByText('Ligado a ele na semana passada: 1 missão concluída · 2 blocos iniciados.')).toBeInTheDocument();
    const h = within(card).getByRole('group', { name: 'Saúde' });
    expect(within(h).getByText('Sem registro ligado a ele na semana passada.')).toBeInTheDocument();
    expect(within(card).queryByRole('group', { name: 'Inglês' })).not.toBeInTheDocument();
    await user.click(within(c).getByRole('button', { name: 'Um pouco' }));
    expect(within(c).getByRole('button', { name: 'Um pouco' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(h).getByRole('button', { name: 'Sim' }));
    await user.click(within(h).getByRole('button', { name: 'Sim' }));   // tapped again: cleared
    expect(within(h).getByRole('button', { name: 'Sim' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(within(card).getByRole('button', { name: 'Salvar e continuar' }));
    await waitFor(async () => expect((await db.weeks.get(WEEK))?.review?.goals).toEqual({ [career.id]: 'um-pouco' }));
    expect(await within(await screen.findByRole('region', { name: 'Nova semana' })).findByRole('heading', { name: 'Objetivos da semana' }))
      .toBeInTheDocument();
  }, 15_000);

  it('the taps stay in the draft through "Fazer depois"; nothing tapped saves no goals', async () => {
    const user = userEvent.setup();
    await goal('Carreira em Dados');
    let card = await openCard(user);
    await user.click(within(await within(card).findByRole('group', { name: 'Carreira em Dados' })).getByRole('button', { name: 'Sim' }));
    await user.click(within(card).getByRole('button', { name: 'Fazer depois' }));
    await user.click(await screen.findByRole('button', { name: 'Nova semana' }));
    card = await screen.findByRole('region', { name: 'Nova semana' });
    const group = await within(card).findByRole('group', { name: 'Carreira em Dados' });
    expect(within(group).getByRole('button', { name: 'Sim' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(group).getByRole('button', { name: 'Sim' }));
    await user.click(within(card).getByRole('button', { name: 'Salvar e continuar' }));
    await waitFor(async () => expect((await db.weeks.get(WEEK))?.review).toBeDefined());
    expect((await db.weeks.get(WEEK))!.review!.goals).toBeUndefined();
  }, 15_000);

  it('without an active goal there is no section', async () => {
    const user = userEvent.setup();
    const card = await openCard(user);
    expect(await within(card).findByRole('heading', { name: 'Sua leitura' })).toBeInTheDocument();
    expect(within(card).queryByRole('heading', { name: 'Avançou nos seus objetivos?' })).not.toBeInTheDocument();
  });
});
