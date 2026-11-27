import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INVESTIGATED_HINT } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { completeMission, createMission, setDayMode, startBlock } from '../src/domain/actions';
import { closePartial } from '../src/domain/missionActions';
import { ResumePromptHost, useResumePrompt } from '../src/features/agora/ResumePrompt';
import { DayCloseSheetHost } from '../src/features/dayClose/DayCloseSheet';
import { useDayCloseSheet } from '../src/features/dayClose/useDayClose';
import { PartialSheetHost, usePartialSheet } from '../src/features/mission/PartialSheet';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at, seedBlocks } from './blockFixture';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 9, 30));   // Wednesday 11/11: "Tech" (b1) is the current block
  localStorage.clear();
  usePartialSheet.setState({ missionId: undefined });
  useResumePrompt.setState({ request: undefined });
  useDayCloseSheet.getState().close();
  useToast.getState().dismiss();
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
});
afterEach(() => { vi.useRealTimers(); });

describe('"Investiguei"', () => {
  it('in the Parcial: the chip marks the partial event; the toast says "Investigação anotada"; never a postponement', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Integrar API', status: 'doing', postponeCount: 1 });
    render(<><PartialSheetHost /><ToastHost /></>);
    usePartialSheet.getState().open(m.id);
    const d = await screen.findByRole('dialog', { name: 'Parcial' });
    const group = within(d).getByRole('group', { name: 'Foi investigação? (opcional)' });
    expect(within(group).queryByText(INVESTIGATED_HINT)).not.toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: 'Investiguei' }));
    expect(within(group).getByRole('button', { name: 'Investiguei' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByText(INVESTIGATED_HINT)).toBeInTheDocument();
    await user.type(within(d).getByRole('textbox', { name: 'O que saiu? (opcional)' }), 'Li a doc');
    await user.click(within(d).getByRole('button', { name: 'Amanhã' }));
    expect(await screen.findByText('Investigação anotada. Guardada para amanhã.')).toBeInTheDocument();
    const events = await db.events.where('missionId').equals(m.id).toArray();
    expect(events.find((e) => e.type === 'partial')!.data).toEqual({ option: 'tomorrow', result: 'Li a doc', investigated: true });
    expect(events.some((e) => e.type === 'snoozed' || e.type === 'rescheduled')).toBe(false);
    expect(await db.missions.get(m.id)).toMatchObject({ status: 'open', postponeCount: 1 });
  });

  it('ending a block: Investiguei among the outcomes, with its hint, saved on the session', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    await startBlock('b1');
    render(<><ResumePromptHost /><ToastHost /></>);
    act(() => useResumePrompt.getState().open({ blockId: 'b1', endsBlock: true }));
    const d = await screen.findByRole('dialog', { name: 'Onde parou?' });
    const outcomes = within(d).getByRole('group', { name: 'Como foi? (opcional)' });
    await user.click(within(outcomes).getByRole('button', { name: 'Investiguei' }));
    expect(within(outcomes).getByText(INVESTIGATED_HINT)).toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect((await db.blockSessions.get('bs-b1-2026-11-11'))?.outcome).toBe('investiguei'));
  });

  it('the day close counts investigations apart from partials', async () => {
    vi.setSystemTime(at(11, 23, 10));
    const done = await createMission({ title: 'Pauta', status: 'doing' });
    await completeMission(done.id);
    const a = await createMission({ title: 'Lista 3', status: 'doing' });
    await closePartial(a.id, { when: 'later' });
    const b = await createMission({ title: 'Integrar API', status: 'doing' });
    await closePartial(b.id, { when: 'later', investigated: true });
    render(<DayCloseSheetHost />);
    act(() => useDayCloseSheet.getState().open());
    const s = await screen.findByRole('dialog', { name: 'Como foi hoje' });
    expect(await within(s).findByText('1 missão concluída · 1 parcial · 1 investigação')).toBeInTheDocument();
  });
});
