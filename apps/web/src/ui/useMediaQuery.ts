import { useCallback, useSyncExternalStore } from 'react';

const supported = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** Live `matchMedia(query).matches` (false where matchMedia is missing, e.g. tests). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (!supported()) return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => supported() && window.matchMedia(query).matches, () => false);
}
