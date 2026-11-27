import { render, screen, waitFor, within } from '@testing-library/react';
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
    const wed = screen.getByRole('group', { name: 'Quarta-feira' });
    while (within(wed).queryAllByRole('button', { name: /^Remover / }).length > 0) {
      await user.click(within(wed).getAllByRole('button', { name: /^Remover / })[0]!);
    }
    await user.click(screen.getByRole('button', { name: 'Salvar plano' }));
    await waitFor(async () => expect(await db.trainingPlans.count()).toBe(1));
    const plan = (await db.trainingPlans.get('plan'))!;
    expect(plan.days.map((d) => d.weekday)).toEqual([1, 2, 4, 5]);
    expect(plan.days[0]!.exercises[0]).toEqual({ name: 'Supino reto', sets: 3, repsMin: 6, repsMax: 10, restMinSec: 120, restMaxSec: 180 });
    expect(screen.getByText('Plano de treino salvo.')).toBeInTheDocument();
    expect(history.at(-1)).toBe('/corpo');
  });

  it('edits one exercise by taps: sets, range, rest preset and "Outro", note; a reversed range is refused', async () => {
    const user = userEvent.setup();
    renderAt('/corpo/plano', <TrainingPlanScreen />);
    await user.type(await screen.findByLabelText('Nome do treino de Segunda-feira'), 'Empurrar');
    await user.click(screen.getByRole('button', { name: 'Adicionar exercício a Segunda-feira' }));
    await user.type(screen.getByLabelText('Nome do exercício 1 de Segunda-feira'), 'supino reto');
    await user.selectOptions(screen.getByLabelText('Séries de supino reto'), '3');
    await user.type(screen.getByLabelText('Repetições mínimas de supino reto'), '8');
    await user.type(screen.getByLabelText('Repetições máximas de supino reto'), '6');
    expect(screen.getByText(/"de" menor ou igual a "até"/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar plano' }));
    expect(await screen.findByText('Corrija os campos marcados antes de salvar.')).toBeInTheDocument();
    expect(await db.trainingPlans.count()).toBe(0);
    await user.clear(screen.getByLabelText('Repetições máximas de supino reto'));
    await user.type(screen.getByLabelText('Repetições máximas de supino reto'), '10');
    await user.click(screen.getByRole('button', { name: 'Descanso 2–3 min em supino reto' }));
    await user.type(screen.getByLabelText('Observação de supino reto'), 'pausa no peito');
    await user.click(screen.getByRole('button', { name: 'Adicionar exercício a Segunda-feira' }));
    await user.type(screen.getByLabelText('Nome do exercício 2 de Segunda-feira'), 'elevação lateral');
    await user.click(screen.getByRole('button', { name: 'Outro descanso em elevação lateral' }));
    await user.type(screen.getByLabelText('Descanso mínimo em segundos de elevação lateral'), '60');
    await user.type(screen.getByLabelText('Descanso máximo em segundos de elevação lateral'), '90');
    await user.click(screen.getByRole('button', { name: 'Subir elevação lateral' }));
    await user.click(screen.getByRole('button', { name: 'Salvar plano' }));
    await waitFor(async () => expect(await db.trainingPlans.count()).toBe(1));
    expect((await db.trainingPlans.get('plan'))!.days).toEqual([{ weekday: 1, name: 'Empurrar', exercises: [
      { name: 'Elevação lateral', restMinSec: 60, restMaxSec: 90 },
      { name: 'Supino reto', sets: 3, repsMin: 8, repsMax: 10, restMinSec: 120, restMaxSec: 180, note: 'pausa no peito' },
    ] }]);
  });

  it('starts, edits and removes a block', async () => {
    const user = userEvent.setup();
    await applyFiveDaySplit();
    renderAt('/corpo/plano', <TrainingPlanScreen />);
    const start = await screen.findByRole('button', { name: 'Começar um bloco' });
    await waitFor(() => expect(start).toBeEnabled());   // waits for today, the block's first day
    await user.click(start);
    expect(screen.getByLabelText('Início do bloco')).toHaveValue('2026-11-11');
    await user.selectOptions(screen.getByLabelText('Semanas do bloco'), '2');
    await user.selectOptions(screen.getByLabelText('RIR mínimo da semana 1'), '3');
    await user.selectOptions(screen.getByLabelText('RIR máximo da semana 1'), '3');
    await user.type(screen.getByLabelText('Cardio mínimo da semana 1'), '20');
    await user.type(screen.getByLabelText('Cardio máximo da semana 1'), '25');
    await user.click(screen.getByRole('button', { name: 'Salvar plano' }));
    await waitFor(async () => expect((await db.trainingPlans.get('plan'))!.block).toEqual({
      startDay: '2026-11-11', weeks: [{ rirMin: 3, rirMax: 3, cardioMin: 20, cardioMax: 25 }, { rirMin: 2, rirMax: 2 }],
    }));
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
