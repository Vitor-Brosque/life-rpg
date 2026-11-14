import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { createCommitment, createMission } from '../src/domain/actions';
import { softDelete } from '../src/db/repo';
import { useMissionSheet } from '../src/features/mission/MissionSheet';
import { RoutineScreen } from '../src/features/routine/RoutineScreen';
import { at, seedBlocks } from './blockFixture';

// Planejar → Rotina → Recorrentes (spec Tarefa F). Today is Wednesday 2026-11-11.

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 10, 20));
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  useMissionSheet.getState().close();
});
afterEach(() => {
  vi.useRealTimers();
});

const EMPTY = /Nada se repete ainda/;

describe('Recorrentes', () => {
  it('sem nada que repita mostra a frase de vazio (mesmo sem blocos)', async () => {
    localStorage.setItem('life-rpg.routine.skipSetup', '1');
    render(<RoutineScreen />);
    await screen.findByText(EMPTY);
    expect(screen.getByRole('heading', { name: 'Recorrentes' })).toBeInTheDocument();
  });

  it('lista missões que repetem e compromissos semanais, e ignora o resto', async () => {
    await seedBlocks();
    await createMission({ title: 'Lavar roupa', recurrence: { kind: 'weekly', weekdays: [1] }, date: '2026-11-16' });
    await createMission({ title: 'Regar plantas', recurrence: { kind: 'daily' }, date: '2026-11-11' });
    await createMission({ title: 'Sem repetir', date: '2026-11-12' });
    await createMission({ title: 'Concluída', recurrence: { kind: 'daily' }, status: 'done' });
    const gone = await createMission({ title: 'Apagada', recurrence: { kind: 'daily' } });
    await softDelete('missions', gone.id);
    await createCommitment({ title: 'Academia', date: '2026-11-02', start: '07:00', end: '08:00', weekdays: [1, 3, 5] });
    await createCommitment({ title: 'Curso velho', date: '2026-09-01', start: '10:00', weekdays: [2], untilDate: '2026-10-01' });
    await createCommitment({ title: 'Pontual', date: '2026-11-12', start: '10:00' });

    render(<RoutineScreen />);
    const missions = await screen.findByRole('list', { name: 'Missões que repetem' });
    const rows = within(missions).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Lavar roupa');
    expect(rows[0]).toHaveTextContent('Repete toda seg · próxima: seg 16/11');
    expect(rows[1]).toHaveTextContent('Regar plantas');
    expect(rows[1]).toHaveTextContent('Repete todo dia · próxima: hoje');

    const commits = screen.getByRole('list', { name: 'Compromissos semanais' });
    const crows = within(commits).getAllByRole('listitem');
    // The fixture's weekly "Aula" (seg–sex 19:00–23:00) comes along with Academia.
    expect(crows).toHaveLength(2);
    expect(crows[0]).toHaveTextContent('Academia');
    expect(crows[0]).toHaveTextContent('seg, qua, sex · 07:00–08:00');
    expect(crows[1]).toHaveTextContent('Aula');
    expect(crows[1]).toHaveTextContent('seg, ter, qua, qui, sex · 19:00–23:00');
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
    for (const t of ['Sem repetir', 'Concluída', 'Apagada', 'Curso velho', 'Pontual']) {
      expect(screen.queryByText(t)).not.toBeInTheDocument();
    }
  });

  it('tocar numa missão abre a ficha dela', async () => {
    const user = userEvent.setup();
    await seedBlocks();
    const m = await createMission({ title: 'Lavar roupa', recurrence: { kind: 'weekly', weekdays: [1] }, date: '2026-11-16' });
    render(<RoutineScreen />);
    await user.click(await screen.findByRole('button', { name: /^Lavar roupa, Repete toda seg/ }));
    expect(useMissionSheet.getState().openId).toBe(m.id);
  });

  it('tocar num compromisso abre a folha dele e o foco volta ao botão ao fechar', async () => {
    const user = userEvent.setup();
    await seedBlocks();
    await createCommitment({ title: 'Academia', date: '2026-11-02', start: '07:00', end: '08:00', weekdays: [1, 3, 5] });
    render(<RoutineScreen />);
    const open = await screen.findByRole('button', { name: /^Academia, seg, qua, sex/ });
    await user.click(open);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Título')).toHaveValue('Academia');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(open).toHaveFocus());
  });

  it('excluir o compromisso pela folha deixa o foco no título Recorrentes, não no body', async () => {
    const user = userEvent.setup();
    await seedBlocks();
    await createCommitment({ title: 'Academia', date: '2026-11-02', start: '07:00', end: '08:00', weekdays: [1, 3, 5] });
    render(<RoutineScreen />);
    await user.click(await screen.findByRole('button', { name: /^Academia, seg, qua, sex/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Excluir compromisso' }));
    await user.click(within(dialog).getByRole('button', { name: 'Sim, excluir' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Recorrentes' })).toHaveFocus());
  });

  it('concluir a missão recorrente pela ficha também deixa o foco no título', async () => {
    const user = userEvent.setup();
    await seedBlocks();
    const m = await createMission({ title: 'Lavar roupa', recurrence: { kind: 'weekly', weekdays: [1] }, date: '2026-11-16' });
    render(<RoutineScreen />);
    await user.click(await screen.findByRole('button', { name: /^Lavar roupa, Repete toda seg/ }));
    await softDelete('missions', m.id);
    useMissionSheet.getState().close();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Recorrentes' })).toHaveFocus());
  });
});
