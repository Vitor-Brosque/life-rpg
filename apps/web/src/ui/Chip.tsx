import type { ReactNode } from 'react';
import { Icon } from '../art/icons';

export interface ChipProps {
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  /** Accessible name for the remove button; defaults to "Remover <text>". */
  removeLabel?: string;
  children: ReactNode;
}

export function Chip({ selected = false, onClick, onRemove, removeLabel, children }: ChipProps) {
  const text = typeof children === 'string' || typeof children === 'number' ? String(children) : '';
  return (
    <span className={selected ? 'chip chip--selected' : 'chip'}>
      {onClick ? (
        <button type="button" className="chip__main" aria-pressed={selected} onClick={onClick}>
          {children}
        </button>
      ) : (
        <span className="chip__label">{children}</span>
      )}
      {onRemove && (
        <button
          type="button"
          className="chip__remove"
          aria-label={removeLabel ?? (text ? `Remover ${text}` : 'Remover')}
          onClick={onRemove}
        >
          <Icon name="close" size={12} />
        </button>
      )}
    </span>
  );
}
