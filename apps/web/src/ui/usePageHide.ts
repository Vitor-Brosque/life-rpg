import { useEffect, useRef } from 'react';

/**
 * Calls `onHide` when the page goes to the background (`visibilitychange` → hidden) or is being
 * unloaded (`pagehide`): the last reliable moments to save a draft on a phone, where the app can
 * be killed or reloaded (app update) without any blur or unmount.
 */
export function usePageHide(onHide: () => void): void {
  const ref = useRef(onHide);
  ref.current = onHide;
  useEffect(() => {
    const run = () => ref.current();
    const onVisibility = () => { if (document.visibilityState === 'hidden') run(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', run);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', run);
    };
  }, []);
}
