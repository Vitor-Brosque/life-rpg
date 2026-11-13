import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawingToImage } from '../src/features/media/drawingImage';
import { IMAGE_MESSAGES, compressImage, encodeSmallest } from '../src/features/media/imageCompress';
import { PNG_BYTES } from './fakeMedia';

const blob = (size: number, type: string) => new Blob([new Uint8Array(size)], { type });
afterEach(() => { vi.restoreAllMocks(); });

describe('encodeSmallest', () => {
  it('stops at the first attempt that fits the target', async () => {
    const encode = vi.fn(async (_w: number, _h: number, type: string) => blob(200 * 1024, type));
    expect((await encodeSmallest(4032, 3024, encode)).type).toBe('image/webp');
    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledWith(1600, 1200, 'image/webp', 0.8);
  });
  it('switches to JPEG for good when the browser cannot encode WebP (Safari)', async () => {
    const encode = vi.fn(async (_w: number, _h: number, type: string, q: number) =>
      (type === 'image/webp' ? blob(10, 'image/png') : blob(q >= 0.7 ? 400 * 1024 : 250 * 1024, 'image/jpeg')));
    expect(await encodeSmallest(2000, 1000, encode)).toMatchObject({ type: 'image/jpeg', size: 250 * 1024 });
    expect(encode.mock.calls.map((c) => [c[0], c[1], c[2], c[3]])).toEqual([
      [1600, 800, 'image/webp', 0.8], [1600, 800, 'image/jpeg', 0.8], [1600, 800, 'image/jpeg', 0.65],
    ]);
  });
  it('keeps the smallest result under the hard cap when nothing reaches the target', async () => {
    const sizes = [900, 800, 700, 600, 500].map((k) => k * 1024);
    let i = 0;
    expect((await encodeSmallest(3000, 3000, async (_w, _h, type) => blob(sizes[i++]!, type))).size).toBe(500 * 1024);
  });
  it('refuses when even the smallest passes 1 MB, and when nothing could be encoded', async () => {
    await expect(encodeSmallest(3000, 3000, async (_w, _h, type) => blob(2 * 1024 * 1024, type))).rejects.toThrow(IMAGE_MESSAGES.tooHeavy);
    await expect(encodeSmallest(3000, 3000, async () => null)).rejects.toThrow(IMAGE_MESSAGES.cantOpen);
  });
});

describe('compressImage', () => {
  it('refuses what is not an image, and images over 30 MB, before decoding', async () => {
    await expect(compressImage(new Blob(['hello'], { type: 'text/plain' }))).rejects.toThrow(IMAGE_MESSAGES.notImage);
    const huge = { type: 'image/png', size: 31 * 1024 * 1024, slice: () => new Blob([PNG_BYTES]) } as unknown as Blob;
    await expect(compressImage(huge)).rejects.toThrow(IMAGE_MESSAGES.tooBig);
  });
});

describe('drawingToImage', () => {
  it('paints the lousa background and the strokes, framed, as PNG; null without strokes', async () => {
    const calls: string[] = [];
    const ctx = {
      fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
      fillRect: (...a: number[]) => { calls.push(`fillRect ${a.join(',')}`); },
      setTransform: (...a: number[]) => { calls.push(`setTransform ${a.join(',')}`); },
      beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, quadraticCurveTo: () => {}, arc: () => {},
      stroke: () => { calls.push('stroke'); },
      fill: () => { calls.push('fill'); },
    };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    let size = '';
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback, type?: string) {
      size = `${this.width}x${this.height}`;
      cb(new Blob(['png'], { type: type ?? '' }));
    });
    expect(await drawingToImage([])).toBeNull();
    expect(getContext).not.toHaveBeenCalled();
    const out = await drawingToImage([{ c: 1, w: 0, p: [0, 0, 100, 50] }, { c: 0, w: 1, p: [10, 10] }]);
    expect(out?.type).toBe('image/png');
    // bounds −1…101 × −1…51 (half the widths), 24 px of margin: 150×100 at zoom 1, origin at (−25, −25)
    expect(size).toBe('150x100');
    expect(calls).toEqual(['fillRect 0,0,150,100', 'setTransform 1,0,0,1,25,25', 'stroke', 'fill']);
  });
});

describe('compressImage decisions', () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
  const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
  const file = (bytes: Uint8Array, type: string, pad = 0) => new File([bytes as BlobPart, new Uint8Array(pad)], 'x', { type });
  const canvases: HTMLCanvasElement[] = [];
  const fills: string[] = [];
  const setup = (w: number, h: number, outcome: 'load' | 'error' = 'load') => {
    canvases.length = 0; fills.length = 0;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    // jsdom loads no images: fire the outcome when a real source is set.
    vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLImageElement, v: string) {
      if (v) queueMicrotask(() => this.dispatchEvent(new Event(outcome)));
    });
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(w);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(h);
    const ctx = {
      fillStyle: '', imageSmoothingQuality: '', drawImage: () => {},
      fillRect: () => { fills.push(String(ctx.fillStyle)); },
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback, type?: string) {
      canvases.push(this);
      cb(new Blob([new Uint8Array(1000)], { type: type ?? '' }));
    });
  };

  it('keeps a small PNG or WebP as is', async () => {
    setup(800, 600);
    const png = file(PNG_BYTES, 'image/png');
    expect(await compressImage(png)).toBe(png);
    const webp = file(WEBP, 'image/webp');
    expect(await compressImage(webp)).toBe(webp);
    expect(canvases).toHaveLength(0);
  });
  it('re-encodes a small JPEG (drops EXIF), with a white background, and releases the canvases', async () => {
    setup(800, 600);
    const out = await compressImage(file(JPEG, 'image/jpeg'));
    expect(out).not.toBeInstanceOf(File);
    expect(out.type).toBe('image/webp'); // the stub answers whatever type is asked
    setup(800, 600);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback, type?: string) {
      canvases.push(this);
      cb(type === 'image/webp' ? new Blob(['x'], { type: 'image/png' }) : new Blob([new Uint8Array(1000)], { type: type ?? '' }));
    });
    expect((await compressImage(file(JPEG, 'image/jpeg'))).type).toBe('image/jpeg');
    expect(fills).toContain('#ffffff');
    expect(canvases.length).toBeGreaterThan(0);
    for (const c of canvases) { expect(c.width).toBe(0); expect(c.height).toBe(0); }
  });
  it('sends an oversized PNG (side or bytes) through the encoder', async () => {
    setup(4000, 3000);
    expect((await compressImage(file(PNG_BYTES, 'image/png'))).size).toBe(1000);
    expect(canvases).toHaveLength(1);
    setup(800, 600);
    expect((await compressImage(file(PNG_BYTES, 'image/png', 400 * 1024))).size).toBe(1000);
  });
  it('turns a decode failure into cantOpen', async () => {
    setup(1, 1, 'error');
    await expect(compressImage(file(PNG_BYTES, 'image/png'))).rejects.toThrow(IMAGE_MESSAGES.cantOpen);
  });
});
