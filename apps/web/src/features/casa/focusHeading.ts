import type { RefObject } from 'react';

/**
 * After a sheet closes or a control is replaced, keyboard focus must not stay on <body>:
 * once the DOM settled, if focus was lost, it moves to the section heading (tabIndex -1).
 */
export function focusHeadingIfLost(heading: RefObject<HTMLElement | null>): void {
  setTimeout(() => {
    const a = document.activeElement;
    if ((!a || a === document.body || !a.isConnected) && heading.current?.isConnected) heading.current.focus();
  }, 0);
}
