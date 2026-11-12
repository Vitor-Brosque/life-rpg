// Focus after a tapped control goes away (a card answered, a picker closed, "Começar bloco"):
// without this, focus falls back to <body> and a screen reader starts over from the top.

/** Marks the heading that takes focus: the current block's name, else the screen's own heading. */
export const FOCUS_BLOCK = 'block';
export const FOCUS_PAGE = 'page';

const WAIT_MS = 5000;

function lost(): boolean {
  const a = document.activeElement;
  return !a || a === document.body || !a.isConnected;
}

/** The current block's heading, else the screen's main heading (both have tabIndex -1). */
export function mainHeading(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-focus-target="${FOCUS_BLOCK}"]`)
    ?? document.querySelector<HTMLElement>(`[data-focus-target="${FOCUS_PAGE}"]`);
}

/**
 * Once `control` leaves the page, moves focus to `target()` (default: the block heading or the
 * main heading) — only when focus went down with it, so a field the user moved to keeps it.
 */
export function focusWhenGone(control: Element | null | undefined, target: () => HTMLElement | null = mainHeading): void {
  if (!control || typeof MutationObserver === 'undefined') return;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    clearTimeout(timer);
  };
  const check = () => {
    if (control.isConnected) return;
    finish();
    if (lost()) target()?.focus();
  };
  const observer = new MutationObserver(check);
  observer.observe(document.body, { childList: true, subtree: true });
  const timer = setTimeout(finish, WAIT_MS);
}
