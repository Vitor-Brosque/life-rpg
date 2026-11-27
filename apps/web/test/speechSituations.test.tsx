import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechSituation } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { DayCloseSheetHost } from '../src/features/dayClose/DayCloseSheet';
import { useDayCloseSheet } from '../src/features/dayClose/useDayClose';
import { SituationSheetHost, useSituationSheet } from '../src/features/speech/SituationSheet';
import { SpeechScreen } from '../src/features/speech/SpeechScreen';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at } from './blockFixture';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(23, 21));
  await db.delete();
  await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
  useDayCloseSheet.getState().close();
  useSituationSheet.setState({ isOpen: false, draft: { note: '' } });
});
afterEach(() => {
  vi.useRealTimers();
  window.history.pushState({}, '', '/');
});

const renderFala = () => {
  window.history.pushState({}, '', '/estudo/fala');
  return render(<><SpeechScreen /><SituationSheetHost /><ToastHost /></>);
};
const seedSituation = () => put('speechSituations', newRecord<SpeechSituation>({
  day: '2026-11-23', at: at(23, 20), context: 'aula', repeats: 0, clarity: 4,
}));

describe('Situação real', () => {
  it('registers from the Fala screen with the touched fields only', async () => {
    const user = userEvent.setup();
    renderFala();
    await user.click(await screen.findByRole('button', { name: 'Registrar situação real' }));
    const dialog = await screen.findByRole('dialog', { name: 'Situação real' });
    const register = within(dialog).getByRole('button', { name: 'Registrar' });
    expect(register).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Aula' }));
    await user.click(within(dialog).getByRole('button', { name: '0' }));
    await user.click(within(dialog).getByRole('button', { name: 'Clareza percebida: 4 de 5' }));
    await user.type(within(dialog).getByLabelText('Uma frase (opcional)'), 'Perguntei sem travar');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText('Situação registrada.')).toBeInTheDocument();
    expect(await screen.findByText('23/11 · Aula · pediram para repetir nenhuma vez · clareza 4')).toBeInTheDocument();
    expect(screen.getByText('"Perguntei sem travar"')).toBeInTheDocument();
    const [s] = await db.speechSituations.toArray();
    expect(s).toMatchObject({ context: 'aula', repeats: 0, clarity: 4, note: 'Perguntei sem travar', day: '2026-11-23' });
    expect(s).not.toHaveProperty('comfort');
  });

  it('the draft survives closing the sheet; nothing is written', async () => {
    const user = userEvent.setup();
    renderFala();
    await user.click(await screen.findByRole('button', { name: 'Registrar situação real' }));
    let dialog = await screen.findByRole('dialog', { name: 'Situação real' });
    await user.click(within(dialog).getByRole('button', { name: 'Conversa' }));
    await user.type(within(dialog).getByLabelText('Uma frase (opcional)'), 'Falei rápido');
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Registrar situação real' }));
    dialog = await screen.findByRole('dialog', { name: 'Situação real' });
    expect(within(dialog).getByRole('button', { name: 'Conversa' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByDisplayValue('Falei rápido')).toBeInTheDocument();
    expect(await db.speechSituations.count()).toBe(0);
  });

  it('deleting keeps focus on the register button, and Desfazer brings it back', async () => {
    await seedSituation();
    const user = userEvent.setup();
    renderFala();
    await user.click(await screen.findByRole('button', { name: 'Apagar situação de 23/11 (Aula)' }));
    expect(await screen.findByText('Situação apagada.')).toBeInTheDocument();
    expect(await screen.findByText('Nenhuma situação registrada ainda.')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Registrar situação real' })));
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(await screen.findByText(/^23\/11 · Aula/)).toBeInTheDocument();
  });

  it('from "Como foi hoje?": what he tapped is kept, the day is not closed', async () => {
    const user = userEvent.setup();
    render(<><DayCloseSheetHost /><SituationSheetHost /><ToastHost /></>);
    act(() => useDayCloseSheet.getState().open());
    const day = await screen.findByRole('dialog', { name: 'Como foi hoje' });
    const tired = await within(day).findByRole('group', { name: /Cansaço/ });
    await user.click(within(tired).getByRole('button', { name: 'Médio' }));
    await user.click(within(day).getByRole('button', { name: 'Situação de fala' }));
    expect(await screen.findByRole('dialog', { name: 'Situação real' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Como foi hoje' })).toBeNull());
    const state = await db.dayState.get('2026-11-23');
    expect(state).toMatchObject({ tiredness: 'medio' });
    expect(state!.closedAt).toBeUndefined();
  });

  it('opening the Fala screen and the sheet writes nothing', async () => {
    const user = userEvent.setup();
    renderFala();
    const outbox = await db.outbox.count();
    await user.click(await screen.findByRole('button', { name: 'Registrar situação real' }));
    await screen.findByRole('dialog', { name: 'Situação real' });
    expect(await db.outbox.count()).toBe(outbox);
  });

  it('Registrar twice quickly logs one situation', async () => {
    const user = userEvent.setup();
    renderFala();
    await user.click(await screen.findByRole('button', { name: 'Registrar situação real' }));
    const dialog = await screen.findByRole('dialog', { name: 'Situação real' });
    await user.click(within(dialog).getByRole('button', { name: 'Aula' }));
    const register = within(dialog).getByRole('button', { name: 'Registrar' });
    fireEvent.click(register);
    fireEvent.click(register);
    expect(await screen.findByText('Situação registrada.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await db.speechSituations.count()).toBe(1);
  });

  it('after Registrar focus is on the opener, the draft is empty on reopening, and Desfazer keeps focus off <body>', async () => {
    const user = userEvent.setup();
    renderFala();
    const opener = await screen.findByRole('button', { name: 'Registrar situação real' });
    await user.click(opener);
    let dialog = await screen.findByRole('dialog', { name: 'Situação real' });
    await user.click(within(dialog).getByRole('button', { name: 'Aula' }));
    await user.type(within(dialog).getByLabelText('Uma frase (opcional)'), 'Oi');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText('Situação registrada.')).toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
    await user.click(opener);
    dialog = await screen.findByRole('dialog', { name: 'Situação real' });
    expect(within(dialog).getByRole('button', { name: 'Aula' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(dialog).getByLabelText('Uma frase (opcional)')).toHaveValue('');
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Fala' })).toHaveFocus());
    await waitFor(async () => expect((await db.speechSituations.toArray())[0]!.deleted).toBe(true));
  });

  it('Desfazer of "Situação apagada." keeps focus off <body>', async () => {
    await seedSituation();
    const user = userEvent.setup();
    renderFala();
    await user.click(await screen.findByRole('button', { name: 'Apagar situação de 23/11 (Aula)' }));
    await screen.findByText('Nenhuma situação registrada ainda.');
    await user.click(await screen.findByRole('button', { name: 'Desfazer' }));
    await screen.findByText(/^23\/11 · Aula/);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Fala' })).toHaveFocus());
  });

  it('from "Como foi hoje?": focus enters the Situação real dialog and is not on <body> after closing it', async () => {
    const user = userEvent.setup();
    render(<><h1 tabIndex={-1} data-focus-target="page">Tela</h1><DayCloseSheetHost /><SituationSheetHost /><ToastHost /></>);
    act(() => useDayCloseSheet.getState().open());
    const day = await screen.findByRole('dialog', { name: 'Como foi hoje' });
    await user.click(await within(day).findByRole('button', { name: 'Situação de fala' }));
    const dialog = await screen.findByRole('dialog', { name: 'Situação real' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });

  it('tapping a chosen chip again stores no field; only the context is stored', async () => {
    const user = userEvent.setup();
    renderFala();
    await user.click(await screen.findByRole('button', { name: 'Registrar situação real' }));
    const dialog = await screen.findByRole('dialog', { name: 'Situação real' });
    await user.click(within(dialog).getByRole('button', { name: 'Aula' }));
    for (const name of ['1', 'Clareza percebida: 3 de 5', 'Conforto: 2 de 5']) {
      await user.click(within(dialog).getByRole('button', { name }));
      await user.click(within(dialog).getByRole('button', { name }));
      expect(within(dialog).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    await screen.findByText('Situação registrada.');
    const [s] = await db.speechSituations.toArray();
    expect(s).toMatchObject({ context: 'aula' });
    for (const k of ['repeats', 'clarity', 'comfort', 'note']) expect(s).not.toHaveProperty(k);
  });
});
