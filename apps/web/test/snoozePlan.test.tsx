import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { completeMission, createMission, setDayMode } from '../src/domain/actions';
import { planMission } from '../src/domain/missionActions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { SnoozeDialog } from '../src/features/agora/SnoozeDialog';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { useCompanion } from '../src/features/companion/store';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at, seedBlocks } from './blockFixture';

const TODAY = '2026-11-11'; // Wednesday

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 9, 30));
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
  await setDayMode('normal');
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: TODAY, emptyDay: undefined });
  useCompanion.getState().clear();
  useToast.getState().dismiss();
});
afterEach(() => { vi.useRealTimers(); });

describe('planMission', () => {
  it('saves the plan, counts a postponement and logs a plan snooze', async () => {
    const m = await createMission({ title: 'Estudar SQL', postponeCount: 1, dayOrder: 2, firstStep: 'abrir o livro' });
    await planMission(m.id, { cueBlockId: 'b1', firstStep: '  abrir o editor  ', date: '2026-11-12' });
    const after = await db.missions.get(m.id);
    expect(after).toMatchObject({
      cueBlockId: 'b1', firstStep: 'abrir o editor', date: '2026-11-12', postponeCount: 2,
    });
    expect(after?.dayOrder).toBeUndefined();
    const ev = (await db.events.where('missionId').equals(m.id).toArray()).find((e) => e.type === 'snoozed');
    expect(ev?.data).toEqual({ option: { date: '2026-11-12' }, plan: true });
  });

  it('an empty first step removes it, no block clears the cue, and the step is cut at 140', async () => {
    const m = await createMission({ title: 'A', postponeCount: 1, firstStep: 'x', cueBlockId: 'b1' });
    await planMission(m.id, { firstStep: '   ', date: '2026-11-12' });
    const a = await db.missions.get(m.id);
    expect(a?.firstStep).toBeUndefined();
    expect(a?.cueBlockId).toBeUndefined();
    await planMission(m.id, { cueBlockId: 'b1', firstStep: 'y'.repeat(200), date: '2026-11-12' });
    expect((await db.missions.get(m.id))?.firstStep).toHaveLength(140);
  });

  it('completing the mission removes the cue', async () => {
    const m = await createMission({ title: 'B', postponeCount: 1 });
    await planMission(m.id, { cueBlockId: 'b1', date: TODAY });
    await completeMission(m.id);
    const a = await db.missions.get(m.id);
    expect(a?.status).toBe('done');
    expect(a?.cueBlockId).toBeUndefined();
  });
});

describe('SnoozeDialog plan', () => {
  const renderDialog = (mission: { id: string; title: string; postponeCount: number; firstStep?: string }) => {
    const onClose = vi.fn();
    render(<><SnoozeDialog mission={mission} today={TODAY} onClose={onClose} /><ToastHost /></>);
    return onClose;
  };

  it('a first-time postponement has no plan block', async () => {
    const m = await createMission({ title: 'Nova', postponeCount: 0 });
    renderDialog(m);
    expect(await screen.findByRole('button', { name: 'Amanhã' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fazer um plano/ })).not.toBeInTheDocument();
  });

  it('after a previous postponement the plan opens on demand and saves for the next block occurrence', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Estudar SQL', postponeCount: 1, firstStep: 'abrir o livro' });
    const onClose = renderDialog(m);
    const toggle = await screen.findByRole('button', { name: 'Fazer um plano (opcional)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Quando?')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveFocus();

    const when = screen.getByLabelText('Quando?');
    const names = within(when).getAllByRole('option').map((o) => o.textContent ?? '');
    expect(names[0]).toBe('Sem bloco');
    expect(names.some((n) => n.startsWith('Tech'))).toBe(true);
    expect(screen.queryByRole('button', { name: /Guardar para o próximo/ })).not.toBeInTheDocument();

    const step = screen.getByLabelText('Então, o primeiro passo:');
    expect(step).toHaveValue('abrir o livro');
    expect(step).toHaveAttribute('maxlength', '140');

    await user.selectOptions(when, 'b1'); // Tech 09:00 already started at 09:30 -> tomorrow
    await user.clear(step);
    await user.type(step, 'abrir o editor');
    await user.click(screen.getByRole('button', { name: 'Guardar para o próximo Tech' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await db.missions.get(m.id)).toMatchObject({
      cueBlockId: 'b1', firstStep: 'abrir o editor', date: '2026-11-12', postponeCount: 2,
    });
  });

  it('a block that has not started yet is kept for today', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Treinar', postponeCount: 2 });
    renderDialog(m);
    await user.click(await screen.findByRole('button', { name: 'Fazer um plano (opcional)' }));
    await user.selectOptions(screen.getByLabelText('Quando?'), 'b2'); // Treino 12:30
    await user.click(screen.getByRole('button', { name: 'Guardar para o próximo Treino' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.date).toBe(TODAY));
  });
});

describe('plan in the Agora', () => {
  it('inside the chosen block the cue mission leads and shows "Plano: bloco → primeiro passo"', async () => {
    await createMission({ title: 'Outra importante', important: true, areaId: 'area-vigor', postponeCount: 0 });
    const m = await createMission({ title: 'Estudar SQL', postponeCount: 1 });
    await planMission(m.id, { cueBlockId: 'b1', firstStep: 'abrir o editor', date: TODAY });
    render(<><AgoraScreen /><ToastHost /></>);
    const card = await screen.findByRole('region', { name: 'Missão agora' });
    expect(await within(card).findByText('Plano: Tech → abrir o editor')).toBeInTheDocument();
    expect(within(card).getByText('Estudar SQL')).toBeInTheDocument();
  });
});
