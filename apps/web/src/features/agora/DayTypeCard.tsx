import { useId } from 'react';
import type { DayMode } from '@life/shared';
import { Icon, type IconName } from '../../art/icons';
import { Panel } from '../../ui/Panel';
import './blocks.css';

export const DAY_MODE_LABEL: Record<DayMode, string> = {
  normal: 'Normal', low: 'Baixa energia', recovery: 'Recuperação', free: 'Livre',
};
export const DAY_MODE_ICON: Record<DayMode, IconName> = {
  normal: 'flame', low: 'moon', recovery: 'heart', free: 'leaf',
};
/** What each type does to the day's blocks (§3 rule 2). */
export const DAY_MODE_HINT: Record<DayMode, string> = {
  normal: 'Todos os blocos, versão normal',
  low: 'Versão mínima, sem complementos',
  recovery: 'Só o essencial protegido',
  free: 'Sem blocos, sem cobrança',
};

export interface DayTypeCardProps {
  onPick(mode: DayMode): void;
  /** Types offered (default: the three of a workday). */
  modes?: DayMode[];
}

/** "Como está hoje?" — the first question of a workday; it decides the shape of the day's blocks. */
export function DayTypeCard({ onPick, modes = ['normal', 'low', 'recovery'] }: DayTypeCardProps) {
  const headingId = useId();
  return (
    <Panel variant="stone" role="region" aria-labelledby={headingId} className="day-type px-border--gold">
      <h2 id={headingId} className="day-type__title">Como está hoje?</h2>
      <p className="day-type__intro">Sem resposta certa. Dá para trocar depois, no topo da tela.</p>
      <div className="day-type__options">
        {modes.map((m) => (
          <button key={m} type="button" className={`day-type__option day-type__option--${m}`} onClick={() => onPick(m)}>
            <Icon name={DAY_MODE_ICON[m]} size={24} className="day-type__icon" />
            <span className="day-type__text">
              <span className="day-type__label">{DAY_MODE_LABEL[m]}</span>
              <span className="day-type__hint">{DAY_MODE_HINT[m]}</span>
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
}
