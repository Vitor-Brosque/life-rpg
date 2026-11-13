import { vi } from 'vitest';

// Test doubles for media (Marco 3c). Tasks 6 and 7 add the microphone and speech doubles here.

/** First bytes of a PNG file: storeMedia accepts it as image/png. */
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);
/** First bytes of a WebM file: storeMedia accepts it as audio/webm. */
export const WEBM_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

export interface FakeMicOptions {
  /** getUserMedia rejects with a DOMException of this name (e.g. 'NotAllowedError'). */
  deny?: string;
  isTypeSupported?: (type: string) => boolean;
  /** The recorder delivers no data (empty recording). */
  empty?: boolean;
}

/** A microphone and a MediaRecorder that deliver WEBM_BYTES when stopped. */
export function installFakeMic(opts: FakeMicOptions = {}) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const getUserMedia = vi.fn(async (_c: MediaStreamConstraints) => {
    if (opts.deny) throw new DOMException('negado', opts.deny);
    return stream;
  });
  const instances: FakeRecorder[] = [];
  class FakeRecorder {
    static isTypeSupported = opts.isTypeSupported ?? ((t: string) => t === 'audio/webm;codecs=opus');
    state: 'inactive' | 'recording' = 'inactive';
    mimeType: string;
    options?: MediaRecorderOptions;
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(_s: MediaStream, o?: MediaRecorderOptions) {
      this.mimeType = o?.mimeType ?? 'audio/webm';
      this.options = o;
      instances.push(this);
    }
    start(): void { this.state = 'recording'; }
    stop(): void {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(opts.empty ? [] : [WEBM_BYTES], { type: this.mimeType }) });
        this.onstop?.();
      });
    }
  }
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  return {
    getUserMedia, track, instances,
    uninstall(): void { delete (navigator as unknown as Record<string, unknown>).mediaDevices; },
  };
}
