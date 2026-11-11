import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { createCommitment, createMission, startMission } from '../src/domain/actions';
import { BoardView } from '../src/features/plan/BoardView';
import { PlanScreen } from '../src/features/plan/PlanScreen';
import { WeekView } from '../src/features/plan/WeekView';
import { ToastHost } from '../src/ui/Toast';

const at = (h: number, m = 0) => new Date(2026, 10, 11, h, m).getTime();

beforeEach(async () => {
  // Only Date is faked: fake-indexeddb needs the real setImmediate/setTimeout.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(10, 20));
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('WeekView', () => {
  it('lists the commitments and missions of the selected day', async () => {
    await createCommitment({ title: 'Dentista', date: '2026-11-11', start: '15:00' });
    await createMission({ title: 'Ler capítulo', date: '2026-11-11' });
    await createMission({ title: 'Outro dia', date: '2026-11-12' });
    render(<WeekView />);
    expect(await screen.findByText('Dentista')).toBeInTheDocument();
    expect(screen.getByText('15:00–16:00')).toBeInTheDocument();
    // Missions come from their own live query, which can resolve after the commitments one.
    expect(await screen.findByText('Ler capítulo')).toBeInTheDocument();
    expect(screen.queryByText('Outro dia')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /qui 12\/11/ }));
    expect(await screen.findByText('Outro dia')).toBeInTheDocument();
    expect(screen.queryByText('Ler capítulo')).not.toBeInTheDocument();
  });

  it('"Mover para… Sem data" moves the mission into the backlog', async () => {
    const m = await createMission({ title: 'Ler capítulo', date: '2026-11-11' });
    render(<WeekView />);
    await screen.findByText('Ler capítulo');
    const backlog = screen.getByRole('region', { name: 'Sem data' });
    expect(within(backlog).queryByText('Ler capítulo')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Mover para/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Sem data' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.date).toBeUndefined());
    expect(await within(backlog).findByText('Ler capítulo')).toBeInTheDocument();
  });

  it('shifts the strip by 7 days with the arrows', async () => {
    render(<WeekView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Próxima semana' }));
    expect(await screen.findByRole('button', { name: /qua 18\/11/ })).toBeInTheDocument();
  });
});

describe('CommitmentSheet', () => {
  it('creates a weekly commitment, edits the series and deletes it after confirming', async () => {
    render(<WeekView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Compromisso' }));
    await userEvent.type(screen.getByLabelText('Título'), 'Aula de inglês');
    await userEvent.click(screen.getByRole('button', { name: 'segunda' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => {
      const c = (await db.commitments.toArray()).find((x) => x.title === 'Aula de inglês');
      expect(c?.weekdays).toEqual([1]);
      expect(c?.date).toBe('2026-11-11');
      expect(c?.end).toBe('10:00');
    });
    // Monday 16/11 shows the occurrence; editing it changes the series.
    await userEvent.click(screen.getByRole('button', { name: /seg 16\/11/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Aula de inglês/ }));
    const title = await screen.findByLabelText('Título');
    await userEvent.clear(title);
    await userEvent.type(title, 'Inglês');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect((await db.commitments.toArray())[0]?.title).toBe('Inglês'));
    await userEvent.click(await screen.findByRole('button', { name: /Inglês/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir compromisso' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sim, excluir' }));
    await waitFor(async () => expect((await db.commitments.toArray())[0]?.deleted).toBe(true));
  });
});

describe('BoardView', () => {
  it('renders the four columns and places missions by status and date', async () => {
    await createMission({ title: 'Sem dia' });
    await createMission({ title: 'Para hoje', date: '2026-11-11' });
    const doing = await createMission({ title: 'Em curso', date: '2026-11-11' });
    await startMission(doing.id);
    await createMission({ title: 'Feita', status: 'done', completedAt: at(9) });
    render(<><BoardView /><ToastHost /></>);
    for (const name of ['Sem data', 'Hoje', 'Em andamento', 'Feito (7 dias)']) {
      expect(await screen.findByRole('heading', { name })).toBeInTheDocument();
    }
    const col = (name: string) => screen.getByRole('region', { name });
    await waitFor(() => expect(within(col('Sem data')).getByText('Sem dia')).toBeInTheDocument());
    expect(within(col('Hoje')).getByText('Para hoje')).toBeInTheDocument();
    expect(within(col('Hoje')).queryByText('Em curso')).not.toBeInTheDocument();
    expect(within(col('Em andamento')).getByText('Em curso')).toBeInTheDocument();
    expect(within(col('Feito (7 dias)')).getByText('Feita')).toBeInTheDocument();
  });

  it('"Mover para…" menu moves a card to another column', async () => {
    const m = await createMission({ title: 'Sem dia' });
    render(<BoardView />);
    await screen.findByText('Sem dia');
    await userEvent.click(screen.getByRole('button', { name: /Mover para/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Hoje' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.date).toBe('2026-11-11'));
  });
});

describe('PlanScreen', () => {
  it('remembers the last tab', async () => {
    const { unmount } = render(<PlanScreen />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Quadro' }));
    expect(await screen.findByRole('heading', { name: 'Em andamento' })).toBeInTheDocument();
    unmount();
    render(<PlanScreen />);
    expect(await screen.findByRole('tab', { name: 'Quadro', selected: true })).toBeInTheDocument();
  });
});

describe('moveToColumn out of "Feito"', () => {
  it('undoes the completion so completing again does not award XP twice', async () => {
    const { completeMission } = await import('../src/domain/actions');
    const { moveToColumn } = await import('../src/features/plan/BoardView');
    const m = await createMission({ title: 'Lavar louça' });
    await completeMission(m.id);
    const xpAfterFirst = (await db.xpEvents.toArray()).filter((x) => !x.deleted).reduce((s, x) => s + x.amount, 0);
    expect(xpAfterFirst).toBe(8);

    const done = (await db.missions.get(m.id))!;
    await moveToColumn(done, 'today', '2026-11-11');
    const moved = (await db.missions.get(m.id))!;
    expect(moved.status).toBe('open');
    expect(moved.date).toBe('2026-11-11');
    const xpAfterMove = (await db.xpEvents.toArray()).filter((x) => !x.deleted).reduce((s, x) => s + x.amount, 0);
    expect(xpAfterMove).toBe(0);

    await completeMission(m.id);
    const xpAfterSecond = (await db.xpEvents.toArray()).filter((x) => !x.deleted).reduce((s, x) => s + x.amount, 0);
    expect(xpAfterSecond).toBe(8);
  });
});
