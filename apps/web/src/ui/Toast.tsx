import { create } from 'zustand';
import { Button } from './Button';

export interface ToastAction { label: string; run(): void }
interface ToastItem { id: number; msg: string; action?: ToastAction }

interface ToastState {
  toast?: ToastItem;
  show(msg: string, action?: ToastAction, ms?: number): void;
  dismiss(): void;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

/** One toast at a time; a new one replaces the current. */
export const useToast = create<ToastState>((set) => ({
  toast: undefined,
  show(msg, action, ms = 4000) {
    clearTimeout(timer);
    const id = ++seq;
    set({ toast: { id, msg, action } });
    timer = setTimeout(() => {
      if (useToast.getState().toast?.id === id) set({ toast: undefined });
    }, ms);
  },
  dismiss() {
    clearTimeout(timer);
    set({ toast: undefined });
  },
}));

/** Mount once (App). Bottom-centre, above the nav and the timer slot. */
export function ToastHost() {
  const toast = useToast((s) => s.toast);
  const dismiss = useToast((s) => s.dismiss);
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className="toast px-border">
          <span className="toast__msg">{toast.msg}</span>
          {toast.action && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const { run } = toast.action!;
                dismiss();
                run();
              }}
            >
              {toast.action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
