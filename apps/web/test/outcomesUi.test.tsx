import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { LifeEvent, XpEvent } from '@life/shared';
import { timestampAt } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { createMission, setDayMode, startBlock } from '../src/domain/actions';
import { CheckinCardHost } from '../src/features/agora/CheckinCard';
import { ResumePromptHost, useResumePrompt } from '../src/features/agora/ResumePrompt';
import { SnoozeDialog } from '../src/features/agora/SnoozeDialog';
import { useCheckinCard } from '../src/features/agora/startWithCheckin';
import { useCompanion } from '../src/features/companion/store';
import { PatternsScreen } from '../src/features/patterns/PatternsScreen';
import { TIMER_IDLE, useTimer } from '../src/timer/store';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at, seedBlocks } from './blockFixture';

const TODAY = '2026-11-11';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 9, 30));
  localStorage.clear();
  useTimer.setState({ ...TIMER_IDLE });
  useResumePrompt.setState({ request: undefined });
  useCheckinCard.setState({ request: undefined });
  useCompanion.getState().clear();
  useToast.getState().dismiss();
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
});
afterEach(() => { vi.useRealTimers(); });

describe('"Encerrar bloco" outcome', () => {
  const openEnding = () => {
    act(() => useResumePrompt.getState().open({ blockId: 'b1', endsBlock: true }));
    return screen.findByRole('dialog', { name: 'Onde parou?' });
  };

  it('Parcial + what came out is saved with the session', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    await startBlock('b1');
    render(<><ResumePromptHost /><ToastHost /></>);
    const dialog = await openEnding();
    const outcomes = within(within(dialog).getByRole('group', { name: 'Como foi? (opcional)' }));
    expect(outcomes.getAllByRole('button').map((b) => b.textContent)).toEqual(['Feito', 'Parcial', 'Não deu']);
    await user.click(outcomes.getByRole('button', { name: 'Parcial' }));
    expect(outcomes.getByRole('button', { name: 'Parcial' })).toHaveAttribute('aria-pressed', 'true');
    await user.type(within(dialog).getByRole('textbox', { name: 'O que saiu? (opcional)' }), 'dedupe feito');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect(await db.blockSessions.get('bs-b1-2026-11-11'))
      .toMatchObject({ outcome: 'parcial', result: 'dedupe feito', endedAt: at(11, 9, 30) }));
  });

  it('tapping the chosen outcome again clears it', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    await startBlock('b1');
    render(<ResumePromptHost />);
    const dialog = await openEnding();
    const feito = within(dialog).getByRole('button', { name: 'Feito' });
    await user.click(feito);
    await user.click(feito);
    expect(feito).toHaveAttribute('aria-pressed', 'false');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect((await db.blockSessions.get('bs-b1-2026-11-11'))?.endedAt).toBeDefined());
    expect((await db.blockSessions.get('bs-b1-2026-11-11'))?.outcome).toBeUndefined();
  });

  it('"Encerrar sem anotar" ignores everything', async () => {
    const user = userEvent.setup();
    await setDayMode('normal');
    await startBlock('b1');
    render(<ResumePromptHost />);
    const dialog = await openEnding();
    await user.click(within(dialog).getByRole('button', { name: 'Não deu' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'O que saiu? (opcional)' }), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Encerrar sem anotar' }));
    await waitFor(async () => expect((await db.blockSessions.get('bs-b1-2026-11-11'))?.endedAt).toBeDefined());
    const s = await db.blockSessions.get('bs-b1-2026-11-11');
    expect(s?.outcome).toBeUndefined();
    expect(s?.result).toBeUndefined();
  });

  it('the timer prompt (not ending a block) has no outcome question', async () => {
    render(<ResumePromptHost />);
    act(() => useResumePrompt.getState().open({ blockId: 'b1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Onde parou?' });
    expect(within(dialog).queryByText('Como foi? (opcional)')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: 'O que saiu? (opcional)' })).not.toBeInTheDocument();
  });
});

describe('"Agora não" reason', () => {
  const snoozed = async (id: string) => (await db.events.where('missionId').equals(id).toArray()).filter((e) => e.type === 'snoozed');

  it('a reason chip is saved with the postponement', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Estudar' });
    render(<><SnoozeDialog mission={m} today={TODAY} onClose={vi.fn()} /><ToastHost /></>);
    const group = within(await screen.findByRole('group', { name: 'Motivo (opcional)' }));
    expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual(
      ['Sem tempo', 'Sem energia', 'Não sei por onde começar', 'Falta algo', 'Outra prioridade']);
    await user.click(group.getByRole('button', { name: 'Sem energia' }));
    expect(group.getByRole('button', { name: 'Sem energia' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Amanhã' }));
    await waitFor(async () => expect(await snoozed(m.id)).toHaveLength(1));
    expect((await snoozed(m.id))[0]!.data).toEqual({ option: 'tomorrow', reason: 'sem-energia' });
  });

  it('without a chip there is no reason', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Estudar' });
    render(<><SnoozeDialog mission={m} today={TODAY} onClose={vi.fn()} /><ToastHost /></>);
    await user.click(await screen.findByRole('button', { name: 'Amanhã' }));
    await waitFor(async () => expect(await snoozed(m.id)).toHaveLength(1));
    expect((await snoozed(m.id))[0]!.data).toEqual({ option: 'tomorrow' });
  });
});

describe('"O que trava?" on the start card', () => {
  const openCard = async (title: string, fields: Record<string, unknown> = {}) => {
    const m = await createMission({ title, postponeCount: 2, ...fields });
    act(() => useCheckinCard.getState().open({ mission: m }));
    return { m, card: await screen.findByRole('dialog', { name: 'Antes de começar' }) };
  };

  it('is folded away until asked, and a step offer saves the first step with one tap', async () => {
    const user = userEvent.setup();
    render(<><CheckinCardHost /><ToastHost /></>);
    const { m, card } = await openCard('Relatório');
    const toggle = within(card).getByRole('button', { name: 'O que trava? (opcional)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(card).queryByRole('group', { name: 'O que trava?' })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(within(card).getByRole('button', { name: 'Falta informação' }));
    expect(within(card).getByText('Primeira ação sugerida: Anotar a dúvida e onde encontrar a resposta')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Usar como primeiro passo' }));
    await waitFor(async () => expect((await db.missions.get(m.id))?.firstStep).toBe('Anotar a dúvida e onde encontrar a resposta'));
    expect(await screen.findByText('Primeiro passo salvo.')).toBeInTheDocument();
    expect(within(card).getByText('Experimento: só 10 minutos para anotar a dúvida e onde encontrar a resposta')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Só começar' }));
    await waitFor(async () => expect(await db.checkins.count()).toBe(1));
    expect((await db.checkins.toArray())[0]).toMatchObject({ missionId: m.id, blocker: 'falta-informacao' });
  });

  it('"É grande demais" shrinks in place and the experiment uses the new text', async () => {
    const user = userEvent.setup();
    render(<><CheckinCardHost /><ToastHost /></>);
    const { m, card } = await openCard('Lista de cálculo');
    await user.click(within(card).getByRole('button', { name: 'O que trava? (opcional)' }));
    await user.click(within(card).getByRole('button', { name: 'É grande demais' }));
    await user.type(within(card).getByRole('textbox', { name: 'Versão de 5 minutos' }), 'só montar a integral');
    await user.click(within(card).getByRole('button', { name: 'Encolher' }));
    await waitFor(async () => expect(await db.missions.get(m.id)).toMatchObject({ shrunk: true, firstStep: 'só montar a integral' }));
    expect(await within(card).findByText('Experimento: só 10 minutos para só montar a integral')).toBeInTheDocument();
  });

  it('"Chato / sem vontade" points to the experiment', async () => {
    const user = userEvent.setup();
    render(<CheckinCardHost />);
    const { card } = await openCard('Relatório');
    await user.click(within(card).getByRole('button', { name: 'O que trava? (opcional)' }));
    await user.click(within(card).getByRole('button', { name: 'Chato / sem vontade' }));
    expect(within(card).getByText('Experimento de 10 minutos: comece pelo botão abaixo.')).toBeInTheDocument();
  });

  it('skipping the question saves a check-in without blocker', async () => {
    const user = userEvent.setup();
    render(<CheckinCardHost />);
    const { card } = await openCard('Relatório');
    await user.click(within(card).getByRole('button', { name: 'Só começar' }));
    await waitFor(async () => expect(await db.checkins.count()).toBe(1));
    expect((await db.checkins.toArray())[0]!.blocker).toBeUndefined();
  });
});

describe('Adiamentos: marked reasons', () => {
  it('lists how often each reason was marked', async () => {
    vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
    const base = { createdAt: 1, updatedAt: 1, deleted: false };
    const ev = (n: number, reason: string): LifeEvent => ({
      ...base, id: `r${n}`, at: timestampAt('2026-11-10', '10:00'), type: 'snoozed', missionId: 'm1', data: { option: 'tomorrow', reason },
    });
    await put('xpEvents', newRecord<XpEvent>({ at: timestampAt('2026-11-02', '10:00'), amount: 5, reason: 'start', dayKey: '2026-11-02' }));
    await db.missions.put({
      ...base, id: 'm1', title: 'Estudar', checklist: [], status: 'open', important: false, shrunk: false, postponeCount: 3,
    });
    await db.events.bulkPut([ev(1, 'sem-energia'), ev(2, 'sem-energia'), ev(3, 'sem-tempo')]);
    const { hook } = memoryLocation({ path: '/padroes' });
    render(<Router hook={hook}><PatternsScreen /><ToastHost /></Router>);
    expect(await screen.findByText('Motivos marcados ao adiar: Sem energia 2 · Sem tempo 1.')).toBeInTheDocument();
    expect(screen.getByText('Só conta quando um motivo foi marcado em “Agora não”.')).toBeInTheDocument();
  });
});
