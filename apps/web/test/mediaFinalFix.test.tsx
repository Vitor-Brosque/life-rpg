import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '@life/shared';
import type { SyncChange } from '@life/shared';
import { db } from '../src/db/db';
import { collectExport, mediaLeftOutNote } from '../src/db/exportData';
import { storeMedia } from '../src/db/media';
import { applyRemote } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { saveDeck, saveNote } from '../src/domain/studyActions';
import { AudioPlayer } from '../src/features/media/AudioPlayer';
import { MediaImage } from '../src/features/media/MediaImage';
import { SpeakButton } from '../src/features/media/SpeakButton';
import { SpokenAnswer } from '../src/features/media/SpokenAnswer';
import { useRecorder } from '../src/features/media/useRecorder';
import { DataSection } from '../src/features/settings/DataSection';
import { importFile, importSummary } from '../src/features/settings/importData';
import { DeckSheet } from '../src/features/study/DeckSheet';
import { ReviewSession } from '../src/features/study/ReviewSession';
import { useSession } from '../src/features/study/sessionStore';
import { resetMediaSyncState } from '../src/sync/media';
import { formatBytes } from '../src/ui/format';
import { ToastHost } from '../src/ui/Toast';
import { PNG_BYTES, WEBM_BYTES, installFakeMic, installFakeSpeech } from './fakeMedia';

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
let mic: ReturnType<typeof installFakeMic> | undefined;
beforeEach(async () => {
  await db.delete(); await db.open();
  await ensureSeed();
  resetMediaSyncState();
  localStorage.clear();
  window.history.pushState({}, '', '/');
});
afterEach(() => {
  mic?.uninstall(); mic = undefined;
  for (const key of ['share', 'canShare']) delete (navigator as unknown as Record<string, unknown>)[key];
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
});

describe('microphone released when revealing while still asking', () => {
  it('stop() during "asking" cancels the start: the late stream is stopped and nothing records', async () => {
    mic = installFakeMic();
    const stream = { getTracks: () => [mic!.track] } as unknown as MediaStream;
    let release: (s: MediaStream) => void = () => {};
    mic.getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>((r) => { release = r; }));
    const { result } = renderHook(() => useRecorder());
    act(() => result.current.start());
    expect(result.current.state.kind).toBe('asking');
    act(() => result.current.stop());
    expect(result.current.state.kind).toBe('idle');
    release(stream);
    await flush();
    expect(mic.track.stop).toHaveBeenCalledTimes(1);
    expect(mic.instances).toHaveLength(0);
    expect(result.current.state.kind).toBe('idle');
  });
  it('SpokenAnswer: revealing before the microphone answers leaves it off', async () => {
    mic = installFakeMic();
    const stream = { getTracks: () => [mic!.track] } as unknown as MediaStream;
    let release: (s: MediaStream) => void = () => {};
    mic.getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>((r) => { release = r; }));
    const kinds: string[] = [];
    const onKind = (k: string) => { kinds.push(k); };
    const view = render(<SpokenAnswer revealed={false} onKind={onKind} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Gravar resposta' }));
    view.rerender(<SpokenAnswer revealed onKind={onKind} />);
    release(stream);
    await flush();
    expect(mic.track.stop).toHaveBeenCalled();
    expect(kinds).not.toContain('recording');
  });
});

describe('SpokenAnswer controls', () => {
  it('one persistent button keeps focus while its label changes; the stop control has its own name', async () => {
    const user = userEvent.setup();
    mic = installFakeMic();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:s/1');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    render(<SpokenAnswer revealed={false} onKind={() => {}} />);
    const main = screen.getByRole('button', { name: 'Gravar resposta' });
    await user.click(main);
    const stop = await screen.findByRole('button', { name: 'Parar a gravação' });
    expect(stop).toBe(main);
    expect(stop).toHaveFocus();
    await user.click(stop);
    const again = await screen.findByRole('button', { name: 'Gravar de novo' });
    expect(again).toBe(main);
    expect(again).toHaveFocus();
  });
  it('the review offers it only where the browser can record', async () => {
    localStorage.setItem('life-rpg.study.speakFirst', '1');
    const d = await saveDeck({ name: 'Inglês' });
    await saveNote({ deckId: d.id, type: 'basic', front: 'apple', back: 'maçã' });
    useSession.getState().reset();
    window.history.pushState({}, '', '/estudo/revisar');
    render(<ReviewSession />);
    await screen.findByText('apple');
    expect(screen.queryByRole('button', { name: 'Gravar resposta' })).toBeNull();
    expect(screen.queryByText('Sua resposta falada')).toBeNull();
  });
});

describe('export in two steps and the media cap', () => {
  const shareable = () => {
    const share = vi.fn(async (_d: ShareData) => {});
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    return share;
  };
  it('where files can be shared the first tap only prepares; the second tap shares', async () => {
    const user = userEvent.setup();
    const share = shareable();
    render(<><DataSection /><ToastHost /></>);
    await user.click(screen.getByRole('button', { name: 'Preparar exportação' }));
    const second = await screen.findByRole('button', { name: 'Compartilhar arquivo' });
    expect(share).not.toHaveBeenCalled();
    expect(screen.getByText(/Exportação pronta/)).toBeInTheDocument();
    await user.click(second);
    expect(share).toHaveBeenCalledTimes(1);
    const file = share.mock.calls[0]![0].files![0]!;
    expect(file.type).toBe('application/json');
    expect(Object.keys(JSON.parse(await file.text()))).toContain('missions');
    expect(await screen.findByRole('button', { name: 'Preparar exportação' })).toBeInTheDocument();
  });
  it('without a share sheet one tap downloads', async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<DataSection />);
    await user.click(screen.getByRole('button', { name: 'Exportar JSON' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Compartilhar arquivo' })).toBeNull();
  });
  it('media beyond the cap are left out: queued ones go first (oldest first), then the rest, with a count', async () => {
    const mk = (n: number) => { const b = new Uint8Array(16).fill(n); b.set(PNG_BYTES.subarray(0, 8)); return b; };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000); await storeMedia(mk(1), { upload: false }); // old, already on the server
    vi.setSystemTime(2000); await storeMedia(mk(2), { upload: true }); // waiting, newer
    vi.setSystemTime(3000); await storeMedia(mk(3), { upload: true }); // waiting, newest
    vi.setSystemTime(4000); await storeMedia(mk(4), { upload: false });
    const h = (n: number) => sha256Hex(mk(n));
    const data = await collectExport(40); // room for two files of 16 bytes
    expect(data.media!.map((m) => m.hash)).toEqual([h(2), h(3)]);
    expect(data.mediaNote).toBe(mediaLeftOutNote(2));
    expect(mediaLeftOutNote(2)).toContain('2 mídias não couberam');
    expect(mediaLeftOutNote(1)).toContain('1 mídia não coube');
    const roomy = await collectExport(16 * 4);
    expect(roomy.media).toHaveLength(4);
    expect(roomy.mediaNote).toBeUndefined();
    const none = await collectExport(8);
    expect(none.media).toBeUndefined();
    expect(none.mediaNote).toBe(mediaLeftOutNote(4));
  });
});

describe('import with no room left', () => {
  it('counts media that did not fit and says so in the summary', async () => {
    await storeMedia(PNG_BYTES, { upload: false });
    const json = JSON.stringify(await collectExport());
    await db.delete(); await db.open();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(db.mediaData, 'put').mockRejectedValue(Object.assign(new Error('full'), { name: 'QuotaExceededError' }));
    const result = await importFile(new Blob([json]));
    expect(result.media).toBe(0);
    expect(result.noSpace).toBe(1);
    expect(importSummary({ records: 12, media: 0, noSpace: 1 })).toBe('12 registros importados. 1 mídia não coube neste aparelho.');
    expect(importSummary({ records: 12, media: 2, noSpace: 3 })).toBe('12 registros e 2 mídias importados. 3 mídias não couberam neste aparelho.');
  });
});

describe('one sound at a time', () => {
  it('playing a recording stops the reading, and reading stops the playing', async () => {
    const user = userEvent.setup();
    const tts = installFakeSpeech();
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:a/1');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    render(<><AudioPlayer url="blob:a/1" label="som" /><SpeakButton text="apple" lang="en-US" label="Ouvir a frente" /></>);
    await user.click(screen.getByRole('button', { name: 'Ouvir a frente' }));
    expect(tts.current()).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Tocar áudio: som' }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(tts.synth.cancel).toHaveBeenCalledTimes(2); // speak() cancels first, then play() stops the reading
    expect(tts.current()).toBeUndefined();
    pause.mockClear();
    await user.click(screen.getByRole('button', { name: /Ouvir a frente|Parar a leitura/ }));
    expect(pause).toHaveBeenCalled();
    expect(tts.current()).toBeDefined();
  });
  it('the button goes back to "Ouvir" when its text changes', async () => {
    const user = userEvent.setup();
    installFakeSpeech();
    const view = render(<SpeakButton text="apple" lang="en-US" label="Ouvir a frente" />);
    await user.click(screen.getByRole('button', { name: 'Ouvir a frente' }));
    expect(screen.getByRole('button', { name: 'Parar a leitura' })).toBeInTheDocument();
    view.rerender(<SpeakButton text="pear" lang="en-US" label="Ouvir a frente" />);
    expect(screen.getByRole('button', { name: 'Ouvir a frente' })).toBeInTheDocument();
  });
});

describe('small fixes', () => {
  it('the deck sheet shows a stored language this app does not list, instead of "Desligado"', async () => {
    const d = await saveDeck({ name: 'Coreano', speechLang: 'ko-KR' });
    render(<DeckSheet open onClose={() => {}} deck={(await db.decks.get(d.id))!} />);
    const select = screen.getByLabelText('Ouvir em voz alta') as HTMLSelectElement;
    expect(select.value).toBe('ko-KR');
    expect(select.selectedOptions[0]!.textContent).toBe('ko-KR');
  });
  it('an image that cannot be decoded shows the calm box', async () => {
    await storeMedia(PNG_BYTES, { upload: false });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:img/1');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const hash = sha256Hex(PNG_BYTES);
    render(<MediaImage hash={hash} alt="mapa" />);
    const img = await waitFor(() => {
      const el = screen.getByRole('img', { name: 'mapa' });
      expect(el.tagName).toBe('IMG');
      return el;
    });
    fireEvent.error(img);
    const box = await screen.findByRole('img', { name: 'mapa: Não foi possível mostrar esta imagem.' });
    expect(box.tagName).toBe('SPAN');
  });
  it('formatBytes never prints 1024 of a unit', () => {
    const MB = 1024 * 1024;
    expect(formatBytes(1024 * 1024 - 1)).toBe('1 MB');
    expect(formatBytes(1023.6 * 1024)).toBe('1 MB');
    expect(formatBytes(1024 ** 3 - 1)).toBe('1 GB');
    expect(formatBytes(1023.96 * MB)).toBe('1 GB');
    expect(formatBytes(1023 * 1024)).toBe('1023 KB');
    expect(formatBytes(120 * 1024)).toBe('120 KB');
  });
  it('applyRemote ignores tables that are not synced, even if this device has them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const change = { table: 'mediaInfo', record: { id: 'x', hash: 'x', createdAt: 1, updatedAt: 1, deleted: false } } as unknown as SyncChange;
    expect(await applyRemote(change)).toBe(false);
    expect(await applyRemote(change)).toBe(false);
    expect(await db.mediaInfo.count()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
