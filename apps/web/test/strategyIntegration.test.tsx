import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newStrategyDraft } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { setDayMode } from '../src/domain/actions';
import { setWeekExperiment } from '../src/domain/patternActions';
import { createStrategy, testStrategy, trashStrategy } from '../src/domain/strategyActions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { useCompanion } from '../src/features/companion/store';
import { useWeekSession } from '../src/features/week/weekCycle';
import { ToastHost } from '../src/ui/Toast';
import { at, seedBlocks } from './blockFixture';

// Wednesday 11/11 at 09:30: "Tech" (b1, journey j-tech) is the current block.
const TODAY = '2026-11-11';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 9, 30));
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: TODAY, emptyDay: undefined });
  useWeekSession.setState({ dismissed: undefined, opened: undefined, started: undefined });
  useCompanion.getState().clear();
  await setDayMode('normal');
});
afterEach(() => { vi.useRealTimers(); });

const renderAgora = () => render(<><AgoraScreen /><ToastHost /></>);
const banner = () => screen.findByRole('region', { name: 'Bloco atual' });

describe('strategies in the Agora', () => {
  it('the line names the testing strategies (newest first, two and +N); the old experiment shows until a strategy has its title', async () => {
    await testStrategy('Celular longe', 'ideia');
    vi.setSystemTime(at(11, 9, 31));
    await testStrategy('Biblioteca à tarde', 'ia');
    vi.setSystemTime(at(11, 9, 32));
    await testStrategy('Pauta na véspera', 'ideia');
    await setWeekExperiment('Começar pelo teste');
    renderAgora();
    expect(await screen.findByText('Estratégias em teste: Pauta na véspera · Biblioteca à tarde · +1')).toBeInTheDocument();
    expect(screen.getByText('Experimento da semana: Começar pelo teste')).toBeInTheDocument();
    // Linked to the current block: the banner has read the strategies once it shows it; the unlinked ones stay out.
    await createStrategy(newStrategyDraft(TODAY, { title: 'Pauta do bloco', link: { kind: 'block', id: 'b1' } }));
    const b = await banner();
    expect(await within(b).findByText('Estratégia em teste: Pauta do bloco')).toBeInTheDocument();
    expect(within(b).queryByText(/Celular longe|Biblioteca à tarde|Pauta na véspera/)).not.toBeInTheDocument();
    await testStrategy('começar pelo TESTE', 'padroes');
    await waitFor(() => expect(screen.queryByText(/^Experimento da semana/)).not.toBeInTheDocument());
  });

  it('the current block shows the strategies linked to it or to its journey, before Começar bloco', async () => {
    await createStrategy(newStrategyDraft(TODAY, { title: 'Celular em outro cômodo', link: { kind: 'block', id: 'b1' } }));
    renderAgora();
    const b = await banner();
    expect(await within(b).findByText('Estratégia em teste: Celular em outro cômodo')).toBeInTheDocument();
    expect(within(b).getByRole('button', { name: 'Começar bloco' })).toBeInTheDocument();
    vi.setSystemTime(at(11, 9, 31));
    await createStrategy(newStrategyDraft(TODAY, { title: 'Pauta na véspera', link: { kind: 'journey', id: 'j-tech' } }));
    expect(await within(b).findByText('Estratégias em teste: Pauta na véspera · Celular em outro cômodo')).toBeInTheDocument();
  });

  it('a strategy of another block or a trashed one stays out of the banner; nothing is written by showing them', async () => {
    await createStrategy(newStrategyDraft(TODAY, { title: 'Treino cedo', link: { kind: 'block', id: 'b2' } }));
    const t = await createStrategy(newStrategyDraft(TODAY, { title: 'Celular longe', link: { kind: 'block', id: 'b1' } }));
    await trashStrategy(t.id);
    await createStrategy(newStrategyDraft(TODAY, { title: 'Biblioteca à tarde', link: { kind: 'block', id: 'b1' } }));
    const before = [await db.outbox.count(), await db.strategies.count()];
    renderAgora();
    const b = await banner();
    // The banner shows the linked one, so it has read the strategies; the other block's and the trashed one are not there.
    expect(await within(b).findByText('Estratégia em teste: Biblioteca à tarde')).toBeInTheDocument();
    expect(within(b).queryByText(/Treino cedo|Celular longe/)).not.toBeInTheDocument();
    expect([await db.outbox.count(), await db.strategies.count()]).toEqual(before);
  });
});
