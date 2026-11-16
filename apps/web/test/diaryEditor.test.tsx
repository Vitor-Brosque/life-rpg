import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { DiaryEntry, Journey } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { createMission } from '../src/domain/actions';
import { saveDiaryEntry, trashDiaryEntry } from '../src/domain/diaryActions';
import { DiaryEditorScreen } from '../src/features/diary/DiaryEditor';
import { DiaryTrashScreen } from '../src/features/diary/DiaryTrash';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at } from './blockFixture';

const DRAFT_KEY = 'life-rpg.diary.draft';
const entry = (id: string) => db.diaryEntries.get(id) as Promise<DiaryEntry>;
const pause = (ms: number) => new Promise((res) => setTimeout(res, ms));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 21, 5));
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
});
afterEach(() => { vi.useRealTimers(); });

function renderEditor(id: string) {
  const loc = memoryLocation({ path: `/diario/${id}`, record: true });
  const view = render(<Router hook={loc.hook}><DiaryEditorScreen id={id} /><ToastHost /></Router>);
  return { ...view, loc };
}
const seed = (id: string, text = 'Hoje rendeu.') =>
  saveDiaryEntry(id, { text, day: '2026-11-11', at: at(11, 21, 5), themes: [], links: [], private: false });

describe('writing', () => {
  it('Escrever, write and leave: the entry exists with day and time; opening wrote nothing', async () => {
    const user = userEvent.setup();
    const queued = await db.outbox.count();
    renderEditor('e1');
    expect(await screen.findByRole('heading', { name: 'Nova entrada' })).toBeInTheDocument();
    const box = screen.getByLabelText('Texto da entrada');
    expect(box).toHaveFocus();
    expect(screen.getByText('Quarta-feira, 11/11 · 21:05')).toBeInTheDocument();
    expect(await db.diaryEntries.count()).toBe(0);
    expect(await db.outbox.count()).toBe(queued);
    await user.type(box, 'Hoje rendeu.');
    await waitFor(async () => expect(await entry('e1')).toMatchObject({
      kind: 'livre', day: '2026-11-11', at: at(11, 21, 5), text: 'Hoje rendeu.', themes: [], links: [], private: false,
    }));
    expect((await entry('e1')).editedAt).toBeUndefined();
    expect(await screen.findByText('Salvo às 21:05.')).toBeInTheDocument();
  });

  it('leaving right after typing saves without waiting for the pause', async () => {
    const user = userEvent.setup();
    const { unmount } = renderEditor('e1');
    await user.type(await screen.findByLabelText('Texto da entrada'), 'Rápido');
    unmount();
    await waitFor(async () => expect((await entry('e1'))?.text).toBe('Rápido'));
  });

  it('only spaces never creates the entry; a newborn emptied before leaving is deleted', async () => {
    const user = userEvent.setup();
    const { unmount } = renderEditor('e1');
    const box = await screen.findByLabelText('Texto da entrada');
    await user.type(box, '   ');
    await pause(1200);
    expect(await db.diaryEntries.count()).toBe(0);
    await user.type(box, 'a');
    await waitFor(async () => expect((await entry('e1'))?.text).toBe('   a'));
    await user.clear(box);
    unmount();
    await waitFor(async () => expect(await entry('e1')).toMatchObject({ deleted: true, text: '' }));
  });

  it('editing an existing entry marks editedAt; an emptied old entry keeps its last text', async () => {
    const user = userEvent.setup();
    await seed('e1');
    vi.setSystemTime(at(12, 9));
    const { unmount } = renderEditor('e1');
    expect(await screen.findByRole('heading', { name: 'Entrada do diário' })).toBeInTheDocument();
    const box = screen.getByLabelText('Texto da entrada');
    expect(box).toHaveValue('Hoje rendeu.');
    await user.clear(box);
    await user.type(box, 'Novo texto');
    await waitFor(async () => expect(await entry('e1')).toMatchObject({ text: 'Novo texto', editedAt: at(12, 9) }));
    await user.clear(box);
    expect(screen.getByText('Texto vazio não é salvo. Para tirar a entrada, use Apagar.')).toBeInTheDocument();
    unmount();
    await pause(50);
    expect(await entry('e1')).toMatchObject({ text: 'Novo texto', deleted: false });
  });

  it('Mudar data e hora: the logical day and the time; before the day start is the next morning', async () => {
    const user = userEvent.setup();
    await seed('e1');
    renderEditor('e1');
    await user.click(await screen.findByRole('button', { name: 'Mudar data e hora' }));
    fireEvent.change(screen.getByLabelText('Dia'), { target: { value: '2026-11-10' } });
    await waitFor(async () => expect(await entry('e1')).toMatchObject({ day: '2026-11-10', at: at(10, 21, 5) }));
    fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '01:30' } });
    await waitFor(async () => expect(await entry('e1')).toMatchObject({ day: '2026-11-10', at: at(11, 1, 30) }));
    expect(screen.getByText('Terça-feira, 10/11 · 01:30')).toBeInTheDocument();
  });

  it('a draft kept while the app was in the background comes back and is saved', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      id: 'e9', text: 'Meio escrito', day: '2026-11-11', at: at(11, 20), themes: ['sono'], links: [], private: false,
    }));
    renderEditor('e9');
    expect(await screen.findByLabelText('Texto da entrada')).toHaveValue('Meio escrito');
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    await waitFor(async () => expect(await entry('e9')).toMatchObject({ text: 'Meio escrito', at: at(11, 20), themes: ['sono'] }));
  });

  it('hiding the page keeps the draft locally and saves it', async () => {
    const user = userEvent.setup();
    renderEditor('e1');
    await user.type(await screen.findByLabelText('Texto da entrada'), 'Antes de sair');
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!)).toMatchObject({ id: 'e1', text: 'Antes de sair' });
    await waitFor(async () => expect((await entry('e1'))?.text).toBe('Antes de sair'));
  });
});

describe('options', () => {
  it('themes, private and up to three links', async () => {
    const user = userEvent.setup();
    await seed('e1');
    await put('journeys', newRecord<Journey>({ title: 'Tech News', status: 'active', order: 0 }));
    for (const title of ['Ler cap. 3', 'Lista 2', 'Revisar']) await createMission({ title });
    renderEditor('e1');
    await user.click(await screen.findByRole('button', { name: 'Família' }));
    await waitFor(async () => expect((await entry('e1')).themes).toEqual(['familia']));
    expect(screen.getByRole('button', { name: 'Família' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('switch', { name: 'Privada' }));
    await waitFor(async () => expect((await entry('e1')).private).toBe(true));

    await user.click(screen.getByRole('button', { name: 'Ligar a…' }));
    await user.type(screen.getByLabelText('Buscar missão ou jornada'), 'tech');
    await user.click(screen.getByRole('button', { name: 'jornada: Tech News' }));
    await waitFor(async () => expect((await entry('e1')).links).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Desligar Tech News' })).toHaveFocus());
    for (const title of ['Ler cap. 3', 'Lista 2']) {
      await user.click(screen.getByRole('button', { name: 'Ligar a…' }));
      await user.click(await screen.findByRole('button', { name: `missão: ${title}` }));
    }
    await waitFor(async () => expect((await entry('e1')).links).toHaveLength(3));
    expect(screen.getByRole('button', { name: 'Ligar a…' })).toBeDisabled();
    expect(screen.getByText('Até 3 vínculos por entrada.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desligar Lista 2' }));
    await waitFor(async () => expect((await entry('e1')).links).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Ligar a…' })).toBeEnabled();
  });
});

describe('Apagar and Apagadas recentemente', () => {
  it('Apagar sends the entry to the trash and back to the week; Desfazer restores it', async () => {
    const user = userEvent.setup();
    await seed('e1');
    const { loc } = renderEditor('e1');
    await user.click(await screen.findByRole('button', { name: 'Apagar' }));
    await waitFor(async () => expect((await entry('e1')).trashedAt).toBe(at(11, 21, 5)));
    expect(screen.getByRole('status')).toHaveTextContent('Entrada em Apagadas recentemente.');
    expect(loc.history!.at(-1)).toBe('/diario?semana=2026-11-09');
    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Desfazer' }));
    await waitFor(async () => expect((await entry('e1')).trashedAt).toBeUndefined());
  });

  it('Restaurar, Apagar de vez (confirmed) and Esvaziar', async () => {
    const user = userEvent.setup();
    await seed('e1', 'Primeira');
    await seed('e2', 'Segunda');
    await seed('e3', 'Terceira');
    for (const id of ['e1', 'e2', 'e3']) await trashDiaryEntry(id);
    const loc = memoryLocation({ path: '/diario/apagadas' });
    render(<Router hook={loc.hook}><DiaryTrashScreen /><ToastHost /></Router>);
    const list = await screen.findByRole('list', { name: 'Entradas apagadas' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    const when = 'Quarta-feira, 11/11 · 21:05';
    await user.click(within(list).getAllByRole('button', { name: `Restaurar a entrada de ${when}` })[0]!);
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
    expect(screen.getByRole('status')).toHaveTextContent('Entrada restaurada.');
    expect(document.activeElement).not.toBe(document.body);
    await user.click(within(list).getAllByRole('button', { name: `Apagar de vez a entrada de ${when}` })[0]!);
    await user.click(within(screen.getByRole('group', { name: `Confirmar apagar de vez a entrada de ${when}` })).getByRole('button', { name: 'Apagar de vez' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Esvaziar' }));
    expect(screen.getByText('Apagar de vez 1 entrada? Não dá para desfazer.')).toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: 'Confirmar esvaziar' })).getByRole('button', { name: 'Esvaziar' }));
    expect(await screen.findByText('Nada aqui.')).toBeInTheDocument();
    const all = await db.diaryEntries.toArray();
    expect(all.filter((e) => e.deleted).map((e) => e.text)).toEqual(['', '']);
    expect(all.filter((e) => !e.deleted && e.trashedAt === undefined)).toHaveLength(1);
  });

  it('an entry in the trash opens with Restaurar; a deleted one says so', async () => {
    const user = userEvent.setup();
    await seed('e1');
    await trashDiaryEntry('e1');
    renderEditor('e1');
    expect(await screen.findByText('Esta entrada está em Apagadas recentemente.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restaurar' }));
    expect(await screen.findByLabelText('Texto da entrada')).toHaveValue('Hoje rendeu.');
  });
});
