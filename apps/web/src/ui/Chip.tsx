import type { MouseEvent, ReactNode } from 'react';
import { Icon } from '../art/icons';

export interface ChipProps {
  selected?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Accessible name of the main button when the visible text alone is not enough (a row's item name). */
  'aria-label'?: string;
  onRemove?: () => void;
  /** Accessible name for the remove button; defaults to "Remover <text>". */
  removeLabel?: string;
  children: ReactNode;
}

export function Chip({ selected = false, onClick, onRemove, removeLabel, children, 'aria-label': label }: ChipProps) {
  const text = typeof children === 'string' || typeof children === 'number' ? String(children) : '';
  return (
    <span className={selected ? 'chip chip--selected' : 'chip'}>
      {onClick ? (
        <button type="button" className="chip__main" aria-pressed={selected} aria-label={label} onClick={onClick}>
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
