import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '@life/shared';
import { db } from '../src/db/db';
import { MEDIA_LEFT_OUT, collectExport } from '../src/db/exportData';
import { storeMedia } from '../src/db/media';
import { setMeta } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { DataSection } from '../src/features/settings/DataSection';
import { StorageSection } from '../src/features/settings/StorageSection';
import { importFile, importSummary } from '../src/features/settings/importData';
import { formatBytes } from '../src/ui/format';
import { ToastHost } from '../src/ui/Toast';
import { PNG_BYTES, WEBM_BYTES } from './fakeMedia';

const MB = 1024 * 1024;
const IMG = sha256Hex(PNG_BYTES);
const stubStorage = (value: unknown) => Object.defineProperty(navigator, 'storage', { configurable: true, value });
beforeEach(async () => { await db.delete(); await db.open(); await ensureSeed(); });
afterEach(() => { delete (navigator as unknown as Record<string, unknown>).storage; vi.restoreAllMocks(); });

describe('formatBytes', () => {
  it('B, KB, then one decimal from MB, with a comma', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(120 * 1024)).toBe('120 KB');
    expect(formatBytes(8.2 * MB)).toBe('8,2 MB');
    expect(formatBytes(12 * MB)).toBe('12 MB');
    expect(formatBytes(1.2 * 1024 * MB)).toBe('1,2 GB');
  });
});

describe('Armazenamento', () => {
  it('shows media on this device and uploads waiting; hides what the browser lacks', async () => {
    render(<StorageSection />);
    expect(await screen.findByText('Nenhuma')).toBeInTheDocument();
    expect(screen.queryByText('Espaço usado pelo app')).toBeNull();
    expect(screen.queryByText('Armazenamento persistente')).toBeNull();
    await storeMedia(PNG_BYTES, { upload: true });
    await storeMedia(WEBM_BYTES, { upload: true });
    expect(await screen.findByText('2 arquivos · 32 B')).toBeInTheDocument();
    expect(screen.getByText('Sem sincronização: as mídias ficam só neste aparelho.')).toBeInTheDocument();
    await setMeta('syncToken', 'tok');
    expect(await screen.findByText('2 mídias')).toBeInTheDocument();
  });
  it('shows space and persistence, and asks the browser to keep the data', async () => {
    const user = userEvent.setup();
    let kept = false;
    const persist = vi.fn(async () => { kept = true; return true; });
    stubStorage({ estimate: async () => ({ usage: 12 * MB, quota: 1.2 * 1024 * MB }), persisted: async () => kept, persist });
    render(<><StorageSection /><ToastHost /></>);
    expect(await screen.findByText('12 MB de 1,2 GB')).toBeInTheDocument();
    expect(await screen.findByText('Não garantido — o navegador pode liberar espaço se o aparelho ficar cheio.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pedir para manter os dados' }));
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Pronto: o navegador vai manter os dados.')).toBeInTheDocument();
    expect(await screen.findByText('Sim — o navegador não apaga estes dados sozinho.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pedir para manter os dados' })).toBeNull();
  });
  it('a refused request gets the gentle hint', async () => {
    const user = userEvent.setup();
    stubStorage({ persisted: async () => false, persist: async () => false });
    render(<><StorageSection /><ToastHost /></>);
    await user.click(await screen.findByRole('button', { name: 'Pedir para manter os dados' }));
    expect(await screen.findByText('O navegador não aceitou agora. Instalar o app na tela de início costuma ajudar.')).toBeInTheDocument();
  });
});

describe('export and import with media', () => {
  it('embeds media up to the cap and leaves them out with a note above it', async () => {
    await storeMedia(PNG_BYTES, { upload: false });
    const data = await collectExport();
    expect(data.media).toEqual([{ hash: IMG, type: 'image/png', data: Buffer.from(PNG_BYTES).toString('base64') }]);
    expect(data.mediaNote).toBeUndefined();
    const capped = await collectExport(8);
    expect(capped.media).toBeUndefined();
    expect(capped.mediaNote).toBe(MEDIA_LEFT_OUT);
  });
  it('an exported file brings its media back into an empty device, queued for upload', async () => {
    await storeMedia(PNG_BYTES, { upload: false });
    const json = JSON.stringify(await collectExport());
    await db.delete(); await db.open();
    const result = await importFile(new Blob([json], { type: 'application/json' }));
    expect(result.media).toBe(1);
    expect(result.records).toBeGreaterThan(0);
    expect((await db.mediaInfo.get(IMG))!.type).toBe('image/png');
    expect(await db.mediaQueue.get(IMG)).toBeTruthy();
    expect((await importFile(new Blob([json]))).media).toBe(0);
  });
  it('skips media whose bytes do not match their hash, and malformed entries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const media = [
      { hash: 'a'.repeat(64), type: 'image/png', data: Buffer.from(PNG_BYTES).toString('base64') },
      { hash: 'nope', data: 'x' },
    ];
    const json = JSON.stringify({ ...(await collectExport()), media });
    expect((await importFile(new Blob([json]))).media).toBe(0);
    expect(await db.mediaInfo.count()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('importSummary', () => {
    expect(importSummary({ records: 1, media: 0 })).toBe('1 registro importado');
    expect(importSummary({ records: 12, media: 0 })).toBe('12 registros importados');
    expect(importSummary({ records: 12, media: 3 })).toBe('12 registros e 3 mídias importados');
    expect(importSummary({ records: 1, media: 1 })).toBe('1 registro e 1 mídia importados');
  });
  it('Dados says in advance whether media go into the export', async () => {
    render(<DataSection />);
    await storeMedia(PNG_BYTES, { upload: false });
    expect(await screen.findByText('Imagens e áudios (16 B) entram na exportação.')).toBeInTheDocument();
    await db.mediaInfo.put({ hash: 'f'.repeat(64), type: 'audio/mp4', size: 26 * MB, addedAt: 1 });
    expect(await screen.findByText('Imagens e áudios passam de 25 MB e ficam fora da exportação (continuam guardados neste aparelho e, com a sincronização, no servidor).')).toBeInTheDocument();
  });
});
