import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Area, LifeEvent, Mission, Week, XpEvent } from '@life/shared';
import { timestampAt } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { testStrategy } from '../src/domain/strategyActions';
import { useMissionSheet } from '../src/features/mission/MissionSheet';
import { PatternsScreen } from '../src/features/patterns/PatternsScreen';
import { ToastHost } from '../src/ui/Toast';

// The scenario of the shared postpone test, on Friday 2026-11-13: heavy Faculdade missions put off
// in the afternoons (6 postponements, 2 starts), the others started in the mornings (3 and 9).
const base = { createdAt: 1, updatedAt: 1, deleted: false };
const FACUL: Area = { ...base, id: 'area-facul', name: 'Faculdade', attribute: 'Sabedoria', color: '#7bc96f', icon: 'book', order: 9, archived: false };
const mission = (p: Partial<Mission> & Pick<Mission, 'id' | 'title'>): Mission => ({
  ...base, checklist: [], status: 'open', important: false, shrunk: false, postponeCount: 0, ...p,
});
let n = 0;
const ev = (type: LifeEvent['type'], missionId: string, day: string, time: string, data?: Record<string, unknown>): LifeEvent => ({
  ...base, id: `ev${++n}`, at: timestampAt(day, time), type, missionId, ...(data ? { data } : {}),
});
const MISSIONS = [
  mission({ id: 'mH1', title: 'Lista de cálculo', energy: 'heavy', areaId: 'area-facul' }),
  mission({ id: 'mH2', title: 'Relatório de física', energy: 'heavy', areaId: 'area-facul' }),
  mission({ id: 'mL', title: 'Ler capítulo', energy: 'light', areaId: 'area-intelecto' }),
  mission({ id: 'mM', title: 'Organizar notas', energy: 'medium' }),
];
const EVENTS = [
  ...['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((d) => ev('snoozed', 'mH1', d, '15:00')),
  ev('snoozed', 'mH2', '2026-11-09', '15:00'), ev('snoozed', 'mH2', '2026-11-10', '15:00'),
  ev('started', 'mH2', '2026-11-11', '15:00'), ev('started', 'mH2', '2026-11-12', '15:00'), ev('shrunk', 'mH2', '2026-11-09', '15:05'),
  ev('snoozed', 'mL', '2026-11-02', '10:00'),
  ...['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09'].map((d) => ev('started', 'mL', d, '10:00')),
  ev('rescheduled', 'mM', '2026-11-10', '10:00', { from: '2026-11-10', to: '2026-11-11' }),
  ev('rescheduled', 'mM', '2026-11-11', '10:00', { from: '2026-11-11', to: '2026-11-12' }),
  ...['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((d) => ev('started', 'mM', d, '10:00')),
  ev('dropped', 'mM', '2026-11-12', '10:00'),
];

async function seed(events: LifeEvent[] = EVENTS): Promise<void> {
  await db.areas.put(FACUL);
  await db.missions.bulkPut(MISSIONS);
  await db.events.bulkPut(events);
  await put('xpEvents', newRecord<XpEvent>({ at: timestampAt('2026-11-02', '10:00'), amount: 5, reason: 'start', dayKey: '2026-11-02' }));
}
function renderScreen() {
  const { hook } = memoryLocation({ path: '/padroes' });
  return render(<Router hook={hook}><PatternsScreen /><ToastHost /></Router>);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  try { localStorage.clear(); } catch { /* ignore */ }
  useMissionSheet.setState({ openId: undefined });
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

describe('Adiamentos', () => {
  it('observed totals, the most postponed missions and the groups', async () => {
    const user = userEvent.setup();
    await seed();
    renderScreen();
    expect(await screen.findByText('Nas últimas 4 semanas: adiou 9 vezes, começou 11, encolheu 1 e soltou 1.')).toBeInTheDocument();
    const first = screen.getByRole('button', { name: 'Abrir missão: Lista de cálculo, adiada 4 vezes' });
    expect(first).toHaveTextContent('Lista de cálculo · 4×');
    await user.click(first);
    expect(useMissionSheet.getState().openId).toBe('mH1');
    await user.click(screen.getByText('Por esforço, área, parte do dia, dia da semana e tipo do dia'));
    expect(screen.getByRole('heading', { level: 4, name: 'Esforço da missão' })).toBeInTheDocument();
    expect(screen.getByText('Pesadas: adiou 6 · começou 2')).toBeInTheDocument();
    expect(screen.getByText('Tarde: adiou 6 · começou 2')).toBeInTheDocument();
  });

  it('hypotheses come with their basis and an experiment tested as a strategy', async () => {
    const user = userEvent.setup();
    await seed();
    renderScreen();
    const h = await screen.findByRole('article', { name: 'Pode ser que “Lista de cálculo” esteja grande ou pouco clara.' });
    expect(within(h).getByText('“Lista de cálculo” foi adiada 4 vezes nas últimas 4 semanas e não foi começada.')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByText('Hipóteses vêm de contagens de 4 semanas: podem ser acaso e mostram associação, não causa. Você decide se vale testar.')).toBeInTheDocument();
    await user.click(within(h).getByRole('button', { name: 'Abrir missão: Lista de cálculo' }));
    expect(useMissionSheet.getState().openId).toBe('mH1');
    await user.click(within(h).getByRole('button', { name: 'Testar como estratégia' }));
    await waitFor(async () => expect((await db.strategies.toArray()).map((s) => [s.title, s.source])).toEqual([
      ['Nesta semana, reescreva o primeiro passo de “Lista de cálculo” como uma ação de 5 minutos, ou divida a missão em etapas.', 'padroes'],
    ]));
  });

  it('below 8 postponements: says how far it is', async () => {
    await seed(EVENTS.filter((e) => e.missionId !== 'mH1'));
    renderScreen();
    expect(await screen.findByText('As hipóteses aparecem a partir de 8 adiamentos em 4 semanas. Até agora: 5.')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('past experiments of the last whole weeks', async () => {
    await seed();
    await db.weeks.put({ ...base, id: '2026-11-02', objectives: [], experiment: 'Celular longe' } satisfies Week);
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Experimentos anteriores' })).toBeInTheDocument();
    expect(screen.getByText('Semana de 02/11: Celular longe')).toBeInTheDocument();
    expect(screen.queryByText(/^Blocos iniciados:/)).not.toBeInTheDocument();
    expect(screen.getByText('Uma semana é pouco para concluir: compare com calma.')).toBeInTheDocument();
  });

  it('a suggestion already in test says so', async () => {
    await seed();
    await testStrategy('Nesta semana, reescreva o primeiro passo de “Lista de cálculo” como uma ação de 5 minutos, ou divida a missão em etapas.', 'padroes');
    renderScreen();
    const h = await screen.findByRole('article', { name: 'Pode ser que “Lista de cálculo” esteja grande ou pouco clara.' });
    expect(await within(h).findByRole('button', { name: 'Já está em teste' })).toBeDisabled();
  });
});
