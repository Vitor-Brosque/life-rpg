import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LifeEvent, Mission, Suggestion } from '@life/shared';
import { latestResult } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { createMission } from '../src/domain/actions';
import { closePartial, noteResult } from '../src/domain/missionActions';
import { MainCard } from '../src/features/agora/MainCard';
import type { AgoraActions } from '../src/features/agora/useAgora';
import { MissionSheetHost, useMissionSheet } from '../src/features/mission/MissionSheet';
import { PartialSheetHost, usePartialSheet } from '../src/features/mission/PartialSheet';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at } from './blockFixture';

const HOUR = 3600_000;
const eventsOf = (id: string) => db.events.where('missionId').equals(id).toArray();

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 9, 30));
  localStorage.clear();
  usePartialSheet.setState({ missionId: undefined });
  useMissionSheet.setState({ openId: undefined });
  useToast.getState().dismiss();
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

describe('closePartial', () => {
  it('reopens the mission for tomorrow, keeps the postpone count and logs a partial event', async () => {
    const m = await createMission({ title: 'Parser', status: 'doing', postponeCount: 2, dayOrder: 3 });
    await closePartial(m.id, { result: ' metade ', next: 'teste de URLs', when: 'tomorrow' });
    const after = await db.missions.get(m.id);
    expect(after).toMatchObject({ status: 'open', firstStep: 'teste de URLs', date: '2026-11-12', postponeCount: 2 });
    expect(after?.dayOrder).toBeUndefined();
    expect(after?.snoozedUntil).toBeUndefined();
    const events = await eventsOf(m.id);
    const partials = events.filter((e) => e.type === 'partial');
    expect(partials).toHaveLength(1);
    expect(partials[0]!.data).toEqual({ option: 'tomorrow', result: 'metade', next: 'teste de URLs' });
    expect(events.some((e) => e.type === 'snoozed')).toBe(false);
  });

  it('"later" snoozes for three hours; a chosen day sets the date; empty fields are left out', async () => {
    const m = await createMission({ title: 'A', status: 'doing', firstStep: 'antigo' });
    await closePartial(m.id, { when: 'later' });
    const a = await db.missions.get(m.id);
    expect(a?.snoozedUntil).toBe(Date.now() + 3 * HOUR);
    expect(a?.firstStep).toBe('antigo');
    expect(a?.status).toBe('open');
    await closePartial(m.id, { when: { date: '2026-11-20' } });
    const b = await db.missions.get(m.id);
    expect(b).toMatchObject({ date: '2026-11-20' });
    expect(b?.snoozedUntil).toBeUndefined();
    const partials = (await eventsOf(m.id)).filter((e) => e.type === 'partial');
    expect(partials.map((e) => e.data)).toEqual(expect.arrayContaining([{ option: 'later' }, { option: { date: '2026-11-20' } }]));
  });

  it('does nothing to a concluded mission', async () => {
    const m = await createMission({ title: 'Feita', status: 'done', postponeCount: 1 });
    await closePartial(m.id, { result: 'x', next: 'y', when: 'tomorrow' });
    expect(await db.missions.get(m.id)).toMatchObject({ status: 'done', postponeCount: 1 });
    expect((await db.missions.get(m.id))?.firstStep).toBeUndefined();
    expect((await eventsOf(m.id)).some((e) => e.type === 'partial')).toBe(false);
  });
});

describe('noteResult', () => {
  it('the newest result wins and a blank one clears it', async () => {
    const m = await createMission({ title: 'Feita', status: 'done' });
    await noteResult(m.id, 'a');
    vi.setSystemTime(at(11, 9, 31));
    await noteResult(m.id, 'b');
    expect(latestResult(await eventsOf(m.id), m.id)?.result).toBe('b');
    vi.setSystemTime(at(11, 9, 32));
    await noteResult(m.id, '  ');
    expect(latestResult(await eventsOf(m.id), m.id)).toBeUndefined();
  });
});

const noopActions = {
  start: vi.fn(), complete: vi.fn(), open: vi.fn(), other: vi.fn(), shrink: vi.fn(), split: vi.fn(),
  drop: vi.fn(), snooze: vi.fn(),
} as unknown as AgoraActions;
const suggestionOf = (mission: Mission): Suggestion => ({ mission, score: 1, reasons: [], postponedHint: false });

describe('Parcial in the interface', () => {
  it('the main card offers "Parcial" only for a mission in progress', async () => {
    const doing = await createMission({ title: 'Em curso', status: 'doing' });
    const open = await createMission({ title: 'Aberta' });
    const { rerender } = render(<MainCard suggestion={suggestionOf(doing)} canSkip actions={noopActions} />);
    expect(await screen.findByRole('button', { name: 'Parcial' })).toBeInTheDocument();
    rerender(<MainCard suggestion={suggestionOf(open)} canSkip actions={noopActions} />);
    expect(screen.queryByRole('button', { name: 'Parcial' })).not.toBeInTheDocument();
  });

  it('two taps: Parcial, then Amanhã, saves it and says so', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Parser', status: 'doing', postponeCount: 1 });
    render(<><MainCard suggestion={suggestionOf(m)} canSkip actions={noopActions} /><PartialSheetHost /><ToastHost /></>);
    await user.click(await screen.findByRole('button', { name: 'Parcial' }));
    const dialog = await screen.findByRole('dialog', { name: 'Parcial' });
    expect(within(dialog).getByText('“Parser” fica aberta. O que já saiu fica anotado.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Amanhã' }));
    expect(await screen.findByText('Parcial anotada. Guardada para amanhã.')).toBeInTheDocument();
    await waitFor(async () => expect(await db.missions.get(m.id)).toMatchObject({ status: 'open', date: '2026-11-12', postponeCount: 1 }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Parcial' })).not.toBeInTheDocument());
  });

  it('closing the sheet writes nothing', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Parser', status: 'doing' });
    render(<PartialSheetHost />);
    usePartialSheet.getState().open(m.id);
    const dialog = await screen.findByRole('dialog', { name: 'Parcial' });
    await user.type(within(dialog).getByRole('textbox', { name: 'O que saiu? (opcional)' }), 'algo');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Parcial' })).not.toBeInTheDocument());
    expect((await eventsOf(m.id)).some((e) => e.type === 'partial')).toBe(false);
    expect((await db.missions.get(m.id))?.status).toBe('doing');
  });
});

describe('"O que saiu?" on the mission sheet', () => {
  it('a concluded mission takes a result on blur', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Feita', status: 'done' });
    render(<MissionSheetHost />);
    useMissionSheet.getState().open(m.id);
    const field = await screen.findByRole('textbox', { name: 'O que saiu?' });
    await user.type(field, 'versão final');
    await user.tab();
    await waitFor(async () => expect(latestResult(await eventsOf(m.id), m.id)?.result).toBe('versão final'));
  });

  it('an open mission shows the last partial', async () => {
    const m = await createMission({ title: 'Aberta' });
    await put('events', newRecord<LifeEvent>({
      at: Date.now() - 1000, type: 'partial', missionId: m.id, data: { option: 'tomorrow', result: 'falta o teste' },
    }));
    render(<MissionSheetHost />);
    useMissionSheet.getState().open(m.id);
    expect(await screen.findByText('Última parcial: falta o teste')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'O que saiu?' })).not.toBeInTheDocument();
  });

  it('a mission in progress offers Parcial, which opens the partial sheet', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Em curso', status: 'doing' });
    render(<><MissionSheetHost /><PartialSheetHost /></>);
    useMissionSheet.getState().open(m.id);
    await user.click(await screen.findByRole('button', { name: 'Parcial' }));
    expect(await screen.findByRole('dialog', { name: 'Parcial' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Missão' })).not.toBeInTheDocument();
  });
});
