import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { BlockSession, DiaryEntry, FocusSession } from '@life/shared';
import { db } from '../src/db/db';
import { refreshNow, useNow, useToday } from '../src/db/hooks';
import { newRecord, patch, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { createMission, setDayMode } from '../src/domain/actions';
import { saveCloseNote } from '../src/domain/diaryActions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { DayCloseCard, DayCloseLink } from '../src/features/dayClose/DayCloseCard';
import { DayCloseSheetHost } from '../src/features/dayClose/DayCloseSheet';
import { useDayCloseSheet } from '../src/features/dayClose/useDayClose';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at, seedBlocks } from './blockFixture';

const TODAY = '2026-11-11';
const pause = (ms = 60) => new Promise((res) => setTimeout(res, ms));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 23, 10));
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
  useToast.getState().dismiss();
  useDayCloseSheet.getState().close();
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: TODAY, emptyDay: undefined });
});
afterEach(() => { vi.useRealTimers(); });

const view = (today = TODAY, mode: 'normal' | 'free' = 'normal') => (
  <><DayCloseCard today={today} mode={mode} now={Date.now()} /><DayCloseLink /><ToastHost /><DayCloseSheetHost /></>
);
const session = (blockId: string, extra: Partial<BlockSession>) =>
  put('blockSessions', newRecord<BlockSession>({ id: `bs-${blockId}-${TODAY}`, blockId, day: TODAY, version: 'normal', ...extra }));
const sheet = () => screen.findByRole('dialog', { name: 'Como foi hoje' });
const card = () => screen.queryByRole('region', { name: 'Como foi hoje?' });

describe('card "Como foi hoje?"', () => {
  it('waits for the evening (after the class); "Agora não" hides it and writes closeDismissed', async () => {
    const user = userEvent.setup();
    const r = render(view());
    // Loaded and due at 23:10 (a positive sign first), then not yet at 22:30, then due again.
    expect(await screen.findByRole('region', { name: 'Como foi hoje?' })).toBeInTheDocument();
    vi.setSystemTime(at(11, 22, 30));
    r.rerender(view());
    await waitFor(() => expect(card()).not.toBeInTheDocument());
    vi.setSystemTime(at(11, 23, 10));
    r.rerender(view());
    const c = await screen.findByRole('region', { name: 'Como foi hoje?' });
    expect(within(c).getByText('Dois minutos para fechar o dia. Tudo é opcional.')).toBeInTheDocument();
    await user.click(within(c).getByRole('button', { name: 'Agora não' }));
    await waitFor(() => expect(card()).not.toBeInTheDocument());
    expect((await db.dayState.get(TODAY))!.closeDismissed).toBe(true);
  });

  it('never on a free day', async () => {
    vi.setSystemTime(at(14, 23, 10)); // Saturday
    const r = render(view('2026-11-14', 'normal'));
    expect(await screen.findByRole('region', { name: 'Como foi hoje?' })).toBeInTheDocument();
    r.rerender(view('2026-11-14', 'free'));
    await waitFor(() => expect(card()).not.toBeInTheDocument());
  });

  it('an unclosed Wednesday: still due at 03:30 Thursday (logical Wednesday), gone at 04:30 (a new logical day)', async () => {
    function Live() {
      const today = useToday();
      const now = useNow();
      return today ? <><p>{`Dia lógico: ${today}`}</p><DayCloseCard today={today} mode="normal" now={now} /></> : null;
    }
    vi.setSystemTime(at(12, 3, 30));
    render(<Live />);
    expect(await screen.findByText('Dia lógico: 2026-11-11')).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Como foi hoje?' })).toBeInTheDocument();
    vi.setSystemTime(at(12, 4, 30));
    act(() => refreshNow());
    expect(await screen.findByText('Dia lógico: 2026-11-12')).toBeInTheDocument();
    await waitFor(() => expect(card()).not.toBeInTheDocument());
  });

  it('shows in the Agora; "Abrir" opens the sheet and writes nothing', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    render(<><AgoraScreen /><DayCloseSheetHost /><ToastHost /></>);
    await screen.findByRole('region', { name: 'Como foi hoje?' });
    await pause(100);
    const stateBefore = JSON.stringify(await db.dayState.toArray());
    const outboxBefore = await db.outbox.count();
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const s = await sheet();
    expect(await within(s).findByRole('heading', { name: 'Observado' })).toBeInTheDocument();
    await pause(100);
    expect(JSON.stringify(await db.dayState.toArray())).toBe(stateBefore);
    expect(await db.outbox.count()).toBe(outboxBefore);
  });

  it('the link "Como foi hoje" opens the sheet at any time', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(at(11, 10));
    render(view());
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    expect(await sheet()).toBeInTheDocument();
  });
});

describe('sheet "Como foi hoje"', () => {
  it('describes the observed day', async () => {
    const user = userEvent.setup();
    await session('b1', { startedAt: at(11, 9), endedAt: at(11, 12) });
    await session('b2', { startedAt: at(11, 12, 30), endedAt: at(11, 13), version: 'minimum' });
    await put('focusSessions', newRecord<FocusSession>({
      id: 'f1', startedAt: at(11, 10), endedAt: at(11, 10, 30), activeMs: 30 * 60_000, mode: 'free', outcome: 'finished',
    }));
    render(view());
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    const s = await sheet();
    expect(await within(s).findByText('2 de 5 blocos iniciados (1 na versão mínima).')).toBeInTheDocument();
    expect(within(s).getByText('Tech — Iniciado · 09:00–12:00')).toBeInTheDocument();
    expect(within(s).getByText('30 min de foco registrado')).toBeInTheDocument();
  });

  it('a pending mission can go to tomorrow and leaves the list; focus never falls to the page', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Ler capítulo', date: TODAY });
    await createMission({ title: 'Lavar louça', date: TODAY });
    render(view());
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    const s = await sheet();
    const heading = await within(s).findByRole('heading', { name: 'Pendências de hoje' });
    expect(within(s).getByText('Amanhã, outro dia ou soltar — você escolhe.')).toBeInTheDocument();
    expect(within(s).getByRole('group', { name: 'Ler capítulo' })).toBeInTheDocument();
    await user.click(within(s).getByRole('button', { name: 'Amanhã: Ler capítulo' }));
    await waitFor(async () => expect((await db.missions.get(m.id))!.date).toBe('2026-11-12'));
    await waitFor(() => expect(within(s).queryByText('Ler capítulo')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(heading));
    // The last one: the section goes, focus goes to "Observado".
    await user.click(within(s).getByRole('button', { name: 'Amanhã: Lavar louça' }));
    await waitFor(() => expect(within(s).queryByRole('heading', { name: 'Pendências de hoje' })).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(within(s).getByRole('heading', { name: 'Observado' })));
  });

  it('"Escolher dia" moves a pending mission to the chosen day', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Ler capítulo', date: TODAY });
    render(view());
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    const s = await sheet();
    await user.click(await within(s).findByRole('button', { name: 'Escolher dia para Ler capítulo' }));
    const date = within(s).getByLabelText('Novo dia para Ler capítulo');
    await user.clear(date);
    await user.type(date, '2026-11-16');
    await user.click(within(s).getByRole('button', { name: 'Mover Ler capítulo' }));
    await waitFor(async () => expect((await db.missions.get(m.id))!.date).toBe('2026-11-16'));
    await waitFor(() => expect(within(s).queryByText('Ler capítulo')).not.toBeInTheDocument());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('"Soltar" drops a pending mission with the chosen reason', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Ler capítulo', date: TODAY });
    render(view());
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    const s = await sheet();
    await user.click(await within(s).findByRole('button', { name: 'Soltar Ler capítulo' }));
    await user.click(within(s).getByRole('button', { name: 'não depende de mim — soltar Ler capítulo' }));
    await waitFor(async () => expect(await db.missions.get(m.id)).toMatchObject({ status: 'dropped', dropReason: 'não depende de mim' }));
    await waitFor(() => expect(within(s).queryByText('Ler capítulo')).not.toBeInTheDocument());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('closes the day with tiredness and note, and reopens it as "Dia fechado às 23:10."', async () => {
    const user = userEvent.setup();
    render(view());
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    const s = await sheet();
    await user.click(await within(s).findByRole('button', { name: 'Médio' }));
    await user.type(within(s).getByLabelText('Observação (opcional)'), 'Dia corrido');
    await user.click(within(s).getByRole('button', { name: 'Fechar o dia' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Dia fechado.'));
    expect(await db.dayState.get(TODAY)).toMatchObject({ closedAt: at(11, 23, 10), tiredness: 'medio' });
    expect(await db.diaryEntries.get('diary-close-2026-11-11')).toMatchObject({ kind: 'fechamento', text: 'Dia corrido', at: at(11, 23, 10) });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Como foi hoje' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Como foi hoje' }));
    const again = await sheet();
    expect(await within(again).findByText('Dia fechado às 23:10.')).toBeInTheDocument();
    expect(within(again).getByRole('button', { name: 'Médio' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(again).getByLabelText('Observação (opcional)')).toHaveValue('Dia corrido');
    expect(within(again).getByRole('button', { name: 'Salvar' })).toBeInTheDocument();
  });

  it('the observation shows the fechamento entry of the day, with no length limit', async () => {
    const long = `Escrito no diário. ${'x'.repeat(400)}`;
    await saveCloseNote(TODAY, long);
    const user = userEvent.setup();
    render(view());
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    const field = await within(await sheet()).findByLabelText('Observação (opcional)');
    expect(field).toHaveValue(long);
    expect(field).not.toHaveAttribute('maxlength');
    expect(screen.getByText('Fica no diário como o fechamento do dia.')).toBeInTheDocument();
  });

  it('"Escrever no diário" closes the sheet and opens a new entry, writing nothing', async () => {
    const user = userEvent.setup();
    const loc = memoryLocation({ path: '/', record: true });
    render(<Router hook={loc.hook}>{view()}</Router>);
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    await user.click(await within(await sheet()).findByRole('button', { name: 'Escrever no diário' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Como foi hoje' })).not.toBeInTheDocument());
    expect(loc.history!.at(-1)).toMatch(/^\/diario\/[0-9A-Z]{26}$/);
    expect(await db.diaryEntries.count()).toBe(0);
  });

  it('"Escrever no diário" keeps the note being typed as the fechamento, without closing the day', async () => {
    const user = userEvent.setup();
    const loc = memoryLocation({ path: '/', record: true });
    render(<Router hook={loc.hook}>{view()}</Router>);
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    const s = await sheet();
    await user.type(await within(s).findByLabelText('Observação (opcional)'), 'Dia corrido');
    await user.click(within(s).getByRole('button', { name: 'Escrever no diário' }));
    await waitFor(() => expect(loc.history!.at(-1)).toMatch(/^\/diario\/[0-9A-Z]{26}$/));
    await waitFor(async () => expect((await db.diaryEntries.get(`diary-close-${TODAY}`))?.text).toBe('Dia corrido'));
    expect((await db.dayState.get(TODAY))?.closedAt).toBeUndefined();
    expect(await db.diaryEntries.count()).toBe(1);
  });

  it('a fechamento updated while the sheet is open (sync) is kept by Fechar o dia when the field was not touched', async () => {
    await saveCloseNote(TODAY, 'Versão antiga');
    const user = userEvent.setup();
    render(view());
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    const s = await sheet();
    expect(await within(s).findByLabelText('Observação (opcional)')).toHaveValue('Versão antiga');
    await patch<DiaryEntry>('diaryEntries', `diary-close-${TODAY}`, { text: 'Versão mais nova, de outro aparelho' });
    await user.click(within(s).getByRole('button', { name: 'Fechar o dia' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Dia fechado.'));
    const kept = await db.diaryEntries.get(`diary-close-${TODAY}`);
    expect(kept).toMatchObject({ text: 'Versão mais nova, de outro aparelho', deleted: false });
    expect(kept!.trashedAt).toBeUndefined();
    expect((await db.dayState.get(TODAY))?.closedAt).toBe(at(11, 23, 10));
  });

  it('an entry that arrives while the sheet is open with an empty field is not trashed by Fechar o dia', async () => {
    const user = userEvent.setup();
    render(view());
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    const s = await sheet();
    expect(await within(s).findByLabelText('Observação (opcional)')).toHaveValue('');
    await saveCloseNote(TODAY, 'Escrito no PC');
    await user.click(within(s).getByRole('button', { name: 'Fechar o dia' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Dia fechado.'));
    const kept = await db.diaryEntries.get(`diary-close-${TODAY}`);
    expect(kept).toMatchObject({ text: 'Escrito no PC', deleted: false });
    expect(kept!.trashedAt).toBeUndefined();
  });

  it('a changed field is saved over the newer version (his new words), and Escrever no diário keeps an untouched newer one', async () => {
    await saveCloseNote(TODAY, 'Versão antiga');
    const user = userEvent.setup();
    const loc = memoryLocation({ path: '/', record: true });
    render(<Router hook={loc.hook}>{view()}</Router>);
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    let s = await sheet();
    await within(s).findByLabelText('Observação (opcional)');
    await patch<DiaryEntry>('diaryEntries', `diary-close-${TODAY}`, { text: 'Versão nova' });
    await user.click(within(s).getByRole('button', { name: 'Escrever no diário' }));
    await waitFor(() => expect(loc.history!.at(-1)).toMatch(/^\/diario\/[0-9A-Z]{26}$/));
    expect((await db.diaryEntries.get(`diary-close-${TODAY}`))?.text).toBe('Versão nova');

    await user.click(screen.getByRole('button', { name: 'Como foi hoje' }));
    s = await sheet();
    const field = await within(s).findByLabelText('Observação (opcional)');
    expect(field).toHaveValue('Versão nova');
    await patch<DiaryEntry>('diaryEntries', `diary-close-${TODAY}`, { text: 'Versão ainda mais nova' });
    await user.clear(field);
    await user.type(field, 'O que eu escrevi agora');
    await user.click(within(s).getByRole('button', { name: 'Fechar o dia' }));
    await waitFor(async () => expect((await db.diaryEntries.get(`diary-close-${TODAY}`))?.text).toBe('O que eu escrevi agora'));
  });

  it('his changed observation over a text that changed while the sheet was open keeps that text in Apagadas recentemente', async () => {
    const CLOSE = `diary-close-${TODAY}`;
    const copies = async () => (await db.diaryEntries.toArray()).filter((e) => e.id !== CLOSE);
    await saveCloseNote(TODAY, 'Versão antiga');
    const user = userEvent.setup();
    const loc = memoryLocation({ path: '/', record: true });
    render(<Router hook={loc.hook}>{view()}</Router>);
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    let s = await sheet();
    let field = await within(s).findByLabelText('Observação (opcional)');
    let newer = await patch<DiaryEntry>('diaryEntries', CLOSE, { text: 'Versão nova, de outro aparelho' });
    await user.clear(field);
    await user.type(field, 'O que eu escrevi agora');
    await user.click(within(s).getByRole('button', { name: 'Fechar o dia' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Dia fechado. A versão mais nova da observação ficou em Apagadas recentemente.'));
    expect(await db.diaryEntries.get(CLOSE)).toMatchObject({ kind: 'fechamento', text: 'O que eu escrevi agora', deleted: false });
    expect(await copies()).toEqual([expect.objectContaining({
      id: `${CLOSE}-copia-${newer.updatedAt}`, kind: 'livre', text: 'Versão nova, de outro aparelho', trashedAt: at(11, 23, 10), deleted: false,
    })]);

    // Escrever no diário does the same.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Como foi hoje' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Como foi hoje' }));
    s = await sheet();
    field = await within(s).findByLabelText('Observação (opcional)');
    expect(field).toHaveValue('O que eu escrevi agora');
    vi.setSystemTime(at(11, 23, 20));
    newer = await patch<DiaryEntry>('diaryEntries', CLOSE, { text: 'Escrito no PC enquanto isso' });
    await user.type(field, ' e mais');
    await user.click(within(s).getByRole('button', { name: 'Escrever no diário' }));
    await waitFor(() => expect(loc.history!.at(-1)).toMatch(/^\/diario\/[0-9A-Z]{26}$/));
    await waitFor(async () => expect((await db.diaryEntries.get(CLOSE))?.text).toBe('O que eu escrevi agora e mais'));
    expect((await copies()).map((e) => [e.text, e.trashedAt])).toEqual([
      ['Versão nova, de outro aparelho', at(11, 23, 10)], ['Escrito no PC enquanto isso', at(11, 23, 20)],
    ]);
    expect((await copies())[1]!.id).toBe(`${CLOSE}-copia-${newer.updatedAt}`);
  });

  it('"Fiz, mas não registrei" registers the block as done later, without XP', async () => {
    const user = userEvent.setup();
    render(view());
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    const s = await sheet();
    await user.click(await within(s).findByText('Correções'));
    await user.click(within(s).getByRole('button', { name: 'Fiz, mas não registrei: Compl' }));
    expect(within(s).getByText('Fica marcado como registrado depois e não dá XP.')).toBeInTheDocument();
    expect(within(s).getByLabelText('Início de Compl')).toHaveValue('18:00');
    await user.click(within(s).getByRole('button', { name: 'Registrar Compl' }));
    expect(await within(s).findAllByText(/Compl — Iniciado · registrado depois · 18:00–18:40/)).not.toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(within(s).getByRole('button', { name: 'Ajustar horário de Compl' })));
    expect(await db.blockSessions.get(`bs-b5-${TODAY}`)).toMatchObject({ retro: true });
    expect((await db.xpEvents.toArray()).filter((x) => x.reason === 'block')).toHaveLength(0);
  });

  it('corrects block times and focus minutes, and deletes a focus session with Desfazer', async () => {
    const user = userEvent.setup();
    await session('b1', { startedAt: at(11, 9), endedAt: at(11, 12) });
    await put('focusSessions', newRecord<FocusSession>({
      id: 'f1', startedAt: at(11, 10), endedAt: at(11, 11), activeMs: 60 * 60_000, mode: 'free', outcome: 'finished',
    }));
    render(view());
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    const s = await sheet();
    await user.click(await within(s).findByText('Correções'));
    await user.click(within(s).getByRole('button', { name: 'Ajustar horário de Tech' }));
    const start = within(s).getByLabelText('Início de Tech');
    expect(within(s).getByLabelText('Fim de Tech')).toHaveValue('12:00');
    await user.clear(start);
    await user.type(start, '09:10');
    await user.click(within(s).getByRole('button', { name: 'Salvar horário de Tech' }));
    await waitFor(async () => expect((await db.blockSessions.get(`bs-b1-${TODAY}`))!.startedAt).toBe(at(11, 9, 10)));
    await waitFor(() => expect(document.activeElement).toBe(within(s).getByRole('button', { name: 'Ajustar horário de Tech' })));

    await user.click(within(s).getByRole('button', { name: 'Corrigir minutos do foco das 10:00' }));
    const min = within(s).getByLabelText('Minutos do foco das 10:00');
    await user.clear(min);
    await user.type(min, '45');
    await user.click(within(s).getByRole('button', { name: 'Salvar minutos do foco das 10:00' }));
    await waitFor(async () => expect((await db.focusSessions.get('f1'))!.activeMs).toBe(45 * 60_000));
    await waitFor(() => expect(document.activeElement).toBe(within(s).getByRole('button', { name: 'Corrigir minutos do foco das 10:00' })));

    await user.click(within(s).getByRole('button', { name: 'Apagar foco das 10:00' }));
    await waitFor(async () => expect((await db.focusSessions.get('f1'))!.deleted).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(within(s).getByText('Correções')));
    await user.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Desfazer' }));
    await waitFor(async () => expect((await db.focusSessions.get('f1'))!.deleted).toBe(false));
  });

  it('deleting one of two focus sessions sends focus to the next row', async () => {
    const user = userEvent.setup();
    for (const [id, h] of [['f1', 10], ['f2', 14]] as const) {
      await put('focusSessions', newRecord<FocusSession>({
        id, startedAt: at(11, h), endedAt: at(11, h, 30), activeMs: 30 * 60_000, mode: 'free', outcome: 'finished',
      }));
    }
    render(view());
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    const s = await sheet();
    await user.click(await within(s).findByText('Correções'));
    await user.click(within(s).getByRole('button', { name: 'Apagar foco das 10:00' }));
    await waitFor(() => expect(within(s).queryByRole('button', { name: 'Apagar foco das 10:00' })).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(within(s).getByRole('button', { name: 'Corrigir minutos do foco das 14:00' })));
  });

  it('shows the correction error next to the field', async () => {
    const user = userEvent.setup();
    await session('b1', { startedAt: at(11, 9), endedAt: at(11, 12) });
    render(view());
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    const s = await sheet();
    await user.click(await within(s).findByText('Correções'));
    await user.click(within(s).getByRole('button', { name: 'Ajustar horário de Tech' }));
    const end = within(s).getByLabelText('Fim de Tech');
    await user.clear(end);
    await user.type(end, '08:00');
    await user.click(within(s).getByRole('button', { name: 'Salvar horário de Tech' }));
    expect(await within(s).findByRole('alert')).toHaveTextContent('O fim precisa ser depois do início.');
  });
});
