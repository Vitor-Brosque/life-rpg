import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { BlockOccurrence } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { saveSleepTimes } from '../src/domain/sleepActions';
import { BlockBanner } from '../src/features/agora/BlockBanner';
import { CharacterScreen } from '../src/features/character/CharacterScreen';
import { BodyBlockPanel } from '../src/features/corpo/BodyBlockPanel';
import { CorpoScreen, SYMPTOMS_NOTE } from '../src/features/corpo/CorpoScreen';
import { SleepSheetHost, useSleepSheet } from '../src/features/corpo/SleepSheet';
import { WorkoutSheetHost, useWorkoutSheet } from '../src/features/corpo/WorkoutSheet';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at, block } from './blockFixture';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(13, 15));
  await db.delete(); await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
  useSleepSheet.getState().close();
  useWorkoutSheet.getState().close();
});
afterEach(() => { vi.useRealTimers(); });

const hosts = <><ToastHost /><SleepSheetHost /><WorkoutSheetHost /></>;
function renderAt(path: string, ui: React.ReactNode) {
  const { hook } = memoryLocation({ path });
  return render(<Router hook={hook}>{ui}{hosts}</Router>);
}
const toastText = () => screen.getByRole('status');

/** Nights 10, 11 and 12 (see the shared sleep test): average 7h20, bedtime spread 62 min. */
async function threeNights(): Promise<void> {
  await saveSleepTimes('2026-11-10', '23:00', '07:00');
  await saveSleepTimes('2026-11-11', '00:30', '08:30');
  await saveSleepTimes('2026-11-12', '01:30', '07:30');
}

describe('Corpo — sono', () => {
  it('the symptoms note shows once, until "Entendi"', async () => {
    const user = userEvent.setup();
    renderAt('/corpo', <CorpoScreen />);
    expect(await screen.findByText(SYMPTOMS_NOTE)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entendi' }));
    await waitFor(() => expect(screen.queryByText(SYMPTOMS_NOTE)).not.toBeInTheDocument());
    expect((await db.settings.get('settings'))!.sleep?.noteDismissed).toBe(true);
  });

  it('with fewer than 3 complete nights it explains what comes', async () => {
    await saveSleepTimes('2026-11-12', '23:30', '07:00');
    renderAt('/corpo', <CorpoScreen />);
    expect(await screen.findByText(
      'Com 3 noites completas (Deitei e Acordei), aparecem aqui os horários médios e quanto eles variam. Até agora: 1.',
    )).toBeInTheDocument();
  });

  it('shows the observed regularity and opens a night from the list', async () => {
    const user = userEvent.setup();
    await threeNights();
    renderAt('/corpo', <CorpoScreen />);
    expect(await screen.findByText('Observado nas últimas 14 noites')).toBeInTheDocument();
    expect(screen.getByText('7h20')).toBeInTheDocument();
    expect(screen.getByText('00:20 em média · variação típica ±1h02')).toBeInTheDocument();
    expect(screen.getByText('entre 23:00 e 01:30')).toBeInTheDocument();
    expect(screen.getByText('07:40 em média · variação típica ±37 min')).toBeInTheDocument();
    expect(screen.getByText('3 de 14')).toBeInTheDocument();
    const nights = screen.getByRole('list', { name: 'Últimas 14 noites' });
    expect(within(nights).getAllByRole('button')).toHaveLength(14);
    await user.click(within(nights).getByRole('button', { name: 'Noite de qui 12/11: 01:30 → 07:30, 6h. Editar' }));
    expect(await screen.findByRole('dialog', { name: 'Noite de qui 12/11' })).toBeInTheDocument();
  });
});

describe('Corpo — treino', () => {
  it('registers a workout, the minimum cardio, and deletes with Desfazer', async () => {
    const user = userEvent.setup();
    renderAt('/corpo', <CorpoScreen />);
    expect(await screen.findByText('Nenhum treino nesta semana ainda.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar treino' }));
    const sheet = await screen.findByRole('dialog', { name: 'Registrar treino' });
    expect(within(sheet).getByLabelText('Minutos')).toHaveValue(60);
    await user.click(within(sheet).getByRole('radio', { name: 'Cardio' }));
    expect(within(sheet).getByLabelText('Minutos')).toHaveValue(30);
    await user.click(within(sheet).getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(toastText()).toHaveTextContent('Treino registrado · +8 XP'));
    expect(await screen.findByText('1 treino · 30 min')).toBeInTheDocument();
    expect(screen.getByText('1 cardio')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fiz o cardio mínimo' }));
    await waitFor(() => expect(toastText()).toHaveTextContent('Cardio mínimo registrado.'));
    expect(await screen.findByText('2 treinos · 40 min')).toBeInTheDocument();
    expect(screen.getByText('sex 13/11 · Cardio · 10 min · mínimo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apagar treino: Cardio, 10 min, sex 13/11' }));
    await waitFor(() => expect(toastText()).toHaveTextContent('Treino apagado.'));
    expect(await screen.findByText('1 treino · 30 min')).toBeInTheDocument();
    await user.click(within(toastText()).getByRole('button', { name: 'Desfazer' }));
    expect(await screen.findByText('2 treinos · 40 min')).toBeInTheDocument();
  });

  it('refuses 0 minutes with a gentle message', async () => {
    const user = userEvent.setup();
    renderAt('/corpo', <CorpoScreen />);
    await user.click(await screen.findByRole('button', { name: 'Registrar treino' }));
    const sheet = await screen.findByRole('dialog', { name: 'Registrar treino' });
    await user.clear(within(sheet).getByLabelText('Minutos'));
    await user.type(within(sheet).getByLabelText('Minutos'), '0');
    await user.click(within(sheet).getByRole('button', { name: 'Registrar' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Informe quantos minutos durou.');
    expect(await db.workouts.count()).toBe(0);
  });
});

const TREINO = block({
  id: 'b2', name: 'Treino', order: 1, targetStart: '12:30', durationMin: 120, minimumMin: 45, kind: 'body', areaId: 'area-vigor',
});
const occurrence = (p: Partial<BlockOccurrence> = {}): BlockOccurrence => ({
  block: TREINO, day: '2026-11-13', plannedStart: at(13, 12, 30), plannedEnd: at(13, 14, 30),
  start: at(13, 12, 30), end: at(13, 14, 30), version: 'normal', shrunk: false, state: 'current', ...p,
});

describe('Bloco Treino', () => {
  it('suggests the minutes since the block started and highlights the minimum cardio in the minimum version', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(at(13, 13, 15));
    const occ = occurrence({
      version: 'minimum',
      session: { id: 'bs-b2-2026-11-13', createdAt: 1, updatedAt: 1, deleted: false, blockId: 'b2', day: '2026-11-13', startedAt: at(13, 12, 30), version: 'minimum' },
    });
    renderAt('/', <BodyBlockPanel occurrence={occ} now={Date.now()} />);
    const group = await screen.findByRole('group', { name: 'Treino de hoje' });
    expect(within(group).getByText(
      'Hoje vale a versão mínima do cardio: 10 min de caminhada leve ou bicicleta, em ritmo de conversa.',
    )).toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: 'Registrar treino' }));
    const sheet = await screen.findByRole('dialog', { name: 'Registrar treino' });
    expect(within(sheet).getByLabelText('Minutos')).toHaveValue(45);
    await user.click(within(sheet).getByRole('button', { name: 'Cancelar' }));
    await user.click(within(group).getByRole('button', { name: 'Fiz o cardio mínimo' }));
    expect(await within(group).findByText('Hoje: Cardio 10 min')).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: 'Fiz o cardio mínimo' })).not.toBeInTheDocument();
    expect((await db.workouts.toArray())[0]).toMatchObject({ kind: 'cardio', minutes: 10, minimum: true, blockId: 'b2' });
  });

  it('the banner shows the group only for body blocks, with the gentle line on normal days', async () => {
    const view = renderAt('/', <BlockBanner occurrence={occurrence()} now={at(13, 12, 40)} />);
    const group = await screen.findByRole('group', { name: 'Treino de hoje' });
    expect(within(group).getByText('Sem vontade de cardio? A versão mínima é 10 min.')).toBeInTheDocument();
    view.unmount();
    const focus = block({ id: 'b1', name: 'Tech', order: 0, targetStart: '09:00', durationMin: 180, minimumMin: 45, kind: 'focus' });
    renderAt('/', <BlockBanner occurrence={occurrence({ block: focus })} now={at(13, 12, 40)} />);
    await screen.findByRole('region', { name: 'Bloco atual' });
    expect(screen.queryByRole('group', { name: 'Treino de hoje' })).not.toBeInTheDocument();
  });
});

describe('Personagem — cartão Corpo', () => {
  it('summarises sleep and the week, and links to /corpo', async () => {
    await threeNights();
    renderAt('/personagem', <CharacterScreen />);
    const card = await screen.findByRole('region', { name: 'Corpo' });
    expect(await within(card).findByText('Sono: 7h20 em média · deitar ±1h02')).toBeInTheDocument();
    expect(within(card).getByText('Treinos nesta semana: 0')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Ver sono e treinos' })).toHaveAttribute('href', '/corpo');
  });
});
