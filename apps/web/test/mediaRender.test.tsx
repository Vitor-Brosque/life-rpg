import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@life/shared';
import { renderCloze, sha256Hex } from '@life/shared';
import { db } from '../src/db/db';
import { storeMedia } from '../src/db/media';
import { setMeta } from '../src/db/repo';
import { AudioPlayer, stopAllAudio } from '../src/features/media/AudioPlayer';
import { MediaImage } from '../src/features/media/MediaImage';
import { Rich } from '../src/features/study/Rich';
import { matchesQuery, noteTitle } from '../src/features/study/noteDraft';
import { resetMediaSyncState } from '../src/sync/media';
import { ToastHost, useToast } from '../src/ui/Toast';
import { PNG_BYTES, WEBM_BYTES } from './fakeMedia';

const IMG = sha256Hex(PNG_BYTES);
const SND = sha256Hex(WEBM_BYTES);
let urls = 0;
beforeEach(async () => {
  await db.delete(); await db.open();
  resetMediaSyncState();
  urls = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:t/${++urls}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// While the object URL is being made (one tick), the waiting box has the same name as the image:
// assertions on `src` go inside waitFor, never on a findByRole result.
const imgSrc = (name: string) => screen.getByRole('img', { name }).getAttribute('src');

describe('images in cards', () => {
  it('renders a stored image through an object URL, revoked on unmount', async () => {
    await storeMedia(PNG_BYTES, { upload: false });
    const view = render(<Rich text={`Veja ![mapa do Brasil](media:${IMG})`} />);
    await waitFor(() => expect(imgSrc('mapa do Brasil')).toBe('blob:t/1'));
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:t/1');
  });
  it('shows a calm box while the file is not here, then the image when it arrives', async () => {
    render(<Rich text={`![](media:${IMG})`} />);
    expect(await screen.findByRole('img', { name: 'Imagem: Imagem ainda não chegou a este aparelho.' })).toBeInTheDocument();
    await storeMedia(PNG_BYTES, { upload: false });
    await waitFor(() => expect(imgSrc('Imagem')).toBe('blob:t/1'));
  });
  it('says "Baixando imagem…" while downloading', async () => {
    await setMeta('syncToken', 'tok');
    let release!: () => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
      release = () => resolve({ ok: true, status: 200, arrayBuffer: async () => PNG_BYTES.slice().buffer });
    })));
    render(<Rich text={`![gráfico](media:${IMG})`} />);
    expect(await screen.findByText('Baixando imagem…')).toBeInTheDocument();
    release();
    await waitFor(() => expect(imgSrc('gráfico')).toBe('blob:t/1'));
  });
  it('an image inside a revealed cloze is marked', async () => {
    await storeMedia(PNG_BYTES, { upload: false });
    const { container } = render(<Rich text={renderCloze(`Capital: {{1::![Brasília](media:${IMG})}}`, 1, 'back')} />);
    await waitFor(() => expect(container.querySelector('mark.cloze img')).not.toBeNull());
  });
});

describe('audio in cards', () => {
  it('plays and pauses, one sound at a time', async () => {
    const user = userEvent.setup();
    await storeMedia(WEBM_BYTES, { upload: false });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
    const { container } = render(<Rich text={`[pronúncia](media:${SND}) e [de novo](media:${SND})`} />);
    const first = await screen.findByRole('button', { name: 'Tocar áudio: pronúncia' });
    await waitFor(() => expect(first).toBeEnabled());
    await user.click(first);
    expect(play).toHaveBeenCalledTimes(1);
    const [a1] = container.querySelectorAll('audio');
    fireEvent.play(a1!);
    expect(screen.getByRole('button', { name: 'Pausar áudio: pronúncia' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tocar áudio: de novo' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Tocar áudio: de novo' }));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(pause.mock.contexts[0]).toBe(a1);
  });
  it('a missing file disables the button with a calm status; a failed play shows a toast', async () => {
    const user = userEvent.setup();
    render(<><Rich text={`[pronúncia](media:${SND})`} /><ToastHost /></>);
    expect(await screen.findByText('pronúncia · ainda não chegou a este aparelho')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tocar áudio: pronúncia · ainda não chegou a este aparelho' })).toBeDisabled();
    await storeMedia(WEBM_BYTES, { upload: false });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tocar áudio: pronúncia' })).toBeEnabled());
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValueOnce(new DOMException('não', 'NotAllowedError'));
    await user.click(screen.getByRole('button', { name: 'Tocar áudio: pronúncia' }));
    expect(await screen.findByText('Não foi possível tocar este áudio neste aparelho.')).toBeInTheDocument();
  });
});

describe('media urls', () => {
  it('a new hash revokes the old URL and shows the new one', async () => {
    await storeMedia(PNG_BYTES, { upload: false });
    const other = new Uint8Array([...PNG_BYTES, 0, 1, 2, 3]);
    await storeMedia(other, { upload: false });
    const h2 = sha256Hex(other);
    const view = render(<MediaImage hash={IMG} alt="a" />);
    await waitFor(() => expect(imgSrc('a')).toBe('blob:t/1'));
    view.rerender(<MediaImage hash={h2} alt="a" />);
    await waitFor(() => expect(imgSrc('a')).toBe('blob:t/2'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:t/1');
  });
  it('under StrictMode only the last URL stays live and the shown one is not revoked', async () => {
    await storeMedia(PNG_BYTES, { upload: false });
    render(<StrictMode><MediaImage hash={IMG} alt="a" /></StrictMode>);
    await waitFor(() => expect(screen.getByRole('img', { name: 'a' }).tagName).toBe('IMG'));
    const shown = imgSrc('a')!;
    const revoked = (URL.revokeObjectURL as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0]);
    expect(revoked).not.toContain(shown);
    expect(urls - revoked.length).toBe(1);
  });
});

describe('audio lifecycle', () => {
  const live = () => render(<><AudioPlayer url="blob:x/1" label="x" /><ToastHost /></>);
  it('stopAllAudio pauses the playing element', async () => {
    const user = userEvent.setup();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
    const { container } = live();
    await user.click(screen.getByRole('button', { name: 'Tocar áudio: x' }));
    stopAllAudio();
    expect(pause.mock.contexts).toContain(container.querySelector('audio'));
  });
  it('unmounting a playing player pauses it', async () => {
    const user = userEvent.setup();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
    const { container, unmount } = live();
    const el = container.querySelector('audio');
    await user.click(screen.getByRole('button', { name: 'Tocar áudio: x' }));
    unmount();
    expect(pause.mock.contexts).toContain(el);
  });
  it('AbortError is silent; NotAllowedError shows the toast', async () => {
    const user = userEvent.setup();
    useToast.getState().dismiss();
    live();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValueOnce(new DOMException('x', 'AbortError'));
    await user.click(screen.getByRole('button', { name: 'Tocar áudio: x' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Não foi possível tocar este áudio neste aparelho.')).toBeNull();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValueOnce(new DOMException('x', 'NotAllowedError'));
    await user.click(screen.getByRole('button', { name: 'Tocar áudio: x' }));
    expect(await screen.findByText('Não foi possível tocar este áudio neste aparelho.')).toBeInTheDocument();
  });
  it('a second tap while play() is pending pauses instead of playing again', async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => new Promise(() => {}));
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
    live();
    await user.click(screen.getByRole('button', { name: 'Tocar áudio: x' }));
    await user.click(screen.getByRole('button', { name: 'Tocar áudio: x' }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalled();
  });
  it('a disabled player names its status', () => {
    render(<AudioPlayer label="x" status="baixando…" />);
    expect(screen.getByRole('button', { name: 'Tocar áudio: x · baixando…' })).toBeDisabled();
  });
});

describe('titles and search', () => {
  it('never show hashes', () => {
    expect(noteTitle(`![mapa](media:${IMG})\nQual?`)).toBe('mapa');
    expect(noteTitle(`![](media:${IMG})`)).toBe('imagem');
    const n = { front: `[ouça](media:${SND})`, back: 'x' } as Note;
    expect(matchesQuery(n, 'ouça')).toBe(true);
    expect(matchesQuery(n, SND.slice(0, 10))).toBe(false);
  });
});
