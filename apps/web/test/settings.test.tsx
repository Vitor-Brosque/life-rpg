import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Mission } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { getMeta, importRecords, newRecord, put } from '../src/db/repo';
import { parseImport } from '../src/features/settings/importData';
import { FocusSection } from '../src/features/settings/PreferenceSections';
import { SettingsScreen } from '../src/features/settings/SettingsScreen';
import { useSyncStatus } from '../src/sync/status';
import { ToastHost } from '../src/ui/Toast';

const NOW = new Date(2026, 10, 11, 10, 20).getTime();

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await db.delete();
  await db.open();
  await ensureSeed();
  useSyncStatus.setState({ state: 'disabled', pending: 0, lastSync: undefined, error: undefined });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderSettings() {
  const { hook } = memoryLocation({ path: '/ajustes' });
  return render(<Router hook={hook}><SettingsScreen /><ToastHost /></Router>);
}

const mk = (fields: Partial<Mission> = {}) => newRecord<Mission>({
  title: 'x', checklist: [], status: 'open', important: false, shrunk: false, postponeCount: 0, ...fields,
});

describe('SettingsScreen', () => {
  it('"Exportar JSON" downloads every table, including missions', async () => {
    const user = userEvent.setup();
    await put('missions', mk({ title: 'Ler' }));
    let blob: Blob | undefined;
    let fileName = '';
    URL.createObjectURL = vi.fn((b: Blob) => { blob = b; return 'blob:life'; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      fileName = this.download;
    });
    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Exportar JSON' }));
    await waitFor(() => expect(blob).toBeDefined());
    const data = JSON.parse(await blob!.text()) as Record<string, unknown[]>;
    expect(Object.keys(data)).toContain('missions');
    expect(data.missions!.map((m) => (m as Mission).title)).toEqual(['Ler']);
    expect(fileName).toBe('life-rpg-2026-11-11.json');
  });

  it('Sono: the Agora taps and the wind-down reminder with its time', async () => {
    const user = userEvent.setup();
    renderSettings();
    const section = await screen.findByRole('region', { name: 'Sono' });
    const prompt = within(section).getByRole('checkbox', { name: 'Mostrar “Deitei” e “Acordei” no Agora' });
    await waitFor(() => expect(prompt).toBeChecked());
    const time = within(section).getByLabelText('Horário do lembrete');
    expect(time).toBeDisabled();
    await user.click(within(section).getByRole('checkbox', { name: 'Lembrete de desaceleração' }));
    await waitFor(async () => expect((await db.settings.get('settings'))!.sleep?.windDownReminder).toBe(true));
    await waitFor(() => expect(time).toBeEnabled());
    expect(time).toHaveValue('22:45');
    await user.click(prompt);
    await waitFor(async () => expect((await db.settings.get('settings'))!.sleep?.agoraPrompt).toBe(false));
  });

  it('"Sobre" shows the version without repository paths', async () => {
    renderSettings();
    expect(await screen.findByText(/LIFE RPG, versão/)).toBeInTheDocument();
    expect(screen.queryByText(/docs\/superpowers|\.md\b/)).not.toBeInTheDocument();
  });

  it('changing "O dia começa às" persists in settings', async () => {
    const user = userEvent.setup();
    renderSettings();
    const select = await screen.findByLabelText('O dia começa às');
    await waitFor(() => expect(select).toHaveValue('4'));
    await user.selectOptions(select, '5');
    await waitFor(async () => expect((await db.settings.get('settings'))?.dayStartHour).toBe(5));
  });

  it('saves day end, Pomodoro minutes, companion mute and reminder minutes', async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() => expect(screen.getByLabelText('O dia termina às')).toHaveValue('23'));
    await user.selectOptions(screen.getByLabelText('O dia termina às'), '0');
    await user.selectOptions(screen.getByLabelText('Minutos de foco'), '50');
    await user.selectOptions(screen.getByLabelText('Minutos de pausa'), '10');
    await user.click(screen.getByLabelText('Silenciar falas'));
    await user.selectOptions(screen.getByLabelText('Lembrar compromissos'), '0');
    await waitFor(async () => {
      expect(await db.settings.get('settings')).toMatchObject({
        dayEndHour: 0, pomodoro: { focusMin: 50, breakMin: 10 }, companionMuted: true, commitmentReminderMin: 0,
      });
    });
  });

  it('the Foco hint presents Pomodoro as one option, not the best one', async () => {
    renderSettings();
    expect(await screen.findByText(/para quem prefere um ritmo fixo\. Pausas no seu ritmo funcionam tão bem quanto/)).toBeInTheDocument();
  });

  it('two quick Pomodoro changes both stick, even from a stale render', async () => {
    const user = userEvent.setup();
    // The live query may not have re-rendered between two changes: the section must not save stale values.
    const stale = (await db.settings.get('settings'))!;
    render(<FocusSection settings={stale} />);
    await user.selectOptions(screen.getByLabelText('Minutos de foco'), '50');
    await waitFor(async () => expect((await db.settings.get('settings'))?.pomodoro.focusMin).toBe(50));
    await user.selectOptions(screen.getByLabelText('Minutos de pausa'), '10');
    await waitFor(async () => expect((await db.settings.get('settings'))?.pomodoro).toEqual({ focusMin: 50, breakMin: 10 }));
  });

  it('renames an area, adds one and archives another', async () => {
    const user = userEvent.setup();
    renderSettings();
    const areas = await screen.findByRole('region', { name: 'Áreas da vida' });
    await user.click(await within(areas).findByRole('button', { name: /Corpo/ }));
    const name = within(areas).getByLabelText('Nome da área');
    await user.clear(name);
    await user.type(name, 'Saúde{Enter}');
    await waitFor(async () => expect((await db.areas.get('area-vigor'))?.name).toBe('Saúde'));
    await user.click(within(areas).getByRole('radio', { name: 'Turquesa' }));
    await waitFor(async () => expect((await db.areas.get('area-vigor'))?.color).toBe('#5fc7c0'));
    await user.click(within(areas).getByRole('button', { name: 'Arquivar área' }));
    await waitFor(async () => expect((await db.areas.get('area-vigor'))?.archived).toBe(true));

    await user.click(within(areas).getByRole('button', { name: 'Adicionar área' }));
    await user.type(within(areas).getByLabelText('Nome da nova área'), 'Espiritualidade');
    await user.type(within(areas).getByLabelText('Atributo da nova área'), 'Fé');
    await user.click(within(areas).getByRole('button', { name: 'Criar área' }));
    await waitFor(async () => {
      const added = (await db.areas.toArray()).find((a) => a.name === 'Espiritualidade');
      expect(added).toMatchObject({ attribute: 'Fé', archived: false, order: 6 });
    });
  });

  it('shows the sync status texts and the pending count', async () => {
    renderSettings();
    const sync = await screen.findByRole('region', { name: 'Sincronização' });
    expect(within(sync).getByText('Desativada')).toBeInTheDocument();
    act(() => useSyncStatus.setState({ state: 'idle', lastSync: new Date(2026, 10, 11, 9, 5).getTime(), pending: 2 }));
    expect(within(sync).getByText('Sincronizado às 09:05')).toBeInTheDocument();
    expect(within(sync).getByText('2 alterações pendentes')).toBeInTheDocument();
    act(() => useSyncStatus.setState({ state: 'syncing' }));
    expect(within(sync).getByText('Sincronizando…')).toBeInTheDocument();
    act(() => useSyncStatus.setState({ state: 'offline' }));
    expect(within(sync).getByText('Sem conexão — tudo fica salvo no aparelho')).toBeInTheDocument();
    act(() => useSyncStatus.setState({ state: 'error', error: 'Erro do servidor (500)' }));
    expect(within(sync).getByText('Erro: Erro do servidor (500)')).toBeInTheDocument();
  });

  it('"Conectar" tells the result of the access code in a toast', async () => {
    const user = userEvent.setup();
    renderSettings();
    const sync = await screen.findByRole('region', { name: 'Sincronização' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    await user.type(within(sync).getByLabelText('Código de acesso'), 'errado');
    await user.click(within(sync).getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByText('Código inválido')).toBeInTheDocument();

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ cursor: 0, changes: [] }) })));
    await user.click(within(sync).getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByText('Conectado')).toBeInTheDocument();
    expect(await getMeta('syncToken')).toBe('errado');
  });

  it('"Importar JSON" upserts newer records, queues them for sync and tells the count', async () => {
    const user = userEvent.setup();
    const local = await put('missions', mk({ title: 'Local mais nova', updatedAt: NOW }));
    await db.outbox.clear();
    const file = new File([JSON.stringify({
      exportedAt: NOW,
      missions: [
        { ...mk({ title: 'Importada' }), id: 'imp-1', createdAt: 100, updatedAt: 200 },
        { ...local, title: 'Velha', updatedAt: 10 },
        { title: 'sem id', updatedAt: 5 },
      ],
      bogus: [{ id: 'x', updatedAt: 1 }],
    })], 'life-rpg.json', { type: 'application/json' });
    renderSettings();
    await user.upload(await screen.findByLabelText('Importar JSON'), file);
    expect(await screen.findByText('1 registro importado')).toBeInTheDocument();
    expect((await db.missions.get('imp-1'))?.updatedAt).toBe(200);
    expect((await db.missions.get(local.id))?.title).toBe('Local mais nova');
    expect(await db.outbox.get('missions:imp-1')).toMatchObject({ table: 'missions', id: 'imp-1', updatedAt: 200 });
  });

  it('"Importar JSON" rejects a file that is not an export', async () => {
    const user = userEvent.setup();
    renderSettings();
    const file = new File(['{"hello": 1}'], 'x.json', { type: 'application/json' });
    await user.upload(await screen.findByLabelText('Importar JSON'), file);
    expect(await screen.findByText('Arquivo inválido: não parece uma exportação do LIFE RPG.')).toBeInTheDocument();
  });
});

describe('import helpers', () => {
  it('parseImport keeps only known tables and well-formed records', () => {
    const changes = parseImport({
      missions: [{ id: 'a', updatedAt: 3, createdAt: 1, deleted: false, title: 't' }, { id: 7, updatedAt: 1 }, null],
      xpEvents: [{ id: 'b', updatedAt: 4 }],
      meta: [{ id: 'syncToken', updatedAt: 1 }],
    });
    expect(changes.map((c) => `${c.table}:${c.record.id}`)).toEqual(['missions:a', 'xpEvents:b']);
    // Missing createdAt / deleted are filled so the server accepts the record.
    expect(changes[1]!.record).toMatchObject({ createdAt: 4, deleted: false });
    expect(() => parseImport([1, 2])).toThrow();
    expect(() => parseImport({ exportedAt: 1 })).toThrow();
  });

  it('importRecords keeps the newer copy and queues accepted rows', async () => {
    const existing = await put('missions', mk({ title: 'atual' }));
    const n = await importRecords([
      { table: 'missions', record: { ...existing, title: 'mais nova', updatedAt: existing.updatedAt + 10 } },
      { table: 'missions', record: { ...mk({ title: 'empate' }), id: existing.id, updatedAt: existing.updatedAt + 10 } },
    ]);
    expect(n).toBe(1);
    expect((await db.missions.get(existing.id))?.title).toBe('mais nova');
    expect((await db.outbox.get(`missions:${existing.id}`))?.updatedAt).toBe(existing.updatedAt + 10);
  });
});
