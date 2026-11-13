import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { LifeEvent, Mission, Week } from '@life/shared';
import { timestampAt } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { setDayMode } from '../src/domain/actions';
import { setWeekAtypical, setWeekExperiment } from '../src/domain/patternActions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { useCompanion } from '../src/features/companion/store';
import { MiniBars } from '../src/features/patterns/MiniBars';
import { PatternsScreen } from '../src/features/patterns/PatternsScreen';
import { WeekView } from '../src/features/plan/WeekView';
import { useWeekSession } from '../src/features/week/weekCycle';
import { ToastHost } from '../src/ui/Toast';
import { at, seedBlocks } from './blockFixture';

// P3 "semana atípica": marcar no Planejar e no card Nova semana, a linha no Agora e fora das
// comparações dos Padrões. Monday 2026-11-16 is the week '2026-11-16'; last week is 2026-11-09.

const LAST = '2026-11-09';
const WEEK = '2026-11-16';
const base = { createdAt: 1, updatedAt: 1, deleted: false };
const atypical = (id: string, reason = 'Provas', extra: Partial<Week> = {}): Week =>
  ({ ...base, id, objectives: [], atypical: { reason }, ...extra });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(16, 9, 30)); // Monday
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: WEEK, emptyDay: undefined });
  useWeekSession.setState({ dismissed: undefined, opened: undefined, started: undefined });
  useCompanion.getState().clear();
});
afterEach(() => { vi.useRealTimers(); });

describe('setWeekAtypical', () => {
  it('creates the week record when it is missing, with a clean reason and a valid return day', async () => {
    await setWeekAtypical(WEEK, { reason: `  ${'x'.repeat(80)}  `, returnDay: '2026-11-23' });
    const w = await db.weeks.get(WEEK);
    expect(w?.objectives).toEqual([]);
    expect(w?.atypical?.reason).toBe('x'.repeat(60));
    expect(w?.atypical?.returnDay).toBe('2026-11-23');
  });

  it('drops an invalid return day, falls back to "Outro" for an empty reason and keeps other fields', async () => {
    await setWeekExperiment('Celular longe');
    await setWeekAtypical(WEEK, { reason: '   ', returnDay: '2026-13-45' });
    const w = await db.weeks.get(WEEK);
    expect(w?.experiment).toBe('Celular longe');
    expect(w?.atypical).toEqual({ reason: 'Outro' });
  });

  it('undefined removes the mark and keeps a record that holds something else', async () => {
    await setWeekExperiment('Celular longe');
    await setWeekAtypical(WEEK, { reason: 'Viagem' });
    await setWeekAtypical(WEEK, undefined);
    const w = await db.weeks.get(WEEK);
    expect(w?.deleted).toBe(false);
    expect(w?.experiment).toBe('Celular longe');
    expect(w?.atypical).toBeUndefined();
  });

  it('undefined soft-deletes a record that held nothing but the mark, and marking again revives it', async () => {
    await setWeekAtypical(WEEK, { reason: 'Viagem' });
    await setWeekAtypical(WEEK, undefined);
    expect((await db.weeks.get(WEEK))?.deleted).toBe(true);
    await setWeekAtypical(WEEK, { reason: 'Provas' });
    const w = await db.weeks.get(WEEK);
    expect(w?.deleted).toBe(false);
    expect(w?.atypical?.reason).toBe('Provas');
  });

  it('a return day before the Monday of the week is ignored', async () => {
    await setWeekAtypical(WEEK, { reason: 'Provas', returnDay: '2026-11-10' });
    expect((await db.weeks.get(WEEK))?.atypical).toEqual({ reason: 'Provas' });
  });
});

describe('Agora', () => {
  const renderAgora = () => render(<><AgoraScreen /><ToastHost /></>);

  it('shows the atypical line (with the return day) and the experiment together, on a Wednesday', async () => {
    vi.setSystemTime(at(18, 9, 30));
    await setDayMode('normal');
    await setWeekExperiment('Começar pelo teste');
    await setWeekAtypical(WEEK, { reason: 'Provas', returnDay: '2026-11-22' });
    renderAgora();
    expect(await screen.findByText('Semana atípica (Provas) até 22/11. Versões mínimas contam tanto quanto.')).toBeInTheDocument();
    expect(screen.getByText('Experimento da semana: Começar pelo teste')).toBeInTheDocument();
  });

  it('without a return day it is the plain sentence; after the return day it disappears', async () => {
    vi.setSystemTime(at(18, 9, 30));
    await setDayMode('normal');
    await setWeekAtypical(WEEK, { reason: 'Viagem' });
    const first = renderAgora();
    expect(await screen.findByText('Semana atípica (Viagem). Versões mínimas contam tanto quanto.')).toBeInTheDocument();
    first.unmount();
    await setWeekAtypical(WEEK, { reason: 'Viagem', returnDay: '2026-11-18' });
    renderAgora();
    // The experiment comes from the same week record: once it shows, the record was read.
    await setWeekExperiment('Começar pelo teste');
    expect(await screen.findByText('Experimento da semana: Começar pelo teste')).toBeInTheDocument();
    expect(screen.queryByText(/Semana atípica/)).not.toBeInTheDocument();
  });

  it('a week record that only holds the mark still waits for its Nova semana card', async () => {
    await db.weeks.put(atypical(WEEK));
    await setDayMode('normal');
    renderAgora();
    expect(await screen.findByRole('region', { name: 'Nova semana' }, { timeout: 3000 })).toBeInTheDocument();
  });

  it('Nova semana: marking then unmarking the week on a Monday leaves the card pending', async () => {
    await setWeekAtypical(WEEK, { reason: 'Viagem' });
    await setWeekAtypical(WEEK, undefined);
    await setDayMode('normal');
    renderAgora();
    expect(await screen.findByRole('region', { name: 'Nova semana' }, { timeout: 3000 })).toBeInTheDocument();
  });

  it('Nova semana: the welcome-back sentence shows on the collapsed card too', async () => {
    await db.weeks.put(atypical(LAST, 'Provas'));
    await setDayMode('normal');
    renderAgora();
    const card = await screen.findByRole('region', { name: 'Nova semana' }, { timeout: 3000 });
    expect(within(card).getByRole('button', { name: 'Começar' })).toBeInTheDocument();
    expect(await within(card).findByText('A semana passada foi atípica (Provas). Bem-vindo de volta: começar pelas versões mínimas vale.')).toBeInTheDocument();
  });

  it('Nova semana: last week atypical gets a welcome-back sentence', async () => {
    const user = userEvent.setup();
    await db.weeks.put(atypical(LAST, 'Provas'));
    await setDayMode('normal');
    renderAgora();
    const card = await screen.findByRole('region', { name: 'Nova semana' }, { timeout: 3000 });
    await user.click(within(card).getByRole('button', { name: 'Começar' }));
    expect(await within(card).findByText('A semana passada foi atípica (Provas). Bem-vindo de volta: começar pelas versões mínimas vale.')).toBeInTheDocument();
  });

  it('Nova semana: "Esta semana vai ser atípica?" opens the sheet and marks the week', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    renderAgora();
    const card = await screen.findByRole('region', { name: 'Nova semana' }, { timeout: 3000 });
    await user.click(within(card).getByRole('button', { name: 'Começar' }));
    const opener = await within(card).findByRole('button', { name: 'Esta semana vai ser atípica?' });
    await user.click(opener);
    const sheet = await screen.findByRole('dialog', { name: 'Semana atípica' });
    await user.click(within(sheet).getByRole('button', { name: 'Viagem' }));
    await user.click(within(sheet).getByRole('button', { name: 'Marcar semana' }));
    await waitFor(async () => expect((await db.weeks.get(WEEK))?.atypical?.reason).toBe('Viagem'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('Planejar → Semana', () => {
  it('"Semana atípica" in the header opens the sheet: chips, other reason, date, mark and unmark', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(at(11, 10, 20)); // Wednesday, week 2026-11-09
    render(<WeekView />);
    const opener = await screen.findByRole('button', { name: /Semana atípica/ });
    expect(opener).toHaveAccessibleName('Semana atípica, semana de 09/11');
    await user.click(opener);
    const sheet = await screen.findByRole('dialog', { name: 'Semana atípica' });
    expect(within(sheet).getByText('Semana de 09/11')).toBeInTheDocument();
    // A return day before the week's Monday is not offered.
    expect(within(sheet).getByLabelText('O ritmo volta em')).toHaveAttribute('min', LAST);
    expect(within(sheet).getByText('Numa semana atípica, versões mínimas contam tanto quanto. Os Padrões não comparam esta semana com as outras.')).toBeInTheDocument();
    for (const name of ['Provas', 'Viagem', 'Saúde', 'Outro']) expect(within(sheet).getByRole('button', { name })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Desmarcar' })).not.toBeInTheDocument();
    // The return day defaults to the next Monday.
    expect(within(sheet).getByLabelText('O ritmo volta em')).toHaveValue('2026-11-16');
    await user.click(within(sheet).getByRole('button', { name: 'Outro' }));
    await user.type(within(sheet).getByRole('textbox', { name: 'Qual o motivo?' }), 'Congresso');
    await user.click(within(sheet).getByRole('button', { name: 'Marcar semana' }));
    await waitFor(async () => expect((await db.weeks.get(LAST))?.atypical).toEqual({ reason: 'Congresso', returnDay: '2026-11-16' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Focus returns to the opener, which now shows the reason.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Semana atípica/ })));

    await user.click(screen.getByRole('button', { name: /Semana atípica/ }));
    const again = await screen.findByRole('dialog', { name: 'Semana atípica' });
    expect(within(again).getByRole('textbox', { name: 'Qual o motivo?' })).toHaveValue('Congresso');
    await user.click(within(again).getByRole('button', { name: 'Desmarcar' }));
    await waitFor(async () => expect((await db.weeks.get(LAST))?.atypical).toBeUndefined());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('Padrões', () => {
  it('MiniBars: an atypical bar is marked with text and a dashed style, not colour alone', () => {
    const { container } = render(<MiniBars values={[3, 2]} labels={['26/10', '02/11']} atypical={[false, true]} />);
    expect(container.querySelectorAll('.minibars__bar--atypical')).toHaveLength(1);
    expect(screen.getByText('02/11*')).toBeInTheDocument();
    expect(screen.getByText('26/10')).toBeInTheDocument();
  });

  const ev = (type: LifeEvent['type'], day: string): LifeEvent =>
    ({ ...base, id: `${type}-${day}`, at: timestampAt(day, '15:00'), type, missionId: 'm1' });
  const mission: Mission = {
    ...base, id: 'm1', title: 'Lista', checklist: [], status: 'open', important: false, shrunk: false, postponeCount: 0,
  };

  it('Adiamentos leave the atypical week out and say so', async () => {
    vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
    await db.missions.put(mission);
    await db.events.bulkPut([ev('snoozed', '2026-11-03'), ev('snoozed', '2026-11-10'), ev('started', '2026-11-11')]);
    await db.weeks.put(atypical('2026-11-02'));
    await db.xpEvents.put({ ...base, id: 'xp1', at: timestampAt('2026-11-02', '10:00'), amount: 5, reason: 'start', dayKey: '2026-11-02' });
    const { hook } = memoryLocation({ path: '/padroes' });
    render(<Router hook={hook}><PatternsScreen /></Router>);
    expect(await screen.findByText('Nas últimas 4 semanas: adiou 1 vez, começou 1, encolheu 0 e soltou 0.')).toBeInTheDocument();
    expect(screen.getByText('1 semana atípica fora da conta.')).toBeInTheDocument();
  });
});
