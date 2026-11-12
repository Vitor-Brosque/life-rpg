import type { Ref } from 'react';
import type { DayMode } from '@life/shared';
import { Icon } from '../../art/icons';
import { Button } from '../../ui/Button';
import { DAY_MODE_HINT, DAY_MODE_ICON, DAY_MODE_LABEL } from './DayTypeCard';
import './blocks.css';

const MODES: DayMode[] = ['normal', 'low', 'recovery', 'free'];

export interface ModeButtonProps {
  ref?: Ref<HTMLButtonElement>;
  mode: DayMode;
  open: boolean;
  /** Id of the picker it controls. */
  pickerId: string;
  onToggle(): void;
}

/** The day-type chip of the status strip (replaces "Hoje está pesado"). */
export function ModeButton({ ref, mode, open, pickerId, onToggle }: ModeButtonProps) {
  return (
    <Button ref={ref} size="sm" className={`mode-btn mode-btn--${mode}`} aria-expanded={open}
      aria-label={`Tipo do dia: ${DAY_MODE_LABEL[mode]}`} aria-controls={open ? pickerId : undefined} onClick={onToggle}>
      <Icon name={DAY_MODE_ICON[mode]} size={12} />
      {DAY_MODE_LABEL[mode]}
    </Button>
  );
}

export interface ModePickerProps {
  ref?: Ref<HTMLDivElement>;
  id: string;
  mode: DayMode;
  /** `option`: the tapped button (it goes away with the picker). */
  onPick(mode: DayMode, option: HTMLElement): void;
}

/** Small inline picker under the strip: the four day types with what each one means. */
export function ModePicker({ ref, id, mode, onPick }: ModePickerProps) {
  return (
    <div ref={ref} id={id} className="mode-picker" role="group" aria-label="Tipo do dia">
      {MODES.map((m) => (
        <button key={m} type="button" className="mode-picker__option" aria-pressed={m === mode}
          aria-label={DAY_MODE_LABEL[m]} aria-describedby={`${id}-${m}`} onClick={(e) => onPick(m, e.currentTarget)}>
          <Icon name={DAY_MODE_ICON[m]} size={12} className="mode-picker__icon" />
          <span className="mode-picker__label">{DAY_MODE_LABEL[m]}</span>
          <span id={`${id}-${m}`} className="mode-picker__hint">{DAY_MODE_HINT[m]}</span>
        </button>
      ))}
    </div>
  );
}
