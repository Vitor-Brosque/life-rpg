import { CLOZE_CLOSE, CLOZE_HIDDEN, CLOZE_OPEN } from './cloze';
import { MEDIA_REF_SOURCE, parseMarkdown, type MdInline } from './markdown';
import type { Rect, SketchView } from './sketch';

// Media in cards (Marco 3c, spec §4). Pure: no DOM, no network. The bytes never go into synced
// records; notes only carry references `![legenda](media:<sha256>)` (image) and
// `[legenda](media:<sha256>)` (audio).

/** Lowercase hex SHA-256 of the file's bytes. */
export const MEDIA_HASH_RE = /^[0-9a-f]{64}$/;
export const isMediaHash = (s: string): boolean => MEDIA_HASH_RE.test(s);

/** Largest file the server accepts (and the largest audio file the editor takes). */
export const MEDIA_MAX_BYTES = 8 * 1024 * 1024;
/** Images: longest side after resizing, the size aimed at, the most kept, the most read. */
export const IMAGE_MAX_SIDE = 1600;
export const IMAGE_TARGET_BYTES = 300 * 1024;
export const IMAGE_HARD_CAP_BYTES = 1024 * 1024;
export const IMAGE_INPUT_MAX_BYTES = 30 * 1024 * 1024;
/** Recordings: at most 2 minutes, 64 kbit/s (voice). */
export const AUDIO_MAX_MS = 120_000;
export const AUDIO_BITS_PER_SECOND = 64_000;
/** Export JSON: media are embedded (base64) only while their total stays at or below this. */
export const EXPORT_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

export type MediaKind = 'image' | 'audio';
export type MediaType =
  | 'image/jpeg' | 'image/png' | 'image/webp'
  | 'audio/webm' | 'audio/mp4' | 'audio/ogg' | 'audio/mpeg';

/** Encoding attempts, in order, until one fits IMAGE_TARGET_BYTES (spec §4.1). */
export interface ImageAttempt { maxSide: number; quality: number }
export const IMAGE_ATTEMPTS: readonly ImageAttempt[] = [
  { maxSide: 1600, quality: 0.8 },
  { maxSide: 1600, quality: 0.65 },
  { maxSide: 1280, quality: 0.7 },
  { maxSide: 1024, quality: 0.65 },
  { maxSide: 800, quality: 0.6 },
];

/** Size that fits `maxSide` on the longest side, keeping the aspect; never enlarges; ≥ 1 px. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const long = Math.max(w, h);
  if (long <= maxSide) return { width: w, height: h };
  const scale = maxSide / long;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

const at = (b: Uint8Array, offset: number, ascii: string): boolean => {
  for (let i = 0; i < ascii.length; i++) if (b[offset + i] !== ascii.charCodeAt(i)) return false;
  return true;
};

/**
 * The format, from the first bytes (file signature), or undefined when it is not one of the
 * accepted formats. Server and web use the same allowlist; the declared type is never trusted.
 */
export function sniffMediaType(b: Uint8Array): MediaType | undefined {
  if (b.length < 12) return undefined;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && at(b, 1, 'PNG\r\n\x1a\n')) return 'image/png';
  if (at(b, 0, 'RIFF') && at(b, 8, 'WEBP')) return 'image/webp';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  if (at(b, 4, 'ftyp')) return 'audio/mp4';
  if (at(b, 0, 'OggS')) return 'audio/ogg';
  if (at(b, 0, 'ID3')) return 'audio/mpeg';
  if (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0 && (b[1]! & 0x06) !== 0) return 'audio/mpeg';
  return undefined;
}

export const mediaKindOf = (type: string): MediaKind | undefined =>
  type.startsWith('image/') ? 'image' : type.startsWith('audio/') ? 'audio' : undefined;

/** MediaRecorder types, most compatible first: AAC in MP4 plays everywhere, Opus in WebM almost. */
export const RECORDER_TYPES = [
  'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus',
] as const;

/** First recorder type the browser supports; '' lets the browser pick its default. */
export function pickRecorderType(isSupported: (type: string) => boolean): string {
  for (const t of RECORDER_TYPES) {
    try {
      if (isSupported(t)) return t;
    } catch {
      // isTypeSupported may throw on odd strings in old engines: try the next one.
    }
  }
  return '';
}

/**
 * Size and view to turn a drawing into an image (editor "Desenho"): the strokes' bounds plus
 * `pad` on every side, scaled down to fit `maxSide`, never enlarged. undefined for no strokes.
 */
export function drawingFrame(
  bounds: Rect | undefined, pad = 24, maxSide = IMAGE_MAX_SIDE,
): { width: number; height: number; view: SketchView } | undefined {
  if (!bounds) return undefined;
  const cw = bounds.maxX - bounds.minX + 2 * pad;
  const ch = bounds.maxY - bounds.minY + 2 * pad;
  const { width, height } = fitWithin(cw, ch, maxSide);
  const zoom = Math.min(1, width / cw, height / ch);
  return { width, height, view: { x: bounds.minX - pad, y: bounds.minY - pad, zoom } };
}

// ------------------------------------------------------------------ references in Markdown

export interface MediaRef { kind: MediaKind; label: string; hash: string; start: number; end: number }

/** Every reference in `text`, in order (also inside code: harmless for downloads). */
export function findMediaRefs(text: string): MediaRef[] {
  const out: MediaRef[] = [];
  for (const m of text.matchAll(new RegExp(MEDIA_REF_SOURCE, 'g'))) {
    out.push({ kind: m[1] ? 'image' : 'audio', label: m[2]!, hash: m[3]!, start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** Distinct hashes referenced by the texts, in first-seen order (an array: thousands of notes). */
export function mediaRefs(texts: ReadonlyArray<string | undefined>): string[] {
  const seen = new Set<string>();
  for (const t of texts) if (t) for (const r of findMediaRefs(t)) seen.add(r.hash);
  return [...seen];
}

export const DEFAULT_MEDIA_LABEL: Record<MediaKind, string> = { image: 'imagem', audio: 'áudio' };
export const MEDIA_LABEL_MAX = 80;

/** A label that keeps the reference parseable: no `]`, no line breaks, at most 80 characters. */
export function cleanMediaLabel(s: string): string {
  return s.replace(/[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MEDIA_LABEL_MAX).trim();
}

export function mediaMarkdown(kind: MediaKind, hash: string, label: string): string {
  return `${kind === 'image' ? '!' : ''}[${label}](media:${hash})`;
}

/**
 * The editor's insertion: the selection [start, end) becomes the reference's label (or
 * `defaultLabel` when empty), separated from neighbouring text by one space. The label comes back
 * selected, so typing replaces it with a caption. Always inline: in a topic, the image stays in
 * the same key point.
 */
export function insertMediaRef(
  text: string, start: number, end: number, kind: MediaKind, hash: string, defaultLabel: string = DEFAULT_MEDIA_LABEL[kind],
): { text: string; selStart: number; selEnd: number } {
  const label = cleanMediaLabel(text.slice(start, end)) || defaultLabel;
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before !== '' && !/\s$/.test(before) ? ' ' : '';
  const trail = after !== '' && !/^\s/.test(after) ? ' ' : '';
  const ref = mediaMarkdown(kind, hash, label);
  const selStart = before.length + lead.length + (kind === 'image' ? 2 : 1);
  return { text: before + lead + ref + trail + after, selStart, selEnd: selStart + label.length };
}

/** References replaced by their labels (titles and search never show hashes). */
export function stripMedia(text: string): string {
  return text.replace(new RegExp(MEDIA_REF_SOURCE, 'g'), (_all: string, bang: string, label: string) =>
    label.trim() || DEFAULT_MEDIA_LABEL[bang ? 'image' : 'audio']);
}

// ------------------------------------------------------------------ text to speech

function inlineSpeech(nodes: MdInline[]): string {
  let s = '';
  for (const n of nodes) {
    switch (n.t) {
      case 'text': case 'code': s += n.v; break;
      case 'strong': case 'em': s += inlineSpeech(n.c); break;
      case 'br': s += '\n'; break;
      case 'math': case 'img': case 'audio': break;
    }
  }
  return s;
}

/**
 * What "Ouvir" reads: the text of a card side without markup, formulas, code blocks or media.
 * A hidden cloze reads as a pause ("…").
 */
export function speakableText(markdown: string): string {
  const src = markdown.split(CLOZE_HIDDEN).join('…').split(CLOZE_OPEN).join('').split(CLOZE_CLOSE).join('');
  const parts: string[] = [];
  for (const b of parseMarkdown(src)) {
    if (b.t === 'p') parts.push(inlineSpeech(b.c));
    else if (b.t === 'list') for (const item of b.items) parts.push(inlineSpeech(item));
  }
  return parts.map((p) => p.replace(/[ \t]+/g, ' ').trim()).filter((p) => p !== '').join('\n');
}

export interface VoiceLike { lang: string; localService?: boolean }

const langKey = (l: string): string => l.replace('_', '-').toLowerCase();

/** Voice for `lang`: same tag (on-device first), else same language (en-GB for en-US), else none. */
export function pickVoice<T extends VoiceLike>(voices: readonly T[], lang: string): T | undefined {
  const want = langKey(lang);
  const base = want.split('-')[0];
  const rank = (v: T): number => {
    const l = langKey(v.lang);
    const tier = l === want ? 0 : l.split('-')[0] === base ? 2 : 9;
    return tier + (v.localService ? 0 : 1);
  };
  let best: T | undefined;
  for (const v of voices) if (rank(v) < 9 && (!best || rank(v) < rank(best))) best = v;
  return best;
}

// ------------------------------------------------------------------ export JSON

/** Base64 of the bytes, built in chunks (a 25 MB export must not blow the call stack). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Bytes of a base64 string; throws on invalid input (atob does). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
