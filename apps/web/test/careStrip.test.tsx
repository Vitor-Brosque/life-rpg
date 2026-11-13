import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { finishPrep, saveRecipe, setMenuSlot } from '../src/domain/mealActions';
import { saveSleepSettings } from '../src/domain/sleepActions';
import { CareStrip } from '../src/features/agora/CareStrip';
import { SleepSheetHost, useSleepSheet } from '../src/features/corpo/SleepSheet';
import { ToastHost, useToast } from '../src/ui/Toast';

const at = (d: number, h: number, m = 0): Date => new Date(2026, 10, d, h, m);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(13, 22));
  await db.delete(); await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
  useSleepSheet.getState().close();
});
afterEach(() => { vi.useRealTimers(); });

const strip = (inCommitment = false) =>
  <><CareStrip now={Date.now()} inCommitment={inCommitment} /><ToastHost /><SleepSheetHost /></>;
const toastText = () => screen.getByRole('status');

describe('CareStrip — sono', () => {
  it('"Deitei" at night, "Acordei" in the morning, with the duration, the XP and Desfazer', async () => {
    const user = userEvent.setup();
    const view = render(strip());
    const sleep = await screen.findByRole('group', { name: 'Sono' });
    expect(within(sleep).getByText('Indo dormir?')).toBeInTheDocument();
    await user.click(within(sleep).getByRole('button', { name: 'Deitei' }));
    await waitFor(() => expect(toastText()).toHaveTextContent('Boa noite. Deitou às 22:00.'));
    expect(await screen.findByText('Deitou às 22:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar a noite' })).toBeInTheDocument();

    vi.setSystemTime(at(14, 7, 10));
    view.rerender(strip());
    await user.click(screen.getByRole('button', { name: 'Acordei' }));
    await waitFor(() => expect(toastText()).toHaveTextContent('Bom dia. Dormiu 9h10 · +2 XP'));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Sono' })).not.toBeInTheDocument());
    await user.click(within(toastText()).getByRole('button', { name: 'Desfazer' }));
    await waitFor(async () => expect((await db.sleepLogs.get('sleep-2026-11-13'))!.wakeAt).toBeUndefined());
    expect((await db.xpEvents.get('xp-sleep-2026-11-13'))!.deleted).toBe(true);
  });

  it('no "Deitei" during a commitment, none when turned off in Ajustes', async () => {
    const view = render(strip(true));
    await screen.findByRole('status');
    expect(screen.queryByRole('group', { name: 'Sono' })).not.toBeInTheDocument();
    await saveSleepSettings({ agoraPrompt: false });
    view.rerender(strip(false));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Sono' })).not.toBeInTheDocument());
  });

  it('"Acordei" without "Deitei" asks for the bedtime and opens the night sheet', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(at(14, 7));
    render(strip());
    const sleep = await screen.findByRole('group', { name: 'Sono' });
    expect(within(sleep).getByText('Bom dia!')).toBeInTheDocument();
    await user.click(within(sleep).getByRole('button', { name: 'Acordei' }));
    await waitFor(() => expect(toastText()).toHaveTextContent('Bom dia. Que horas deitou?'));
    await user.click(within(toastText()).getByRole('button', { name: 'Informar' }));
    const sheet = await screen.findByRole('dialog', { name: 'Noite de sex 13/11' });
    await waitFor(() => expect(within(sheet).getByLabelText('Acordei às')).toHaveValue('07:00'));
  });
});

describe('Folha da noite', () => {
  it('saves both times with XP, refuses wake before bed, deletes with Desfazer', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(at(13, 15));
    render(strip());
    useSleepSheet.getState().open('2026-11-12');
    const sheet = await screen.findByRole('dialog', { name: 'Noite de qui 12/11' });
    await user.type(within(sheet).getByLabelText('Deitei às'), '23:30');
    await user.type(within(sheet).getByLabelText('Acordei às'), '07:00');
    await user.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(toastText()).toHaveTextContent('Noite salva · +2 XP'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    useSleepSheet.getState().open('2026-11-12');
    const again = await screen.findByRole('dialog', { name: 'Noite de qui 12/11' });
    await waitFor(() => expect(within(again).getByLabelText('Deitei às')).toHaveValue('23:30'));
    await user.clear(within(again).getByLabelText('Deitei às'));
    await user.type(within(again).getByLabelText('Deitei às'), '08:00');
    await user.click(within(again).getByRole('button', { name: 'Salvar' }));
    expect(await within(again).findByRole('alert')).toHaveTextContent('O horário de acordar precisa ser depois do de deitar.');
    await user.click(within(again).getByRole('button', { name: 'Apagar noite' }));
    await waitFor(() => expect(toastText()).toHaveTextContent('Noite apagada.'));
    expect((await db.sleepLogs.get('sleep-2026-11-12'))!.deleted).toBe(true);
    await user.click(within(toastText()).getByRole('button', { name: 'Desfazer' }));
    await waitFor(async () => expect((await db.sleepLogs.get('sleep-2026-11-12'))!.deleted).toBe(false));
  });

  it('without a night it registers a forgotten one, last night by default', async () => {
    vi.setSystemTime(at(14, 15));
    render(strip());
    useSleepSheet.getState().open();
    const sheet = await screen.findByRole('dialog', { name: 'Registrar uma noite' });
    expect(within(sheet).getByLabelText('Noite de')).toHaveValue('2026-11-13');
  });
});

describe('CareStrip — refeição', () => {
  it('shows the planned dish with its portions; "Comi uma" takes one out and hides the row', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(at(13, 12));
    const r = await saveRecipe({ name: 'Frango com arroz', ingredients: 'frango' });
    await setMenuSlot('2026-11-09', '2026-11-13', 'almoco', r.id);
    await finishPrep([{ recipeId: r.id, portions: 4 }]);
    render(strip());
    const meal = await screen.findByRole('group', { name: 'Refeição' });
    expect(meal).toHaveTextContent('Almoço: Frango com arroz · 4 no freezer');
    await user.click(within(meal).getByRole('button', { name: 'Comi uma: Frango com arroz' }));
    await waitFor(() => expect(toastText()).toHaveTextContent('Bom proveito. No freezer: 3 marmitas.'));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Refeição' })).not.toBeInTheDocument());
  });

  it('a planned dish with nothing frozen shows no button; no dish, no row', async () => {
    vi.setSystemTime(at(13, 20));
    const r = await saveRecipe({ name: 'Omelete', ingredients: 'ovos' });
    await setMenuSlot('2026-11-09', '2026-11-13', 'jantar', r.id);
    render(strip());
    const meal = await screen.findByRole('group', { name: 'Refeição' });
    expect(meal).toHaveTextContent('Jantar: Omelete');
    expect(within(meal).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('CareStrip — foco', () => {
  it('after "Acordei" hides the row, focus goes to the page heading, not to the body', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(at(14, 7, 10));
    await db.sleepLogs.put({ id: 'sleep-2026-11-13', createdAt: 1, updatedAt: 1, deleted: false, night: '2026-11-13', bedAt: at(13, 22).getTime() });
    render(<><h1 tabIndex={-1} data-focus-target="page">Agora</h1>{strip()}</>);
    await user.click(await screen.findByRole('button', { name: 'Acordei' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Sono' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Agora' })).toHaveFocus());
  });
});
