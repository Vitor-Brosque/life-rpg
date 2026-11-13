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
