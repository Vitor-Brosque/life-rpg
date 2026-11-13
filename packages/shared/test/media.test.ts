import { describe, expect, it } from 'vitest';
import {
  bytesToBase64, base64ToBytes, cleanMediaLabel, drawingFrame, findMediaRefs, fitWithin, insertMediaRef, isMediaHash,
  mediaKindOf, mediaRefs, pickRecorderType, pickVoice, sniffMediaType, speakableText, stripMedia,
} from '../src/media';
import { CLOZE_CLOSE, CLOZE_HIDDEN, CLOZE_OPEN } from '../src/cloze';

const enc = (s: string) => new TextEncoder().encode(s);
const head = (h: number[] | string, n = 16) => {
  const bytes = typeof h === 'string' ? Array.from(enc(h)) : h;
  const b = new Uint8Array(Math.max(n, bytes.length)); b.set(bytes); return b;
};
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(63) + 'c';

describe('formats and sizes', () => {
  it('sniffs the accepted signatures and refuses the rest', () => {
    expect(sniffMediaType(head([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMediaType(head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffMediaType(head('RIFF\x10\x00\x00\x00WEBPVP8 '))).toBe('image/webp');
    expect(sniffMediaType(head([0x1a, 0x45, 0xdf, 0xa3]))).toBe('audio/webm');
    expect(sniffMediaType(head('\x00\x00\x00\x1cftypM4A '))).toBe('audio/mp4');
    expect(sniffMediaType(head('OggS'))).toBe('audio/ogg');
    expect(sniffMediaType(head('ID3\x04'))).toBe('audio/mpeg');
    expect(sniffMediaType(head([0xff, 0xfb, 0x90, 0x64]))).toBe('audio/mpeg');
    expect(sniffMediaType(head('RIFF\x10\x00\x00\x00WAVEfmt '))).toBeUndefined();
    expect(sniffMediaType(head([0xff, 0xf1, 0x50, 0x80]))).toBeUndefined(); // raw AAC (ADTS)
    expect(sniffMediaType(head('<html><body>hi'))).toBeUndefined();
    expect(sniffMediaType(head('GIF89a'))).toBeUndefined();
    expect(sniffMediaType(new Uint8Array([0xff, 0xd8, 0xff]))).toBeUndefined();
    expect(mediaKindOf('image/webp')).toBe('image');
    expect(mediaKindOf('audio/mp4;codecs=mp4a.40.2')).toBe('audio');
    expect(mediaKindOf('text/html')).toBeUndefined();
    expect(isMediaHash(H1)).toBe(true);
    expect(isMediaHash(H1.toUpperCase())).toBe(false);
    expect(isMediaHash('a'.repeat(63))).toBe(false);
  });
  it('fits within the longest side without enlarging', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(10000, 1, 1600)).toEqual({ width: 1600, height: 1 });
    expect(fitWithin(0, 0, 1600)).toEqual({ width: 1, height: 1 });
  });
  it('picks the most compatible recorder type', () => {
    expect(pickRecorderType(() => true)).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(pickRecorderType((t) => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
    expect(pickRecorderType((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickRecorderType(() => false)).toBe('');
    expect(pickRecorderType((t) => { if (t.includes('mp4')) throw new Error('x'); return t === 'audio/webm'; })).toBe('audio/webm');
  });
  it('frames a drawing for export', () => {
    expect(drawingFrame(undefined)).toBeUndefined();
    expect(drawingFrame({ minX: 0, minY: 0, maxX: 100, maxY: 50 })).toEqual({ width: 148, height: 98, view: { x: -24, y: -24, zoom: 1 } });
    const big = drawingFrame({ minX: 10, minY: 20, maxX: 3210, maxY: 1620 })!;
    expect(big).toMatchObject({ width: 1600, height: 812, view: { x: -14, y: -4 } });
    expect(big.view.zoom).toBeCloseTo(0.49261, 4);
  });
});

describe('references', () => {
  const txt = `Veja ![mapa do Brasil](media:${H1}) e ouça [pronúncia](media:${H2}).`;
  it('finds, lists and strips references', () => {
    expect(findMediaRefs(txt)).toEqual([
      { kind: 'image', label: 'mapa do Brasil', hash: H1, start: 5, end: 94 },
      { kind: 'audio', label: 'pronúncia', hash: H2, start: 102, end: 185 },
    ]);
    expect(mediaRefs([txt, undefined, `![](media:${H1})`, `[x](media:${H2.toUpperCase()})`])).toEqual([H1, H2]);
    expect(mediaRefs([])).toEqual([]);
    expect(findMediaRefs('[x](https://a.b) ![y](media:123)')).toEqual([]);
    expect(stripMedia(txt)).toBe('Veja mapa do Brasil e ouça pronúncia.');
    expect(stripMedia(`![](media:${H1}) e [ ](media:${H2})`)).toBe('imagem e áudio');
    expect(cleanMediaLabel(' a]b\nc  d ')).toBe('a b c d');
    expect(cleanMediaLabel('x'.repeat(100))).toHaveLength(80);
  });
  it('inserts inline, with the selection as the label and the label selected', () => {
    const sel = (r: { text: string; selStart: number; selEnd: number }) => r.text.slice(r.selStart, r.selEnd);
    expect(insertMediaRef('', 0, 0, 'image', H1)).toEqual({ text: `![imagem](media:${H1})`, selStart: 2, selEnd: 8 });
    const after = insertMediaRef('Qual país?', 10, 10, 'image', H1);
    expect(after.text).toBe(`Qual país? ![imagem](media:${H1})`);
    expect(sel(after)).toBe('imagem');
    const label = insertMediaRef('Diga mapa agora', 5, 9, 'image', H1);
    expect(label.text).toBe(`Diga ![mapa](media:${H1}) agora`);
    expect(sel(label)).toBe('mapa');
    const audio = insertMediaRef('apple', 5, 5, 'audio', H2);
    expect(audio.text).toBe(`apple [áudio](media:${H2})`);
    expect(sel(audio)).toBe('áudio');
    expect(insertMediaRef('ab', 1, 1, 'audio', H2).text).toBe(`a [áudio](media:${H2}) b`);
    expect(insertMediaRef('linha\n', 6, 6, 'image', H1).text).toBe(`linha\n![imagem](media:${H1})`);
    const drawing = insertMediaRef('x', 1, 1, 'image', H1, 'desenho');
    expect(drawing.text).toBe(`x ![desenho](media:${H1})`);
    expect(sel(drawing)).toBe('desenho');
  });
});

describe('speech and export helpers', () => {
  it('speaks text only', () => {
    expect(speakableText(`**apple** ![x](media:${H1}) [ouça](media:${H2})`)).toBe('apple');
    expect(speakableText('A *maçã* é $x^2$ vermelha\n\n```py\ncode\n```\n- um\n- dois')).toBe('A maçã é vermelha\num\ndois');
    expect(speakableText(`The ${CLOZE_OPEN}${CLOZE_HIDDEN}${CLOZE_CLOSE} is red`)).toBe('The … is red');
    expect(speakableText(`The ${CLOZE_OPEN}apple${CLOZE_CLOSE} is red`)).toBe('The apple is red');
    expect(speakableText('$$x$$')).toBe('');
  });
  it('picks a voice by tag, then by language, on-device first', () => {
    const voices = [
      { lang: 'en-GB', localService: true, name: 'gb' },
      { lang: 'en-US', localService: false, name: 'us-net' },
      { lang: 'en_US', localService: true, name: 'us-local' },
      { lang: 'pt-BR', localService: true, name: 'br' },
    ];
    expect(pickVoice(voices, 'en-US')?.name).toBe('us-local');
    expect(pickVoice(voices, 'en-AU')?.name).toBe('gb');
    expect(pickVoice(voices, 'pt-PT')?.name).toBe('br');
    expect(pickVoice(voices, 'ja-JP')).toBeUndefined();
    expect(pickVoice([{ lang: 'en-US', name: 'n' }, { lang: 'en-GB', localService: true, name: 'g' }], 'en-US')?.name).toBe('n');
  });
  it('round-trips base64 in chunks', () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
    expect(bytesToBase64(enc('oi'))).toBe('b2k=');
    expect(base64ToBytes('')).toEqual(new Uint8Array(0));
    expect(() => base64ToBytes('***')).toThrow();
  });
});
