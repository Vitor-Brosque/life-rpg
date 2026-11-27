import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockSession, XpEvent } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { createMission, setDayMode } from '../src/domain/actions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { focusInto, useMomentSession } from '../src/features/agora/MomentCards';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { useCompanion } from '../src/features/companion/store';
import { DayCloseSheetHost } from '../src/features/dayClose/DayCloseSheet';
import { useDayCloseSheet } from '../src/features/dayClose/useDayClose';
import { PainelScreen } from '../src/features/painel/PainelScreen';
import { useWeekSession } from '../src/features/week/weekCycle';
import { ToastHost } from '../src/ui/Toast';
import { at, seedBlocks } from './blockFixture';

// Monday 16/11/2026: Nova semana is offered; the class ends at 23:00, so "Como foi hoje?" is due at 23:10.
const TODAY = '2026-11-16';
const base = { createdAt: 1, updatedAt: 1, deleted: false };
const session = (blockId: string, d: number): BlockSession => {
  const day = `2026-11-${String(d).padStart(2, '0')}`;
  return { ...base, id: `bs-${blockId}-${day}`, blockId, day, startedAt: at(d, 9), endedAt: at(d, 9, 40), version: 'normal' };
};
const xp = (id: string, dayKey: string): XpEvent => ({ ...base, id, at: 1, amount: 5, reason: 'block', dayKey });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(16, 23, 10));
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
  await db.blockSessions.bulkPut([session('b1', 9), session('b1', 10)]);   // last week: the Nova semana has numbers
  await db.xpEvents.bulkPut([xp('x1', '2026-11-09')]);
  useMomentSession.setState({ day: undefined, chosen: undefined });
  useWeekSession.setState({ dismissed: undefined, opened: undefined, started: undefined });
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: TODAY, emptyDay: undefined });
  useDayCloseSheet.getState().close();
  useCompanion.getState().clear();
});
afterEach(() => { vi.useRealTimers(); });

const items = (sheet: HTMLElement) => [...sheet.querySelectorAll('.moment-list__title')].map((t) => t.textContent);

describe('one moment card at a time', () => {
  it('"Como foi hoje?" first; the others wait in "Mais para hoje (N)"; bringing one up moves focus into it and writes nothing', async () => {
    const user = userEvent.setup();
    await createMission({ title: 'Relatório antigo', date: '2026-11-12' });   // Revisão rápida
    await setDayMode('normal');
    render(<><AgoraScreen /><DayCloseSheetHost /><ToastHost /></>);
    expect(await screen.findByRole('region', { name: 'Como foi hoje?' })).toBeInTheDocument();
    const more = await screen.findByRole('button', { name: 'Mais para hoje (2)' });
    expect(screen.queryByRole('region', { name: 'Nova semana' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Revisão rápida/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Missão agora' })).toBeInTheDocument();
    const outbox = await db.outbox.count();
    await user.click(more);
    const sheet = await screen.findByRole('dialog', { name: 'Mais para hoje' });
    expect(within(sheet).getByText('Um card por vez no Agora. Escolha outro para trazer para cima; o que estava lá vem para cá.')).toBeInTheDocument();
    expect(items(sheet)).toEqual(['Nova semana', 'Revisão rápida']);
    await user.click(within(sheet).getByRole('button', { name: /^Nova semana/ }));
    const week = await screen.findByRole('region', { name: 'Nova semana' });
    await waitFor(() => expect(within(week).getByRole('button', { name: 'Começar' })).toHaveFocus());
    expect(screen.queryByRole('region', { name: 'Como foi hoje?' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mais para hoje (2)' }));
    expect(items(await screen.findByRole('dialog', { name: 'Mais para hoje' }))).toEqual(['Como foi hoje?', 'Revisão rápida']);
    expect(await db.outbox.count()).toBe(outbox);
  });

  it('in the morning: "Como está hoje?" first, then the Nova semana; the quick review waits behind both', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(at(16, 9, 30));
    await createMission({ title: 'Relatório antigo', date: '2026-11-12' });
    render(<><AgoraScreen /><ToastHost /></>);
    const dayCard = await screen.findByRole('region', { name: 'Como está hoje?' });
    expect(await screen.findByRole('button', { name: 'Mais para hoje (1)' })).toBeInTheDocument();
    await user.click(within(dayCard).getByRole('button', { name: /Normal/ }));
    expect(await screen.findByRole('region', { name: 'Nova semana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mais para hoje (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Revisão rápida/ })).not.toBeInTheDocument();
  });

  it('the "Nova semana" link brings the card up even in the evening', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    render(<><AgoraScreen /><DayCloseSheetHost /><ToastHost /></>);
    await screen.findByRole('region', { name: 'Como foi hoje?' });
    await user.click(await screen.findByRole('button', { name: 'Mais para hoje (1)' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Mais para hoje' })).getByRole('button', { name: /^Nova semana/ }));
    await user.click(within(await screen.findByRole('region', { name: 'Nova semana' })).getByRole('button', { name: 'Fazer depois' }));
    expect(await screen.findByRole('region', { name: 'Como foi hoje?' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Nova semana' }));
    expect(await screen.findByRole('region', { name: 'Nova semana' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Como foi hoje?' })).not.toBeInTheDocument();
  });

  it('the Painel follows the same rule in its Agora column', async () => {
    await setDayMode('normal');
    render(<><PainelScreen /><DayCloseSheetHost /></>);
    const col = await screen.findByRole('region', { name: 'Agora' });
    expect(await within(col).findByRole('region', { name: 'Como foi hoje?' })).toBeInTheDocument();
    expect(await within(col).findByRole('button', { name: 'Mais para hoje (1)' })).toBeInTheDocument();
    expect(within(col).queryByRole('region', { name: 'Nova semana' })).not.toBeInTheDocument();
  });
});

describe('moment queue rules', () => {
  it('a card brought up yesterday is forgotten today; the main card region stays while one is brought up', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    useMomentSession.setState({ day: '2026-11-15', chosen: 'semana' });
    render(<><AgoraScreen /><DayCloseSheetHost /><ToastHost /></>);
    expect(await screen.findByRole('region', { name: 'Como foi hoje?' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Nova semana' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Mais para hoje (1)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mais para hoje (1)' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Mais para hoje' })).getByRole('button', { name: /^Nova semana/ }));
    expect(await screen.findByRole('region', { name: 'Nova semana' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Missão agora' })).toBeInTheDocument();
  });

  it('"Mais para hoje" is absent when only one card is due', async () => {
    vi.setSystemTime(at(16, 9, 30));
    await setDayMode('normal');
    render(<><AgoraScreen /><ToastHost /></>);
    expect(await screen.findByRole('region', { name: 'Nova semana' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mais para hoje/ })).not.toBeInTheDocument();
  });
});

describe('focusInto', () => {
  const mount = () => {
    document.body.innerHTML = '<button id="more">Mais para hoje</button><button id="other">Outro</button><div id="slot"></div>';
    return {
      slot: document.getElementById('slot')!, more: document.getElementById('more') as HTMLElement, other: document.getElementById('other') as HTMLElement,
    };
  };
  const addCard = (slot: HTMLElement) => { slot.innerHTML = '<button id="card">Começar</button>'; };
  afterEach(() => { document.body.innerHTML = ''; });

  it('moves into the card when it shows while focus is still on "Mais para hoje"', async () => {
    const { slot, more } = mount();
    more.focus();
    focusInto(slot, () => more);
    addCard(slot);
    await waitFor(() => expect(document.getElementById('card')).toHaveFocus());
  });

  it('does not pull focus away from where he went', async () => {
    const { slot, more, other } = mount();
    more.focus();
    const cancel = focusInto(slot, () => more);
    await new Promise((r) => setTimeout(r, 20));
    other.focus();
    addCard(slot);
    await new Promise((r) => setTimeout(r, 20));
    expect(other).toHaveFocus();
    cancel();
  });

  it('stops waiting when cancelled (the component went away)', async () => {
    const { slot, more } = mount();
    more.focus();
    const cancel = focusInto(slot, () => more);
    await new Promise((r) => setTimeout(r, 20));
    cancel();
    addCard(slot);
    await new Promise((r) => setTimeout(r, 20));
    expect(more).toHaveFocus();
  });
});
