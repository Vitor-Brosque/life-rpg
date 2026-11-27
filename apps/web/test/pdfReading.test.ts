import { describe, expect, it } from 'vitest';
import { IDLE_MS, READ_CONTACT_MS, READ_PAGE_MS, ReadingSession, ScrollGuard, pageAtScroll } from '../src/features/pdf/reading';
import { appBinaryDataFactory } from '../src/features/pdf/pdfBinaryData';

// PDFs da aula (spec 2026-11-26 §1.3, §1.6): the reader's arithmetic, without a browser. The reader lays the pages out in
// a column inside its scrolling area, 8 px apart with 8 px of padding above and below.

/** The pages' tops and the scroll height of `n` pages of `height` px. */
function column(n: number, height: number): { tops: number[]; scrollHeight: number } {
  const tops = Array.from({ length: n }, (_, i) => 8 + i * (height + 8));
  return { tops, scrollHeight: 8 + n * height + (n - 1) * 8 + 8 };
}

/** The pages that become current while scrolling from the top to the bottom, 1 px at a time. */
function pagesWhileScrolling(tops: number[], clientHeight: number, scrollHeight: number): number[] {
  const seen: number[] = [];
  for (let y = 0; y <= scrollHeight - clientHeight; y++) {
    const p = pageAtScroll(tops, y, clientHeight, scrollHeight);
    if (seen[seen.length - 1] !== p) seen.push(p);
  }
  return seen;
}

describe('pageAtScroll: the current page (I3)', () => {
  // An iPhone 14 Home Screen app: the reading area is about 584 px tall and 16:9 slides about 330 px wide (186 px tall).
  const H = 584;

  it('a 16:9 slide deck on a 584 px area: every slide becomes current in order, the last ones included', () => {
    const { tops, scrollHeight } = column(20, 186);
    expect(pagesWhileScrolling(tops, H, scrollHeight)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(pageAtScroll(tops, 0, H, scrollHeight)).toBe(1);
    expect(pageAtScroll(tops, scrollHeight - H, H, scrollHeight)).toBe(20); // the very bottom is the last slide
  });

  it('the old probe (30% of the area) never reached the last two slides of that deck', () => {
    const { tops, scrollHeight } = column(20, 186);
    const probeAt30 = (y: number) => tops.filter((t) => t <= y + H * 0.3).length;
    expect(probeAt30(scrollHeight - H)).toBe(18);
  });

  it('a desktop with wide 16:9 slides (400 px tall on a 700 px area): the last slide is reachable too', () => {
    const { tops, scrollHeight } = column(30, 400);
    expect(pagesWhileScrolling(tops, 700, scrollHeight)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('A4 pages taller than the area: the page under the top third, as before, until the last screen of scroll', () => {
    const { tops, scrollHeight } = column(10, 800);
    expect(pageAtScroll(tops, tops[4]! - 8, H, scrollHeight)).toBe(5);
    expect(pageAtScroll(tops, tops[4]! - H * 0.3 - 1, H, scrollHeight)).toBe(4);
    expect(pageAtScroll(tops, tops[4]! - H * 0.3 + 1, H, scrollHeight)).toBe(5);
    expect(pagesWhileScrolling(tops, H, scrollHeight)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('a document shorter than the area stays on the first page; one a little taller starts on page 1 at the top', () => {
    const short = column(2, 186);
    expect(pageAtScroll(short.tops, 0, H, short.scrollHeight)).toBe(1);
    const slightly = column(3, 210); // 662 px: 78 px of scroll
    expect(pageAtScroll(slightly.tops, 0, H, slightly.scrollHeight)).toBe(1);
    expect(pageAtScroll(slightly.tops, slightly.scrollHeight - H, H, slightly.scrollHeight)).toBe(3);
    expect(pageAtScroll([], 0, H, 0)).toBe(1);
  });
});

describe('ScrollGuard: the reader\'s own moves (I3)', () => {
  it('ignores the events at the placed position and clears at her first scroll elsewhere', () => {
    const g = new ScrollGuard();
    expect(g.ignores(300)).toBe(false); // nothing placed: every event is hers
    g.placed(1200);
    expect(g.ignores(1200)).toBe(true);
    expect(g.ignores(1201)).toBe(true); // sub-pixel rounding
    expect(g.ignores(1180)).toBe(false); // she scrolled
    expect(g.ignores(1200)).toBe(false); // and the guard is gone
  });
});

describe('ReadingSession: visible reading time and read pages (I4, I5)', () => {
  const t0 = 1_000_000;
  const s = (start = 1, asked = false, visible = true) => new ReadingSession(start, t0, { asked, visible });

  it('time in background is not counted', () => {
    const r = s();
    r.activity(t0 + 30_000);
    r.hide(t0 + 40_000);
    r.show(t0 + 2 * 3_600_000); // two hours with the phone locked
    expect(r.elapsed(t0 + 2 * 3_600_000 + 5_000)).toBe(45_000);
    expect(r.contact(t0 + 2 * 3_600_000 + 5_000)).toBe(false);
    // Opened while hidden: nothing counts until it shows.
    const hidden = s(1, false, false);
    expect(hidden.elapsed(t0 + 60_000)).toBe(0);
    hidden.show(t0 + 60_000);
    expect(hidden.elapsed(t0 + 70_000)).toBe(10_000);
  });

  it('a stretch without scroll or input counts at most 3 minutes (never more), shorter ones count whole', () => {
    const r = s();
    r.activity(t0 + IDLE_MS);           // exactly 3 minutes: counts whole
    expect(r.elapsed(t0 + IDLE_MS)).toBe(IDLE_MS);
    r.activity(t0 + 3 * IDLE_MS);       // then 6 minutes on one dense page: only 3 count
    expect(r.elapsed(t0 + 3 * IDLE_MS)).toBe(2 * IDLE_MS);
    expect(r.elapsed(t0 + 3 * IDLE_MS + 20_000)).toBe(2 * IDLE_MS + 20_000);
    expect(r.elapsed(t0 + 10 * IDLE_MS)).toBe(3 * IDLE_MS); // still open and left alone: capped at 3 minutes
  });

  it('a page is read after 8 s as the current page: a fast scroll through 10 pages reads none and asks nothing', () => {
    const r = s(1);
    for (let n = 2; n <= 11; n++) r.page(n, t0 + (n - 1) * 1_000);
    expect(r.read(t0 + 11_000)).toEqual([]);
    expect(r.recall(t0 + 11_000)).toBeUndefined();
    const slow = s(1);
    slow.page(2, t0 + READ_PAGE_MS);       // page 1 stayed 8 s: read
    slow.page(3, t0 + READ_PAGE_MS + 7_999); // page 2 only 7.999 s
    expect(slow.read(t0 + READ_PAGE_MS + 7_999)).toEqual([1]);
    expect(slow.read(t0 + 2 * READ_PAGE_MS + 7_999)).toEqual([1, 3]); // the current one counts once it has stayed long enough
  });

  it('asks after 3 read pages besides the opening one, from the first to the last read; or after 5 minutes of reading', () => {
    const r = s(12);
    [13, 14, 18].forEach((n, i) => r.page(n, t0 + (i + 1) * 10_000));
    expect(r.recall(t0 + 30_000)).toBeUndefined(); // 12, 13, 14 read; 18 just arrived
    expect(r.recall(t0 + 40_000)).toEqual({ from: 12, to: 18 });
    const long = s(4);
    for (let m = 1; m <= 4; m++) long.activity(t0 + m * 60_000);
    expect(long.recall(t0 + 299_000)).toBeUndefined();
    expect(long.recall(t0 + 300_000)).toEqual({ from: 4, to: 4 });
  });

  it('a minute of reading is contact with the subject', () => {
    const r = s();
    expect(r.contact(t0 + READ_CONTACT_MS - 1)).toBe(false);
    expect(r.contact(t0 + READ_CONTACT_MS)).toBe(true);
  });

  it('opened at an asked page, where she stopped is not written until she moves 2 pages away from it', () => {
    const r = s(12, true);
    expect(r.writesPage).toBe(false);
    r.page(13, t0 + 1_000);
    r.page(11, t0 + 2_000);
    expect(r.writesPage).toBe(false);
    r.page(14, t0 + 3_000);
    expect(r.writesPage).toBe(true);
    r.page(12, t0 + 4_000);
    expect(r.writesPage).toBe(true); // once she read on, it stays free
    expect(s(12, false).writesPage).toBe(true);
  });
});

describe('the binary files PDF.js may ask for (I1)', () => {
  it('serves only the two wasm decoders by name; anything else fails, so PDF.js goes on without it', async () => {
    const asked: string[] = [];
    const Factory = appBinaryDataFactory({ 'jbig2.wasm': '/assets/jbig2-abc.wasm', 'openjpeg.wasm': '/assets/openjpeg-def.wasm' },
      async (url) => { asked.push(url); return new Uint8Array([0, 97, 115, 109]).buffer; });
    const f = new Factory({ cMapUrl: null, standardFontDataUrl: null, wasmUrl: null });
    expect(await f.fetch({ kind: 'wasmUrl', filename: 'jbig2.wasm' })).toEqual(new Uint8Array([0, 97, 115, 109]));
    await f.fetch({ kind: 'wasmUrl', filename: 'openjpeg.wasm' });
    expect(asked).toEqual(['/assets/jbig2-abc.wasm', '/assets/openjpeg-def.wasm']);
    for (const req of [
      { kind: 'wasmUrl', filename: 'quickjs-eval.wasm' }, { kind: 'wasmUrl', filename: 'qcms_bg.wasm' },
      { kind: 'wasmUrl', filename: 'toString' }, { kind: 'standardFontDataUrl', filename: 'FoxitSymbol.pfb' },
      { kind: 'cMapUrl', filename: 'jbig2.wasm' },
    ]) {
      await expect(f.fetch(req)).rejects.toThrow(/no .* file/);
    }
    expect(asked).toHaveLength(2);
  });
});
