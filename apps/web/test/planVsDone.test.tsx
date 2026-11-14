import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Block, BlockSession, DayPlan, XpEvent } from '@life/shared';
import { timestampAt } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { PatternsScreen } from '../src/features/patterns/PatternsScreen';

const base = { createdAt: 1, updatedAt: 1, deleted: false };
const TECH: Block = {
  ...base, id: 'b1', name: 'Tech', weekdays: [1, 2, 3, 4, 5], order: 0, targetStart: '09:00', durationMin: 120,
  minimumMin: 30, kind: 'focus', protected: false, checklist: [], archived: false, areaId: 'area-intelecto',
};
const DAY = '2026-11-03';   // Tuesday of a complete week (02/11–08/11)

async function seedDay(withPlan: boolean): Promise<void> {
  await db.blocks.put(TECH);
  await put('xpEvents', newRecord<XpEvent>({ at: timestampAt(DAY, '10:00'), amount: 5, reason: 'block', dayKey: DAY, areaId: 'area-intelecto' }));
  await db.blockSessions.put({ ...base, id: `bs-b1-${DAY}`, blockId: 'b1', day: DAY, version: 'normal',
    startedAt: timestampAt(DAY, '09:00'), endedAt: timestampAt(DAY, '10:00') } satisfies BlockSession);
  if (withPlan) {
    await db.dayPlans.put({ ...base, id: DAY, day: DAY, mode: 'normal', takenAt: timestampAt(DAY, '09:00'), commitments: [], blocks: [{
      blockId: 'b1', name: 'Tech', kind: 'focus', areaId: 'area-intelecto', targetStart: '09:00', durationMin: 120,
      minimumMin: 30, protected: false, order: 0, createdAt: 1,
    }] } satisfies DayPlan);
  }
}

function renderScreen() {
  const { hook } = memoryLocation({ path: '/padroes' });
  return render(<Router hook={hook}><PatternsScreen /></Router>);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  try { localStorage.clear(); } catch { /* ignore */ }
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

describe('Planejado × executado', () => {
  it('shows the sentence, the series and the traceable days', async () => {
    await seedDay(true);
    renderScreen();
    const heading = await screen.findByRole('heading', { level: 2, name: 'Planejado × executado' });
    const section = heading.closest('section')!;
    expect(within(section).getByText(/Na última semana: .* executados de/)).toBeInTheDocument();
    expect(within(section).getByText('dias com plano registrado: 1')).toBeInTheDocument();
    expect(within(section).getByText('Barra clara: planejado. Barra cheia: executado.')).toBeInTheDocument();
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(within(section).getByText('Ver dias'));
    expect(within(section).getAllByText(/ter 03\/11: 1h de 2h/).length).toBeGreaterThan(0);
  });

  it('without plans, explains when it appears', async () => {
    await seedDay(false);
    renderScreen();
    const heading = await screen.findByRole('heading', { level: 2, name: 'Planejado × executado' });
    expect(within(heading.closest('section')!).getByText(/Aparece com os dias que têm plano registrado/)).toBeInTheDocument();
    expect(screen.queryByText(/^dias com plano registrado: [0-9]/)).not.toBeInTheDocument();
  });
});
