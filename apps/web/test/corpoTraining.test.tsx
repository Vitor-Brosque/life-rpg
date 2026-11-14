import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { TrainingLog } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { logWorkout } from '../src/domain/workoutActions';
import { applyFiveDaySplit } from '../src/domain/trainingActions';
import { CorpoScreen } from '../src/features/corpo/CorpoScreen';
import { TrainingPlanScreen } from '../src/features/corpo/TrainingPlanScreen';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at } from './blockFixture';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 10));
  await db.delete(); await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
});
afterEach(() => { vi.useRealTimers(); });

function renderAt(path: string, ui: React.ReactNode) {
  const { hook, history } = memoryLocation({ path, record: true });
  const view = render(<Router hook={hook}>{ui}<ToastHost /></Router>);
  return { ...view, history };
}

const log = (day: string, exercises: TrainingLog['exercises'], planName = 'Pernas') =>
  put('trainingLogs', newRecord<TrainingLog>({ id: `training-${day}`, day, planName, exercises }));

describe('Corpo: treino de hoje', () => {
  it('offers the five-day split without writing, and creates the plan on tap', async () => {
    const user = userEvent.setup();
    renderAt('/corpo', <CorpoScreen />);
    const btn = await screen.findByRole('button', { name: 'Usar a divisão de exemplo de 5 dias' });
    expect(screen.getByText(/Segunda-feira — Peito e tríceps: Supino reto/)).toBeInTheDocument();
    expect(await db.trainingPlans.count()).toBe(0);
    await user.click(btn);
    expect(await screen.findByRole('heading', { name: 'Treino de hoje: Pernas' })).toBeInTheDocument();
    expect(screen.getByText('Plano de treino criado.')).toBeInTheDocument();
    expect((await db.trainingPlans.get('plan'))!.days).toHaveLength(5);
  });

  it('shows done and swapped exercises from today log', async () => {
    await applyFiveDaySplit();
    await log('2026-11-11', [
      { id: 'p0', name: 'Agachamento livre', status: 'feito', sets: [{ reps: 10, kg: 40 }, { reps: 10, kg: 40 }] },
      { id: 'p2', name: 'Cadeira extensora', status: 'trocado', replacedBy: 'Afundo', sets: [] },
      { id: 'p1', name: 'Leg press', sets: [] },
    ]);
    renderAt('/corpo', <CorpoScreen />);
    expect(await screen.findByText('Agachamento livre — feito (2 séries)')).toBeInTheDocument();
    expect(screen.getByText('Cadeira extensora — trocado por Afundo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir o treino de hoje' })).toHaveAttribute('href', '/corpo/treino');
    expect(screen.queryByRole('link', { name: 'Registrar o treino' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Editar plano' })).toHaveAttribute('href', '/corpo/plano');
  });

  it('says rest on Saturday and offers cardio', async () => {
    vi.setSystemTime(at(14, 10));
    await applyFiveDaySplit();
    renderAt('/corpo', <CorpoScreen />);
    expect(await screen.findByText('Descanso da musculação.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Registrar cardio' })).toHaveAttribute('href', '/corpo/treino');
  });
});

describe('Plano de treino', () => {
  it('fills the form from the split without saving, and saves only filled days', async () => {
    const user = userEvent.setup();
    const { history } = renderAt('/corpo/plano', <TrainingPlanScreen />);
    await user.click(await screen.findByRole('button', { name: 'Preencher com a divisão de exemplo de 5 dias' }));
    expect(screen.getByLabelText('Nome do treino de Segunda-feira')).toHaveValue('Peito e tríceps');
    expect(await db.trainingPlans.count()).toBe(0);
    await user.clear(screen.getByLabelText('Nome do treino de Quarta-feira'));
    await user.clear(screen.getByLabelText('Exercícios de Quarta-feira, um por linha'));
    await user.click(screen.getByRole('button', { name: 'Salvar plano' }));
    await waitFor(async () => expect(await db.trainingPlans.count()).toBe(1));
    const plan = (await db.trainingPlans.get('plan'))!;
    expect(plan.days.map((d) => d.weekday)).toEqual([1, 2, 4, 5]);
    expect(screen.getByText('Plano de treino salvo.')).toBeInTheDocument();
    expect(history.at(-1)).toBe('/corpo');
  });

  it('cancels without writing', async () => {
    const user = userEvent.setup();
    const { history } = renderAt('/corpo/plano', <TrainingPlanScreen />);
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(await db.trainingPlans.count()).toBe(0);
    expect(history.at(-1)).toBe('/corpo');
  });
});

describe('Corpo: evolução e cardio', () => {
  it('shows the empty evolution text', async () => {
    renderAt('/corpo', <CorpoScreen />);
    expect(await screen.findByText('A evolução aparece depois do primeiro treino com séries registradas.')).toBeInTheDocument();
  });

  it('shows per-exercise evolution with a link to the day', async () => {
    const user = userEvent.setup();
    await log('2026-11-04', [{ id: 'p0', name: 'Agachamento livre', status: 'feito', sets: [{ reps: 10, kg: 40 }, { reps: 10, kg: 40 }, { reps: 10, kg: 40 }] }]);
    await log('2026-11-11', [{ id: 'p0', name: 'Agachamento livre', status: 'feito', sets: [{ reps: 10, kg: 40 }, { reps: 8, kg: 45 }, { reps: 9, kg: 45 }] }]);
    renderAt('/corpo', <CorpoScreen />);
    const summary = await screen.findByText('Agachamento livre · 2 sessões · última 11/11');
    await user.click(summary);
    expect(screen.getByText('11/11: melhor 45 kg × 9 · volume 1.165 kg')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver o treino de 11/11' })).toHaveAttribute('href', '/corpo/treino?dia=2026-11-11');
  });

  it('sums the cardio of the last complete weeks', async () => {
    await logWorkout({ kind: 'cardio', minutes: 20, at: at(3, 9) });
    await logWorkout({ kind: 'cardio', minutes: 10, at: at(5, 9) });
    renderAt('/corpo', <CorpoScreen />);
    expect(await screen.findByText(/Últimas 8 semanas completas: 2 sessões, 30 min de cardio\./)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cardio por semana' })).toBeInTheDocument();
  });
});
