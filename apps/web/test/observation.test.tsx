import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DayState, Settings } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, patch, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { endObservation, startObservation } from '../src/domain/observationActions';
import { DayCloseCard } from '../src/features/dayClose/DayCloseCard';
import { ObservationCard } from '../src/features/diary/ObservationCard';
import { ObservationScreen } from '../src/features/diary/ObservationScreen';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at } from './blockFixture';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(23, 21));   // Monday 23/11, 21:00
  await db.delete();
  await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const settings = async (): Promise<Settings> => (await db.settings.get('settings'))!;
const observe = (observation: Settings['observation']) => patch<Settings>('settings', 'settings', { observation });
const card = () => screen.findByRole('region', { name: 'Observação de 14 dias' });

describe('Observação de 14 dias', () => {
  it('none: the sentence and Começar, which starts today; opening writes nothing', async () => {
    const user = userEvent.setup();
    const before = await db.outbox.count();
    render(<><ObservationCard /><ToastHost /></>);
    const c = await card();
    expect(within(c).getByText(/^Por 14 dias, marque no "Como foi hoje\?" o humor/)).toBeInTheDocument();
    expect(await db.outbox.count()).toBe(before);
    await user.click(within(c).getByRole('button', { name: 'Começar' }));
    await waitFor(async () => expect((await settings()).observation).toEqual({ startDay: '2026-11-23' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Observação começou. Até 06/12.'));
    expect(await within(await card()).findByText('Dia 1 de 14 · de 23/11 a 06/12.')).toBeInTheDocument();
    await waitFor(() => expect(within(c).getByRole('heading', { name: 'Observação de 14 dias' })).toHaveFocus());
  });

  it('Encerrar asks first; Continuar observando keeps it; Encerrar ends today and offers the summary', async () => {
    const user = userEvent.setup();
    await observe({ startDay: '2026-11-21' });
    render(<><ObservationCard /><ToastHost /></>);
    const c = await card();
    expect(await within(c).findByText('Dia 3 de 14 · de 21/11 a 04/12.')).toBeInTheDocument();
    await user.click(within(c).getByRole('button', { name: 'Encerrar observação' }));
    const ask = within(c).getByRole('group', { name: 'Confirmar encerrar observação' });
    expect(within(ask).getByText('Encerrar agora? O resumo mostra os dias até hoje.')).toBeInTheDocument();
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Encerrar' }));
    await user.click(within(ask).getByRole('button', { name: 'Continuar observando' }));
    expect(document.activeElement).toBe(within(c).getByRole('button', { name: 'Encerrar observação' }));
    expect((await settings()).observation).toEqual({ startDay: '2026-11-21' });
    await user.click(within(c).getByRole('button', { name: 'Encerrar observação' }));
    await user.click(within(c).getByRole('button', { name: 'Encerrar' }));
    await waitFor(async () => expect((await settings()).observation).toEqual({ startDay: '2026-11-21', endedDay: '2026-11-23' }));
    expect(await within(c).findByText('De 21/11 a 23/11 (3 dias).')).toBeInTheDocument();
    expect(within(c).getByRole('link', { name: 'Ver resumo' })).toHaveAttribute('href', '/diario/observacao');
    expect(within(c).getByRole('button', { name: 'Começar outra' })).toBeInTheDocument();
    await waitFor(() => expect(within(c).getByRole('heading', { name: 'Observação de 14 dias' })).toHaveFocus());
  });

  it('after 14 days it is over by itself, with nothing written; actions keep the other settings', async () => {
    await observe({ startDay: '2026-11-01' });
    const before = (await settings()).updatedAt;
    render(<ObservationCard />);
    expect(await within(await card()).findByText('De 01/11 a 14/11 (14 dias).')).toBeInTheDocument();
    expect((await settings()).updatedAt).toBe(before);
    await endObservation();   // not running: nothing
    expect((await settings()).observation).toEqual({ startDay: '2026-11-01' });
    await startObservation();
    expect(await settings()).toMatchObject({ observation: { startDay: '2026-11-23' }, dayStartHour: 4 });
  });

  it('the evening card says "Observação: dia N de 14" while it runs, and nothing else changes', async () => {
    await observe({ startDay: '2026-11-21' });
    render(<DayCloseCard today="2026-11-23" mode="normal" now={Date.now()} />);
    const c = await screen.findByRole('region', { name: 'Como foi hoje?' });
    expect(await within(c).findByText('Observação: dia 3 de 14')).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Abrir' })).toBeInTheDocument();
  });

  it('the evening card has no observation line with none, or once it has ended', async () => {
    render(<DayCloseCard today="2026-11-23" mode="normal" now={Date.now()} />);
    const c = await screen.findByRole('region', { name: 'Como foi hoje?' });
    // The same card proves it has read the settings: the line appears when an observation starts and goes when it ends.
    await startObservation();
    expect(await within(c).findByText('Observação: dia 1 de 14')).toBeInTheDocument();
    await endObservation();
    await waitFor(() => expect(within(c).queryByText(/^Observação:/)).not.toBeInTheDocument());
    expect((await settings()).observation).toMatchObject({ startDay: '2026-11-23', endedDay: '2026-11-23' });
  });

  it('the summary: counts of days with "sem registro" apart, and the note; reading writes nothing', async () => {
    await observe({ startDay: '2026-11-09', endedDay: '2026-11-22' });
    await put('dayState', newRecord<DayState>({ id: '2026-11-10', hardDay: false, reviewDone: false, mood: 'ok', load: 'leve' }));
    await put('dayState', newRecord<DayState>({ id: '2026-11-11', hardDay: false, reviewDone: false, mood: 'bem', concentration: 'boa' }));
    const before = await db.outbox.count();
    render(<ObservationScreen />);
    expect(await screen.findByRole('heading', { name: 'Resumo da observação' })).toBeInTheDocument();
    expect(await screen.findByText('De 09/11 a 22/11/2026 (14 dias).')).toBeInTheDocument();
    expect(screen.getByText('Cada número conta dias (no sono, a noite antes de cada dia).')).toBeInTheDocument();
    const value = (term: string) => screen.getByText(term, { selector: 'dt' }).nextElementSibling?.textContent;
    expect(value('Dias com algum registro')).toBe('2 de 14');
    expect(value('Humor')).toBe('Ok 1 · Bem 1 · sem registro 12');
    expect(value('Sobrecarga')).toBe('Leve 1 · sem registro 13');
    expect(value('Concentração')).toBe('Boa 1 · sem registro 13');
    expect(value('Blocos')).toBe('sem registro');
    expect(screen.getByText(/^É o que foi registrado, sem interpretação\. Associação, não causa/)).toBeInTheDocument();
    expect(await db.outbox.count()).toBe(before);
  });

  it('Tentar de novo keeps focus on the heading and then shows the summary', async () => {
    const user = userEvent.setup();
    await observe({ startDay: '2026-11-09', endedDay: '2026-11-22' });
    vi.spyOn(db.blocks, 'toArray').mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ObservationScreen />);
    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(screen.getByRole('heading', { name: 'Resumo da observação' })).toHaveFocus();
    expect(await screen.findByText('De 09/11 a 22/11/2026 (14 dias).')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Resumo da observação' })).toHaveFocus();
  });

  it('the summary screen while it runs, or without one', async () => {
    const first = render(<ObservationScreen />);
    expect(await screen.findByText('Nenhuma observação ainda. Comece pelo Diário.')).toBeInTheDocument();
    first.unmount();
    await observe({ startDay: '2026-11-21' });
    render(<ObservationScreen />);
    expect(await screen.findByText('A observação ainda está em andamento: dia 3 de 14. O resumo aparece no fim.')).toBeInTheDocument();
  });
});
