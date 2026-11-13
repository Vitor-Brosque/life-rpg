import {
  IMAGE_ATTEMPTS, IMAGE_HARD_CAP_BYTES, IMAGE_INPUT_MAX_BYTES, IMAGE_MAX_SIDE, IMAGE_TARGET_BYTES, fitWithin, sniffMediaType,
} from '@life/shared';
import { MediaInputError } from '../../db/media';

// Images from the editor (Marco 3c, spec §4.2 and §6.2): at most 1600 px and ~300 KB, decoded by
// the browser (EXIF orientation applied) and re-encoded on a canvas. Never leaves the device.

export const IMAGE_MESSAGES = {
  notImage: 'Esse arquivo não é uma imagem.',
  tooBig: 'Imagem grande demais (máximo 30 MB).',
  cantOpen: 'Não consegui abrir esta imagem. Tente JPG, PNG ou WebP.',
  tooHeavy: 'Não consegui deixar esta imagem leve o bastante. Tente uma menor ou recortada.',
} as const;

export type Encode = (width: number, height: number, type: 'image/webp' | 'image/jpeg', quality: number) => Promise<Blob | null>;

/**
 * Tries IMAGE_ATTEMPTS in order and returns the first result within IMAGE_TARGET_BYTES, else the
 * smallest within IMAGE_HARD_CAP_BYTES. WebP while the browser produces it; the first time it does
 * not (Safari answers PNG), JPEG from then on.
 */
export async function encodeSmallest(width: number, height: number, encode: Encode): Promise<Blob> {
  let type: 'image/webp' | 'image/jpeg' = 'image/webp';
  let best: Blob | undefined;
  for (const a of IMAGE_ATTEMPTS) {
    const size = fitWithin(width, height, a.maxSide);
    let blob = await encode(size.width, size.height, type, a.quality);
    if (type === 'image/webp' && blob?.type !== 'image/webp') {
      type = 'image/jpeg';
      blob = await encode(size.width, size.height, type, a.quality);
    }
    if (!blob) continue;
    if (!best || blob.size < best.size) best = blob;
    if (blob.size <= IMAGE_TARGET_BYTES) return blob;
  }
  if (!best) throw new MediaInputError(IMAGE_MESSAGES.cantOpen);
  if (best.size > IMAGE_HARD_CAP_BYTES) throw new MediaInputError(IMAGE_MESSAGES.tooHeavy);
  return best;
}

function decodeImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  return img.decode()
    .then(() => img, () => { throw new MediaInputError(IMAGE_MESSAGES.cantOpen); })
    .finally(() => URL.revokeObjectURL(url)); // the decoded image stays drawable
}

function canvasEncode(img: HTMLImageElement, w: number, h: number, type: string, quality: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  if (type === 'image/jpeg') { // no transparency in JPEG: white, not black, behind transparent parts
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * The image to keep for `file`. A small PNG/WebP (a print, a diagram) stays as is, so its text
 * stays sharp; everything else is re-encoded, JPEG included (which drops EXIF data such as GPS).
 */
export async function compressImage(file: Blob): Promise<Blob> {
  const head = sniffMediaType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!file.type.startsWith('image/') && !head?.startsWith('image/')) throw new MediaInputError(IMAGE_MESSAGES.notImage);
  if (file.size > IMAGE_INPUT_MAX_BYTES) throw new MediaInputError(IMAGE_MESSAGES.tooBig);
  const img = await decodeImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if ((head === 'image/png' || head === 'image/webp') && file.size <= IMAGE_TARGET_BYTES && Math.max(w, h) <= IMAGE_MAX_SIDE) {
    return file;
  }
  return encodeSmallest(w, h, (tw, th, type, q) => canvasEncode(img, tw, th, type, q));
}
