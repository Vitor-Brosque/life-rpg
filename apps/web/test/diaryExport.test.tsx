import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { DayState } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { saveDiaryEntry } from '../src/domain/diaryActions';
import { DiaryScreen } from '../src/features/diary/DiaryScreen';
import { ToastHost } from '../src/ui/Toast';
import { at } from './blockFixture';

function stubNavigator(key: string, value: unknown) {
  if (value === undefined) delete (navigator as unknown as Record<string, unknown>)[key];
  else Object.defineProperty(navigator, key, { configurable: true, value });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(16, 10));   // Monday 16/11: the week of 09/11 is the previous one
  await db.delete();
  await db.open();
  await ensureSeed();
  await saveDiaryEntry('a', { text: 'Dia corrido.', day: '2026-11-10', at: at(10, 21, 5), themes: ['familia'], links: [], private: false });
  await saveDiaryEntry('b', { text: 'Só meu.', day: '2026-11-12', at: at(12, 22, 10), themes: [], links: [], private: true });
  await put('dayState', newRecord<DayState>({ id: '2026-11-11', hardDay: true, reviewDone: false, mode: 'low', startedAt: at(11, 9) }));
});
afterEach(() => {
  stubNavigator('canShare', undefined);
  stubNavigator('share', undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function openSheet() {
  const user = userEvent.setup();
  const loc = memoryLocation({ path: '/diario?semana=2026-11-09' });
  render(<Router hook={loc.hook}><DiaryScreen /><ToastHost /></Router>);
  await user.click(await screen.findByRole('button', { name: 'Exportar semana' }));
  const sheet = await screen.findByRole('dialog', { name: 'Exportar semana' });
  return { user, sheet };
}
const preview = (sheet: HTMLElement) => within(sheet).getByLabelText('Prévia');

const DEFAULT_TEXT = [
  '# Diário — 09/11 a 15/11/2026',
  'Exportado do LIFE RPG em 16/11/2026. As entradas são minhas palavras, sem edição. "Registrado pelo app" vem dos registros do aplicativo.',
  '',
  '## Terça-feira, 10/11',
  '### 21:05',
  'Dia corrido.',
  '',
  '_Temas: Família_',
  '',
  '## Quarta-feira, 11/11',
  '',
  '**Registrado pelo app:** dia Baixa energia',
  '',
].join('\n');

describe('Exportar semana', () => {
  it('previews the exact text: private out by default, app records and reviews on; the switches change it', async () => {
    const { user, sheet } = await openSheet();
    expect(within(sheet).getByText('Semana 09/11–15/11')).toBeInTheDocument();
    expect(within(sheet).getByRole('switch', { name: 'Incluir entradas privadas' })).toHaveAttribute('aria-checked', 'false');
    expect(within(sheet).getByRole('switch', { name: 'Registrado pelo app' })).toHaveAttribute('aria-checked', 'true');
    expect(within(sheet).getByRole('switch', { name: 'Revisões da semana e do mês' })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(preview(sheet).textContent).toBe(DEFAULT_TEXT));
    expect(within(sheet).getByRole('region', { name: 'Prévia' })).toBe(preview(sheet));
    await user.click(within(sheet).getByRole('switch', { name: 'Incluir entradas privadas' }));
    await waitFor(() => expect(preview(sheet)).toHaveTextContent('### 22:10 · privada Só meu.'));
    await user.click(within(sheet).getByRole('switch', { name: 'Registrado pelo app' }));
    expect(preview(sheet)).not.toHaveTextContent('Registrado pelo app');
    await user.click(within(sheet).getByRole('button', { name: 'Próxima semana' }));
    await waitFor(() => expect(preview(sheet)).toHaveTextContent('# Diário — 16/11 a 22/11/2026'));
    expect(within(sheet).getByRole('button', { name: 'Próxima semana' })).toBeDisabled();
  });

  it('opening the sheet, changing the week and the switches write nothing', async () => {
    const counts = async () => [await db.outbox.count(), await db.diaryEntries.count(), await db.dayState.count()];
    const before = await counts();
    const { user, sheet } = await openSheet();
    await waitFor(() => expect(preview(sheet).textContent).toBe(DEFAULT_TEXT));
    for (const name of ['Incluir entradas privadas', 'Registrado pelo app', 'Revisões da semana e do mês']) {
      await user.click(within(sheet).getByRole('switch', { name }));
    }
    await user.click(within(sheet).getByRole('button', { name: 'Semana anterior' }));
    await waitFor(() => expect(preview(sheet)).toHaveTextContent('# Diário — 02/11 a 08/11/2026'));
    expect(await counts()).toEqual(before);
  });

  it('Compartilhar hands the .md file to the share sheet with the previewed text', async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    stubNavigator('canShare', vi.fn((data: ShareData) => (data.files?.length ?? 0) > 0));
    stubNavigator('share', share);
    const { user, sheet } = await openSheet();
    await waitFor(() => expect(preview(sheet).textContent).toBe(DEFAULT_TEXT));
    await user.click(within(sheet).getByRole('button', { name: 'Compartilhar' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const arg = share.mock.calls[0]![0];
    expect(arg.title).toBe('LIFE RPG — diário');
    const file = arg.files![0]!;
    expect(file.name).toBe('diario-2026-11-09_a_2026-11-15.md');
    expect(await file.text()).toBe(DEFAULT_TEXT);
  });

  it('Baixar downloads the file where the device cannot share it', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:diario');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { user, sheet } = await openSheet();
    await waitFor(() => expect(preview(sheet).textContent).toBe(DEFAULT_TEXT));
    await user.click(within(sheet).getByRole('button', { name: 'Baixar' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  });
});
