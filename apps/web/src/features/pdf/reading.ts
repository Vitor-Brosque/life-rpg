import { STUDY_FILE_LIMITS } from '@life/shared';

// PDFs da aula (spec 2026-11-26 §1.3, §1.6, §1.7): the reader's arithmetic, pure so it is tested without a browser.
// - pageAtScroll: which page is current for a scroll position (the last slides of a deck included).
// - ScrollGuard: tells the scroll events the reader caused itself (opening at a page, "Ir", zoom) from hers.
// - ReadingSession: how long she really read (visible, not idle) and which pages she read, for "Lembrar antes de sair",
//   the contact with the subject and the page written as where she stopped.

/** A page counts as read after staying current this long (reading time). */
export const READ_PAGE_MS = 8_000;
/** A stretch this long without scroll or input is not reading (the phone left open on the table): it is dropped. */
export const IDLE_MS = 3 * 60_000;
/** This much reading time counts as contact with the subject (lastReadAt). */
export const READ_CONTACT_MS = 60_000;
/** Opened at a page ("Ver no PDF"): where she stopped is kept until she moves this many pages away from it. */
export const ASKED_PAGE_LEAVE = 2;

/**
 * The current page for a scroll position. The probe sits at 30% of the reading area and, over the last stretch of
 * scroll (70% of the area, or less when the document is shorter), slides down to its bottom: the last pages of a deck of
 * short 16:9 slides become current in turn, and at the very bottom the last page is current. `tops` are the pages'
 * offsets in the scroller, ascending (page i + 1 at tops[i]). Returns a 1-based page.
 */
export function pageAtScroll(tops: readonly number[], scrollTop: number, clientHeight: number, scrollHeight: number): number {
  if (tops.length === 0) return 1;
  const maxScroll = scrollHeight - clientHeight;
  const zone = Math.min(clientHeight * 0.7, maxScroll);
  let ratio = 0.3;
  if (zone > 0) {
    const remaining = Math.max(0, maxScroll - scrollTop);
    if (remaining < zone) ratio = 0.3 + 0.7 * (1 - remaining / zone);
  }
  const probe = Math.min(scrollTop + clientHeight * ratio, scrollHeight - 1);
  let lo = 0;
  let hi = tops.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid]! <= probe) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found + 1;
}

/**
 * The reader moved the view itself (opening at a page, "Ir", a zoom): the scroll events at that position are not hers
 * and must not change the current page (the last slides could not be asked for, and opening near the end would write
 * another page). Her first scroll away ends it.
 */
export class ScrollGuard {
  private at: number | undefined;

  /** The view was just placed at `scrollTop` (as the browser clamped it). */
  placed(scrollTop: number): void { this.at = scrollTop; }

  /** True for an event at the placed position (ignored); an event elsewhere is hers and clears the guard. */
  ignores(scrollTop: number): boolean {
    if (this.at !== undefined && Math.abs(scrollTop - this.at) < 2) return true;
    this.at = undefined;
    return false;
  }
}

/**
 * One opening of the reader. Reading time counts only while the page is visible, and a stretch without scroll or
 * input counts at most IDLE_MS (a dense page read untouched still counts; a reader left open does not keep counting).
 * A page is read after READ_PAGE_MS as the current page, so a fast scroll
 * through 10 pages reads none. Times are passed in (Date.now() in the app), so tests drive the clock.
 */
export class ReadingSession {
  readonly start: number;
  private cur: number;
  private counted = 0;
  /** Start of the stretch being counted; undefined while hidden. */
  private mark: number | undefined;
  /** Reading time when the current page became current. */
  private pageFrom = 0;
  private readonly readPages = new Set<number>();
  /** Opened at an asked page: lastPage is not written until she moves ASKED_PAGE_LEAVE pages away. */
  private pinned: boolean;

  constructor(start: number, now: number, opts: { asked: boolean; visible: boolean }) {
    this.start = start;
    this.cur = start;
    this.pinned = opts.asked;
    this.mark = opts.visible ? now : undefined;
  }

  get current(): number { return this.cur; }
  /** Where she stopped may be written (false while an asked page is still near). */
  get writesPage(): boolean { return !this.pinned; }

  private open(now: number): number {
    if (this.mark === undefined) return 0;
    const gap = now - this.mark;
    return gap > 0 ? Math.min(gap, IDLE_MS) : 0;
  }

  private commit(now: number): void {
    this.counted += this.open(now);
    if (this.mark !== undefined) this.mark = now;
  }

  /** Reading time so far, in ms. */
  elapsed(now: number): number { return this.counted + this.open(now); }

  /** Enough reading for contact with the subject. */
  contact(now: number): boolean { return this.elapsed(now) >= READ_CONTACT_MS; }

  /** Her scroll, tap or key: the stretch up to now counts (at most IDLE_MS) and a new one starts. */
  activity(now: number): void { this.commit(now); }

  /** The page went to the background (locked phone, other app): time stops. */
  hide(now: number): void {
    this.commit(now);
    this.mark = undefined;
  }

  /** Back on screen: time counts again from now. */
  show(now: number): void { this.mark ??= now; }

  /** The current page changed (her scroll or "Ir"). */
  page(n: number, now: number): void {
    if (n === this.cur) return;
    this.settle(now);
    this.cur = n;
    this.pageFrom = this.elapsed(now);
    if (this.pinned && Math.abs(n - this.start) >= ASKED_PAGE_LEAVE) this.pinned = false;
  }

  private settle(now: number): void {
    if (this.elapsed(now) - this.pageFrom >= READ_PAGE_MS) this.readPages.add(this.cur);
  }

  /** The pages read so far (the current one once it has been current long enough). */
  read(now: number): number[] {
    this.settle(now);
    return [...this.readPages].sort((a, b) => a - b);
  }

  /**
   * Leaving: the pages "Lembrar antes de sair" asks about (the first and last read), after 3 read pages besides the
   * opening one or 5 minutes of reading; undefined otherwise, or when no page was read.
   */
  recall(now: number): { from: number; to: number } | undefined {
    const read = this.read(now);
    if (read.length === 0) return undefined;
    const fresh = read.filter((p) => p !== this.start).length;
    if (fresh < STUDY_FILE_LIMITS.recallPages && this.elapsed(now) < STUDY_FILE_LIMITS.recallMs) return undefined;
    return { from: read[0]!, to: read[read.length - 1]! };
  }
}
