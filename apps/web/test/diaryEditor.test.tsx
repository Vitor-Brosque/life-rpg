import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Router, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { DiaryEntry, DiaryTheme, Journey } from '@life/shared';
import { db } from '../src/db/db';
import { applyRemote, newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { createMission } from '../src/domain/actions';
import { withLock } from '../src/domain/common';
import {
  diaryLockKey, restoreDiaryEntry, saveCloseNote, saveDiaryEntry, trashDiaryEntry, type DiaryDraft,
} from '../src/domain/diaryActions';
import { DiaryEditorScreen } from '../src/features/diary/DiaryEditor';
import { readDiaryDraft, writeDiaryDraft } from '../src/features/diary/diaryDraft';
import { DiaryScreen } from '../src/features/diary/DiaryScreen';
import { DiaryTrashScreen } from '../src/features/diary/DiaryTrash';
import { FOCUS_PAGE } from '../src/ui/focusAfter';
import { FAILURE_TOAST } from '../src/ui/safeRun';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at } from './blockFixture';

const entry = (id: string) => db.diaryEntries.get(id) as Promise<DiaryEntry>;
const pause = (ms: number) => new Promise((res) => setTimeout(res, ms));
/** An empty task on the entry's lock (writes nothing): resolves once every write already queued on that entry has finished. */
const queuedWritesDone = (id: string) => withLock(diaryLockKey(id), async () => undefined);
const keptDraft = (text = 'Meio escrito', themes: DiaryTheme[] = []): DiaryDraft => ({
  text, day: '2026-11-11', at: at(11, 20), themes, links: [], private: false,
});

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
    await queuedWritesDone('e1');
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
    writeDiaryDraft('e9', keptDraft('Meio escrito', ['sono']));   // a never-saved entry: no base
    renderEditor('e9');
    expect(await screen.findByLabelText('Texto da entrada')).toHaveValue('Meio escrito');
    await waitFor(async () => expect(await entry('e9')).toMatchObject({ text: 'Meio escrito', at: at(11, 20), themes: ['sono'] }));
    await waitFor(() => expect(readDiaryDraft('e9')).toBeUndefined());
  });

  it('hiding the page keeps the draft locally and saves it', async () => {
    const user = userEvent.setup();
    renderEditor('e1');
    await user.type(await screen.findByLabelText('Texto da entrada'), 'Antes de sair');
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(readDiaryDraft('e1')).toMatchObject({ id: 'e1', draft: { text: 'Antes de sair' } });
    await waitFor(async () => expect((await entry('e1'))?.text).toBe('Antes de sair'));
    await waitFor(() => expect(readDiaryDraft('e1')).toBeUndefined());
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

function failNextTransaction() {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(db, 'transaction').mockImplementationOnce((() => Promise.reject(new Error('disk'))) as never);
}

describe('fix round 1', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('a newborn entry stays new for the whole session: emptied after the first autosave it is removed, no editedAt', async () => {
    const user = userEvent.setup();
    const { unmount } = renderEditor('e1');
    const box = await screen.findByLabelText('Texto da entrada');
    await user.type(box, 'abc');
    expect(await screen.findByText('Salvo às 21:05.')).toBeInTheDocument();
    await user.type(box, 'd');
    await waitFor(async () => expect((await entry('e1')).text).toBe('abcd'));
    expect((await entry('e1')).editedAt).toBeUndefined();
    expect(screen.getByRole('heading', { name: 'Nova entrada' })).toBeInTheDocument();
    await user.clear(box);
    unmount();
    await waitFor(async () => expect(await entry('e1')).toMatchObject({ deleted: true, text: '' }));
    expect((await entry('e1')).editedAt).toBeUndefined();
  });

  it('a failed save keeps the text pending: leaving retries it', async () => {
    const user = userEvent.setup();
    const { unmount } = renderEditor('e1');
    failNextTransaction();
    await user.type(await screen.findByLabelText('Texto da entrada'), 'abc');
    expect(await screen.findByText(FAILURE_TOAST, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(await db.diaryEntries.count()).toBe(0);
    unmount();
    await waitFor(async () => expect((await entry('e1'))?.text).toBe('abc'));
  });

  it('a restored draft stays on the device until its text is really saved', async () => {
    writeDiaryDraft('e9', keptDraft());
    failNextTransaction();
    renderEditor('e9');
    expect(await screen.findByLabelText('Texto da entrada')).toHaveValue('Meio escrito');
    expect(readDiaryDraft('e9')).toBeDefined();
    expect(await screen.findByText(FAILURE_TOAST, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(readDiaryDraft('e9')?.draft.text).toBe('Meio escrito');
  });

  it('Restaurar on the trashed-entry screen moves focus to the editor heading', async () => {
    const user = userEvent.setup();
    await seed('e1');
    await trashDiaryEntry('e1');
    renderEditor('e1');
    await user.click(await screen.findByRole('button', { name: 'Restaurar' }));
    await screen.findByLabelText('Texto da entrada');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Entrada do diário' })).toHaveFocus());
  });

  it('Pronto and Apagar leave focus on the next screen heading', async () => {
    const user = userEvent.setup();
    await seed('e1');
    const loc = memoryLocation({ path: '/diario/e1' });
    render(<Router hook={loc.hook}><Switch>
      <Route path="/diario/:id">{(p) => <DiaryEditorScreen id={p.id} />}</Route>
      <Route path="/diario"><h1 tabIndex={-1} data-focus-target={FOCUS_PAGE}>Diário</h1></Route>
    </Switch><ToastHost /></Router>);
    await user.click(await screen.findByRole('button', { name: 'Pronto' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Diário' })).toHaveFocus());
    act(() => loc.navigate('/diario/e1'));
    await user.click(await screen.findByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Diário' })).toHaveFocus());
  });

  it('the trash confirmations take focus when opened and give it back on Cancelar', async () => {
    const user = userEvent.setup();
    await seed('e1');
    await trashDiaryEntry('e1');
    const loc = memoryLocation({ path: '/diario/apagadas' });
    render(<Router hook={loc.hook}><DiaryTrashScreen /><ToastHost /></Router>);
    const when = 'Quarta-feira, 11/11 · 21:05';
    await user.click(await screen.findByRole('button', { name: `Apagar de vez a entrada de ${when}` }));
    const row = screen.getByRole('group', { name: `Confirmar apagar de vez a entrada de ${when}` });
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Apagar de vez' })).toHaveFocus());
    await user.click(within(row).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: `Apagar de vez a entrada de ${when}` })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Esvaziar' }));
    const all = screen.getByRole('group', { name: 'Confirmar esvaziar' });
    await waitFor(() => expect(within(all).getByRole('button', { name: 'Esvaziar' })).toHaveFocus());
    await user.click(within(all).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Esvaziar' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Esvaziar' }));
    await user.click(within(screen.getByRole('group', { name: 'Confirmar esvaziar' })).getByRole('button', { name: 'Esvaziar' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Apagadas recentemente' })).toHaveFocus());
  });

  it('Esvaziar that emptied nothing says nothing', async () => {
    const user = userEvent.setup();
    await seed('e1');
    await trashDiaryEntry('e1');
    const loc = memoryLocation({ path: '/diario/apagadas' });
    render(<Router hook={loc.hook}><DiaryTrashScreen /><ToastHost /></Router>);
    await user.click(await screen.findByRole('button', { name: 'Esvaziar' }));
    const confirm = within(screen.getByRole('group', { name: 'Confirmar esvaziar' })).getByRole('button', { name: 'Esvaziar' });
    // Restored (say, on another device) between Esvaziar's scan and its write: the re-check leaves it alone.
    const snap = await db.diaryEntries.toArray();
    const scan = vi.spyOn(db.diaryEntries, 'toArray').mockImplementationOnce((async () => {
      await restoreDiaryEntry('e1');
      return snap;
    }) as never);
    fireEvent.click(confirm);
    await waitFor(() => expect(scan).toHaveBeenCalled());
    await waitFor(async () => expect((await entry('e1')).trashedAt).toBeUndefined());
    await queuedWritesDone('e1');   // resolves after Esvaziar's re-check of e1 and its answer
    expect(useToast.getState().toast).toBeUndefined();
    expect(await entry('e1')).toMatchObject({ text: 'Hoje rendeu.', deleted: false });
  });
});

describe('final fix wave', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const CLOSE = 'diary-close-2026-11-11';
  const notice = () => screen.queryByText(/Há um texto não salvo/);

  /** A draft kept here at 21:30 from version 1; then the record changed elsewhere (12/11 08:00). */
  async function keptThenNewer() {
    const v1 = (await seed('e1', 'Versão 1'))!;
    vi.setSystemTime(at(11, 21, 30));
    writeDiaryDraft('e1', keptDraft('Meio escrito neste aparelho'), v1.updatedAt);
    vi.setSystemTime(at(12, 8));
    await seed('e1', 'Versão do celular');
    const before = await entry('e1');
    const queued = await db.outbox.count();
    renderEditor('e1');
    const box = await screen.findByLabelText('Texto da entrada');
    return { box, before, queued };
  }

  it('a kept draft older than the record: the database text shows, nothing is written, the notice offers both', async () => {
    const { box, before, queued } = await keptThenNewer();
    expect(box).toHaveValue('Versão do celular');
    expect(box).toHaveAttribute('readonly');
    expect(screen.getByText('Escolha um dos textos acima para continuar.')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Há um texto não salvo deste aparelho, de 11/11 21:30.' });
    expect(within(group).getByText('Meio escrito neste aparelho')).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Usar este texto' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    await queuedWritesDone('e1');
    expect(await entry('e1')).toEqual(before);
    expect(await db.outbox.count()).toBe(queued);
    expect(readDiaryDraft('e1')?.draft.text).toBe('Meio escrito neste aparelho');
  });

  it('Usar este texto puts the kept text in the field and saves it; the draft is then forgotten', async () => {
    const user = userEvent.setup();
    const { box } = await keptThenNewer();
    await user.click(screen.getByRole('button', { name: 'Usar este texto' }));
    expect(box).toHaveValue('Meio escrito neste aparelho');
    expect(box).not.toHaveAttribute('readonly');
    expect(notice()).not.toBeInTheDocument();
    await waitFor(() => expect(box).toHaveFocus());
    await waitFor(async () => expect(await entry('e1')).toMatchObject({ text: 'Meio escrito neste aparelho', editedAt: at(12, 8) }));
    await waitFor(() => expect(readDiaryDraft('e1')).toBeUndefined());
  });

  it('Descartar forgets the kept draft and keeps the database text', async () => {
    const user = userEvent.setup();
    const { box, before } = await keptThenNewer();
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(readDiaryDraft('e1')).toBeUndefined();
    expect(notice()).not.toBeInTheDocument();
    expect(box).toHaveValue('Versão do celular');
    await waitFor(() => expect(box).toHaveFocus());
    await queuedWritesDone('e1');
    expect(await entry('e1')).toEqual(before);
  });

  it('a draft based on the record as it still is comes back and is saved, with no notice', async () => {
    const v1 = (await seed('e1', 'Versão 1'))!;
    writeDiaryDraft('e1', keptDraft('Versão 1 e mais um pouco'), v1.updatedAt);
    renderEditor('e1');
    expect(await screen.findByLabelText('Texto da entrada')).toHaveValue('Versão 1 e mais um pouco');
    expect(notice()).not.toBeInTheDocument();
    await waitFor(async () => expect((await entry('e1')).text).toBe('Versão 1 e mais um pouco'));
    await waitFor(() => expect(readDiaryDraft('e1')).toBeUndefined());
  });

  it('hiding the page writes no draft when everything is saved', async () => {
    const user = userEvent.setup();
    await seed('e1');
    renderEditor('e1');
    const box = await screen.findByLabelText('Texto da entrada');
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(readDiaryDraft('e1')).toBeUndefined();
    await user.type(box, '!');
    await waitFor(async () => expect((await entry('e1')).text).toBe('Hoje rendeu.!'));
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(readDiaryDraft('e1')).toBeUndefined();
  });

  it('a save that fails on leaving keeps the text on the device, and the Diário offers Continuar', async () => {
    const { unmount } = renderEditor('e1');
    fireEvent.change(await screen.findByLabelText('Texto da entrada'), { target: { value: 'Não perca isto' } });
    failNextTransaction();
    unmount();
    await waitFor(() => expect(readDiaryDraft('e1')).toMatchObject({ draft: { text: 'Não perca isto' }, keptAt: at(11, 21, 5) }));
    expect(readDiaryDraft('e1')!.base).toBeUndefined();
    expect(await db.diaryEntries.count()).toBe(0);
    const loc = memoryLocation({ path: '/diario' });
    render(<Router hook={loc.hook}><DiaryScreen /></Router>);
    expect(await screen.findByText('Texto não salvo de 11/11 21:05')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continuar o texto de 11/11 21:05' })).toHaveAttribute('href', '/diario/e1');
  });

  it('Apagar de vez and Esvaziar forget the kept drafts of the entries they delete', async () => {
    const user = userEvent.setup();
    for (const id of ['e1', 'e2', 'e3']) await seed(id, `Texto ${id}`);
    await trashDiaryEntry('e1');
    vi.setSystemTime(at(11, 21, 6));
    await trashDiaryEntry('e2');
    for (const id of ['e1', 'e2', 'e3']) writeDiaryDraft(id, keptDraft(`rascunho ${id}`), 1);
    const loc = memoryLocation({ path: '/diario/apagadas' });
    render(<Router hook={loc.hook}><DiaryTrashScreen /><ToastHost /></Router>);
    const when = 'Quarta-feira, 11/11 · 21:05';
    await user.click((await screen.findAllByRole('button', { name: `Apagar de vez a entrada de ${when}` }))[0]!);
    await user.click(within(screen.getByRole('group', { name: `Confirmar apagar de vez a entrada de ${when}` })).getByRole('button', { name: 'Apagar de vez' }));
    await waitFor(async () => expect((await entry('e2')).deleted).toBe(true));
    await waitFor(() => expect(readDiaryDraft('e2')).toBeUndefined());
    expect(readDiaryDraft('e1')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Esvaziar' }));
    await user.click(within(screen.getByRole('group', { name: 'Confirmar esvaziar' })).getByRole('button', { name: 'Esvaziar' }));
    await waitFor(async () => expect((await entry('e1')).deleted).toBe(true));
    await waitFor(() => expect(readDiaryDraft('e1')).toBeUndefined());
    expect(readDiaryDraft('e3')?.draft.text).toBe('rascunho e3');
  });

  it('an entry deleted elsewhere, with a draft kept here, offers the draft back', async () => {
    const user = userEvent.setup();
    const v1 = (await seed('e1', 'Versão 1'))!;
    writeDiaryDraft('e1', keptDraft('Escrito aqui'), v1.updatedAt);
    await applyRemote({ table: 'diaryEntries', record: { ...v1, text: '', themes: [], links: [], deleted: true, updatedAt: v1.updatedAt + 60_000 } });
    renderEditor('e1');
    expect(await screen.findByText('Esta entrada foi apagada.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Há um texto não salvo deste aparelho, de 11/11 21:05.' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Usar este texto' }));
    expect(await screen.findByLabelText('Texto da entrada')).toHaveValue('Escrito aqui');
    expect(await entry('e1')).toMatchObject({ deleted: false, kind: 'livre', text: 'Escrito aqui', at: at(11, 20) });
    expect(readDiaryDraft('e1')).toBeUndefined();
  });

  it('opening an existing entry from the timeline moves focus to its heading', async () => {
    const user = userEvent.setup();
    await seed('e1');
    const loc = memoryLocation({ path: '/diario' });
    render(<Router hook={loc.hook}><Switch>
      <Route path="/diario/:id">{(p) => <DiaryEditorScreen id={p.id} />}</Route>
      <Route path="/diario"><DiaryScreen /></Route>
    </Switch></Router>);
    await user.click(await screen.findByRole('link', { name: /Hoje rendeu/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Entrada do diário' })).toHaveFocus());
  });

  it('a save after a remote Apagar de vez revives the entry with its kind (a fechamento stays fechamento)', async () => {
    await saveCloseNote('2026-11-11', 'Fechei o dia.');
    renderEditor(CLOSE);
    const box = await screen.findByLabelText('Texto da entrada');
    fireEvent.change(box, { target: { value: 'Fechei o dia. E mais.' } });
    const e = await entry(CLOSE);
    await applyRemote({ table: 'diaryEntries', record: { ...e, text: '', themes: [], links: [], deleted: true, updatedAt: e.updatedAt + 60_000 } });
    await waitFor(async () => expect(await entry(CLOSE)).toMatchObject({ deleted: false, kind: 'fechamento', text: 'Fechei o dia. E mais.' }));
  });
});

/** Releases what holdSaves still holds (a failed test must not leave the entry's lock taken for the next ones). */
let releaseHeld: (() => void) | undefined;

/** Holds each save's transaction until released, in order (the transactions nested in it go through). */
function holdSaves(): Array<() => void> {
  const real = db.transaction.bind(db) as unknown as (...args: unknown[]) => Promise<unknown>;
  const held: Array<() => void> = [];
  releaseHeld = () => { for (const release of held) release(); };
  vi.spyOn(db, 'transaction').mockImplementation(((...args: unknown[]) => {
    if (Dexie.currentTransaction) return real(...args);
    return new Promise<void>((release) => { held.push(release); }).then(() => real(...args));
  }) as never);
  return held;
}

describe('fix round 2', () => {
  afterEach(() => {
    releaseHeld?.();
    releaseHeld = undefined;
    vi.restoreAllMocks();
  });
  const notice = () => screen.queryByText(/Há um texto não salvo/);
  const purged = (e: DiaryEntry) => ({ ...e, text: '', themes: [], links: [], deleted: true, updatedAt: e.updatedAt + 60_000 });

  it('a save still on its way is not "saved" for the page-hide net: the newer text stays kept until it is saved too', async () => {
    const held = holdSaves();
    renderEditor('e1');
    const box = await screen.findByLabelText('Texto da entrada');
    fireEvent.change(box, { target: { value: 'Primeiro' } });
    await waitFor(() => expect(held).toHaveLength(1), { timeout: 3000 });
    fireEvent.change(box, { target: { value: 'Primeiro e mais' } });
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(readDiaryDraft('e1')?.draft.text).toBe('Primeiro e mais');
    held[0]!();
    expect(await screen.findByText('Salvo às 21:05.')).toBeInTheDocument();   // the first save came back
    expect((await entry('e1')).text).toBe('Primeiro');
    expect(readDiaryDraft('e1')?.draft.text).toBe('Primeiro e mais');
    await waitFor(() => expect(held).toHaveLength(2));
    held[1]!();
    await waitFor(async () => expect((await entry('e1')).text).toBe('Primeiro e mais'));
    await waitFor(() => expect(readDiaryDraft('e1')).toBeUndefined());
  });

  it('hiding the page while a save is on its way keeps that text until the save lands', async () => {
    const held = holdSaves();
    renderEditor('e1');
    fireEvent.change(await screen.findByLabelText('Texto da entrada'), { target: { value: 'A caminho' } });
    await waitFor(() => expect(held).toHaveLength(1), { timeout: 3000 });
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(readDiaryDraft('e1')).toMatchObject({ draft: { text: 'A caminho' } });
    expect(readDiaryDraft('e1')!.base).toBeUndefined();
    held[0]!();
    await waitFor(async () => expect((await entry('e1'))?.text).toBe('A caminho'));
    await waitFor(() => expect(readDiaryDraft('e1')).toBeUndefined());
    expect(held).toHaveLength(1);
  });

  /** e1 open with "Texto A"; then "Texto B" arrives by sync (12/11 08:00). */
  async function newerWhileOpen() {
    const user = userEvent.setup();
    const a = (await seed('e1', 'Texto A'))!;
    const view = renderEditor('e1');
    const box = await screen.findByLabelText('Texto da entrada');
    vi.setSystemTime(at(12, 8));
    await applyRemote({ table: 'diaryEntries', record: { ...a, text: 'Texto B', updatedAt: a.updatedAt + 60_000 } });
    const b = await entry('e1');
    return { user, a, b, box, view };
  }
  const NOTICE_12_08 = 'Há um texto não salvo deste aparelho, de 12/11 08:00.';

  it('a copy left open never saves over a newer synced text: the field shows it and the notice offers his text', async () => {
    const { user, a, b, box } = await newerWhileOpen();
    await user.type(box, ' e mais');
    const group = await screen.findByRole('group', { name: NOTICE_12_08 }, { timeout: 3000 });
    expect(within(group).getByText('Texto A e mais')).toBeInTheDocument();
    expect(box).toHaveValue('Texto B');
    expect(box).toHaveAttribute('readonly');
    expect(screen.getByText('Escolha um dos textos acima para continuar.')).toBeInTheDocument();
    await queuedWritesDone('e1');
    expect(await entry('e1')).toEqual(b);
    expect(readDiaryDraft('e1')).toMatchObject({ draft: { text: 'Texto A e mais' }, base: a.updatedAt });
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(readDiaryDraft('e1')?.draft.text).toBe('Texto A e mais');
  });

  it('Usar este texto then saves his text over the newer one, deliberately', async () => {
    const { user, box } = await newerWhileOpen();
    await user.type(box, ' e mais');
    await user.click(await screen.findByRole('button', { name: 'Usar este texto' }, { timeout: 3000 }));
    expect(box).toHaveValue('Texto A e mais');
    expect(box).not.toHaveAttribute('readonly');
    expect(notice()).not.toBeInTheDocument();
    await waitFor(async () => expect(await entry('e1')).toMatchObject({ text: 'Texto A e mais', editedAt: at(12, 8) }));
    await waitFor(() => expect(readDiaryDraft('e1')).toBeUndefined());
  });

  it('Descartar keeps the newer text, and typing then continues from it', async () => {
    const { user, b, box } = await newerWhileOpen();
    await user.type(box, ' e mais');
    await user.click(await screen.findByRole('button', { name: 'Descartar' }, { timeout: 3000 }));
    expect(readDiaryDraft('e1')).toBeUndefined();
    expect(box).toHaveValue('Texto B');
    await queuedWritesDone('e1');
    expect(await entry('e1')).toEqual(b);
    await user.type(box, '!');
    await waitFor(async () => expect((await entry('e1')).text).toBe('Texto B!'));
    expect(notice()).not.toBeInTheDocument();
  });

  it('leaving with a change over a newer synced text keeps his text on the device, and opening again asks', async () => {
    const { a, box, view } = await newerWhileOpen();
    fireEvent.change(box, { target: { value: 'Texto A, saindo' } });
    view.unmount();
    await waitFor(() => expect(readDiaryDraft('e1')).toMatchObject({ draft: { text: 'Texto A, saindo' }, base: a.updatedAt }));
    await queuedWritesDone('e1');
    expect((await entry('e1')).text).toBe('Texto B');
    renderEditor('e1');
    expect(await screen.findByLabelText('Texto da entrada')).toHaveValue('Texto B');
    expect(screen.getByRole('group', { name: NOTICE_12_08 })).toBeInTheDocument();
  });

  it('an entry deleted for good shows a draft kept after the screen opened, without leaving it', async () => {
    const v1 = (await seed('e1', 'Versão 1'))!;
    await applyRemote({ table: 'diaryEntries', record: purged(v1) });
    renderEditor('e1');
    expect(await screen.findByText('Esta entrada foi apagada.')).toBeInTheDocument();
    expect(notice()).not.toBeInTheDocument();
    act(() => { writeDiaryDraft('e1', keptDraft('Escrito aqui'), v1.updatedAt); });
    expect(await screen.findByRole('group', { name: 'Há um texto não salvo deste aparelho, de 11/11 21:05.' })).toBeInTheDocument();
  });

  it('a revival that fails after a remote Apagar de vez keeps his text, offered on the same screen', async () => {
    const v1 = (await seed('e1', 'Versão 1'))!;
    renderEditor('e1');
    fireEvent.change(await screen.findByLabelText('Texto da entrada'), { target: { value: 'Versão 1 e o que escrevi' } });
    await applyRemote({ table: 'diaryEntries', record: purged(v1) });
    failNextTransaction();   // the save made on leaving the form (it would revive the entry)
    expect(await screen.findByText('Esta entrada foi apagada.')).toBeInTheDocument();
    const group = await screen.findByRole('group', { name: 'Há um texto não salvo deste aparelho, de 11/11 21:05.' });
    expect(within(group).getByText('Versão 1 e o que escrevi')).toBeInTheDocument();
    expect(await screen.findByText(FAILURE_TOAST)).toBeInTheDocument();
  });

  it('an entry deleted for good elsewhere forgets a kept draft holding the very text it had', async () => {
    const v1 = (await seed('e1', 'Versão 1'))!;
    renderEditor('e1');
    await screen.findByLabelText('Texto da entrada');
    act(() => { writeDiaryDraft('e1', keptDraft('Versão 1'), v1.updatedAt); });   // kept while a save was on its way
    await applyRemote({ table: 'diaryEntries', record: purged(v1) });
    expect(await screen.findByText('Esta entrada foi apagada.')).toBeInTheDocument();
    await waitFor(() => expect(readDiaryDraft('e1')).toBeUndefined());
    expect(notice()).not.toBeInTheDocument();
  });

  it('Esvaziar that stops partway forgets the drafts of the entries it did delete, and keeps the others', async () => {
    const user = userEvent.setup();
    for (const id of ['e1', 'e2']) {
      await seed(id, `Texto ${id}`);
      await trashDiaryEntry(id);
      writeDiaryDraft(id, keptDraft(`rascunho ${id}`), 1);
    }
    const loc = memoryLocation({ path: '/diario/apagadas' });
    render(<Router hook={loc.hook}><DiaryTrashScreen /><ToastHost /></Router>);
    await user.click(await screen.findByRole('button', { name: 'Esvaziar' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const get = db.diaryEntries.get.bind(db.diaryEntries);
    vi.spyOn(db.diaryEntries, 'get').mockImplementation(((key: string) =>
      key === 'e2' ? Promise.reject(new Error('disk')) : get(key)) as never);
    await user.click(within(screen.getByRole('group', { name: 'Confirmar esvaziar' })).getByRole('button', { name: 'Esvaziar' }));
    expect(await screen.findByText(FAILURE_TOAST)).toBeInTheDocument();
    expect(await entry('e1')).toMatchObject({ deleted: true, text: '' });
    expect(readDiaryDraft('e1')).toBeUndefined();
    expect(readDiaryDraft('e2')?.draft.text).toBe('rascunho e2');
  });
});
