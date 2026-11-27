import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { SleepLog } from '@life/shared';
import { REPORT_DEFAULTS } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { saveDiaryEntry } from '../src/domain/diaryActions';
import { DiaryScreen } from '../src/features/diary/DiaryScreen';
import { ReportScreen } from '../src/features/diary/ReportScreen';
import { ToastHost } from '../src/ui/Toast';
import { at } from './blockFixture';

function stubNavigator(key: string, value: unknown) {
  if (value === undefined) delete (navigator as unknown as Record<string, unknown>)[key];
  else Object.defineProperty(navigator, key, { configurable: true, value });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(16, 10));   // Monday 16/11: the screen opens on the week of 09/11
  await db.delete();
  await db.open();
  await ensureSeed();
  await saveDiaryEntry('a', { text: 'Dia corrido.', day: '2026-11-10', at: at(10, 21, 5), themes: ['familia'], links: [], private: false });
  await saveDiaryEntry('b', { text: 'Só meu.', day: '2026-11-12', at: at(12, 22, 10), themes: [], links: [], private: true });
  await saveDiaryEntry('c', { text: 'Apresentei o trabalho em sala.', day: '2026-11-13', at: at(13, 20), themes: ['comunicacao'], links: [], private: false });
  await put('sleepLogs', newRecord<SleepLog>({ id: 'sleep-2026-11-12', night: '2026-11-12', bedAt: at(12, 23, 30), wakeAt: at(13, 7) }));
});
afterEach(() => {
  stubNavigator('canShare', undefined);
  stubNavigator('share', undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function open() {
  const user = userEvent.setup();
  const view = render(<Router hook={memoryLocation({ path: '/diario/relatorios' }).hook}><ReportScreen /><ToastHost /></Router>);
  return { user, view };
}
const preview = () => screen.getByRole('region', { name: 'Prévia' });
/** A chip of one group ("Período", "Tema", "Seções", "Entradas do diário"): two groups have a "Personalizado". */
const chip = (group: string, name: string) => within(screen.getByRole('group', { name: group })).getByRole('button', { name });
const HEAD = [
  'Exportado do LIFE RPG em 16/11/2026.',
  'Fatos vêm dos registros do app; percepções são minhas palavras; ausência de dado não é fracasso; interpretações são hipóteses.',
];

describe('Relatórios', () => {
  it('the Diário bar links to it', async () => {
    render(<Router hook={memoryLocation({ path: '/diario' }).hook}><DiaryScreen /></Router>);
    expect(await screen.findByRole('link', { name: 'Relatórios' })).toHaveAttribute('href', '/diario/relatorios');
  });

  it('opens on the last complete week, Geral, the diary of the theme, private entries out, every health type in', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Relatórios', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('Semana 09/11–15/11')).toBeInTheDocument();
    expect(chip('Período', 'Semana')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Tema', 'Geral')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Entradas do diário', 'Do tema')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Tema', 'Saúde')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('switch', { name: 'Incluir entradas privadas' })).toHaveAttribute('aria-checked', 'false');
    for (const name of ['Sono', 'Treino', 'Estado do dia']) expect(screen.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(preview().textContent).toContain('# Relatório — Geral — 09/11 a 15/11/2026\n'));
    const text = preview().textContent!;
    expect(text).toContain('- Dias com algum registro: 2 de 7.');
    expect(text).toContain('Dia corrido.');
    expect(text).toContain('Apresentei o trabalho em sala.');
    expect(text).not.toContain('Só meu.');
    expect(screen.getByRole('button', { name: 'Baixar' })).toBeEnabled();
  });

  it('Comunicação oral: only Prática de fala and the entries of that theme; no health switches', async () => {
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: 'Comunicação oral' }));
    await waitFor(() => expect(preview().textContent).toBe([
      '# Relatório — Comunicação oral — 09/11 a 15/11/2026', ...HEAD,
      '', '## Prática de fala', '**Sem dados:**', '- Ainda não há prática de fala registrada.',
      '', '## Diário', '**Minhas percepções:** entradas do diário, com as minhas palavras, sem edição.',
      '', '### Sexta-feira, 13/11 · 20:00', 'Apresentei o trabalho em sala.', '', '_Temas: Comunicação_', '',
    ].join('\n')));
    expect(screen.queryByRole('switch', { name: 'Sono' })).not.toBeInTheDocument();
  });

  it('Saúde: switching a health type off leaves it out of the text', async () => {
    const { user } = open();
    await screen.findByText('Semana 09/11–15/11');
    await user.click(chip('Tema', 'Saúde'));
    await waitFor(() => expect(preview().textContent).toContain('- Sono: 1 noite com Deitei e Acordei.'));
    await user.click(screen.getByRole('switch', { name: 'Sono' }));
    await waitFor(() => expect(preview().textContent).toContain('- Nenhum registro de treino ou cansaço neste período.'));
    expect(preview().textContent).not.toContain('Sono');
  });

  it('Escolher lists the period\'s entries; private ones only with the switch; the switch is off again on the next visit', async () => {
    const { user, view } = open();
    await user.click(await screen.findByRole('button', { name: 'Escolher' }));
    const list = await screen.findByRole('list', { name: 'Entradas do período' });
    expect(within(list).getAllByRole('checkbox').map((c) => c.closest('label')!.textContent)).toEqual([
      'ter 10/11 · 21:05 — Dia corrido.',
      'sex 13/11 · 20:00 — Apresentei o trabalho em sala.',
    ]);
    await waitFor(() => expect(preview().textContent).toContain('- Nenhuma entrada do diário para este relatório.'));
    await user.click(within(list).getByRole('checkbox', { name: /Apresentei/ }));
    await waitFor(() => expect(preview().textContent).toContain('### Sexta-feira, 13/11 · 20:00'));
    expect(preview().textContent).not.toContain('Dia corrido.');
    await user.click(screen.getByRole('switch', { name: 'Incluir entradas privadas' }));
    await user.click(await screen.findByRole('checkbox', { name: /Só meu/ }));
    await waitFor(() => expect(preview().textContent).toContain('### Quinta-feira, 12/11 · 22:10 · privada\nSó meu.'));
    view.unmount();
    open();
    expect(await screen.findByRole('switch', { name: 'Incluir entradas privadas' })).toHaveAttribute('aria-checked', 'false');
    expect(chip('Entradas do diário', 'Do tema')).toHaveAttribute('aria-pressed', 'true');
  });

  it('Personalizado starts from the sections of the theme chosen before', async () => {
    const { user } = open();
    await screen.findByText('Semana 09/11–15/11');
    await user.click(chip('Tema', 'Saúde'));
    await user.click(chip('Tema', 'Personalizado'));
    const sections = screen.getByRole('group', { name: 'Seções' });
    expect(within(sections).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)).toEqual(['Saúde']);
    await user.click(within(sections).getByRole('button', { name: 'Visão geral' }));
    await waitFor(() => expect(preview().textContent).toContain('# Relatório — Personalizado — 09/11 a 15/11/2026\n'));
    expect(preview().textContent).toMatch(/## Visão geral[\s\S]*## Saúde/);
  });

  it('periods: week arrows, month, and two dates (at most 92 days, up to today)', async () => {
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: 'Próxima semana' }));
    expect(screen.getByText('Semana 16/11–22/11')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próxima semana' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Semana anterior' })).toHaveFocus();
    await waitFor(() => expect(preview().textContent).toContain('# Relatório — Geral — 16/11 a 22/11/2026 (até hoje, 16/11)\n'));
    await user.click(chip('Período', 'Mês'));
    expect(screen.getByText('Novembro de 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próximo mês' })).toBeDisabled();
    await waitFor(() => expect(preview().textContent).toContain('# Relatório — Geral — novembro de 2026 (até hoje, 16/11)\n'));
    await user.click(screen.getByRole('button', { name: 'Mês anterior' }));
    expect(screen.getByText('Outubro de 2026')).toBeInTheDocument();
    await user.click(chip('Período', 'Personalizado'));
    const fromInput = screen.getByLabelText('De');
    const toInput = screen.getByLabelText('Até');
    expect([fromInput, toInput].map((i) => (i as HTMLInputElement).value)).toEqual(['2026-11-10', '2026-11-16']);
    fireEvent.change(toInput, { target: { value: '2026-11-01' } });
    expect(await screen.findByText('A data final precisa ser igual ou depois da inicial.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Baixar' })).toBeDisabled();
    expect(preview().textContent).toBe('');
    fireEvent.change(fromInput, { target: { value: '2026-07-01' } });
    fireEvent.change(toInput, { target: { value: '2026-11-10' } });
    expect(await screen.findByText('Escolha um período de até 92 dias.')).toBeInTheDocument();
    fireEvent.change(fromInput, { target: { value: '2026-11-01' } });
    await waitFor(() => expect(preview().textContent).toContain('# Relatório — Geral — 01/11 a 10/11/2026\n'));
  });

  it('opening and every choice write nothing', async () => {
    const counts = async () => [await db.outbox.count(), await db.diaryEntries.count(), await db.dayState.count(), await db.sleepLogs.count()];
    const before = await counts();
    const { user } = open();
    await waitFor(() => expect(preview().textContent).toContain('# Relatório'));
    for (const [group, name] of [['Tema', 'Saúde'], ['Entradas do diário', 'Escolher'], ['Entradas do diário', 'Todas'],
      ['Entradas do diário', 'Nenhuma'], ['Período', 'Mês'], ['Período', 'Semana'], ['Tema', 'Personalizado']] as const) {
      await user.click(chip(group, name));
    }
    await user.click(screen.getByRole('switch', { name: 'Incluir entradas privadas' }));
    expect(await counts()).toEqual(before);
  });

  it('Compartilhar hands the .md file with the previewed text to the share sheet', async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    stubNavigator('canShare', vi.fn((data: ShareData) => (data.files?.length ?? 0) > 0));
    stubNavigator('share', share);
    const { user } = open();
    await waitFor(() => expect(preview().textContent).toContain('# Relatório — Geral'));
    await user.click(screen.getByRole('button', { name: 'Compartilhar' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const arg = share.mock.calls[0]![0];
    expect(arg.title).toBe('LIFE RPG — relatório');
    const file = arg.files![0]!;
    expect(file.name).toBe('relatorio-geral-2026-11-09_a_2026-11-15.md');
    expect(file.type).toBe('text/plain');
    expect(await file.text()).toBe(preview().textContent);
  });

  it('keeps the defaults untouched and shows a calm message when reading fails', async () => {
    const before = structuredClone(REPORT_DEFAULTS);
    const { user, view } = open();
    await screen.findByText('Semana 09/11–15/11');
    await user.click(chip('Tema', 'Personalizado'));
    await user.click(within(screen.getByRole('group', { name: 'Seções' })).getByRole('button', { name: 'Visão geral' }));
    await user.click(screen.getByRole('switch', { name: 'Sono' }));
    await user.click(chip('Entradas do diário', 'Escolher'));
    await user.click(await screen.findByRole('checkbox', { name: /Apresentei/ }));
    expect(REPORT_DEFAULTS).toEqual(before);
    view.unmount();
    vi.spyOn(db.blocks, 'toArray').mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    open();
    expect(await screen.findByText('Não foi possível ler os registros agora. Tente de novo.')).toBeInTheDocument();
    expect(screen.queryByText('Carregando…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Baixar' })).toBeDisabled();
  });

  it('never shows the previous text while the new one loads, and options do not re-read', async () => {
    const reads = vi.spyOn(db.settings, 'get');
    const { user } = open();
    await waitFor(() => expect(preview().textContent).toContain('09/11 a 15/11/2026'));
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(preview().textContent ?? ''));
    observer.observe(preview(), { childList: true, characterData: true, subtree: true });
    await user.click(screen.getByRole('button', { name: 'Próxima semana' }));
    await waitFor(() => expect(preview().textContent).toContain('16/11 a 22/11/2026'));
    observer.disconnect();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((s) => s.includes('09/11 a 15/11'))).toEqual([]);
    const calls = reads.mock.calls.length;
    await user.click(chip('Tema', 'Saúde'));
    await user.click(screen.getByRole('switch', { name: 'Sono' }));
    await user.click(screen.getByRole('switch', { name: 'Incluir entradas privadas' }));
    await waitFor(() => expect(preview().textContent).toContain('# Relatório — Saúde'));
    expect(reads.mock.calls.length).toBe(calls);
  });

  it('Tentar de novo reads the same period again; Carregando… shows while the text is not there', async () => {
    const fail = vi.spyOn(db.blocks, 'toArray').mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = open();
    expect(await screen.findByText('Carregando…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Baixar' })).toBeDisabled();
    expect(await screen.findByText('Não foi possível ler os registros agora. Tente de novo.')).toBeInTheDocument();
    expect(screen.queryByText('Carregando…')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(preview().textContent).toContain('# Relatório — Geral — 09/11 a 15/11/2026'));
    expect(fail).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
    expect(screen.queryByText('Não foi possível ler os registros agora. Tente de novo.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Baixar' })).toBeEnabled();
    expect(preview()).toHaveFocus();
  });

  it('Escolher shows "Nenhuma entrada" only when the read worked', async () => {
    vi.spyOn(db.blocks, 'toArray').mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = open();
    await screen.findByRole('group', { name: 'Entradas do diário' });
    await user.click(chip('Entradas do diário', 'Escolher'));
    expect(screen.queryByText('Nenhuma entrada neste período.')).not.toBeInTheDocument();
    expect(await screen.findByText('Não foi possível ler os registros agora. Tente de novo.')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma entrada neste período.')).not.toBeInTheDocument();
  });
});
