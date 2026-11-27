import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Block, BlockSession, Week, XpEvent } from '@life/shared';
import { addDays, timestampAt, weekdayOf } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { testStrategy } from '../src/domain/strategyActions';
import { PatternsScreen } from '../src/features/patterns/PatternsScreen';
import { ToastHost } from '../src/ui/Toast';

const base = { createdAt: 1, updatedAt: 1, deleted: false };
const TECH: Block = {
  ...base, id: 'b1', name: 'Tech', weekdays: [1, 2, 3, 4, 5], order: 0, targetStart: '09:00', durationMin: 120,
  minimumMin: 30, kind: 'focus', protected: false, checklist: [], archived: false,
};
const session = (day: string): BlockSession => ({
  ...base, id: `bs-b1-${day}`, blockId: 'b1', day, version: 'normal',
  startedAt: timestampAt(day, '09:00'), endedAt: timestampAt(day, '10:00'),
});
const xpOn = (dayKey: string) => put('xpEvents', newRecord<XpEvent>({
  at: timestampAt(dayKey, '10:00'), amount: 5, reason: 'block', dayKey, areaId: 'area-intelecto',
}));

async function seedRoutine(): Promise<void> {
  await db.blocks.put(TECH);
  const sessions: BlockSession[] = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays('2026-09-28', i);
    const wd = weekdayOf(d);
    if (wd === 0 || wd === 6) continue;
    if (i < 28 || wd === 1 || wd === 2) sessions.push(session(d));
  }
  await db.blockSessions.bulkPut(sessions);
  await xpOn('2026-09-28');
}

function renderScreen() {
  const { hook } = memoryLocation({ path: '/padroes' });
  return render(<Router hook={hook}><PatternsScreen /><ToastHost /></Router>);
}
const region = (name: string) => screen.findByRole('region', { name });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  try { localStorage.clear(); } catch { /* ignore */ }
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

describe('Padrões', () => {
  it('without any XP: one calm explanation', async () => {
    renderScreen();
    expect(await screen.findByText(/Os padrões aparecem com o uso\./)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Padrões' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tendências' })).not.toBeInTheDocument();
  });

  it('trends by week and by month; the choice is remembered', async () => {
    const user = userEvent.setup();
    await seedRoutine();
    const { unmount } = renderScreen();
    const blocks = await region('Blocos');
    expect(within(blocks).getByText('24 de 30 blocos iniciados nas últimas 6 semanas; versão mínima em 0. Na semana mais recente: 2 de 5.')).toBeInTheDocument();
    expect(within(blocks).getByText('Por semana, da mais antiga para a mais recente: 28/09: 5 de 5; 05/10: 5 de 5; 12/10: 5 de 5; 19/10: 5 de 5; 26/10: 2 de 5; 02/11: 2 de 5.')).toBeInTheDocument();
    expect(within(blocks).getByText('Barras: blocos iniciados. Fundo: planejados.')).toBeInTheDocument();
    expect(within(await region('Retomadas')).getByText('Nenhuma retomada nas últimas 6 semanas.')).toBeInTheDocument();
    expect(within(await region('Card de início e Escapei')).getByText('Nenhum card de início nem “Escapei” nas últimas 6 semanas.')).toBeInTheDocument();
    const balance = await region('Equilíbrio');
    expect(within(balance).getByText('Estudo')).toBeInTheDocument();
    expect(within(balance).getByText('100%')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Meses' }));
    expect(screen.getByRole('button', { name: 'Meses' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(await region('Blocos')).getByText('22 de 44 blocos iniciados nos últimos 2 meses; versão mínima em 0. No mês mais recente: 19 de 22.')).toBeInTheDocument();
    unmount();
    renderScreen();
    await region('Blocos');
    expect(screen.getByRole('button', { name: 'Meses' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('with one whole week only: little history yet', async () => {
    await xpOn('2026-11-02');
    renderScreen();
    expect(await screen.findByText('Ainda pouco histórico: as tendências aparecem com 2 semanas completas de uso.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Blocos' })).not.toBeInTheDocument();
  });

  it('weeks 5–8: observed numbers, context and the suggested experiment, tested as a strategy by one tap', async () => {
    const user = userEvent.setup();
    await seedRoutine();
    renderScreen();
    const notice = await region('Semanas 5–8: Tech');
    expect(within(notice).getByRole('heading', { name: 'Semanas 5–8 · Tech' })).toBeInTheDocument();
    expect(within(notice).getByText('Nas 4 primeiras semanas, você começou 20 de 20 (100%). Nas últimas 2 semanas, 4 de 10 (40%).')).toBeInTheDocument();
    expect(within(notice).getByText(/Não é falha, e pode ser só variação/)).toBeInTheDocument();
    expect(within(notice).getByRole('link', { name: 'Ajustar a rotina' })).toHaveAttribute('href', '/planejar?aba=rotina');
    await user.click(within(notice).getByRole('button', { name: 'Testar como estratégia' }));
    await waitFor(async () => expect(await db.strategies.toArray()).toEqual([expect.objectContaining({
      title: 'Nesta semana, a meta de Tech é só a versão mínima (30 min).', source: 'padroes', status: 'testando', startDay: '2026-11-13',
    })]));
    expect(await screen.findByText('Estratégia em teste. Ela aparece no Agora e em Diário → Estratégias.')).toBeInTheDocument();
    expect(await within(notice).findByRole('button', { name: 'Já está em teste' })).toBeDisabled();
    expect((await db.weeks.get('2026-11-09'))?.experiment).toBeUndefined();
  });

  it('another strategy in test does not stop a new one: no "Trocar" any more', async () => {
    const user = userEvent.setup();
    await seedRoutine();
    await db.weeks.put({ ...base, id: '2026-11-09', objectives: [], experiment: 'Celular longe' } satisfies Week);
    await testStrategy('Biblioteca à tarde', 'ideia');
    renderScreen();
    const notice = await region('Semanas 5–8: Tech');
    await user.click(within(notice).getByRole('button', { name: 'Testar como estratégia' }));
    await waitFor(async () => expect(await db.strategies.count()).toBe(2));
    expect(within(notice).queryByRole('group', { name: 'Trocar experimento' })).not.toBeInTheDocument();
    expect((await db.weeks.get('2026-11-09'))!.experiment).toBe('Celular longe');
  });

  it('keeps keyboard focus off <body> after "Testar como estratégia"', async () => {
    const user = userEvent.setup();
    await seedRoutine();
    renderScreen();
    const notice = await region('Semanas 5–8: Tech');
    await user.click(within(notice).getByRole('button', { name: 'Testar como estratégia' }));
    await within(notice).findByRole('button', { name: 'Já está em teste' });
    expect(document.activeElement).not.toBe(document.body);
  });

  it('"Está tudo bem assim" dismisses that beginning for good', async () => {
    const user = userEvent.setup();
    await seedRoutine();
    renderScreen();
    await user.click(within(await region('Semanas 5–8: Tech')).getByRole('button', { name: 'Está tudo bem assim' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Semanas 5–8: Tech' })).not.toBeInTheDocument());
    expect((await db.settings.get('settings'))!.patterns).toEqual({ watchDismissed: ['block:tech:2026-09-28'] });
    expect(await screen.findByText('Combinado. Este aviso não volta para este começo.')).toBeInTheDocument();
  });

  it('associations wait for enough data, and say how far it is', async () => {
    await seedRoutine();
    renderScreen();
    expect(await screen.findByText('Números lado a lado, dos últimos 90 dias. Associação, não causa: outra coisa pode estar mexendo nos dois lados.')).toBeInTheDocument();
    expect(within(await region('Sono e blocos do dia seguinte')).getByText('Aparece com 14 dias úteis que tenham a noite anterior registrada. Até agora: 0.')).toBeInTheDocument();
    expect(within(await region('Sono e tipo do dia')).getByText('Aparece com 14 dias em que você escolheu o tipo do dia e registrou a noite anterior. Até agora: 0.')).toBeInTheDocument();
    expect(within(await region('Jeito de responder e acerto na revisão'))
      .getByText('Aparece com 30 revisões de cards já aprendidos em “Só pensou” e em pelo menos um outro jeito. Até agora: só pensou 0, escreveu 0, desenhou 0, falou 0.')).toBeInTheDocument();
  });

  it('explains how everything is calculated', async () => {
    await seedRoutine();
    renderScreen();
    expect(await screen.findByText('Como estes números são calculados')).toBeInTheDocument();
    expect(screen.getByText('Nada aqui usa IA. São contagens simples, e você pode discordar de qualquer leitura.')).toBeInTheDocument();
  });
});
