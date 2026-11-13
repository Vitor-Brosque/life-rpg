import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Journey } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { newRecord, put } from '../src/db/repo';
import { addPracticeError, createPracticeSession, errorToCardDraft } from '../src/domain/practiceActions';
import { deleteNote, saveDeck } from '../src/domain/studyActions';
import { PracticeScreen } from '../src/features/practice/PracticeScreen';
import { ToastHost, useToast } from '../src/ui/Toast';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
});
afterEach(() => { vi.useRealTimers(); window.history.pushState({}, '', '/'); });

const get = async (id: string) => (await db.practiceSessions.get(id))!;
const renderAt = (id: string) => {
  window.history.pushState({}, '', `/pratica/${id}`);
  render(<><PracticeScreen id={id} /><ToastHost /></>);
  return screen.findByRole('region', { name: /^Registro de erros/ });
};

describe('Registro de erros', () => {
  it('the sheet validates, saves with Ctrl+Enter (the step stays), edits, and Apagar offers Desfazer', async () => {
    const user = userEvent.setup();
    const s = await createPracticeSession({ title: 'Dedup' });
    const log = await renderAt(s.id);
    expect(within(log).getByText(/^Errar faz parte de programar\./)).toBeInTheDocument();
    await user.click(within(log).getByRole('button', { name: 'Registrar erro' }));
    const dialog = await screen.findByRole('dialog', { name: 'Registrar erro' });
    await user.click(within(dialog).getByRole('button', { name: 'Salvar erro' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Descreva o que deu errado.');
    await user.type(within(dialog).getByLabelText('O que deu errado?'), 'usei return no for');
    await user.type(within(dialog).getByLabelText('Por quê?'), 'sai na primeira volta');
    await user.type(within(dialog).getByLabelText('Qual é a ideia correta?'), 'acumular e retornar depois');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await within(log).findByText('usei return no for')).toBeInTheDocument();
    expect(within(log).getByText('Por quê: sai na primeira volta')).toBeInTheDocument();
    expect(within(log).getByText('Ideia correta: acumular e retornar depois')).toBeInTheDocument();
    expect(within(log).getByRole('heading', { name: 'Registro de erros (1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Problema' })).toBeInTheDocument();
    expect((await get(s.id)).step).toBe('problem');
    expect(within(log).getByRole('button', { name: 'Registrar erro' })).toHaveFocus();

    await user.click(within(log).getByRole('button', { name: 'Editar erro: usei return no for' }));
    const edit = await screen.findByRole('dialog', { name: 'Editar erro' });
    expect(within(edit).getByLabelText('O que deu errado?')).toHaveValue('usei return no for');
    await user.type(within(edit).getByLabelText('O que deu errado?'), ' do loop');
    await user.click(within(edit).getByRole('button', { name: 'Salvar erro' }));
    expect(await within(log).findByText('usei return no for do loop')).toBeInTheDocument();
    await waitFor(() => expect(within(log).getByRole('button', { name: 'Editar erro: usei return no for do loop' })).toHaveFocus());

    await user.click(within(log).getByRole('button', { name: 'Apagar erro: usei return no for do loop' }));
    await waitFor(async () => expect((await get(s.id)).errors).toHaveLength(0));
    // the focused row is gone: focus lands on the list heading, never on <body>
    await waitFor(() => expect(within(log).getByRole('heading', { name: 'Registro de erros' })).toHaveFocus());
    await user.click(await screen.findByRole('button', { name: 'Desfazer' }));
    await waitFor(async () => expect((await get(s.id)).errors).toHaveLength(1));
    await waitFor(() => expect(document.body).not.toHaveFocus());
    await waitFor(() => expect(log.contains(document.activeElement)).toBe(true));
  });

  it('chooses the drafts deck and turns an entry into a card draft, once', async () => {
    const user = userEvent.setup();
    await put('journeys', newRecord<Journey>({ id: 'j-tech', title: 'Tech News', status: 'active', order: 0 }));
    const tech = await saveDeck({ name: 'Tech News', journeyId: 'j-tech' });
    const sql = await saveDeck({ name: 'SQL' });
    const s = await createPracticeSession({ title: 'Dedup', journeyId: 'j-tech' });
    await addPracticeError(s.id, { what: 'usei return no for', why: 'sai na primeira volta', fix: 'acumular e retornar depois' });
    const log = await renderAt(s.id);
    const select = await within(log).findByLabelText('Rascunhos de card vão para');
    await waitFor(() => expect(select).toHaveValue(tech.id));
    await user.selectOptions(select, 'SQL');
    await waitFor(async () => expect((await get(s.id)).deckId).toBe(sql.id));
    await user.click(within(log).getByRole('button', { name: 'Virar card: usei return no for' }));
    expect(await screen.findByText('Rascunho de card salvo')).toBeInTheDocument();
    const link = await within(log).findByRole('link', { name: 'Rascunho de card · abrir: usei return no for' });
    const note = (await db.notes.toArray()).find((n) => !n.deleted)!;
    expect(link).toHaveAttribute('href', `/estudo/nota/${note.id}`);
    expect(note).toMatchObject({ draft: true, deckId: sql.id, back: 'acumular e retornar depois', extra: 'sai na primeira volta' });
    expect(within(log).queryByRole('button', { name: /^Virar card/ })).toBeNull();
    await waitFor(() => expect(link).toHaveFocus());
    await user.selectOptions(select, 'Caixa de entrada');
    await waitFor(async () => expect((await get(s.id)).deckId).toBeUndefined());
  });

  it('a deleted draft brings "Virar card" back', async () => {
    const s = await createPracticeSession({ title: 'Dedup' });
    const e = await addPracticeError(s.id, { what: 'esqueci o commit', why: '', fix: '' });
    const note = await errorToCardDraft(s.id, e.id);
    await deleteNote(note.id);
    const log = await renderAt(s.id);
    expect(await within(log).findByRole('button', { name: 'Virar card: esqueci o commit' })).toBeInTheDocument();
  });
});
