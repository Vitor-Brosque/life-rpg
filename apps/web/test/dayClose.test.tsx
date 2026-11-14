import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockSession, FocusSession } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { createMission, setDayMode } from '../src/domain/actions';
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
    vi.setSystemTime(at(11, 22, 30));
    const r = render(view());
    await pause();
    expect(card()).not.toBeInTheDocument();
    vi.setSystemTime(at(11, 23, 10));
    r.rerender(view());
    const c = await screen.findByRole('region', { name: 'Como foi hoje?' });
    expect(within(c).getByText('Dois minutos para fechar o dia. Tudo é opcional.')).toBeInTheDocument();
    await user.click(within(c).getByRole('button', { name: 'Agora não' }));
    await waitFor(() => expect(card()).not.toBeInTheDocument());
    expect((await db.dayState.get(TODAY))!.closeDismissed).toBe(true);
  });

  it('never on a free day, and an unclosed yesterday does not show it today', async () => {
    vi.setSystemTime(at(14, 23, 10)); // Saturday
    const r = render(view('2026-11-14', 'free'));
    await pause();
    expect(card()).not.toBeInTheDocument();
    vi.setSystemTime(at(12, 5, 0)); // Thursday morning; Wednesday was never closed
    r.rerender(view('2026-11-12'));
    await pause();
    expect(card()).not.toBeInTheDocument();
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

  it('a pending mission can go to tomorrow and leaves the list', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Ler capítulo', date: TODAY });
    render(view());
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    const s = await sheet();
    expect(await within(s).findByRole('heading', { name: 'Pendências de hoje' })).toBeInTheDocument();
    expect(within(s).getByText('Amanhã, outro dia ou soltar — você escolhe.')).toBeInTheDocument();
    await user.click(within(s).getByRole('button', { name: 'Amanhã' }));
    await waitFor(async () => expect((await db.missions.get(m.id))!.date).toBe('2026-11-12'));
    await waitFor(() => expect(within(s).queryByText('Ler capítulo')).not.toBeInTheDocument());
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
    expect(await db.dayState.get(TODAY)).toMatchObject({ closedAt: at(11, 23, 10), tiredness: 'medio', closeNote: 'Dia corrido' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Como foi hoje' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Como foi hoje' }));
    const again = await sheet();
    expect(await within(again).findByText('Dia fechado às 23:10.')).toBeInTheDocument();
    expect(within(again).getByRole('button', { name: 'Médio' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(again).getByLabelText('Observação (opcional)')).toHaveValue('Dia corrido');
    expect(within(again).getByRole('button', { name: 'Salvar' })).toBeInTheDocument();
  });

  it('"Fiz, mas não registrei" registers the block as done later, without XP', async () => {
    const user = userEvent.setup();
    render(view());
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    const s = await sheet();
    await user.click(await within(s).findByText('Correções'));
    await user.click(within(s).getByRole('button', { name: 'Fiz, mas não registrei: Compl' }));
    expect(within(s).getByText('Fica marcado como registrado depois e não dá XP.')).toBeInTheDocument();
    await user.click(within(s).getByRole('button', { name: 'Registrar' }));
    expect(await within(s).findAllByText(/Compl — Iniciado · registrado depois · 18:00–18:40/)).not.toHaveLength(0);
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
    const start = within(s).getByLabelText('Início');
    await user.clear(start);
    await user.type(start, '09:10');
    await user.click(within(s).getByRole('button', { name: 'Salvar horário' }));
    await waitFor(async () => expect((await db.blockSessions.get(`bs-b1-${TODAY}`))!.startedAt).toBe(at(11, 9, 10)));

    await user.click(within(s).getByRole('button', { name: 'Corrigir minutos do foco das 10:00' }));
    const min = within(s).getByLabelText('Minutos');
    await user.clear(min);
    await user.type(min, '45');
    await user.click(within(s).getByRole('button', { name: 'Salvar minutos' }));
    await waitFor(async () => expect((await db.focusSessions.get('f1'))!.activeMs).toBe(45 * 60_000));

    await user.click(within(s).getByRole('button', { name: 'Apagar foco das 10:00' }));
    await waitFor(async () => expect((await db.focusSessions.get('f1'))!.deleted).toBe(true));
    await user.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Desfazer' }));
    await waitFor(async () => expect((await db.focusSessions.get('f1'))!.deleted).toBe(false));
  });

  it('shows the correction error next to the field', async () => {
    const user = userEvent.setup();
    await session('b1', { startedAt: at(11, 9), endedAt: at(11, 12) });
    render(view());
    await user.click(await screen.findByRole('button', { name: 'Como foi hoje' }));
    const s = await sheet();
    await user.click(await within(s).findByText('Correções'));
    await user.click(within(s).getByRole('button', { name: 'Ajustar horário de Tech' }));
    const end = within(s).getByLabelText('Fim');
    await user.clear(end);
    await user.type(end, '08:00');
    await user.click(within(s).getByRole('button', { name: 'Salvar horário' }));
    expect(await within(s).findByRole('alert')).toHaveTextContent('O fim precisa ser depois do início.');
  });
});
