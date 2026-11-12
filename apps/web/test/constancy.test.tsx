import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { DayState, XpEvent } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { CharacterScreen } from '../src/features/character/CharacterScreen';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { PainelScreen } from '../src/features/painel/PainelScreen';
import { TIMER_IDLE, useTimer } from '../src/timer/store';

// §9 Constância: only non-free days count ("4 de 5 dias úteis"); free days are labelled "livre".
// Today is Wednesday 2026-11-11: the last 7 days are Thu 5 … Wed 11 (Sat 7 and Sun 8 are free).

const base = { createdAt: 1, updatedAt: 1, deleted: false };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 10, 20));
  useTimer.setState({ ...TIMER_IDLE });
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: '2026-11-11', emptyDay: undefined });
  await db.delete();
  await db.open();
  await ensureSeed();
  // Wed 11, Mon 9 (workdays), Sat 7 (free) and Tue 20 Oct (inside the 30 days).
  const xp = (id: string, dayKey: string): XpEvent => ({ ...base, id, at: 1, amount: 5, reason: 'complete', dayKey });
  await db.xpEvents.bulkPut([xp('a', '2026-11-11'), xp('b', '2026-11-09'), xp('c', '2026-11-07'), xp('d', '2026-10-20')]);
});
afterEach(() => { vi.useRealTimers(); });

function renderCharacter() {
  const { hook } = memoryLocation({ path: '/personagem' });
  return render(<Router hook={hook}><CharacterScreen /></Router>);
}

describe('constancy in workdays', () => {
  it('Character counts workdays only, labels free days "livre" and never says "sequência"', async () => {
    renderCharacter();
    const dots = await screen.findByRole('list', { name: '2 de 5 dias úteis com atividade' });
    expect(within(dots).getAllByRole('listitem')).toHaveLength(7);
    expect(within(dots).getAllByText('livre')).toHaveLength(2);
    expect(within(dots).getByRole('listitem', { name: 'Dia livre, com atividade' })).toHaveClass('is-free');
    expect(within(dots).getByRole('listitem', { name: 'Dia livre' })).toHaveClass('is-free');
    expect(within(dots).getByText('hoje')).toBeInTheDocument();

    expect(screen.getByText('2 de 5 dias úteis')).toBeInTheDocument();
    // 22 workdays from 13 Oct to 11 Nov; Saturday's activity is a bonus, not part of the count.
    expect(screen.getByText('3 de 22 dias úteis nos últimos 30')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sequ[eê]ncia/i);
  });

  it('a weekday marked free is not counted either', async () => {
    const free: DayState = { ...base, id: '2026-11-10', hardDay: false, reviewDone: false, mode: 'free' };
    await db.dayState.put(free);
    renderCharacter();
    expect(await screen.findByText('2 de 4 dias úteis')).toBeInTheDocument();
    const dots = screen.getByRole('list', { name: '2 de 4 dias úteis com atividade' });
    expect(within(dots).getAllByText('livre')).toHaveLength(3);
  });

  it('the Painel constancy card uses the same count', async () => {
    render(<PainelScreen />);
    const apoio = await screen.findByRole('region', { name: 'Apoio' });
    expect(await within(apoio).findByText('2 de 5 dias úteis — um dia parado não apaga nada.')).toBeInTheDocument();
    expect(within(apoio).getAllByText('livre')).toHaveLength(2);
  });
});
