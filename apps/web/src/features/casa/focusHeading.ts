import type { RefObject } from 'react';
import { focusWhenGone } from '../../ui/focusAfter';

/**
 * After a sheet closes or a control is replaced, keyboard focus must not stay on <body>:
 * once the DOM settled, if focus was lost, it moves to the section heading (tabIndex -1).
 *
 * When focus sits on a control (typically inside the sheet that is about to unmount), wait for that
 * control to actually leave the page: React commits the close on its own schedule, so a fixed
 * `setTimeout(0)` can fire while the sheet is still mounted and then never look again.
 */
export function focusHeadingIfLost(heading: RefObject<HTMLElement | null>): void {
  const current = document.activeElement;
  if (current && current !== document.body && current.isConnected) {
    focusWhenGone(current, () => (heading.current?.isConnected ? heading.current : null));
    return;
  }
  setTimeout(() => {
    const a = document.activeElement;
    if ((!a || a === document.body || !a.isConnected) && heading.current?.isConnected) heading.current.focus();
  }, 0);
}
