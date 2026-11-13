import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { saveDeck } from '../src/domain/studyActions';
import { AUDIO_MESSAGES, saveAudioFile } from '../src/features/media/AudioSheet';
import { RECORDER_MESSAGES, recordingSupported, useRecorder } from '../src/features/media/useRecorder';
import { NoteEditor } from '../src/features/study/NoteEditor';
import { resetMediaSyncState } from '../src/sync/media';
import { formatMinSec } from '../src/ui/format';
import { ToastHost } from '../src/ui/Toast';
import { PNG_BYTES, WEBM_BYTES, installFakeMic } from './fakeMedia';

const SND = sha256Hex(WEBM_BYTES);
let mic: ReturnType<typeof installFakeMic> | undefined;
afterEach(() => {
  mic?.uninstall(); mic = undefined;
  vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks();
  window.history.pushState({}, '', '/');
});
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('useRecorder', () => {
  it('does nothing without MediaRecorder or a microphone API', () => {
    expect(recordingSupported()).toBe(false);
    const { result } = renderHook(() => useRecorder());
    expect(result.current.supported).toBe(false);
    act(() => result.current.start());
    expect(result.current.state.kind).toBe('idle');
  });
  it('asks for the mic only on start, records, stops the tracks and gives a playable URL', async () => {
    mic = installFakeMic();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rec/1');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const { result } = renderHook(() => useRecorder());
    expect(mic.getUserMedia).not.toHaveBeenCalled();
    act(() => result.current.start());
    expect(result.current.state.kind).toBe('asking');
    await flush();
    expect(mic.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(result.current.state).toEqual({ kind: 'recording', elapsedMs: 0 });
    expect(mic.instances[0]!.options).toEqual({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64000 });
    act(() => result.current.stop());
    await flush();
    const s = result.current.state;
    expect(s.kind).toBe('done');
    if (s.kind === 'done') {
      expect(s).toMatchObject({ url: 'blob:rec/1', capped: false });
      expect(s.blob.size).toBe(16);
      expect(s.blob.type).toBe('audio/webm;codecs=opus');
    }
    expect(mic.track.stop).toHaveBeenCalled();
    act(() => result.current.reset());
    expect(revoke).toHaveBeenCalledWith('blob:rec/1');
    expect(result.current.state.kind).toBe('idle');
  });
  it('stops by itself at 2 minutes', async () => {
    vi.useFakeTimers();
    mic = installFakeMic();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rec/2');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const { result } = renderHook(() => useRecorder());
    act(() => result.current.start());
    await flush();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current.state).toEqual({ kind: 'recording', elapsedMs: 30_000 });
    act(() => { vi.advanceTimersByTime(90_000); });
    await flush();
    expect(result.current.state).toMatchObject({ kind: 'done', capped: true, durationMs: 120_000 });
    expect(mic.track.stop).toHaveBeenCalled();
  });
  it('a failure while setting up the recorder frees the microphone and shows the calm message', async () => {
    mic = installFakeMic();
    vi.spyOn(MediaRecorder.prototype, 'start').mockImplementation(() => { throw new Error('start failed'); });
    const { result } = renderHook(() => useRecorder());
    act(() => result.current.start());
    await flush();
    expect(result.current.state).toEqual({ kind: 'error', message: RECORDER_MESSAGES.failed });
    expect(mic.track.stop).toHaveBeenCalled();
  });
  it('a late microphone after reset or unmount has its stream stopped at once and records nothing', async () => {
    mic = installFakeMic();
    const stream = { getTracks: () => [mic!.track] } as unknown as MediaStream;
    let release: (s: MediaStream) => void = () => {};
    mic.getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>((r) => { release = r; }));
    const { result, unmount } = renderHook(() => useRecorder());
    act(() => result.current.start());
    act(() => result.current.reset());
    release(stream);
    await flush();
    expect(mic.track.stop).toHaveBeenCalledTimes(1);
    expect(mic.instances).toHaveLength(0);
    expect(result.current.state.kind).toBe('idle');
    mic.track.stop.mockClear();
    mic.getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>((r) => { release = r; }));
    act(() => result.current.start());
    unmount();
    release(stream);
    await flush();
    expect(mic.track.stop).toHaveBeenCalledTimes(1);
    expect(mic.instances).toHaveLength(0);
  });
  it('falls back to a recorder without options when the constructor refuses them', async () => {
    mic = installFakeMic();
    const Base = MediaRecorder as unknown as new (s: MediaStream, o?: MediaRecorderOptions) => object;
    class Picky extends Base {
      static isTypeSupported = () => true;
      constructor(s: MediaStream, o?: MediaRecorderOptions) {
        if (o) throw new Error('options refused');
        super(s);
      }
    }
    vi.stubGlobal('MediaRecorder', Picky);
    const { result } = renderHook(() => useRecorder());
    act(() => result.current.start());
    await flush();
    expect(result.current.state).toEqual({ kind: 'recording', elapsedMs: 0 });
    expect(mic.instances).toHaveLength(1);
    expect(mic.instances[0]!.options).toBeUndefined();
  });
  it('a track that ends by itself (an interruption) finishes the recording cleanly', async () => {
    mic = installFakeMic();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rec/3');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const { result } = renderHook(() => useRecorder());
    act(() => result.current.start());
    await flush();
    act(() => { (mic!.track as unknown as { onended: () => void }).onended(); });
    await flush();
    expect(result.current.state.kind).toBe('done');
  });
  it('turns denial, a missing mic and an empty recording into gentle messages', async () => {
    for (const [opts, message] of [
      [{ deny: 'NotAllowedError' }, RECORDER_MESSAGES.denied],
      [{ deny: 'NotFoundError' }, RECORDER_MESSAGES.noMic],
      [{ deny: 'AbortError' }, RECORDER_MESSAGES.failed],
    ] as const) {
      mic?.uninstall();
      mic = installFakeMic(opts);
      const { result } = renderHook(() => useRecorder());
      act(() => result.current.start());
      await flush();
      expect(result.current.state).toEqual({ kind: 'error', message });
    }
    mic?.uninstall();
    mic = installFakeMic({ empty: true });
    const { result } = renderHook(() => useRecorder());
    act(() => result.current.start());
    await flush();
    act(() => result.current.stop());
    await flush();
    expect(result.current.state).toEqual({ kind: 'error', message: RECORDER_MESSAGES.empty });
  });
  it('unmounting mid-recording stops the recorder and the microphone; AAC wins when supported', async () => {
    mic = installFakeMic({ isTypeSupported: (t) => t === 'audio/mp4;codecs=mp4a.40.2' });
    const { result, unmount } = renderHook(() => useRecorder());
    act(() => result.current.start());
    await flush();
    expect(mic.instances[0]!.mimeType).toBe('audio/mp4;codecs=mp4a.40.2');
    unmount();
    expect(mic.instances[0]!.state).toBe('inactive');
    expect(mic.track.stop).toHaveBeenCalled();
  });
  it('formatMinSec', () => {
    expect(formatMinSec(0)).toBe('0:00');
    expect(formatMinSec(12_400)).toBe('0:12');
    expect(formatMinSec(120_000)).toBe('2:00');
  });
});

describe('audio in the note editor', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // frozen clock: the recording lasts 0:00
    vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
    await db.delete(); await db.open();
    await ensureSeed();
    resetMediaSyncState();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:t/1');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });
  async function openEditor(): Promise<HTMLTextAreaElement> {
    const d = await saveDeck({ name: 'Inglês' });
    window.history.pushState({}, '', `/estudo/nota/nova?baralho=${d.id}`);
    render(<><NoteEditor /><ToastHost /></>);
    return (await screen.findByLabelText('Verso')) as HTMLTextAreaElement;
  }

  it('records in the Áudio sheet and inserts the reference', async () => {
    const user = userEvent.setup();
    mic = installFakeMic();
    const back = await openEditor();
    await user.click(screen.getByRole('button', { name: 'Inserir áudio em Verso' }));
    await user.click(await screen.findByRole('button', { name: 'Gravar' }));
    expect(await screen.findByText('Gravando · 0:00 / 2:00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Parar' }));
    expect(await screen.findByText('Gravação · 0:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ouvir a gravação' })).toBeEnabled();
    expect(mic.track.stop).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Inserir no card' }));
    await waitFor(() => expect(back).toHaveValue(`[áudio](media:${SND})`));
    expect(screen.getByText('Áudio adicionado.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Áudio' })).toBeNull();
    expect(await db.mediaQueue.get(SND)).toBeTruthy();
  });

  it('a denied microphone gets a gentle message; the file picker still works and refuses non-audio', async () => {
    const user = userEvent.setup({ applyAccept: false });
    mic = installFakeMic({ deny: 'NotAllowedError' });
    const back = await openEditor();
    await user.click(screen.getByRole('button', { name: 'Inserir áudio em Verso' }));
    await user.click(await screen.findByRole('button', { name: 'Gravar' }));
    expect(await screen.findByText(RECORDER_MESSAGES.denied)).toBeInTheDocument();
    await user.upload(screen.getByLabelText('Escolher arquivo'), new File([PNG_BYTES], 'x.png', { type: 'image/png' }));
    expect(await screen.findByText(AUDIO_MESSAGES.format)).toBeInTheDocument();
    await user.upload(screen.getByLabelText('Escolher arquivo'), new File([WEBM_BYTES], 'voz.webm', { type: 'audio/webm' }));
    await waitFor(() => expect(back).toHaveValue(`[áudio](media:${SND})`));
  });

  it('without MediaRecorder there is no Gravar, only the file', async () => {
    const user = userEvent.setup();
    await openEditor();
    await user.click(screen.getByRole('button', { name: 'Inserir áudio em Verso' }));
    expect(await screen.findByText(AUDIO_MESSAGES.unsupported)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gravar' })).toBeNull();
    expect(screen.getByLabelText('Escolher arquivo')).toBeInTheDocument();
  });

  it('closing the sheet mid-recording frees the microphone', async () => {
    const user = userEvent.setup();
    mic = installFakeMic();
    await openEditor();
    await user.click(screen.getByRole('button', { name: 'Inserir áudio em Verso' }));
    await user.click(await screen.findByRole('button', { name: 'Gravar' }));
    await screen.findByText('Gravando · 0:00 / 2:00');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Áudio' })).toBeNull());
    expect(mic.instances[0]!.state).toBe('inactive');
    expect(mic.track.stop).toHaveBeenCalled();
  });

  it('dropping an audio file inserts an audio reference; saveAudioFile refuses more than 8 MB', async () => {
    const back = await openEditor();
    fireEvent.drop(back, { dataTransfer: { files: [new File([WEBM_BYTES], 'voz.webm', { type: 'audio/webm' })], types: ['Files'] } });
    await waitFor(() => expect(back).toHaveValue(`[áudio](media:${SND})`));
    const big = { size: 8 * 1024 * 1024 + 1, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Blob;
    await expect(saveAudioFile(big)).rejects.toThrow(AUDIO_MESSAGES.tooBig);
  });
});
