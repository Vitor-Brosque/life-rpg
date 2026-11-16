import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Journey } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { newRecord, put } from '../src/db/repo';
import { createMission } from '../src/domain/actions';
import { JourneyDetail } from '../src/features/journeys/JourneyDetail';
import { JourneysView } from '../src/features/journeys/JourneysView';
import { ToastHost } from '../src/ui/Toast';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 10, 20).getTime());
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function seedJourney(): Promise<Journey> {
  const j = await put('journeys', newRecord<Journey>({ title: 'Mudança', outcome: 'Casa nova arrumada', status: 'active', order: 0 }));
  await createMission({ title: 'Encaixotar livros', journeyId: j.id, journeyOrder: 0, status: 'done', completedAt: Date.now() });
  await createMission({ title: 'Contratar frete', journeyId: j.id, journeyOrder: 1 });
  await createMission({ title: 'Trocar endereço', journeyId: j.id, journeyOrder: 2 });
  return j;
}

describe('JourneysView', () => {
  it('shows progress 1/3 and the next mission', async () => {
    await seedJourney();
    render(<JourneysView />);
    expect(await screen.findByText('Mudança')).toBeInTheDocument();
    expect(await screen.findByText('1/3')).toBeInTheDocument();
    expect(screen.getByText(/Contratar frete/)).toBeInTheDocument();
  });

  it('creates a journey with the inline form', async () => {
    render(<JourneysView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Nova jornada' }));
    await userEvent.type(screen.getByLabelText('Título'), 'Aprender violão');
    await userEvent.type(screen.getByLabelText('Resultado esperado'), 'Tocar três músicas');
    await userEvent.click(screen.getByRole('button', { name: 'Criar jornada' }));
    await waitFor(async () => {
      const all = await db.journeys.toArray();
      expect(all.find((j) => j.title === 'Aprender violão')?.outcome).toBe('Tocar três músicas');
    });
  });
});

describe('JourneyDetail', () => {
  it('"Concluir jornada" confirms and awards 30 XP', async () => {
    const j = await seedJourney();
    render(<><JourneyDetail id={j.id} /><ToastHost /></>);
    await userEvent.click(await screen.findByRole('button', { name: 'Concluir jornada' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sim, concluir' }));
    await waitFor(async () => {
      const xp = (await db.xpEvents.toArray()).filter((x) => x.reason === 'journey').reduce((s, x) => s + x.amount, 0);
      expect(xp).toBe(30);
    });
    expect(await screen.findByText(/\+30 XP/)).toBeInTheDocument();
    expect((await db.journeys.get(j.id))?.status).toBe('done');
  });

  it('adds a mission at the end of the journey', async () => {
    const j = await seedJourney();
    render(<JourneyDetail id={j.id} />);
    await userEvent.type(await screen.findByLabelText('Nova missão da jornada'), 'Devolver chaves{Enter}');
    await waitFor(async () => {
      const m = (await db.missions.toArray()).find((x) => x.title === 'Devolver chaves');
      expect(m?.journeyId).toBe(j.id);
      expect(m?.journeyOrder).toBe(3);
    });
  });
});
