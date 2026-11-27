import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockOccurrence, BlockSession, TrainingLog } from '@life/shared';
import { db } from '../src/db/db';
import { refreshNow } from '../src/db/hooks';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { addSet, applyFiveDaySplit, saveTrainingPlan } from '../src/domain/trainingActions';
import { BodyBlockPanel } from '../src/features/corpo/BodyBlockPanel';
import { TrainingScreen } from '../src/features/corpo/TrainingScreen';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at, block } from './blockFixture';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 12, 40));
  window.history.pushState(null, '', '/corpo/treino');
  await db.delete(); await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
});
afterEach(() => { vi.useRealTimers(); });

const renderScreen = () => render(<><TrainingScreen /><ToastHost /></>);
const card = async (name: string) => {
  const articles = await screen.findAllByRole('article');
  const found = articles.find((a) => within(a).queryByRole('heading', { name }));
  if (!found) throw new Error(`no article for ${name}`);
  return found;
};

describe('Treino de hoje', () => {
  it('draws the plan without writing anything', async () => {
    await applyFiveDaySplit();
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Treino de hoje', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('Pernas')).toBeInTheDocument();
    expect(await screen.findAllByRole('article')).toHaveLength(6);
    expect(await db.trainingLogs.count()).toBe(0);
  });

  it('shows the last session as a reference only', async () => {
    await applyFiveDaySplit();
    await put('trainingLogs', newRecord<TrainingLog>({
      id: 'training-2026-11-04', day: '2026-11-04', planName: 'Pernas',
      exercises: [{ id: 'p0', name: 'Agachamento livre', status: 'feito', sets: [{ reps: 10, kg: 40 }, { reps: 10, kg: 40 }, { reps: 10, kg: 40 }] }],
    }));
    renderScreen();
    const a = await card('Agachamento livre');
    expect(within(a).getByText('Última: 3 × 10 · 40 kg')).toBeInTheDocument();
    expect(within(a).queryByText(/^Série 1/)).not.toBeInTheDocument();
    expect(await db.trainingLogs.get('training-2026-11-11')).toBeUndefined();
  });

  it('saves a set, keeps the fields for the next one and deletes it', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    renderScreen();
    const a = await card('Agachamento livre');
    await user.type(within(a).getByLabelText('Repetições de Agachamento livre'), '10');
    await user.type(within(a).getByLabelText('Carga (kg) de Agachamento livre'), '80');
    await user.click(within(a).getByRole('button', { name: 'Salvar série de Agachamento livre' }));
    expect(await within(a).findByText('Série 1: 10 × 80 kg')).toBeInTheDocument();
    expect(within(a).getByText('Feito')).toBeInTheDocument();
    expect(within(a).getByLabelText('Repetições de Agachamento livre')).toHaveValue('10');
    expect(within(a).getByLabelText('Carga (kg) de Agachamento livre')).toHaveValue('80');
    await user.click(within(a).getByRole('button', { name: 'Apagar série 1 de Agachamento livre' }));
    await waitFor(() => expect(within(a).queryByText('Série 1: 10 × 80 kg')).not.toBeInTheDocument());
  });

  it('edits a set', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    await addSet('2026-11-11', 'p0', { reps: 10, kg: 80 });
    renderScreen();
    const a = await card('Agachamento livre');
    await user.click(await within(a).findByRole('button', { name: 'Editar série 1 de Agachamento livre' }));
    const reps = within(a).getByLabelText('Repetições da série 1 de Agachamento livre');
    await user.clear(reps);
    await user.type(reps, '8');
    await user.click(within(a).getByRole('button', { name: 'Salvar série 1 de Agachamento livre' }));
    expect(await within(a).findByText('Série 1: 8 × 80 kg')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(within(a).getByRole('heading', { name: 'Agachamento livre' })));
  });

  it('an invalid set shows the alert and writes nothing', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    renderScreen();
    const a = await card('Agachamento livre');
    await user.type(within(a).getByLabelText('Repetições de Agachamento livre'), '0');
    await user.click(within(a).getByRole('button', { name: 'Salvar série de Agachamento livre' }));
    expect(await within(a).findByRole('alert')).toHaveTextContent('Repetições: um número inteiro de 1 a 100.');
    expect(await db.trainingLogs.count()).toBe(0);
  });

  it('skip and undo; swap', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    renderScreen();
    const p = await card('Panturrilha em pé');
    await user.click(within(p).getByRole('button', { name: 'Pulei Panturrilha em pé' }));
    expect(await within(p).findByText('Pulado')).toBeInTheDocument();
    await user.click(within(p).getByRole('button', { name: 'Desfazer pulado de Panturrilha em pé' }));
    await waitFor(() => expect(within(p).queryByText('Pulado')).not.toBeInTheDocument());
    const e = await card('Cadeira extensora');
    await user.click(within(e).getByRole('button', { name: 'Troquei por… Cadeira extensora' }));
    await user.type(within(e).getByLabelText('Troquei Cadeira extensora por'), 'Afundo');
    await user.click(within(e).getByRole('button', { name: 'Salvar troca de Cadeira extensora' }));
    expect(await within(e).findByText('Trocado por Afundo')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(within(e).getByRole('button', { name: 'Troquei por… Cadeira extensora' })));
  });

  it('adds and removes an extra exercise', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    renderScreen();
    await screen.findAllByRole('article');
    await user.type(screen.getByLabelText('Exercício fora do plano'), 'prancha');
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(7));
    const x = await card('Prancha');
    await user.click(within(x).getByRole('button', { name: 'Remover Prancha' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(6));
  });

  it('cardio: saves with XP and shows the text; focus goes to the Cardio heading', async () => {
    const user = userEvent.setup();
    renderScreen();
    const heading = await screen.findByRole('heading', { name: 'Cardio' });
    const section = heading.closest('section')!;
    await user.type(within(section).getByLabelText('Minutos'), '20');
    await user.selectOptions(within(section).getByLabelText('Intensidade (1 a 10, opcional)'), '6');
    await user.click(within(section).getByRole('button', { name: 'Salvar cardio' }));
    expect(await within(section).findByText('Bicicleta ergométrica · 20 min · intensidade 6')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Cardio registrado · +8 XP');
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('"Terminei o treino" logs the workout, toasts and closes; focus goes to the closed state', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    await addSet('2026-11-11', 'p0', { reps: 10 });
    renderScreen();
    const field = await screen.findByLabelText('Minutos de treino');
    await user.clear(field);
    await user.type(field, '75');
    await user.click(screen.getByRole('button', { name: 'Terminei o treino' }));
    const closed = await screen.findByText('Treino encerrado às 12:40.');
    expect(screen.getByRole('status')).toHaveTextContent('Treino registrado · +5 XP');
    await waitFor(() => expect(document.activeElement).toBe(closed));
  });

  it('"Terminei o treino" only once something was done: a set or an extra exercise (the cardio has its own save)', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    renderScreen();
    await screen.findAllByRole('article');
    expect(screen.queryByRole('button', { name: 'Terminei o treino' })).not.toBeInTheDocument();
    const p = await card('Panturrilha em pé');
    await user.click(within(p).getByRole('button', { name: 'Pulei Panturrilha em pé' }));
    await within(p).findByText('Pulado');
    expect(screen.queryByRole('button', { name: 'Terminei o treino' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Exercício fora do plano'), 'prancha');
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(await screen.findByRole('button', { name: 'Terminei o treino' })).toBeInTheDocument();
  });

  it('a rest day and a missing plan: cardio and "Exercício fora do plano", no "Terminei" yet', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(at(14, 12, 40));
    await applyFiveDaySplit();
    const view = renderScreen();
    expect(await screen.findByText('Descanso da musculação.')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar cardio' })).toBeInTheDocument();
    expect(screen.getByLabelText('Exercício fora do plano')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Terminei o treino' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Exercício fora do plano'), 'mobilidade');
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(await card('Mobilidade')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Terminei o treino' })).toBeInTheDocument();
    view.unmount();
    await db.trainingPlans.clear();
    await db.trainingLogs.clear();
    renderScreen();
    expect(await screen.findByText('Ainda não há plano de treino.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Montar o plano' })).toHaveAttribute('href', '/corpo');
    expect(screen.getByLabelText('Exercício fora do plano')).toBeInTheDocument();
  });

  it('another day by ?dia=', async () => {
    window.history.pushState(null, '', '/corpo/treino?dia=2026-11-04');
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Treino de qua 04/11', level: 1 })).toBeInTheDocument();
  });
});

describe('revisão — treino', () => {
  it('a plan day with a name and no exercises shows the name, not "Descanso"', async () => {
    vi.setSystemTime(at(14, 12, 40));
    await applyFiveDaySplit();
    const plan = (await db.trainingPlans.get('plan'))!;
    await saveTrainingPlan([...plan.days, { weekday: 6, name: 'Mobilidade', exercises: [] }]);
    renderScreen();
    expect(await screen.findByText('Mobilidade')).toBeInTheDocument();
    expect(screen.queryByText('Descanso da musculação.')).not.toBeInTheDocument();
  });

  it('removing an earlier set closes the set editor', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    for (const reps of [10, 9, 8]) await addSet('2026-11-11', 'p0', { reps, kg: 80 });
    renderScreen();
    const a = await card('Agachamento livre');
    await user.click(await within(a).findByRole('button', { name: 'Editar série 2 de Agachamento livre' }));
    expect(within(a).getByLabelText('Repetições da série 2 de Agachamento livre')).toBeInTheDocument();
    await user.click(within(a).getByRole('button', { name: 'Apagar série 1 de Agachamento livre' }));
    expect(await within(a).findByText('Série 2: 8 × 80 kg')).toBeInTheDocument();
    expect(within(a).getByText('Série 1: 9 × 80 kg')).toBeInTheDocument();
    expect(within(a).queryByLabelText(/^Repetições da série/)).not.toBeInTheDocument();
  });

  it('the 21st set shows the inline message and writes nothing', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    for (let i = 0; i < 20; i++) await addSet('2026-11-11', 'p0', { reps: 5 });
    renderScreen();
    const a = await card('Agachamento livre');
    await user.type(within(a).getByLabelText('Repetições de Agachamento livre'), '5');
    await user.click(within(a).getByRole('button', { name: 'Salvar série de Agachamento livre' }));
    expect(await within(a).findByRole('alert')).toHaveTextContent('No máximo 20 séries por exercício.');
    expect((await db.trainingLogs.get('training-2026-11-11'))!.exercises[0]!.sets).toHaveLength(20);
    expect(screen.queryByText('Algo não funcionou. Tente de novo.')).not.toBeInTheDocument();
  });

  it('swap and extra name inputs are limited to 80 characters', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    renderScreen();
    const e = await card('Cadeira extensora');
    await user.click(within(e).getByRole('button', { name: 'Troquei por… Cadeira extensora' }));
    expect(within(e).getByLabelText('Troquei Cadeira extensora por')).toHaveAttribute('maxlength', '80');
    expect(screen.getByLabelText('Exercício fora do plano')).toHaveAttribute('maxlength', '80');
  });

  it('"Desfazer" after "Terminei" removes the workout it created', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    await addSet('2026-11-11', 'p0', { reps: 10 });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Terminei o treino' }));
    expect(await screen.findByText('Treino encerrado às 12:40.')).toBeInTheDocument();
    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Desfazer' }));
    await waitFor(async () => expect((await db.workouts.toArray()).filter((w) => !w.deleted)).toHaveLength(0));
    expect(await screen.findByRole('button', { name: 'Terminei o treino' })).toBeInTheDocument();
  });

  it('"Reabrir" brings the footer back and keeps the workout', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    await addSet('2026-11-11', 'p0', { reps: 10 });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Terminei o treino' }));
    await user.click(await screen.findByRole('button', { name: 'Reabrir' }));
    expect(await screen.findByRole('button', { name: 'Terminei o treino' })).toBeInTheDocument();
    expect((await db.workouts.toArray()).filter((w) => !w.deleted)).toHaveLength(1);
  });

  it('editing the cardio minutes keeps one live workout and the XP', async () => {
    const user = userEvent.setup();
    renderScreen();
    const section = (await screen.findByRole('heading', { name: 'Cardio' })).closest('section')!;
    await user.type(within(section).getByLabelText('Minutos'), '20');
    await user.click(within(section).getByRole('button', { name: 'Salvar cardio' }));
    await user.click(await within(section).findByRole('button', { name: 'Editar cardio' }));
    const m = within(section).getByLabelText('Minutos');
    await user.clear(m);
    await user.type(m, '35');
    await user.click(within(section).getByRole('button', { name: 'Salvar cardio' }));
    expect(await within(section).findByText('Bicicleta ergométrica · 35 min')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Cardio atualizado.');
    const live = (await db.workouts.toArray()).filter((w) => !w.deleted);
    expect(live).toHaveLength(1);
    expect(live[0]!.minutes).toBe(35);
    const xp = (await db.xpEvents.toArray()).filter((x) => !x.deleted && x.reason === 'workout');
    expect(xp.map((x) => x.amount)).toEqual([8]);
  });

  it('a past day (?dia=): "Terminei" and the cardio create the workouts without XP', async () => {
    const user = userEvent.setup();
    window.history.pushState(null, '', '/corpo/treino?dia=2026-11-04');
    await applyFiveDaySplit();
    await addSet('2026-11-04', 'p0', { reps: 10 });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Terminei o treino' }));
    expect(await screen.findByText(/^Treino encerrado às/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Treino registrado.');
    const section = (await screen.findByRole('heading', { name: 'Cardio' })).closest('section')!;
    await user.type(within(section).getByLabelText('Minutos'), '25');
    await user.click(within(section).getByRole('button', { name: 'Salvar cardio' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Cardio registrado.'));
    const live = (await db.workouts.toArray()).filter((w) => !w.deleted);
    expect(live.map((w) => [w.kind, w.day]).sort()).toEqual([['cardio', '2026-11-04'], ['musculacao', '2026-11-04']]);
    expect((await db.xpEvents.toArray()).filter((x) => !x.deleted)).toEqual([]);
  });

  it('?bloco=: the minutes follow the block session live until the field is edited; 60 without a session', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    await addSet('2026-11-11', 'p0', { reps: 10 });
    await put('blockSessions', newRecord<BlockSession>({
      id: 'bs-b2-2026-11-11', blockId: 'b2', day: '2026-11-11', startedAt: at(11, 12, 30), version: 'normal',
    }));
    window.history.pushState(null, '', '/corpo/treino?bloco=b2');
    const view = renderScreen();
    const field = await screen.findByLabelText('Minutos de treino');
    await waitFor(() => expect(field).toHaveValue(10));
    vi.setSystemTime(at(11, 13, 25));
    act(() => refreshNow());
    await waitFor(() => expect(field).toHaveValue(55));
    await user.clear(field);
    await user.type(field, '50');
    vi.setSystemTime(at(11, 13, 40));
    act(() => refreshNow());
    expect(field).toHaveValue(50);
    view.unmount();
    window.history.pushState(null, '', '/corpo/treino?bloco=outro');
    renderScreen();
    expect(await screen.findByLabelText('Minutos de treino')).toHaveValue(60);
  });

  it('sets and clears a "Como foi?" chip', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByText('Como foi? (opcional)'));
    const group = screen.getByRole('group', { name: 'Esforço' });
    await user.click(within(group).getByRole('button', { name: '4' }));
    await waitFor(async () => expect((await db.trainingLogs.get('training-2026-11-11'))!.effort).toBe(4));
    await waitFor(() => expect(within(group).getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'true'));
    await user.click(within(group).getByRole('button', { name: '4' }));
    await waitFor(async () => expect((await db.trainingLogs.get('training-2026-11-11'))!.effort).toBeUndefined());
  });
});

describe('bloco Treino do Agora', () => {
  const TREINO = block({
    id: 'b2', name: 'Treino', order: 1, targetStart: '11:45', durationMin: 90, minimumMin: 35, kind: 'body', areaId: 'area-vigor',
  });
  const occurrence = (day: number): BlockOccurrence => ({
    block: TREINO, day: `2026-11-${day}`, plannedStart: at(day, 12, 30), plannedEnd: at(day, 14, 30),
    start: at(day, 12, 30), end: at(day, 14, 30), version: 'normal', shrunk: false, state: 'current',
    session: {
      id: `bs-b2-2026-11-${day}`, createdAt: 1, updatedAt: 1, deleted: false, blockId: 'b2', day: `2026-11-${day}`,
      startedAt: at(day, 12, 30), version: 'normal',
    },
  });

  it('shows the training of the day and the link', async () => {
    await applyFiveDaySplit();
    render(<BodyBlockPanel occurrence={occurrence(11)} now={Date.now()} />);
    expect(await screen.findByText('Treino de hoje: Pernas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir treino' })).toHaveAttribute('href', '/corpo/treino?bloco=b2');
  });

  it('shows the count once there is a log', async () => {
    await applyFiveDaySplit();
    await addSet('2026-11-11', 'p0', { reps: 10 });
    render(<BodyBlockPanel occurrence={occurrence(11)} now={Date.now()} />);
    expect(await screen.findByText('Treino de hoje: Pernas · 1 de 6 exercícios')).toBeInTheDocument();
  });

  it('a name-only plan day shows its name, not "Descanso"', async () => {
    vi.setSystemTime(at(14, 12, 40));
    await applyFiveDaySplit();
    const plan = (await db.trainingPlans.get('plan'))!;
    await saveTrainingPlan([...plan.days, { weekday: 6, name: 'Mobilidade', exercises: [] }]);
    render(<BodyBlockPanel occurrence={occurrence(14)} now={Date.now()} />);
    expect(await screen.findByText('Treino de hoje: Mobilidade')).toBeInTheDocument();
    expect(screen.queryByText('Descanso da musculação.')).not.toBeInTheDocument();
  });

  it('rest day and no plan', async () => {
    vi.setSystemTime(at(14, 12, 40));
    await applyFiveDaySplit();
    const view = render(<BodyBlockPanel occurrence={occurrence(14)} now={Date.now()} />);
    expect(await screen.findByText('Descanso da musculação.')).toBeInTheDocument();
    view.unmount();
    await db.trainingPlans.clear();
    render(<BodyBlockPanel occurrence={occurrence(14)} now={Date.now()} />);
    await screen.findByRole('group', { name: 'Treino de hoje' });
    expect(screen.queryByText('Descanso da musculação.')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Abrir treino' })).not.toBeInTheDocument();
  });
});

describe('Treino detalhado (2026-11-25)', () => {
  const BLOCK = { startDay: '2026-11-09', weeks: [{ rirMin: 3, rirMax: 3, cardioMin: 20, cardioMax: 25 }, { rirMin: 2, rirMax: 2 }] };

  it('shows the plan request, the block week and the weekly cardio target', async () => {
    await applyFiveDaySplit();
    await saveTrainingPlan((await db.trainingPlans.get('plan'))!.days, BLOCK);
    renderScreen();
    const a = await card('Agachamento livre');
    expect(within(a).getByText('3 × 6–10 · descanso 2–3 min')).toBeInTheDocument();
    expect(screen.getByText('Semana 1 de 2 · RIR ~3 · cardio 20–25 min')).toBeInTheDocument();
    expect(screen.getByText('Meta da semana: 20–25 min')).toBeInTheDocument();
  });

  it('saves the RIR of a set from its buttons, shows it and starts the rest countdown', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    renderScreen();
    const a = await card('Agachamento livre');
    await user.type(within(a).getByLabelText('Repetições de Agachamento livre'), '8');
    await user.type(within(a).getByLabelText('Carga (kg) de Agachamento livre'), '60');
    await user.click(within(within(a).getByRole('group', { name: 'RIR da próxima série de Agachamento livre' })).getByRole('button', { name: 'RIR 2' }));
    await user.click(within(a).getByRole('button', { name: 'Salvar série de Agachamento livre' }));
    await waitFor(async () => expect((await db.trainingLogs.get('training-2026-11-11'))!.exercises[0]!.sets).toEqual([{ reps: 8, kg: 60, rir: 2 }]));
    expect(await within(a).findByText('Série 1: 8 × 60 kg · RIR 2')).toBeInTheDocument();
    const bar = screen.getByRole('region', { name: 'Descanso' });
    expect(within(bar).getByText('2:00')).toBeInTheDocument();
    expect(within(bar).getByText('Descanso · Agachamento livre')).toBeInTheDocument();
    vi.setSystemTime(at(11, 12, 42) + 1000);
    expect(await within(bar).findByText('Pode ir', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(within(bar).getByText('até 3:00 · Agachamento livre')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Pular' }));
    expect(screen.queryByRole('region', { name: 'Descanso' })).not.toBeInTheDocument();
  });

  it('tags the exercise when the last session reached the top of the range at the week RIR', async () => {
    await applyFiveDaySplit();
    await saveTrainingPlan((await db.trainingPlans.get('plan'))!.days, BLOCK);
    await put('trainingLogs', newRecord<TrainingLog>({
      id: 'training-2026-11-10', day: '2026-11-10', planName: 'Costas e bíceps',
      target: { week: 1, weeks: 2, rirMin: 3, rirMax: 3 },
      exercises: [{ id: 'p0', name: 'Agachamento livre', status: 'feito', planned: { sets: 3, repsMin: 6, repsMax: 10 },
        sets: [{ reps: 10, kg: 60, rir: 3 }, { reps: 10, kg: 60, rir: 3 }, { reps: 10, kg: 60, rir: 4 }] }],
    }));
    renderScreen();
    const a = await card('Agachamento livre');
    expect(within(a).getByText('Pronto para subir a carga')).toBeInTheDocument();
    expect(within(a).getByText(/Na última \(ter 10\/11\): 3 × 10 · 60 kg, RIR 3, 3, 4\. Faixa até 10\./)).toBeInTheDocument();
    expect(within(await card('Leg press')).queryByText('Pronto para subir a carga')).not.toBeInTheDocument();
  });

  it('records a discomfort with where and a note, and removes it', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    renderScreen();
    const a = await card('Leg press');
    await user.click(within(a).getByRole('button', { name: 'Senti desconforto em Leg press' }));
    expect(within(a).getByText('Dor que persiste ou piora: procure avaliação profissional. O app só registra.')).toBeInTheDocument();
    await user.click(within(a).getByRole('button', { name: 'Joelho' }));
    await user.type(within(a).getByLabelText('Nota do desconforto em Leg press'), 'no fim da série');
    await user.click(within(a).getByRole('button', { name: 'Salvar desconforto em Leg press' }));
    expect(await within(a).findByText('desconforto: joelho (no fim da série)')).toBeInTheDocument();
    expect((await db.trainingLogs.get('training-2026-11-11'))!.exercises[1]!.discomfort).toEqual({ spot: 'joelho', note: 'no fim da série' });
    await user.click(within(a).getByRole('button', { name: 'Editar desconforto em Leg press' }));
    await user.click(within(a).getByRole('button', { name: 'Tirar desconforto' }));
    await waitFor(async () => expect((await db.trainingLogs.get('training-2026-11-11'))!.exercises[1]!.discomfort).toBeUndefined());
  });

  it('a plan saved before the detailed format (plain strings) still draws and logs', async () => {
    await put('trainingPlans', newRecord({ id: 'plan', days: [{ weekday: 3, name: 'Pernas', exercises: ['Agachamento livre', 'Leg press'] }] } as never));
    renderScreen();
    expect(await screen.findAllByRole('article')).toHaveLength(2);
    await addSet('2026-11-11', 'p1', { reps: 12 });
    expect((await db.trainingLogs.get('training-2026-11-11'))!.exercises.map((e) => e.name)).toEqual(['Agachamento livre', 'Leg press']);
  });
});
