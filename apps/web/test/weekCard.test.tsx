import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockSession, Checkin, DayState, Week, XpEvent } from '@life/shared';
import { addDays, timestampAt, weekdayOf } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { createMission, saveWeekReview, setDayMode, setObjectives } from '../src/domain/actions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { PHRASES, renderPhrase } from '../src/features/companion/phrases';
import { useCompanion } from '../src/features/companion/store';
import { PainelScreen } from '../src/features/painel/PainelScreen';
import { useWeekSession } from '../src/features/week/weekCycle';
import { ToastHost } from '../src/ui/Toast';
import { at, block, seedBlocks } from './blockFixture';

// §8 "Nova semana": Monday 2026-11-16 (week '2026-11-16'); last week is 2026-11-09 … 15.

const LAST = '2026-11-09';
const WEEK = '2026-11-16';
const base = { createdAt: 1, updatedAt: 1, deleted: false };

beforeEach(async () => {
  // Only Date is faked: fake-indexeddb needs the real setImmediate/setTimeout.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(16, 9, 30)); // Monday
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: WEEK, emptyDay: undefined });
  useWeekSession.setState({ dismissed: undefined, opened: undefined, started: undefined });
  useCompanion.getState().clear();
});
afterEach(() => { vi.useRealTimers(); });

const renderAgora = () => render(<><AgoraScreen /><ToastHost /></>);
const weekCard = () => screen.findByRole('region', { name: 'Nova semana' }, { timeout: 3000 });
const noWeekCard = () => screen.queryByRole('region', { name: 'Nova semana' });

const session = (blockId: string, d: number, h: number, version: 'normal' | 'minimum' = 'normal'): BlockSession => {
  const day = `2026-11-${String(d).padStart(2, '0')}`;
  return { ...base, id: `bs-${blockId}-${day}`, blockId, day, startedAt: at(d, h), endedAt: at(d, h, 40), version };
};
const xp = (id: string, dayKey: string, reason: XpEvent['reason'] = 'block'): XpEvent =>
  ({ ...base, id, at: 1, amount: 5, reason, dayKey });
const checkin = (id: string, d: number, kind: Checkin['kind'], feelings: string[] = []): Checkin =>
  ({ ...base, id, at: at(d, 10), kind, feelings });

/** Last week: Mon–Thu worked (Friday marked free), 4 blocks started (2 minimum), 1 resumption, 2 escapes. */
async function seedLastWeek(): Promise<void> {
  await db.blockSessions.bulkPut([
    session('b1', 9, 9), session('b3', 9, 15, 'minimum'), session('b1', 10, 9), session('b1', 11, 10, 'minimum'),
  ]);
  const free: DayState = { ...base, id: '2026-11-13', hardDay: false, reviewDone: false, mode: 'free' };
  await db.dayState.put(free);
  await db.xpEvents.bulkPut([
    xp('x1', '2026-11-09'), xp('x2', '2026-11-10'), xp('x3', '2026-11-10', 'resumption'), xp('x4', '2026-11-11'),
  ]);
  await db.checkins.bulkPut([
    checkin('c1', 10, 'start', ['ansiedade', 'tédio']), checkin('c2', 11, 'start', ['ansiedade']),
    checkin('c3', 11, 'escape'), checkin('c4', 12, 'escape'),
  ]);
  // Created this Monday: it was not part of last week's plan.
  await db.blocks.put(block({
    id: 'b6', name: 'Leitura', order: -1, targetStart: '06:00', durationMin: 30, minimumMin: 10, kind: 'light',
    createdAt: at(16, 8),
  }));
}

/** Value shown next to an observed label ("Blocos iniciados" → "4 de 20"). */
const observed = (card: HTMLElement, label: string) =>
  within(card).getByText(label).closest('div')?.querySelector('dd')?.textContent;

describe('Nova semana card', () => {
  it('on Monday, after the day type, shows last week as observed numbers and saves the review', async () => {
    const user = userEvent.setup();
    await seedLastWeek();
    renderAgora();
    const dayCard = await screen.findByRole('region', { name: 'Como está hoje?' });
    // Never before the day type is chosen.
    expect(noWeekCard()).not.toBeInTheDocument();
    await user.click(within(dayCard).getByRole('button', { name: /Normal/ }));

    const card = await weekCard();
    await user.click(within(card).getByRole('button', { name: 'Começar' }));
    expect(within(card).getByRole('heading', { name: 'Observado' })).toBeInTheDocument();
    expect(within(card).getByText('Números da semana passada, sem julgamento.')).toBeInTheDocument();
    expect(observed(card, 'Blocos iniciados')).toBe('4 de 20');
    expect(observed(card, 'Versão mínima')).toBe('2×');
    expect(observed(card, 'Retomadas')).toBe('1');
    expect(observed(card, 'Escapei')).toBe('2×');
    expect(observed(card, 'Sentimento mais comum')).toBe('ansiedade');
    expect(observed(card, 'Dias úteis ativos')).toBe('3 de 4');

    await user.type(within(card).getByLabelText('O que funcionou?'), 'Começar pelo bloco 1');
    await user.type(within(card).getByLabelText('Qual foi o maior obstáculo?'), 'Celular');
    await user.type(within(card).getByLabelText('Que ajuste você quer testar?'), 'Celular em outro cômodo');
    await user.click(within(card).getByRole('button', { name: 'Salvar e continuar' }));

    await waitFor(async () => expect((await db.weeks.get(WEEK))?.review).toMatchObject({
      worked: 'Começar pelo bloco 1', obstacle: 'Celular', adjustment: 'Celular em outro cômodo',
    }));
    expect((await db.weeks.get(WEEK))?.experiment).toBe('Celular em outro cômodo');
    // The card stays for step 2, and the experiment shows on the Agora.
    expect(await within(await weekCard()).findByRole('heading', { name: 'Objetivos' })).toBeInTheDocument();
    expect(await screen.findByText('Experimento da semana: Celular em outro cômodo')).toBeInTheDocument();
  });

  it('every reflection field is optional', async () => {
    const user = userEvent.setup();
    await seedLastWeek();
    await setDayMode('normal');
    renderAgora();
    await user.click(within(await weekCard()).getByRole('button', { name: 'Começar' }));
    await user.click(within(await weekCard()).getByRole('button', { name: 'Salvar e continuar' }));
    await waitFor(async () => expect((await db.weeks.get(WEEK))?.review?.answeredAt).toBeDefined());
    expect((await db.weeks.get(WEEK))?.experiment).toBeUndefined();
    expect(screen.queryByText(/Experimento da semana/)).not.toBeInTheDocument();
  });

  it('objectives: last week\'s open ones first with Manter/Soltar, up to 3 per focus/study block', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    // Same name on another weekday: one group per name.
    await db.blocks.put(block({
      id: 'b1x', name: 'Tech', order: 5, targetStart: '10:00', durationMin: 120, minimumMin: 30, kind: 'focus', weekdays: [6],
    }));
    const last: Week = {
      ...base, id: LAST,
      objectives: [
        { id: 'o1', blockId: 'b1', text: 'Publicar a edição 3', done: false },
        { id: 'o2', blockId: 'b3', text: 'Lista 4', done: false },
        { id: 'o3', blockId: 'b1', text: 'Pauta', done: true },
      ],
    };
    await db.weeks.put(last);
    renderAgora();

    // No activity last week: nothing to observe, the card opens on the objectives.
    const card = await weekCard();
    await user.click(within(card).getByRole('button', { name: 'Começar' }));
    expect(within(card).getByRole('heading', { name: 'Objetivos' })).toBeInTheDocument();
    expect(within(card).queryByRole('heading', { name: 'Observado' })).not.toBeInTheDocument();

    expect(within(card).getAllByRole('group', { name: 'Tech' })).toHaveLength(1);
    const tech = within(card).getByRole('group', { name: 'Tech' });
    const facul = within(card).getByRole('group', { name: 'Facul' });
    const tecnico = within(card).getByRole('group', { name: 'Tecnico' });
    expect(within(card).queryByRole('group', { name: 'Treino' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('group', { name: 'Compl' })).not.toBeInTheDocument();
    expect(within(tech).queryByText('Pauta')).not.toBeInTheDocument();

    await user.click(within(within(tech).getByRole('group', { name: 'Publicar a edição 3' })).getByRole('button', { name: 'Manter' }));
    await user.click(within(within(facul).getByRole('group', { name: 'Lista 4' })).getByRole('button', { name: 'Soltar' }));
    expect(within(tech).getByRole('button', { name: 'Manter' })).toHaveAttribute('aria-pressed', 'true');

    // One empty field at a time, at most 3 per block (the kept one counts).
    await user.type(within(tech).getByRole('textbox', { name: 'Objetivo 2 · Tech' }), 'Fechar a pauta da edição 4');
    await user.type(within(tech).getByRole('textbox', { name: 'Objetivo 3 · Tech' }), 'Revisar o parser');
    expect(within(tech).queryByRole('textbox', { name: 'Objetivo 4 · Tech' })).not.toBeInTheDocument();
    await user.type(within(tecnico).getByRole('textbox', { name: 'Objetivo 1 · Tecnico' }), 'Capítulo 3');
    await user.click(within(card).getByRole('button', { name: 'Concluir' }));

    await waitFor(async () => expect((await db.weeks.get(WEEK))?.objectives).toEqual([
      expect.objectContaining({ blockId: 'b1', text: 'Publicar a edição 3', done: false }),
      expect.objectContaining({ blockId: 'b1', text: 'Fechar a pauta da edição 4', done: false }),
      expect.objectContaining({ blockId: 'b1', text: 'Revisar o parser', done: false }),
      expect.objectContaining({ blockId: 'b4', text: 'Capítulo 3', done: false }),
    ]));
    // A kept objective is a copy: last week's stays as it was.
    expect((await db.weeks.get(WEEK))!.objectives[0]!.id).not.toBe('o1');
    expect((await db.weeks.get(LAST))!.objectives).toHaveLength(3);
    await waitFor(() => expect(noWeekCard()).not.toBeInTheDocument());
  });

  it('"Fazer depois" hides it for this app session, with a "Nova semana" link to reopen', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    const first = renderAgora();
    await user.click(within(await weekCard()).getByRole('button', { name: 'Fazer depois' }));
    await waitFor(() => expect(noWeekCard()).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Nova semana' }));
    expect(await weekCard()).toBeInTheDocument();
    await user.click(within(await weekCard()).getByRole('button', { name: 'Fazer depois' }));
    await waitFor(() => expect(noWeekCard()).not.toBeInTheDocument());
    first.unmount();

    // Next app open (fresh session state): it comes back.
    useWeekSession.setState({ dismissed: undefined, opened: undefined, started: undefined });
    renderAgora();
    expect(await weekCard()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nova semana' })).not.toBeInTheDocument();
  });

  it('"Concluir" with nothing typed closes the card for good, also after a reopen', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    const first = renderAgora();
    const card = await weekCard();
    await user.click(within(card).getByRole('button', { name: 'Começar' }));
    await user.click(within(await weekCard()).getByRole('button', { name: 'Concluir' }));
    await waitFor(() => expect(noWeekCard()).not.toBeInTheDocument());
    first.unmount();
    renderAgora();
    await screen.findByRole('heading', { name: 'Agora' });
    await new Promise((r) => setTimeout(r, 200));
    expect(noWeekCard()).not.toBeInTheDocument();
  });

  it('a week record with no objectives and no experiment shows no card', async () => {
    await db.weeks.put({ ...base, id: WEEK, objectives: [] } satisfies Week);
    await setDayMode('normal');
    renderAgora();
    await screen.findByRole('heading', { name: 'Agora' });
    await new Promise((r) => setTimeout(r, 200));
    expect(noWeekCard()).not.toBeInTheDocument();
  });

  it('is still offered on Tuesday, but not on Wednesday', async () => {
    vi.setSystemTime(at(17, 9, 30));
    await setDayMode('normal');
    const tuesday = renderAgora();
    expect(await weekCard()).toBeInTheDocument();
    tuesday.unmount();

    vi.setSystemTime(at(18, 9, 30));
    await setDayMode('normal');
    renderAgora();
    await screen.findByRole('region', { name: 'Bloco atual' });
    expect(noWeekCard()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nova semana' })).not.toBeInTheDocument();
  });

  it('is not offered once the week has a review or objectives', async () => {
    await setDayMode('normal');
    await setObjectives(WEEK, [{ blockId: 'b1', text: 'Fechar a ingestão', done: false }]);
    const first = renderAgora();
    await screen.findByRole('region', { name: 'Bloco atual' });
    expect(noWeekCard()).not.toBeInTheDocument();
    first.unmount();

    await db.weeks.clear();
    await saveWeekReview(WEEK, { worked: '', obstacle: '', adjustment: '' });
    renderAgora();
    await screen.findByRole('region', { name: 'Bloco atual' });
    expect(noWeekCard()).not.toBeInTheDocument();
  });

  it('shows on the Painel too, in the Agora column', async () => {
    await setDayMode('normal');
    render(<PainelScreen />);
    const agora = await screen.findByRole('region', { name: 'Agora' });
    expect(await within(agora).findByRole('region', { name: 'Nova semana' }, { timeout: 3000 })).toBeInTheDocument();
  });
});

describe('week experiment and objectives during the week', () => {
  it('the experiment is one muted line under the status strip, not repeated in the block banner', async () => {
    vi.setSystemTime(at(18, 9, 30)); // Wednesday
    await setDayMode('normal');
    await saveWeekReview(WEEK, { worked: '', obstacle: '', adjustment: 'Começar pelo teste' });
    renderAgora();
    const banner = await screen.findByRole('region', { name: 'Bloco atual' });
    expect(await screen.findByText('Experimento da semana: Começar pelo teste')).toBeInTheDocument();
    expect(within(banner).queryByText(/Experimento da semana/)).not.toBeInTheDocument();
  });

  it('a block with the same name on another day shows the objectives too', async () => {
    vi.setSystemTime(at(21, 10, 30)); // Saturday
    await db.blocks.put(block({
      id: 'b1x', name: 'Tech', order: 5, targetStart: '10:00', durationMin: 120, minimumMin: 30, kind: 'focus', weekdays: [6],
    }));
    await setDayMode('normal');
    await setObjectives(WEEK, [{ blockId: 'b1', text: 'Fechar a ingestão', done: false }]);
    renderAgora();
    const banner = await screen.findByRole('region', { name: 'Bloco atual' });
    expect(await within(banner).findByRole('checkbox', { name: 'Fechar a ingestão' })).toBeInTheDocument();
  });
});

describe('one morning card at a time', () => {
  const reviewCard = () => screen.queryByRole('region', { name: /Revisão rápida/ });

  it('day type first, then the Nova semana card (collapsed), then the quick review', async () => {
    const user = userEvent.setup();
    await seedLastWeek();
    await createMission({ title: 'Relatório antigo', date: '2026-11-12' });
    renderAgora();
    const dayCard = await screen.findByRole('region', { name: 'Como está hoje?' });
    await screen.findByRole('region', { name: 'Bloco atual' });
    expect(noWeekCard()).not.toBeInTheDocument();
    expect(reviewCard()).not.toBeInTheDocument();
    await user.click(within(dayCard).getByRole('button', { name: /Normal/ }));

    const card = await weekCard();
    expect(within(card).getByText('~2 min')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Começar' })).toBeInTheDocument();
    expect(within(card).queryByRole('heading', { name: 'Observado' })).not.toBeInTheDocument();
    expect(reviewCard()).not.toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Fazer depois' }));
    expect(await screen.findByRole('region', { name: /Revisão rápida/ })).toBeInTheDocument();
    expect(noWeekCard()).not.toBeInTheDocument();
  });

  it('"Começar" opens the steps; the "Nova semana" link opens them at once', async () => {
    const user = userEvent.setup();
    await seedLastWeek();
    await setDayMode('normal');
    renderAgora();
    const card = await weekCard();
    await user.click(within(card).getByRole('button', { name: 'Começar' }));
    expect(within(card).getByRole('heading', { name: 'Observado' })).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Fazer depois' }));
    await user.click(await screen.findByRole('button', { name: 'Nova semana' }));
    expect(within(await weekCard()).getByRole('heading', { name: 'Observado' })).toBeInTheDocument();
  });

  it('"Onde você parou" sits inside the block banner, under its name', async () => {
    await setObjectives(WEEK, [{ blockId: 'b1', text: 'Fechar a ingestão', done: false }]);
    await setDayMode('normal');
    await db.blockSessions.put({ ...base, id: 'bs-b1-2026-11-13', blockId: 'b1', day: '2026-11-13', version: 'normal', nextAction: 'Rodar o teste' });
    renderAgora();
    const banner = await screen.findByRole('region', { name: 'Bloco atual' });
    expect(await within(banner).findByRole('note', { name: 'Onde você parou' }))
      .toHaveTextContent('Onde você parou: Rodar o teste');
  });

  it('the companion says a week-start line the first time the card shows each week', async () => {
    await setDayMode('normal');
    const first = renderAgora();
    await weekCard();
    const p = await db.profile.get('me');
    const lines = PHRASES.weekStart.map((t) => renderPhrase(t, { name: p?.name, companion: p?.companionName }));
    await waitFor(() => expect(lines).toContain(useCompanion.getState().message));
    first.unmount();

    useCompanion.getState().clear();
    useWeekSession.setState({ dismissed: undefined, opened: undefined, started: undefined });
    renderAgora();
    await weekCard();
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(useCompanion.getState().message).toBeUndefined();
  });
});

describe('week objectives stay reachable', () => {
  it('a review without objectives: the link opens step 2, which has "Fazer depois" too', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    await saveWeekReview(WEEK, { worked: '', obstacle: '', adjustment: '' });
    renderAgora();
    await screen.findByRole('region', { name: 'Bloco atual' });
    expect(noWeekCard()).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Nova semana' }));
    const card = await weekCard();
    expect(within(card).getByRole('heading', { name: 'Objetivos' })).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Fazer depois' }));
    await waitFor(() => expect(noWeekCard()).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Nova semana' })).toBeInTheDocument();
  });

  it('the review answers are kept as a draft through "Fazer depois" and navigation', async () => {
    const user = userEvent.setup();
    await seedLastWeek();
    await setDayMode('normal');
    const first = renderAgora();
    const card = await weekCard();
    await user.click(within(card).getByRole('button', { name: 'Começar' }));
    await user.type(within(card).getByLabelText('O que funcionou?'), 'Começar cedo');
    await user.click(within(card).getByRole('button', { name: 'Fazer depois' }));
    await user.click(await screen.findByRole('button', { name: 'Nova semana' }));
    expect(within(await weekCard()).getByLabelText('O que funcionou?')).toHaveValue('Começar cedo');
    first.unmount();

    renderAgora();
    expect(within(await weekCard()).getByLabelText('O que funcionou?')).toHaveValue('Começar cedo');
  });

  it('a carried objective with no choice is kept (Manter shown pressed)', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    await db.weeks.put({ ...base, id: LAST, objectives: [{ id: 'o1', blockId: 'b1', text: 'Publicar a edição 3', done: false }] });
    renderAgora();
    const card = await weekCard();
    await user.click(within(card).getByRole('button', { name: 'Começar' }));
    const carried = within(card).getByRole('group', { name: 'Publicar a edição 3' });
    expect(within(carried).getByRole('button', { name: 'Manter' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(carried).getByRole('button', { name: 'Soltar' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(within(card).getByRole('button', { name: 'Concluir' }));
    await waitFor(async () => expect((await db.weeks.get(WEEK))?.objectives).toEqual([
      expect.objectContaining({ blockId: 'b1', text: 'Publicar a edição 3', done: false }),
    ]));
  });
});

describe('Nova semana and Padrões', () => {
  it('the adjustment field starts with the experiment chosen in Padrões', async () => {
    const user = userEvent.setup();
    await seedLastWeek();
    await db.weeks.put({ ...base, id: WEEK, objectives: [], experiment: 'Versão mínima do Tech' } satisfies Week);
    await setDayMode('normal');
    renderAgora();
    await user.click(within(await weekCard()).getByRole('button', { name: 'Começar' }));
    expect(within(await weekCard()).getByLabelText('Que ajuste você quer testar?')).toHaveValue('Versão mínima do Tech');
  });

  it('a weeks 5–8 drop shows under last week, and "Usar no ajuste" fills the field', async () => {
    const user = userEvent.setup();
    // Tech (b1) started every workday from 05/10 to 30/10, then only on Mondays and Tuesdays.
    const sessions: BlockSession[] = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays('2026-10-05', i);
      const wd = weekdayOf(d);
      if (wd === 0 || wd === 6 || (i >= 28 && wd > 2)) continue;
      sessions.push({ ...base, id: `bs-b1-${d}`, blockId: 'b1', day: d, version: 'normal', startedAt: timestampAt(d, '09:00'), endedAt: timestampAt(d, '10:00') });
    }
    await db.blockSessions.bulkPut(sessions);
    await db.xpEvents.bulkPut([xp('x1', '2026-11-09'), xp('x2', '2026-11-10')]);
    await setDayMode('normal');
    renderAgora();
    await user.click(within(await weekCard()).getByRole('button', { name: 'Começar' }));
    const note = await within(await weekCard()).findByRole('group', { name: 'Semanas 5–8: Tech' });
    expect(note).toHaveTextContent('Semanas 5–8 · Tech: Nas 4 primeiras semanas, você começou 20 de 20 (100%). Nas últimas 2 semanas, 4 de 10 (40%).');
    expect(within(note).getByRole('link', { name: 'Ver em Padrões' })).toHaveAttribute('href', '/padroes');
    await user.click(within(note).getByRole('button', { name: 'Usar no ajuste' }));
    expect(within(await weekCard()).getByLabelText('Que ajuste você quer testar?'))
      .toHaveValue('Nesta semana, a meta de Tech é só a versão mínima (45 min).');
    expect((await db.weeks.get(WEEK))?.experiment).toBeUndefined();
  });

  it('"Usar no ajuste" adds under the typed text, focuses the field and never duplicates', async () => {
    const user = userEvent.setup();
    const sessions: BlockSession[] = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays('2026-10-05', i);
      const wd = weekdayOf(d);
      if (wd === 0 || wd === 6 || (i >= 28 && wd > 2)) continue;
      sessions.push({ ...base, id: `bs-b1-${d}`, blockId: 'b1', day: d, version: 'normal', startedAt: timestampAt(d, '09:00'), endedAt: timestampAt(d, '10:00') });
    }
    await db.blockSessions.bulkPut(sessions);
    await db.xpEvents.bulkPut([xp('x1', '2026-11-09'), xp('x2', '2026-11-10')]);
    await setDayMode('normal');
    renderAgora();
    await user.click(within(await weekCard()).getByRole('button', { name: 'Começar' }));
    const field = within(await weekCard()).getByLabelText('Que ajuste você quer testar?');
    await user.type(field, 'Deitar 23h30');
    const note = await within(await weekCard()).findByRole('group', { name: 'Semanas 5–8: Tech' });
    await user.click(within(note).getByRole('button', { name: 'Usar no ajuste' }));
    expect(field).toHaveValue('Deitar 23h30\nNesta semana, a meta de Tech é só a versão mínima (45 min).');
    expect(field).toHaveFocus();
    await user.click(within(note).getByRole('button', { name: 'Usar no ajuste' }));
    expect(field).toHaveValue('Deitar 23h30\nNesta semana, a meta de Tech é só a versão mínima (45 min).');
  });
});
