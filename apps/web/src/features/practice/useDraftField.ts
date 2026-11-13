import { useCallback, useEffect, useRef, useState } from 'react';
import { FAILURE_TOAST } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { usePageHide } from '../../ui/usePageHide';

export const DRAFT_DELAY_MS = 600;
/** How long, after our own save, a different stored value is taken as the copy from before it. */
export const ECHO_WAIT_MS = 2000;

export interface DraftField {
  value: string;
  onChange(v: string): void;
  onFocus(): void;
  onBlur(): void;
  /** Saves a pending edit now; resolves when every save so far is done (call before reading the record). */
  flush(): Promise<void>;
  /** Drops a pending edit and shows the stored value again. */
  reset(): void;
}

/**
 * Local text for a stored field (spec §2, decision 4): typing stays local and is saved 600 ms after
 * the last change, on blur, when the page hides and on unmount, one save after the other. While the
 * field is focused or has an unsaved edit, a new stored value (another device) never overwrites what
 * is being typed; otherwise the field follows the stored value.
 */
export function useDraftField(saved: string, save: (v: string) => Promise<unknown>): DraftField {
  const [value, setValue] = useState(saved);
  const current = useRef(saved);
  const dirty = useRef(false);
  const focused = useRef(false);
  const pending = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef({ saved, save });
  latest.current = { saved, save };
  // The `save` of the moment of the last edit: a reused field never writes an old draft to a new record.
  const editSave = useRef(save);
  const mounted = useRef(true);
  // The value our last save wrote: until the stored copy shows it (or ECHO_WAIT_MS passes), a different
  // stored value is the one from before the save, still on its way out of the live query — not news.
  const echo = useRef<{ value: string; until: number } | undefined>(undefined);
  const echoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Shows the stored value when nothing of ours is pending, being typed or in flight. */
  const followSaved = useCallback((): void => {
    if (!mounted.current || dirty.current || focused.current || pending.current > 0) return;
    const s = latest.current.saved;
    const e = echo.current;
    if (e) {
      if (s !== e.value && Date.now() < e.until) return;
      echo.current = undefined;
    }
    if (current.current === s) return;
    current.current = s;
    setValue(s);
  }, []);

  // Fires only when `saved` changes; the end of the save queue re-runs it (see flush).
  useEffect(() => { followSaved(); }, [saved, followSaved]);

  const stopTimer = (): void => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  };

  const flush = useCallback((): Promise<void> => {
    stopTimer();
    if (dirty.current) {
      dirty.current = false;
      const v = current.current;
      const run = editSave.current;
      pending.current += 1;
      chain.current = chain.current
        .then(() => run(v))
        .then(() => { echo.current = { value: v, until: Date.now() + ECHO_WAIT_MS }; }, (e: unknown) => {
          // Keep the text and mark it unsaved again: the next blur or edit tries once more.
          // (unless a newer edit already took its place: that one carries the text forward)
          if (current.current === v) dirty.current = true;
          console.error('save draft failed', e);
          useToast.getState().show(FAILURE_TOAST);
        })
        .finally(() => {
          pending.current -= 1;
          if (pending.current === 0 && mounted.current) {
            followSaved();
            // A stored change that arrived during the wait is shown once the wait is over.
            if (echoTimer.current !== undefined) clearTimeout(echoTimer.current);
            echoTimer.current = setTimeout(followSaved, ECHO_WAIT_MS);
          }
        });
    }
    return chain.current;
  }, [followSaved]);

  const onChange = useCallback((v: string): void => {
    current.current = v;
    editSave.current = latest.current.save;
    setValue(v);
    dirty.current = true;
    stopTimer();
    timer.current = setTimeout(() => { void flush(); }, DRAFT_DELAY_MS);
  }, [flush]);

  const onBlur = useCallback((): void => {
    focused.current = false;
    if (dirty.current) { void flush(); return; }
    // Nothing of ours is pending: show what is stored (it may have changed while the field was focused).
    followSaved();
  }, [flush, followSaved]);

  const onFocus = useCallback((): void => { focused.current = true; }, []);

  const reset = useCallback((): void => {
    stopTimer();
    dirty.current = false;
    current.current = latest.current.saved;
    setValue(latest.current.saved);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (echoTimer.current !== undefined) clearTimeout(echoTimer.current);
      void flush();
    };
  }, [flush]);
  usePageHide(() => { void flush(); });

  return { value, onChange, onFocus, onBlur, flush, reset };
}
