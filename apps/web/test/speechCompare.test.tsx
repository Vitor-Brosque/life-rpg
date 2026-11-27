import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechSession } from '@life/shared';
import { sha256Hex } from '@life/shared';
import { db } from '../src/db/db';
import { storeMedia } from '../src/db/media';
import { newRecord, put, setMeta } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { SPACE_RULE } from '../src/features/speech/SpaceSheet';
import { SpeechScreen } from '../src/features/speech/SpeechScreen';
import { resetMediaSyncState } from '../src/sync/media';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at } from './blockFixture';
import { WEBM_BYTES } from './fakeMedia';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(23, 10));
  await db.delete();
  await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
  resetMediaSyncState();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rec/1');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.pushState({}, '', '/');
});

const webm = (n: number): Uint8Array => new Uint8Array([...WEBM_BYTES.slice(0, 12), 9, 9, 9, n]);
const hashOf = (n: number): string => sha256Hex(webm(n))!;
const local = async (n: number, upload = false): Promise<string> => { await storeMedia(webm(n), { upload }); return hashOf(n); };
const session = (id: string, p: Partial<SpeechSession>) =>
  put('speechSessions', newRecord<SpeechSession>({ id, day: '2026-11-23', kind: 'explicacao', recordings: [], ratings: {}, ...p }));
const rec = (hash: string, durationMs: number, atMs = at(23, 10)) => ({ hash, durationMs, at: atMs });

const renderFala = () => {
  window.history.pushState({}, '', '/estudo/fala');
  return render(<><SpeechScreen /><ToastHost /></>);
};
const dialogNamed = (name: string) => screen.findByRole('dialog', { name });

describe('Comparar gravações', () => {
  it('opens on the first and the latest reading of the same text; the select never writes', async () => {
    const h1 = await local(1); const h2 = await local(2); const h3 = await local(3);
    await session('r1', { day: '2026-10-01', kind: 'leitura', passage: 'feira', ratings: { clareza: 3 }, recordings: [rec(h1, 60_000, at(1, 9) - 50 * 86_400_000)] });
    await session('e1', { day: '2026-10-02', kind: 'explicacao', recordings: [rec(h2, 30_000, at(1, 9) - 49 * 86_400_000)] });
    await session('r2', { day: '2026-11-20', kind: 'leitura', passage: 'feira', recordings: [rec(h3, 66_000, at(20, 9))] });
    const user = userEvent.setup();
    renderFala();
    const opener = await screen.findByRole('button', { name: 'Abrir comparação' });
    const outbox = await db.outbox.count();
    await user.click(opener);
    const dialog = await dialogNamed('Comparar gravações');
    const first = within(dialog).getByLabelText('Primeira gravação', { selector: 'select' }) as HTMLSelectElement;
    const second = within(dialog).getByLabelText('Segunda gravação', { selector: 'select' }) as HTMLSelectElement;
    expect(first.value).toBe(`r1:${h1}`);
    expect(second.value).toBe(`r2:${h3}`);
    const left = within(dialog).getByRole('region', { name: 'Primeira gravação' });
    const right = within(dialog).getByRole('region', { name: 'Segunda gravação' });
    expect(await within(left).findByText('Velocidade na leitura de referência: 132 palavras por minuto')).toBeInTheDocument();
    expect(within(left).getByText('Percepção (1 a 5): Clareza percebida 3')).toBeInTheDocument();
    expect(within(right).getByText('Velocidade na leitura de referência: 120 palavras por minuto')).toBeInTheDocument();
    expect(within(right).getByText('Sem autoavaliação nesta sessão.')).toBeInTheDocument();
    await user.selectOptions(second, `e1:${h2}`);
    const right2 = within(dialog).getByRole('region', { name: 'Segunda gravação' });
    expect(within(right2).getByRole('heading', { name: '02/10 · Explicação espontânea · 0:30' })).toBeInTheDocument();
    expect(within(right2).queryByText(/Velocidade na leitura/)).toBeNull();
    expect(await db.outbox.count()).toBe(outbox);
  });

  it('with one recording only, a calm line and no button', async () => {
    const h = await local(1);
    await session('e1', { recordings: [rec(h, 30_000)] });
    renderFala();
    expect(await screen.findByText('Com duas gravações, dá para ouvir uma depois da outra aqui.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir comparação' })).toBeNull();
  });

  it('a recording away from this device: the calm line and "Buscar no servidor"', async () => {
    const gone = hashOf(7);
    const h = await local(1);
    await session('e1', { day: '2026-11-01', recordings: [rec(gone, 30_000, at(1, 9))] });
    await session('e2', { day: '2026-11-02', recordings: [rec(h, 30_000, at(2, 9))] });
    const user = userEvent.setup();
    renderFala();
    await user.click(await screen.findByRole('button', { name: 'Abrir comparação' }));
    const dialog = await dialogNamed('Comparar gravações');
    expect(await within(dialog).findByText('Ouvir a primeira · não está neste aparelho')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Buscar no servidor: Ouvir a primeira' }));
    expect(await within(dialog).findByText('Ouvir a primeira · ainda não chegou a este aparelho')).toBeInTheDocument();
  });
});

describe('Espaço das gravações', () => {
  const seedOld = async (upload = false) => {
    const old = await local(1, upload);
    const recent = await local(2, false);
    await session('old', { day: '2026-10-01', recordings: [rec(old, 61_000)] });
    await session('new', { day: '2026-11-20', recordings: [rec(recent, 30_000)] });
    return old;
  };
  const serverHas = (status: number) => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response(null, { status }));
    vi.stubGlobal('fetch', f);
    return f;
  };

  it('frees an old recording once the server confirms it; focus goes to the title when the button is gone', async () => {
    const old = await seedOld();
    await setMeta('syncToken', 'tok');
    const f = serverHas(200);
    const user = userEvent.setup();
    renderFala();
    expect(await screen.findByText('2 gravações neste aparelho · 32 B')).toBeInTheDocument();
    expect(screen.getByText(SPACE_RULE)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Tirar gravações antigas deste aparelho' }));
    const dialog = await dialogNamed('Espaço das gravações');
    expect(within(dialog).getByText('01/10 · Explicação espontânea · 1:01 · 16 B')).toBeInTheDocument();
    expect(within(dialog).getByText('Total: 16 B')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Tirar 1 gravação deste aparelho' }));
    expect(await screen.findByText('1 gravação saiu deste aparelho e continua no servidor.')).toBeInTheDocument();
    expect(f.mock.calls[0]![0]).toBe(`/api/media/${old}`);
    expect(await screen.findByText('1 gravação neste aparelho · 16 B')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Tirar gravações antigas deste aparelho' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Espaço das gravações' })));
    expect(await db.mediaInfo.get(old)).toBeUndefined();
    expect((await db.speechSessions.get('old'))!.recordings[0]!.hash).toBe(old);
  });

  it('the server does not confirm: nothing leaves, its own message', async () => {
    const old = await seedOld();
    await setMeta('syncToken', 'tok');
    serverHas(404);
    const user = userEvent.setup();
    renderFala();
    await user.click(await screen.findByRole('button', { name: 'Tirar gravações antigas deste aparelho' }));
    const dialog = await dialogNamed('Espaço das gravações');
    expect(within(dialog).getByText(/Antes de tirar, o app confere com o servidor, uma a uma\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Tirar 1 gravação deste aparelho' }));
    expect(await screen.findByText('Nada saiu: o servidor não confirmou essas gravações agora. Elas continuam neste aparelho.')).toBeInTheDocument();
    expect(await db.mediaInfo.get(old)).toBeDefined();
  });

  it('while checking with the server the button is disabled and says so', async () => {
    await seedOld();
    await setMeta('syncToken', 'tok');
    let release: (r: Response) => void = () => {};
    const asked = vi.fn(() => new Promise<Response>((res) => { release = res; }));
    vi.stubGlobal('fetch', asked);
    const user = userEvent.setup();
    renderFala();
    const opener = await screen.findByRole('button', { name: 'Tirar gravações antigas deste aparelho' });
    const outbox = await db.outbox.count();
    await user.click(opener);
    const dialog = await dialogNamed('Espaço das gravações');
    expect(await db.outbox.count()).toBe(outbox);
    await user.click(within(dialog).getByRole('button', { name: 'Tirar 1 gravação deste aparelho' }));
    expect(await within(dialog).findByRole('button', { name: 'Conferindo com o servidor…' })).toBeDisabled();
    expect(dialog).toHaveFocus();
    // The button changes before the request goes out: answer only once the app has really asked the server.
    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
    release(new Response(null, { status: 200 }));
    expect(await screen.findByText('1 gravação saiu deste aparelho e continua no servidor.')).toBeInTheDocument();
  });

  it('partial result: one confirmed, one not; the list stays firm while checking', async () => {
    const old = await seedOld();
    const other = await local(3);
    await session('old2', { day: '2026-10-02', recordings: [rec(other, 20_000)] });
    await setMeta('syncToken', 'tok');
    const f = vi.fn(async (u: string) => new Response(null, { status: u.endsWith(old) ? 200 : 404 }));
    vi.stubGlobal('fetch', f);
    const user = userEvent.setup();
    renderFala();
    await user.click(await screen.findByRole('button', { name: 'Tirar gravações antigas deste aparelho' }));
    const dialog = await dialogNamed('Espaço das gravações');
    await user.click(within(dialog).getByRole('button', { name: 'Tirar 2 gravações deste aparelho' }));
    expect(await screen.findByText('1 gravação saiu deste aparelho e continua no servidor. 1 ficou aqui: o servidor ainda não confirmou.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tirar 0 gravações/ })).toBeNull();
    expect(await db.mediaInfo.get(old)).toBeUndefined();
    expect(await db.mediaInfo.get(other)).toBeDefined();
  });

  it('without a sync token: the explanation, never the button', async () => {
    await seedOld();
    renderFala();
    expect(await screen.findByText('Para tirar gravações deste aparelho, a sincronização precisa estar conectada: o app confere com o servidor antes.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tirar gravações antigas deste aparelho' })).toBeNull();
  });

  it('a file still waiting to upload with no sync: the waiting line, no button', async () => {
    await seedOld(true);
    renderFala();
    expect(await screen.findByText('A sincronização não está conectada: as gravações ainda não foram para o servidor e ficam todas neste aparelho.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tirar gravações antigas deste aparelho' })).toBeNull();
  });
});
