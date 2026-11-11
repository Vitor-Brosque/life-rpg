import { useToast } from './Toast';

export const FAILURE_TOAST = 'Algo não funcionou. Tente de novo.';

function report(e: unknown): void {
  console.error('action failed', e);
  useToast.getState().show(FAILURE_TOAST);
}

/**
 * Runs a fire-and-forget write (a promise, or a function returning one) so a failure is never
 * silent: it is logged and the user gets "Algo não funcionou. Tente de novo.".
 */
export function safeRun(task: Promise<unknown> | (() => unknown)): void {
  try {
    const result = typeof task === 'function' ? task() : task;
    // Any thenable (Dexie returns its own promise type).
    if (typeof (result as PromiseLike<unknown> | undefined)?.then === 'function') {
      Promise.resolve(result).catch(report);
    }
  } catch (e) {
    report(e);
  }
}
