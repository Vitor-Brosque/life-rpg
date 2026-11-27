import { useCallback, useEffect, useRef, useState } from 'react';
import { AUDIO_BITS_PER_SECOND, AUDIO_MAX_MS, pickRecorderType } from '@life/shared';

// Microphone recording (Marco 3c, spec §4.2 and §6.4). The microphone is asked for only inside
// start() (a tap), tracks are stopped as soon as the recording ends (the iPhone's mic indicator
// goes off), and a recording longer than `maxMs` (default AUDIO_MAX_MS) stops by itself.

export const RECORDER_MESSAGES = {
  denied: 'O microfone não está liberado para o LIFE RPG. Para gravar, permita o microfone nas configurações do navegador para este site. Dá para continuar sem áudio.',
  noMic: 'Nenhum microfone encontrado neste aparelho.',
  failed: 'Não foi possível gravar agora. Tente de novo.',
  empty: 'A gravação ficou vazia. Tente de novo.',
} as const;

export type RecorderState =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'recording'; elapsedMs: number }
  | { kind: 'done'; blob: Blob; url: string; durationMs: number; capped: boolean }
  | { kind: 'error'; message: string };

export interface Recorder {
  state: RecorderState;
  supported: boolean;
  /** Asks for the microphone (first time) and records. Call it from a tap. */
  start(): void;
  /** Ends the recording; the result arrives as state 'done'. */
  stop(): void;
  /** Drops the recording (URL revoked) and any recording in progress, back to 'idle'. */
  reset(): void;
}

export function recordingSupported(): boolean {
  return typeof globalThis.MediaRecorder === 'function'
    && typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

const TICK_MS = 250;

interface Active {
  recorder: MediaRecorder; stream: MediaStream; timer: ReturnType<typeof setInterval>; capped: boolean;
  chunks: Blob[]; startedAt: number; type: string | undefined;
}

/** A finished recording handed to the caller (see `RecorderOptions.onUnmount`). */
export interface RecordingResult { blob: Blob; durationMs: number; capped: boolean }

export interface RecorderOptions {
  /**
   * Called when the component unmounts with a recording in progress (it is stopped and finished first), one whose
   * stop is still pending (finished when the recorder delivers it) or one that ended and was not reset yet. Without it (card audio), unmounting drops the recording, as before.
   */
  onUnmount?: (r: RecordingResult) => void;
}

const stopTracks = (stream: MediaStream): void => {
  for (const t of stream.getTracks()) t.stop();
};

function errorMessage(e: unknown): string {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return RECORDER_MESSAGES.denied;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return RECORDER_MESSAGES.noMic;
  return RECORDER_MESSAGES.failed;
}

/** `maxMs`: where the recording stops by itself (cards: AUDIO_MAX_MS, 2 min; speech: SPEECH_AUDIO_MAX_MS, 3 min). The `maxMs` in force is the one captured when recording starts. */
export function useRecorder(maxMs: number = AUDIO_MAX_MS, options?: RecorderOptions): Recorder {
  const [state, setState] = useState<RecorderState>({ kind: 'idle' });
  const onUnmount = useRef(options?.onUnmount);
  onUnmount.current = options?.onUnmount;
  /** The finished recording while the state is 'done' (cleared by start/reset). */
  const finished = useRef<RecordingResult | undefined>(undefined);
  const maxMsRef = useRef(maxMs);
  maxMsRef.current = maxMs;
  const active = useRef<Active | undefined>(undefined);
  const url = useRef<string | undefined>(undefined);
  /** Bumped by every start/reset/unmount: callbacks of an older run do nothing. */
  const run = useRef(0);

  const teardown = useCallback((): void => {
    run.current += 1;
    const a = active.current;
    active.current = undefined;
    if (a) {
      clearInterval(a.timer);
      a.recorder.ondataavailable = null;
      a.recorder.onstop = null;
      if (a.recorder.state !== 'inactive') {
        try { a.recorder.stop(); } catch { /* already stopped */ }
      }
      stopTracks(a.stream);
    }
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = undefined;
  }, []);

  useEffect(() => () => {
    const give = onUnmount.current;
    const a = active.current;
    if (give && a) {
      // Finish the recording outside the component: the last data arrives with stop, then the caller gets the blob.
      // `a` still being active while the recorder is 'inactive' means stop() was called and onstop has not arrived
      // yet (Parar, then leaving at once): the hand-over takes onstop over the same way, without calling stop() again.
      active.current = undefined;
      run.current += 1;   // the React state callbacks of this run do nothing any more
      clearInterval(a.timer);
      const { recorder, stream, chunks, startedAt, type } = a;
      recorder.onerror = null;
      recorder.onstop = () => {
        stopTracks(stream);
        const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
        if (blob.size > 0) give({ blob, durationMs: Math.min(maxMsRef.current, Date.now() - startedAt), capped: a.capped });
      };
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { stopTracks(stream); }
      }
    } else if (give && finished.current) {
      give(finished.current);
    }
    finished.current = undefined;
    teardown();
  }, [teardown]);
  useEffect(() => { stateKind.current = state.kind; }, [state.kind]);

  const stateKind = useRef<RecorderState['kind']>('idle');
  const stop = useCallback((): void => {
    const a = active.current;
    if (a) {
      if (a.recorder.state !== 'inactive') a.recorder.stop();
      return;
    }
    // Still waiting for the microphone: cancel the pending start (the late stream is stopped by the run guard).
    if (stateKind.current === 'asking') {
      run.current += 1;
      setState({ kind: 'idle' });
    }
  }, []);

  const start = useCallback((): void => {
    if (!recordingSupported()) return;
    teardown();
    finished.current = undefined;
    const id = run.current;
    stateKind.current = 'asking';
    setState({ kind: 'asking' });
    const fail = (message: string): void => {
      if (run.current !== id) return;
      teardown();
      setState({ kind: 'error', message });
    };
    const setup = (stream: MediaStream): void => {
      const type = pickRecorderType((t) => MediaRecorder.isTypeSupported(t));
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
      } catch {
        recorder = new MediaRecorder(stream); // the options were refused: try without them
      }
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      const a: Active = {
        recorder, stream, capped: false, chunks, startedAt, type,
        timer: setInterval(() => {
          const elapsedMs = Date.now() - startedAt;
          if (elapsedMs >= maxMs) {
            a.capped = true;
            if (recorder.state !== 'inactive') recorder.stop();
            return;
          }
          setState({ kind: 'recording', elapsedMs });
        }, TICK_MS),
      };
      active.current = a;
      recorder.ondataavailable = (e: BlobEvent) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onerror = () => fail(RECORDER_MESSAGES.failed);
      recorder.onstop = () => {
        if (run.current !== id) return;
        clearInterval(a.timer);
        stopTracks(stream);
        active.current = undefined;
        const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
        if (blob.size === 0) {
          setState({ kind: 'error', message: RECORDER_MESSAGES.empty });
          return;
        }
        url.current = URL.createObjectURL(blob);
        const durationMs = Math.min(maxMs, Date.now() - startedAt);
        finished.current = { blob, durationMs, capped: a.capped };
        setState({ kind: 'done', blob, url: url.current, durationMs, capped: a.capped });
      };
      // An interruption (a call on the iPhone) ends the track: stop cleanly instead of counting up to the cap.
      for (const t of stream.getTracks()) {
        t.onended = () => { if (run.current === id && recorder.state !== 'inactive') recorder.stop(); };
      }
      recorder.start(1000);
      setState({ kind: 'recording', elapsedMs: 0 });
    };
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      if (run.current !== id) { stopTracks(stream); return; }
      try {
        setup(stream);
      } catch {
        stopTracks(stream); // teardown() below only knows streams that reached `active`
        fail(RECORDER_MESSAGES.failed);
      }
    }, (e: unknown) => {
      if (run.current === id) setState({ kind: 'error', message: errorMessage(e) });
    });
  }, [teardown, maxMs]);

  const reset = useCallback((): void => {
    teardown();
    finished.current = undefined;
    setState({ kind: 'idle' });
  }, [teardown]);

  return { state, supported: recordingSupported(), start, stop, reset };
}
