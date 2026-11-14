import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { logBedtime, saveSleepTimes, setSleepQuality } from '../src/domain/sleepActions';
import { CareStrip } from '../src/features/agora/CareStrip';
import { CorpoScreen } from '../src/features/corpo/CorpoScreen';
import { SleepSheetHost, useSleepSheet } from '../src/features/corpo/SleepSheet';
import { ToastHost, useToast } from '../src/ui/Toast';

const at = (d: number, h: number, m = 0): Date => new Date(2026, 10, d, h, m);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(13, 23, 40));
  await db.delete(); await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
  useSleepSheet.getState().close();
});
afterEach(() => { vi.useRealTimers(); });

const strip = () => <><CareStrip now={Date.now()} inCommitment={false} /><ToastHost /><SleepSheetHost /></>;
const NIGHT = 'sleep-2026-11-13';

describe('qualidade do sono', () => {
  it('after "Acordei" asks how it was (focus on the question); a tap saves the quality and thanks', async () => {
    const user = userEvent.setup();
    await logBedtime('2026-11-13');
    vi.setSystemTime(at(14, 7, 10));
    render(<><h1 tabIndex={-1} data-focus-target="page">Agora</h1>{strip()}</>);
    await user.click(await screen.findByRole('button', { name: 'Acordei' }));
    const group = await screen.findByRole('group', { name: 'Qualidade do sono' });
    const question = within(group).getByText('Como foi o sono?');
    await waitFor(() => expect(document.activeElement).toBe(question));
    expect(within(group).getByText('1 = muito ruim · 5 = muito bom')).toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: '4 de 5: Bom' }));
    await waitFor(async () => expect((await db.sleepLogs.get(NIGHT))!.quality).toBe(4));
    expect(screen.getByRole('status')).toHaveTextContent('Sono anotado: bom.');
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Qualidade do sono' })).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Agora' })));
  });

  it('"Pular" hides the question without writing; focus goes to the page heading', async () => {
    const user = userEvent.setup();
    await logBedtime('2026-11-13');
    vi.setSystemTime(at(14, 7, 10));
    render(<><h1 tabIndex={-1} data-focus-target="page">Agora</h1>{strip()}</>);
    await user.click(await screen.findByRole('button', { name: 'Acordei' }));
    const group = await screen.findByRole('group', { name: 'Qualidade do sono' });
    await user.click(within(group).getByRole('button', { name: 'Pular' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Qualidade do sono' })).not.toBeInTheDocument());
    expect((await db.sleepLogs.get(NIGHT))!.quality).toBeUndefined();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Agora' })));
  });

  it('the night sheet has an optional quality select', async () => {
    const user = userEvent.setup();
    await saveSleepTimes('2026-11-12', '23:30', '07:00');
    render(strip());
    useSleepSheet.getState().open('2026-11-12');
    const sheet = await screen.findByRole('dialog', { name: 'Noite de qui 12/11' });
    await waitFor(() => expect(within(sheet).getByLabelText('Acordei às')).toHaveValue('07:00'));
    await user.selectOptions(within(sheet).getByLabelText('Qualidade (opcional)'), '3');
    await user.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect((await db.sleepLogs.get('sleep-2026-11-12'))!.quality).toBe(3));
  });

  it('Corpo shows the mean perceived quality from 3 nights', async () => {
    vi.setSystemTime(at(14, 9));
    const nights: Array<[string, 1 | 2 | 3 | 4 | 5]> = [['2026-11-11', 4], ['2026-11-12', 3], ['2026-11-13', 4]];
    for (const [n, q] of nights) { await saveSleepTimes(n, '23:30', '07:00'); await setSleepQuality(n, q); }
    const { hook } = memoryLocation({ path: '/corpo' });
    render(<Router hook={hook}><CorpoScreen /></Router>);
    expect(await screen.findByText('Qualidade percebida')).toBeInTheDocument();
    expect(screen.getByText('3,7 de 5 · 3 noites')).toBeInTheDocument();
  });
});
