import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockSession } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { createCommitment, startBlock } from '../src/domain/actions';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { PainelScreen } from '../src/features/painel/PainelScreen';
import { TIMER_IDLE, useTimer } from '../src/timer/store';
import { at, seedBlocks } from './blockFixture';

// §10: the Painel's "Hoje" timeline draws today's blocks next to the commitments; Apoio shows
// "Onde você parou" of the current block. Wednesday 2026-11-11, the shared five-block fixture.

const base = { createdAt: 1, updatedAt: 1, deleted: false };

beforeEach(async () => {
  // Only Date is faked: fake-indexeddb needs the real setImmediate/setTimeout.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 10));
  localStorage.clear();
  useTimer.setState({ ...TIMER_IDLE });
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: '2026-11-11', emptyDay: undefined });
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
});
afterEach(() => { vi.useRealTimers(); });

const timeline = async () => {
  const hoje = await screen.findByRole('region', { name: 'Hoje' });
  return within(hoje).findByRole('list', { name: 'Linha do tempo' });
};
/** The timeline entry (li) that names `text`. */
const entry = (list: HTMLElement, text: string) => within(list).getByText(text).closest('li')!;

describe('Painel timeline with blocks', () => {
  it('draws a named band per block of today, the current one marked', async () => {
    render(<PainelScreen />);
    const list = await timeline();
    const tech = await within(list).findByText('Tech');
    expect(tech.closest('li')).toHaveAttribute('aria-current', 'true');
    for (const name of ['Treino', 'Facul', 'Tecnico', 'Compl']) {
      expect(entry(list, name)).not.toHaveAttribute('aria-current');
      expect(entry(list, name)).toHaveAttribute('data-state', 'upcoming');
    }
    expect(within(entry(list, 'Treino')).getByText('12:30–14:30')).toBeInTheDocument();
    // The class is still drawn, and "livre" means outside blocks and commitments.
    expect(within(list).getByText('Aula')).toBeInTheDocument();
    expect(within(list).getAllByText('livre 30 min')).toHaveLength(2);
    expect(within(list).queryByText('livre 9h')).not.toBeInTheDocument();
  });

  it('a shrunk block has its cut part dashed', async () => {
    vi.setSystemTime(at(11, 10, 30));
    await startBlock('b1');
    const { container } = render(<PainelScreen />);
    const list = await timeline();
    await within(list).findByText('Tech');
    const tech = entry(list, 'Tech');
    expect(within(tech).getByText('10:30–12:00')).toBeInTheDocument();
    expect(within(tech).getByText(/encolhido: 1h30 de 3h/)).toBeInTheDocument();
    expect(container.querySelector('.timeline__cut')).not.toBeNull();
  });

  it('a block that does not fit today is a thin "sem tempo hoje" marker', async () => {
    vi.setSystemTime(at(11, 16));
    await createCommitment({ title: 'Dentista', date: '2026-11-11', start: '17:45', end: '19:00' });
    render(<PainelScreen />);
    const list = await timeline();
    await within(list).findByText('Compl');
    const compl = entry(list, 'Compl');
    expect(compl).toHaveAttribute('data-state', 'skipped');
    expect(within(compl).getByText('sem tempo hoje')).toBeInTheDocument();
    expect(entry(list, 'Facul')).toHaveAttribute('aria-current', 'true');
  });

  it('a finished block is muted with a check', async () => {
    vi.setSystemTime(at(11, 11, 50));
    const done: BlockSession = {
      ...base, id: 'bs-b1-2026-11-11', blockId: 'b1', day: '2026-11-11', startedAt: at(11, 9), endedAt: at(11, 11, 30), version: 'normal',
    };
    await db.blockSessions.put(done);
    render(<PainelScreen />);
    const list = await timeline();
    await within(list).findByText('Tech');
    const tech = entry(list, 'Tech');
    expect(tech).toHaveAttribute('data-state', 'done');
    expect(within(tech).getByText('concluído')).toBeInTheDocument();
    expect(tech.querySelector('.icon')).not.toBeNull();
    expect(within(list).queryByRole('listitem', { current: true })).not.toBeInTheDocument();
  });

  it('Apoio shows "Onde você parou" for the current block', async () => {
    const past: BlockSession = {
      ...base, id: 'bs-b1-2026-11-10', blockId: 'b1', day: '2026-11-10', startedAt: at(10, 9), endedAt: at(10, 11),
      version: 'normal', nextAction: 'Revisar o parser',
    };
    await db.blockSessions.put(past);
    render(<PainelScreen />);
    const apoio = await screen.findByRole('region', { name: 'Apoio' });
    const note = await within(apoio).findByRole('note', { name: 'Onde você parou' });
    expect(note).toHaveTextContent('Revisar o parser');
    const agora = screen.getByRole('region', { name: 'Agora' });
    expect(within(agora).queryByRole('note', { name: 'Onde você parou' })).not.toBeInTheDocument();
  });
});
