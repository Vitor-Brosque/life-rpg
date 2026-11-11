import { useId, useState, type ReactNode } from 'react';
import { Icon } from '../../art/icons';

export interface MoveMenuProps {
  /** Mission title: makes the button name unique ("Mover para… Ler capítulo"). */
  title: string;
  /** Receives a `close` callback to call after an action. */
  children: (close: () => void) => ReactNode;
}

/** Small "Mover para…" disclosure (plain buttons inside) that works without dragging (touch, keyboard). */
export function MoveMenu({ title, children }: MoveMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <>
      <button
        type="button"
        className="move-btn"
        aria-label={`Mover para… ${title}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title="Mover para…"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="skip" size={12} />
      </button>
      {open && (
        <div id={panelId} className="move-panel">
          {children(() => setOpen(false))}
        </div>
      )}
    </>
  );
}
