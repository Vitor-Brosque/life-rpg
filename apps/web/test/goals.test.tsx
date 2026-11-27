import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoalDraft, Journey, Mission, Suggestion } from '@life/shared';
import { newGoalDraft } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { createMission } from '../src/domain/actions';
import { createGoal, setJourneyGoal } from '../src/domain/goalActions';
import { MainCard } from '../src/features/agora/MainCard';
import type { AgoraActions } from '../src/features/agora/useAgora';
import { JourneyDetail } from '../src/features/journeys/JourneyDetail';
import { JourneysView } from '../src/features/journeys/JourneysView';
import { MissionSheetHost, useMissionSheet } from '../src/features/mission/MissionSheet';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at } from './blockFixture';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(23, 10));
  localStorage.clear();
  useMissionSheet.setState({ openId: undefined });
  useToast.getState().dismiss();
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

const goal = (title: string, p: Partial<GoalDraft> = {}) => createGoal({ ...newGoalDraft(), title, ...p });
const journey = (title: string, p: Partial<Journey> = {}) => put('journeys', newRecord<Journey>({ title, status: 'active', order: 0, ...p }));
const dialog = (name: string) => screen.findByRole('dialog', { name });
const noopActions = {
  start: vi.fn(), complete: vi.fn(), open: vi.fn(), other: vi.fn(), shrink: vi.fn(), split: vi.fn(), drop: vi.fn(), snooze: vi.fn(),
} as unknown as AgoraActions;
const suggestionOf = (mission: Mission): Suggestion => ({ mission, score: 1, reasons: [], postponedHint: false });
const section = async (name: string) => (await screen.findByRole('heading', { name })).closest('section')!;

describe('Planejar → Objetivos', () => {
  it('goals as groups with their journeys, then "Sem objetivo"; a paused goal says so', async () => {
    const { goal: career } = await goal('Carreira em Dados', { horizon: '2027', why: 'Trabalhar com dados' });
    await goal('Inglês', { status: 'pausado' });
    await journey('Tech News', { goalId: career.id, order: 0 });
    await journey('Mudança', { order: 1 });
    render(<JourneysView />);
    const c = await section('Carreira em Dados');
    expect(within(c).getByText('2027')).toBeInTheDocument();
    expect(within(c).getByText('Trabalhar com dados')).toBeInTheDocument();
    // Journeys come from their own query: wait for them instead of reading right after the goals arrive.
    expect(await within(await within(c).findByRole('list', { name: 'Jornadas de Carreira em Dados' })).findByText('Tech News')).toBeInTheDocument();
    const p = await section('Inglês');
    expect(within(p).getByText('Pausado')).toBeInTheDocument();
    expect(within(p).getByText('Nenhuma jornada ligada ainda. Ligue uma em Nova jornada ou na ficha da jornada.')).toBeInTheDocument();
    const loose = await section('Sem objetivo');
    expect(await within(await within(loose).findByRole('list', { name: 'Jornadas sem objetivo' })).findByText('Mudança')).toBeInTheDocument();
  });

  it('without goals the journeys show as before, under "Jornadas"', async () => {
    await journey('Mudança');
    render(<JourneysView />);
    expect(await screen.findByRole('heading', { name: 'Jornadas' })).toBeInTheDocument();
    expect(await within(await screen.findByRole('list', { name: 'Jornadas ativas' })).findByText('Mudança')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sem objetivo' })).not.toBeInTheDocument();
  });

  it('"Novo objetivo" creates an active goal; opening the sheet writes nothing', async () => {
    const user = userEvent.setup();
    render(<><JourneysView /><ToastHost /></>);
    await user.click(await screen.findByRole('button', { name: 'Novo objetivo' }));
    const d = await dialog('Novo objetivo');
    const outbox = await db.outbox.count();
    expect(within(d).getByRole('button', { name: 'Criar objetivo' })).toBeDisabled();
    expect(within(d).queryByRole('group', { name: 'Situação' })).not.toBeInTheDocument();
    await user.type(within(d).getByLabelText('Objetivo'), 'Primeira vaga em Engenharia de Dados');
    await user.type(within(d).getByLabelText('Horizonte (opcional)'), '2027');
    expect(await db.outbox.count()).toBe(outbox);
    await user.click(within(d).getByRole('button', { name: 'Criar objetivo' }));
    expect(await screen.findByText('Objetivo criado.')).toBeInTheDocument();
    // The sheet has an autoFocus title: closing it still gives the focus back to the button that opened it.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Novo objetivo' })).toHaveFocus());
    expect(await db.goals.toArray()).toEqual([
      expect.objectContaining({ title: 'Primeira vaga em Engenharia de Dados', horizon: '2027', status: 'ativo' }),
    ]);
    expect(await screen.findByRole('heading', { name: 'Primeira vaga em Engenharia de Dados' })).toBeInTheDocument();
  });

  it('a sixth active goal asks which one to pause; without a choice it starts paused', async () => {
    const user = userEvent.setup();
    for (const t of ['A', 'B', 'C', 'D', 'E']) await goal(t);
    render(<><JourneysView /><ToastHost /></>);
    await user.click(await screen.findByRole('button', { name: 'Novo objetivo' }));
    let d = await dialog('Novo objetivo');
    await user.type(within(d).getByLabelText('Objetivo'), 'F');
    const ask = await within(d).findByRole('group', { name: 'Já há 5 objetivos ativos. Pausar qual? (opcional)' });
    expect(within(ask).getByText('Sem escolher, ele fica pausado.')).toBeInTheDocument();
    await user.click(within(ask).getByRole('button', { name: 'B' }));
    await user.click(within(d).getByRole('button', { name: 'Criar objetivo' }));
    expect(await screen.findByText('Objetivo criado. “B” ficou pausado.')).toBeInTheDocument();
    await waitFor(async () => expect((await db.goals.toArray()).find((g) => g.title === 'B')!.status).toBe('pausado'));
    await user.click(screen.getByRole('button', { name: 'Novo objetivo' }));
    d = await dialog('Novo objetivo');
    await user.type(within(d).getByLabelText('Objetivo'), 'G');
    await within(d).findByRole('group', { name: 'Já há 5 objetivos ativos. Pausar qual? (opcional)' });
    await user.click(within(d).getByRole('button', { name: 'Criar objetivo' }));
    expect(await screen.findByText('Objetivo criado como pausado: já há 5 ativos.')).toBeInTheDocument();
    await waitFor(async () => expect((await db.goals.toArray()).find((g) => g.title === 'G')?.status).toBe('pausado'));
  });

  it('archiving a goal with no journey moves it to "Concluídos e arquivados"; focus goes to "Novo objetivo"', async () => {
    const user = userEvent.setup();
    await goal('Antigo');
    render(<><JourneysView /><ToastHost /></>);
    await user.click(await screen.findByRole('button', { name: 'Editar objetivo Antigo' }));
    const d = await dialog('Objetivo');
    await user.click(within(within(d).getByRole('group', { name: 'Situação' })).getByRole('button', { name: 'Arquivado' }));
    await user.click(within(d).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Objetivo salvo.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Antigo' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Novo objetivo' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Mostrar concluídos e arquivados' }));
    expect(within(screen.getByRole('list', { name: 'Objetivos concluídos e arquivados' })).getByText('Antigo')).toBeInTheDocument();
  });
});

describe('the journey picks its objective by tapping', () => {
  it('Nova jornada with an objective', async () => {
    const user = userEvent.setup();
    const { goal: career } = await goal('Carreira em Dados');
    render(<JourneysView />);
    await user.click(await screen.findByRole('button', { name: 'Nova jornada' }));
    await user.type(screen.getByLabelText('Título'), 'Tech News');
    await user.click(within(await screen.findByRole('group', { name: 'Objetivo (opcional)' })).getByRole('button', { name: 'Carreira em Dados' }));
    await user.click(screen.getByRole('button', { name: 'Criar jornada' }));
    await waitFor(async () => expect((await db.journeys.toArray()).find((j) => j.title === 'Tech News')?.goalId).toBe(career.id));
  });

  it('the journey detail shows its objective and changes it with a tap', async () => {
    const user = userEvent.setup();
    const { goal: career } = await goal('Carreira em Dados');
    const j = await journey('Tech News', { goalId: career.id });
    render(<JourneyDetail id={j.id} />);
    expect(await screen.findByText('Objetivo: Carreira em Dados')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Objetivos e jornadas' })).toBeInTheDocument();
    await user.click(screen.getByText('Editar título, resultado, objetivo e área'));
    await user.click(within(screen.getByRole('group', { name: 'Objetivo' })).getByRole('button', { name: 'Sem objetivo' }));
    await waitFor(async () => expect((await db.journeys.get(j.id))!.goalId).toBeUndefined());
    await waitFor(() => expect(screen.queryByText('Objetivo: Carreira em Dados')).not.toBeInTheDocument());
  });
});

describe('the purpose chain', () => {
  it('the main card and the mission sheet show "objective › journey", spoken as "Objetivo: …, jornada: …"', async () => {
    const { goal: career } = await goal('Carreira em Dados');
    const j = await journey('Tech News', { goalId: career.id });
    const m = await createMission({ title: 'Integrar a API', journeyId: j.id });
    render(<><MainCard suggestion={suggestionOf(m)} canSkip actions={noopActions} /><MissionSheetHost /></>);
    const card = await screen.findByRole('region', { name: 'Missão agora' });
    expect(await within(card).findByText('Carreira em Dados › Tech News')).toHaveAttribute('aria-hidden', 'true');
    expect(within(card).getByText('Objetivo: Carreira em Dados, jornada: Tech News')).toHaveClass('visually-hidden');
    useMissionSheet.getState().open(m.id);
    const sheet = await dialog('Missão');
    expect(await within(sheet).findByText('Carreira em Dados › Tech News')).toBeInTheDocument();
  });

  it('a journey without objective shows no line (the same card shows it once linked, and loses it again)', async () => {
    const j = await journey('Solta');
    const m = await createMission({ title: 'Algo', journeyId: j.id });
    render(<MainCard suggestion={suggestionOf(m)} canSkip actions={noopActions} />);
    const card = await screen.findByRole('region', { name: 'Missão agora' });
    const { goal: career } = await goal('Carreira em Dados');
    await setJourneyGoal(j.id, career.id);
    expect(await within(card).findByText('Carreira em Dados › Solta')).toBeInTheDocument();
    await setJourneyGoal(j.id, undefined);
    await waitFor(() => expect(within(card).queryByText(/›/)).not.toBeInTheDocument());
  });
});
