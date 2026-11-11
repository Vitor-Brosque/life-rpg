import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

export interface SheetProps {
  open: boolean;
  onClose(): void;
  title: string;
  children?: ReactNode;
  /** 'top' anchors the sheet to the top on phones (inputs stay clear of the on-screen keyboard). */
  placement?: 'bottom' | 'top';
}

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('inert'));
}

/**
 * Modal sheet: slides up from the bottom on phones, centred dialog from 768 px.
 * Esc and the backdrop close it; Tab is trapped inside; focus returns to the opener.
 */
export function Sheet({ open, onClose, title, children, placement = 'bottom' }: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Focus the dialog itself: focusing a field would pop the iPhone keyboard on every open.
    // Content that wants a field focused can use autoFocus.
    if (panelRef.current && !panelRef.current.contains(document.activeElement)) panelRef.current.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = focusables(panelRef.current);
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className={placement === 'top' ? 'sheet-backdrop sheet-backdrop--top' : 'sheet-backdrop'}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCloseRef.current(); }}
    >
      <div
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="sheet__header">
          <span className="sheet__grip" aria-hidden="true" />
          <h2 id={titleId} className="sheet__title">{title}</h2>
          <Button variant="ghost" size="sm" icon="close" aria-label="Fechar" onClick={() => onCloseRef.current()} />
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
