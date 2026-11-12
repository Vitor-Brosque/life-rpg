import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mission } from '@life/shared';
import { planDay } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { createMission, setDayMode } from '../src/domain/actions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { blockFit } from '../src/features/agora/capacity';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { MissionSheet } from '../src/features/mission/MissionSheet';
import { WeekView } from '../src/features/plan/WeekView';
import { ToastHost } from '../src/ui/Toast';
import { AULA, FIXTURE, at, seedBlocks } from './blockFixture';

beforeEach(async () => {
  // Only Date is faked: fake-indexeddb needs the real setImmediate/setTimeout.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 10));
  localStorage.clear();
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: '2026-11-11', emptyDay: undefined });
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
  await setDayMode('normal');
});
afterEach(() => { vi.useRealTimers(); });

const TODAY = '2026-11-11';
const mission = (m: Partial<Mission> & { id: string }): Mission => ({
  createdAt: 1, updatedAt: 1, deleted: false, title: m.id, checklist: [], status: 'open', important: false,
  shrunk: false, postponeCount: 0, ...m,
});
const plan = (mode: 'normal' | 'free' = 'normal') => planDay({
  day: TODAY, now: at(11, 10), dayStartHour: 4, dayEndHour: 0, mode,
  blocks: FIXTURE, commitments: [AULA], sessions: [],
});

describe('blockFit', () => {
  it('adds the planned load of the block today and compares it with the block time', () => {
    const moving = mission({ id: 'perna', areaId: 'area-vigor', durationMin: 90, date: '2026-11-10' });
    const missions = [
      moving,
      mission({ id: 'cardio', areaId: 'area-vigor', durationMin: 60, date: TODAY }),
      mission({ id: 'alongar', areaId: 'area-vigor', status: 'doing', date: '2026-11-05' }), // 25 by default
      mission({ id: 'feito', areaId: 'area-vigor', durationMin: 60, date: TODAY, status: 'done' }),
      mission({ id: 'amanha', areaId: 'area-vigor', durationMin: 60, date: '2026-11-12' }),
      mission({ id: 'outro', areaId: 'area-ordem', durationMin: 60, date: TODAY }),
    ];
    const fit = blockFit({ mission: moving, blocks: FIXTURE, plan: plan(), missions, today: TODAY });
    expect(fit).toMatchObject({ load: 175, capacity: 120, full: true, nextDay: '2026-11-12' });
    expect(fit?.block.id).toBe('b2');
  });

  it('fits when the load stays within the block', () => {
    const moving = mission({ id: 'perna', areaId: 'area-vigor', durationMin: 90 });
    expect(blockFit({ mission: moving, blocks: FIXTURE, plan: plan(), missions: [moving], today: TODAY }))
      .toMatchObject({ load: 90, capacity: 120, full: false });
  });

  it('an explicit blockId wins over the area; missions of no block have no fit', () => {
    const explicit = mission({ id: 'x', areaId: 'area-vigor', blockId: 'b5' });
    expect(blockFit({ mission: explicit, blocks: FIXTURE, plan: plan(), missions: [], today: TODAY })?.block.id).toBe('b5');
    const loose = mission({ id: 'y', areaId: 'area-ordem' });
    expect(blockFit({ mission: loose, blocks: FIXTURE, plan: plan(), missions: [], today: TODAY })).toBeUndefined();
  });

  it('a block that does not happen today has no time: always full, next occurrence offered', () => {
    const moving = mission({ id: 'perna', areaId: 'area-vigor', durationMin: 10 });
    expect(blockFit({ mission: moving, blocks: FIXTURE, plan: plan('free'), missions: [], today: TODAY }))
      .toMatchObject({ capacity: 0, full: true, nextDay: '2026-11-12' });
    expect(blockFit({ mission: moving, blocks: FIXTURE, plan: plan(), missions: [], today: '2026-11-13' }))
      .toMatchObject({ nextDay: '2026-11-16' });
  });

  it('a block already over today (done or missed) has no time left either', () => {
    const moving = mission({ id: 'parser', journeyId: 'j-tech', durationMin: 10 });
    const late = planDay({
      day: TODAY, now: at(11, 13), dayStartHour: 4, dayEndHour: 0, mode: 'normal',
      blocks: FIXTURE, commitments: [AULA], sessions: [],
    });
    expect(late.find((o) => o.block.id === 'b1')?.state).toBe('missed');
    expect(blockFit({ mission: moving, blocks: FIXTURE, plan: late, missions: [], today: TODAY }))
      .toMatchObject({ capacity: 0, full: true });
  });
});

describe('quick review', () => {
  const renderAgora = () => render(<><AgoraScreen /><ToastHost /></>);
  const item = async (title: string) =>
    within(await screen.findByRole('region', { name: /Revisão rápida/ })).getByRole('group', { name: title });
  /** The block data (live queries) has loaded once the block button shows up. */
  const blockReady = async (row: HTMLElement) => within(row).findByRole('button', { name: /Próximo bloco/ });

  it('warns when "Hoje" overloads the block and sends the mission to its next occurrence', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Treino de perna', areaId: 'area-vigor', durationMin: 90, date: '2026-11-10' });
    await createMission({ title: 'Cardio', areaId: 'area-vigor', durationMin: 60, date: TODAY });
    renderAgora();
    const row = await item('Treino de perna');
    await blockReady(row);
    await user.click(within(row).getByRole('button', { name: 'Hoje' }));
    expect(await within(row).findByText('O bloco Treino de hoje já está cheio (2h30 de 2h). Mandar para o próximo (qui)?'))
      .toBeInTheDocument();
    expect((await db.missions.get(m.id))?.date).toBe('2026-11-10');
    await user.click(within(row).getByRole('button', { name: 'Mandar para o próximo (qui)' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.date).toBe('2026-11-12'));
  });

  it('"Hoje mesmo assim" keeps it today', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Treino de perna', areaId: 'area-vigor', durationMin: 150, date: '2026-11-10' });
    renderAgora();
    const row = await item('Treino de perna');
    await blockReady(row);
    await user.click(within(row).getByRole('button', { name: 'Hoje' }));
    await user.click(await within(row).findByRole('button', { name: 'Hoje mesmo assim' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.date).toBe(TODAY));
  });

  it('moves straight to today when it fits, and offers "Próximo bloco" only for block missions', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Treino de perna', areaId: 'area-vigor', durationMin: 60, date: '2026-11-10' });
    await createMission({ title: 'Pagar a conta', date: '2026-11-10' });
    renderAgora();
    const row = await item('Treino de perna');
    expect(await blockReady(row)).toHaveTextContent('Próximo bloco (qui)');
    expect(within(await item('Pagar a conta')).queryByRole('button', { name: /Próximo bloco/ })).not.toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Hoje' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.date).toBe(TODAY));
  });

  it('"Próximo bloco (qui)" plans the mission for the next day that has its block', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Lista de exercícios', areaId: 'area-facul', date: '2026-11-10' });
    renderAgora();
    await user.click(await blockReady(await item('Lista de exercícios')));
    await waitFor(async () => expect((await db.missions.get(m.id))?.date).toBe('2026-11-12'));
  });
});

describe('"Mover para…" panel', () => {
  it('warns when today is full and offers the next block', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Candidatura', blockId: 'b5', durationMin: 30 });
    await createMission({ title: 'Anki', blockId: 'b5', durationMin: 30, date: TODAY });
    render(<WeekView />);
    const backlog = await screen.findByRole('region', { name: 'Sem data' });
    await user.click(await within(backlog).findByRole('button', { name: 'Mover para… Candidatura' }));
    expect(await within(backlog).findByRole('button', { name: 'Próximo bloco (qui)' })).toBeInTheDocument();
    await user.click(within(backlog).getByRole('button', { name: 'Hoje' }));
    expect(await within(backlog).findByText('O bloco Compl de hoje já está cheio (1h de 40 min). Mandar para o próximo (qui)?'))
      .toBeInTheDocument();
    await user.click(within(backlog).getByRole('button', { name: 'Mandar para o próximo (qui)' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.date).toBe('2026-11-12'));
  });
});

describe('MissionSheet "Bloco"', () => {
  it('assigns a block explicitly, or goes back to automatic', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Treino de perna', areaId: 'area-vigor' });
    render(<MissionSheet missionId={m.id} onClose={() => {}} />);
    const select = await screen.findByRole('combobox', { name: 'Bloco' });
    expect(within(select).getByRole('option', { name: 'Automático — Treino' })).toBeInTheDocument();
    await user.selectOptions(select, 'Compl');
    await waitFor(async () => expect((await db.missions.get(m.id))?.blockId).toBe('b5'));
    await user.selectOptions(select, 'Automático — Treino');
    await waitFor(async () => expect((await db.missions.get(m.id))?.blockId).toBeUndefined());
  });

  it('an archived block it is assigned to shows as "(arquivado)", selected; Automático clears it', async () => {
    const user = userEvent.setup();
    await db.blocks.put({ ...FIXTURE[4]!, id: 'b6', name: 'Leitura', order: 9, archived: true });
    const m = await createMission({ title: 'Ler um capítulo', blockId: 'b6' });
    render(<MissionSheet missionId={m.id} onClose={() => {}} />);
    const select = await screen.findByRole('combobox', { name: 'Bloco' });
    const archived = await within(select).findByRole('option', { name: 'Leitura (arquivado)' });
    expect((archived as HTMLOptionElement).selected).toBe(true);
    expect(select).toHaveValue('b6');
    await user.selectOptions(select, 'Automático (pela área ou jornada)');
    await waitFor(async () => expect((await db.missions.get(m.id))?.blockId).toBeUndefined());
  });
});
