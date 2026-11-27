import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Season, WatchNotice as WatchNoticeData, Week } from '@life/shared';
import { newGoalDraft, newSeasonDraft } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { createGoal } from '../src/domain/goalActions';
import { SEASON_ACTIVE_TEXT, endSeason, startSeason } from '../src/domain/seasonActions';
import { WatchNotice } from '../src/features/patterns/WatchNotice';
import { SeasonReviewSheet } from '../src/features/plan/SeasonReviewSheet';
import { WeekView } from '../src/features/plan/WeekView';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at } from './blockFixture';

// Monday 23/11/2026.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(23, 10));
  localStorage.clear();
  useToast.getState().dismiss();
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

const renderWeek = () => render(<><WeekView /><ToastHost /></>);

describe('Temporada in Planejar → Semana', () => {
  it('"Nova temporada" starts one with a focus linked to an objective; the card shows week 1 of 6; focus goes to its title', async () => {
    const user = userEvent.setup();
    const { goal } = await createGoal({ ...newGoalDraft(), title: 'Carreira em Dados' });
    renderWeek();
    await user.click(await screen.findByRole('button', { name: 'Nova temporada' }));
    const d = await screen.findByRole('dialog', { name: 'Nova temporada' });
    const outbox = await db.outbox.count();
    await user.type(within(d).getByLabelText('Nome da temporada'), 'Consistência no Tech');
    await user.type(within(d).getByLabelText('Foco 1 (opcional)'), 'Bloco do Tech todo dia útil');
    await within(d).findAllByRole('option', { name: 'Carreira em Dados' });
    await user.selectOptions(within(d).getByLabelText('Ligar o foco 2 a (opcional)'), `goal:${goal.id}`);
    expect(await within(d).findByText('Termina na semana de 28/12. Semanas atípicas não entram na conta.')).toBeInTheDocument();
    expect(await db.outbox.count()).toBe(outbox);
    await user.click(within(d).getByRole('button', { name: 'Começar temporada' }));
    expect(await screen.findByText('Temporada começou. Ela fica aqui, no topo da Semana.')).toBeInTheDocument();
    const card = await screen.findByRole('region', { name: 'Temporada: Consistência no Tech · semana 1 de 6' });
    expect(within(within(card).getByRole('list', { name: 'Focos da temporada' })).getAllByRole('listitem').map((li) => li.textContent))
      .toEqual(['Bloco do Tech todo dia útil', 'Carreira em Dados']);
    expect(within(card).queryByRole('button', { name: 'Rever temporada' })).not.toBeInTheDocument();
    await waitFor(() => expect(within(card).getByRole('heading', { name: /^Temporada:/ })).toHaveFocus());
  });

  it('an atypical week does not count; in the last planned week "Rever temporada" ends it with the answers; focus goes to "Nova temporada"', async () => {
    const user = userEvent.setup();
    await put('seasons', newRecord<Season>({ id: 'se1', title: 'Consistência', focus: [], startDay: '2026-10-12', plannedWeeks: 6, status: 'ativa' }));
    await put('weeks', newRecord<Week>({ id: '2026-10-26', objectives: [], atypical: { reason: 'Provas' } }));
    renderWeek();
    // 12/10, 19/10, (26/10 atypical), 02/11, 09/11, 16/11, 23/11: today is week 6 of 6, the last planned one.
    const card = await screen.findByRole('region', { name: 'Temporada: Consistência · semana 6 de 6' });
    expect(within(card).getByText('1 semana atípica ficou fora da conta.')).toBeInTheDocument();
    expect(within(card).getByText('As semanas planejadas chegaram ao fim. Rever é opcional, quando quiser.')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Rever temporada' }));
    const d = await screen.findByRole('dialog', { name: 'Rever temporada' });
    expect(await within(d).findByText('Nada registrado nas semanas da temporada.')).toBeInTheDocument();
    await user.type(within(d).getByLabelText('O que avançou?'), 'Comecei todo dia');
    await user.click(within(d).getByRole('button', { name: 'Encerrar temporada' }));
    expect(await screen.findByText('Temporada encerrada. Quando quiser, comece outra.')).toBeInTheDocument();
    await waitFor(async () => expect(await db.seasons.get('se1')).toMatchObject({
      status: 'encerrada', endedDay: '2026-11-23', review: { progress: 'Comecei todo dia' },
    }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nova temporada' })).toHaveFocus());
  });

  it('editing saves only what changed; "Agora não" in the review writes nothing and keeps the typed answer', async () => {
    const user = userEvent.setup();
    const s = await startSeason({ ...newSeasonDraft('2026-11-23'), title: 'Consistência' });
    renderWeek();
    const card = await screen.findByRole('region', { name: 'Temporada: Consistência · semana 1 de 6' });
    await user.click(within(card).getByRole('button', { name: 'Editar temporada' }));
    let d = await screen.findByRole('dialog', { name: 'Temporada' });
    await user.click(within(within(d).getByRole('group', { name: 'Duração' })).getByRole('button', { name: '8 semanas' }));
    await user.click(within(d).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Temporada salva.')).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Temporada: Consistência · semana 1 de 8' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Editar temporada' }));
    d = await screen.findByRole('dialog', { name: 'Temporada' });
    await user.click(within(d).getByRole('button', { name: 'Rever e encerrar agora' }));
    d = await screen.findByRole('dialog', { name: 'Rever temporada' });
    await user.type(within(d).getByLabelText('O que atrapalhou?'), 'Provas');
    const outbox = await db.outbox.count();
    await user.click(within(d).getByRole('button', { name: 'Agora não' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rever temporada' })).not.toBeInTheDocument());
    expect(await db.outbox.count()).toBe(outbox);
    expect((await db.seasons.get(s.id))!.status).toBe('ativa');
    await user.click(screen.getByRole('button', { name: 'Editar temporada' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Temporada' })).getByRole('button', { name: 'Rever e encerrar agora' }));
    expect(within(await screen.findByRole('dialog', { name: 'Rever temporada' })).getByLabelText('O que atrapalhou?')).toHaveValue('Provas');
  });
});

describe('the weeks 5–8 notice', () => {
  const notice: WatchNoticeData = {
    key: 'block:tech:2026-10-12', habitKey: 'block:tech', name: 'Tech', minimumMin: 40, anchor: '2026-10-12', weekNumber: 6,
    base: { started: 8, planned: 10 }, recent: { started: 2, planned: 10, weeks: 2 },
  };
  it('names the season week while a season is active', async () => {
    const s = await startSeason({ ...newSeasonDraft('2026-11-16'), title: 'Consistência' });
    render(<WatchNotice notice={notice} />);
    expect(await screen.findByText('Temporada: Consistência · semana 2 de 6')).toBeInTheDocument();
    await endSeason(s.id, { progress: '', obstacle: '', next: '' });
    await waitFor(() => expect(screen.queryByText(/^Temporada:/)).not.toBeInTheDocument());
  });
});

describe('"Avançou?" in the season review', () => {
  const review = (answeredAt: number, goals: Record<string, string>) =>
    ({ worked: '', obstacle: '', adjustment: '', answeredAt, goals: goals as never });
  it('his answers sit in "Sua leitura", not in Observado, and only count weeks of the season', async () => {
    const user = userEvent.setup();
    const { goal } = await createGoal({ ...newGoalDraft(), title: 'Carreira em Dados' });
    await createGoal({ ...newGoalDraft(), title: 'Sem respostas' });
    await put('seasons', newRecord<Season>({ id: 'se1', title: 'Consistência', focus: [], startDay: '2026-10-19', plannedWeeks: 6, status: 'ativa' }));
    // Answered on the start day (19/10) about the week of 12/10, before the season: not counted. Answered on 16/11 about 09/11: counted.
    await put('weeks', newRecord<Week>({ id: '2026-10-19', objectives: [], review: review(new Date(2026, 9, 19, 9).getTime(), { [goal.id]: 'nao' }) }));
    await put('weeks', newRecord<Week>({ id: '2026-11-16', objectives: [], review: review(at(16, 9), { [goal.id]: 'sim' }) }));
    renderWeek();
    await user.click(await screen.findByRole('button', { name: 'Rever temporada' }));
    const d = await screen.findByRole('dialog', { name: 'Rever temporada' });
    const observed = (await within(d).findByRole('heading', { name: 'Observado' })).closest('section')!;
    const reading = within(d).getByRole('heading', { name: 'Sua leitura' }).closest('section')!;
    const label = 'Suas respostas ao "Avançou?" nas semanas da temporada';
    expect(await within(reading).findByText(label)).toBeInTheDocument();
    expect(within(reading).getByText('Carreira em Dados: Sim 1')).toBeInTheDocument();
    expect(within(reading).queryByText(/Sem respostas/)).not.toBeInTheDocument();
    expect(within(observed).queryByText(/Avançou\?/)).not.toBeInTheDocument();
    expect(within(observed).queryByText(/Carreira em Dados/)).not.toBeInTheDocument();
    expect(within(d).queryByText(/Carreira em Dados: .*·/)).not.toBeInTheDocument();
  });
});

describe('specific refusals reach him', () => {
  it('starting a season while another became active: the sheet shows the reason, stays open and keeps what he typed', async () => {
    const user = userEvent.setup();
    renderWeek();
    await user.click(await screen.findByRole('button', { name: 'Nova temporada' }));
    const d = await screen.findByRole('dialog', { name: 'Nova temporada' });
    await user.type(within(d).getByLabelText('Nome da temporada'), 'Minha');
    await startSeason({ ...newSeasonDraft('2026-11-23'), title: 'De outro aparelho' });   // synced after the sheet opened
    await user.click(within(d).getByRole('button', { name: 'Começar temporada' }));
    await waitFor(() => expect(within(d).getByText(SEASON_ACTIVE_TEXT)).toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Nova temporada' })).toBeInTheDocument();
    expect(within(d).getByLabelText('Nome da temporada')).toHaveValue('Minha');
    expect(await db.seasons.count()).toBe(1);
    expect(screen.queryByText('Algo não funcionou. Tente de novo.')).not.toBeInTheDocument();
    expect(within(d).getByRole('button', { name: 'Começar temporada' })).toBeEnabled();
  });
});

describe('the review of a season already ended elsewhere', () => {
  const KEY = 'life-rpg-season-draft:se1';
  const stale: Season = { ...newRecord<Season>({ id: 'se1', title: 'Consistência', focus: [], startDay: '2026-10-19', plannedWeeks: 6, status: 'ativa' }) };
  const stored = (extra: Partial<Season>) => put('seasons', { ...stale, status: 'encerrada', endedDay: '2026-11-22', ...extra });
  const open = async (onClose = vi.fn(), onEnded = vi.fn()) => {
    const user = userEvent.setup();
    await put('seasons', stale);
    render(<><SeasonReviewSheet season={stale} today="2026-11-23" onClose={onClose} onEnded={onEnded} /><ToastHost /></>);
    const d = await screen.findByRole('dialog', { name: 'Rever temporada' });
    await within(d).findByText('Nada registrado nas semanas da temporada.');
    return { user, d, onClose, onEnded };
  };
  const other = { progress: 'Do outro aparelho', obstacle: '', next: '', answeredAt: 5 };

  it('no written review there and he typed: only his review is written, the draft goes, he is told', async () => {
    const { user, d, onClose, onEnded } = await open();
    await user.type(within(d).getByLabelText('O que atrapalhou?'), 'Provas');
    expect(localStorage.getItem(KEY)).not.toBeNull();
    await stored({});
    await user.click(within(d).getByRole('button', { name: 'Encerrar temporada' }));
    expect(await screen.findByText('A temporada já estava encerrada. Sua revisão foi guardada.')).toBeInTheDocument();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onEnded).toHaveBeenCalled();
    expect(await db.seasons.get('se1')).toMatchObject({ status: 'encerrada', endedDay: '2026-11-22', review: { obstacle: 'Provas', answeredAt: Date.now() } });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('he typed nothing: nothing is written, the draft goes, he is told', async () => {
    const { user, d, onClose } = await open();
    await stored({ review: other });
    const outbox = await db.outbox.count();
    await user.click(within(d).getByRole('button', { name: 'Encerrar temporada' }));
    expect(await screen.findByText('A temporada já estava encerrada.')).toBeInTheDocument();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await db.outbox.count()).toBe(outbox);
    expect((await db.seasons.get('se1'))!.review).toEqual(other);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('both have written answers: nothing is written, the sheet stays with his text and says why', async () => {
    const { user, d, onClose } = await open();
    await user.type(within(d).getByLabelText('O que avançou?'), 'Meu texto');
    await stored({ review: other });
    const outbox = await db.outbox.count();
    await user.click(within(d).getByRole('button', { name: 'Encerrar temporada' }));
    const note = 'Esta temporada já foi encerrada com uma revisão em outro aparelho. O que você escreveu continua aqui: copie o que quiser guardar.';
    expect(await within(d).findByText(note)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(within(d).getByLabelText('O que avançou?')).toHaveValue('Meu texto');
    expect(await db.outbox.count()).toBe(outbox);
    expect((await db.seasons.get('se1'))!.review).toEqual(other);
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  it('the season is gone: the sheet closes and the draft goes', async () => {
    const { user, d, onClose } = await open();
    await user.type(within(d).getByLabelText('O que avançou?'), 'Meu texto');
    await put('seasons', { ...stale, deleted: true });
    await user.click(within(d).getByRole('button', { name: 'Encerrar temporada' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
