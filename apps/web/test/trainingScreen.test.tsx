import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockOccurrence, TrainingLog } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { addSet, applyFiveDaySplit } from '../src/domain/trainingActions';
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
    await user.type(within(a).getByLabelText('Repetições'), '10');
    await user.type(within(a).getByLabelText('Carga (kg)'), '80');
    await user.click(within(a).getByRole('button', { name: 'Salvar série de Agachamento livre' }));
    expect(await within(a).findByText('Série 1: 10 × 80 kg')).toBeInTheDocument();
    expect(within(a).getByText('Feito')).toBeInTheDocument();
    expect(within(a).getByLabelText('Repetições')).toHaveValue('10');
    expect(within(a).getByLabelText('Carga (kg)')).toHaveValue('80');
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
    const reps = within(a).getByLabelText('Repetições da série 1');
    await user.clear(reps);
    await user.type(reps, '8');
    await user.click(within(a).getByRole('button', { name: 'Salvar' }));
    expect(await within(a).findByText('Série 1: 8 × 80 kg')).toBeInTheDocument();
  });

  it('an invalid set shows the alert and writes nothing', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    renderScreen();
    const a = await card('Agachamento livre');
    await user.type(within(a).getByLabelText('Repetições'), '0');
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
    await user.click(within(e).getByRole('button', { name: 'Troquei por…' }));
    await user.type(within(e).getByLabelText('Troquei por'), 'Afundo');
    await user.click(within(e).getByRole('button', { name: 'Salvar troca' }));
    expect(await within(e).findByText('Trocado por Afundo')).toBeInTheDocument();
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

  it('cardio: saves with XP and shows the text', async () => {
    const user = userEvent.setup();
    renderScreen();
    const section = (await screen.findByRole('heading', { name: 'Cardio' })).closest('section')!;
    await user.type(within(section).getByLabelText('Minutos'), '20');
    await user.selectOptions(within(section).getByLabelText('Intensidade (1 a 10, opcional)'), '6');
    await user.click(within(section).getByRole('button', { name: 'Salvar cardio' }));
    expect(await within(section).findByText('Bicicleta ergométrica · 20 min · intensidade 6')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Cardio registrado · +8 XP');
  });

  it('"Terminei o treino" logs the workout, toasts and closes', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    renderScreen();
    const field = await screen.findByLabelText('Minutos de treino');
    await user.clear(field);
    await user.type(field, '75');
    await user.click(screen.getByRole('button', { name: 'Terminei o treino' }));
    expect(await screen.findByText('Treino encerrado às 12:40.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Treino registrado · +5 XP');
  });

  it('a rest day and a missing plan', async () => {
    vi.setSystemTime(at(14, 12, 40));
    await applyFiveDaySplit();
    const view = renderScreen();
    expect(await screen.findByText('Descanso da musculação.')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar cardio' })).toBeInTheDocument();
    view.unmount();
    await db.trainingPlans.clear();
    renderScreen();
    expect(await screen.findByText('Ainda não há plano de treino.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Montar o plano' })).toHaveAttribute('href', '/corpo');
  });

  it('another day by ?dia=', async () => {
    window.history.pushState(null, '', '/corpo/treino?dia=2026-11-04');
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Treino de qua 04/11', level: 1 })).toBeInTheDocument();
  });
});

describe('bloco Treino do Agora', () => {
  const TREINO = block({
    id: 'b2', name: 'Treino', order: 1, targetStart: '12:30', durationMin: 120, minimumMin: 45, kind: 'body', areaId: 'area-vigor',
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
    expect(screen.getByRole('link', { name: 'Abrir treino' })).toHaveAttribute('href', '/corpo/treino?bloco=b2&min=10');
  });

  it('shows the count once there is a log', async () => {
    await applyFiveDaySplit();
    await addSet('2026-11-11', 'p0', { reps: 10 });
    render(<BodyBlockPanel occurrence={occurrence(11)} now={Date.now()} />);
    expect(await screen.findByText('Treino de hoje: Pernas · 1 de 6 exercícios')).toBeInTheDocument();
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
