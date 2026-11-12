import { Icon } from '../../art/icons';
import { Button } from '../../ui/Button';
import { capacityWarning, sendToNextButton, type BlockFit } from './capacity';
import './blocks.css';

export interface CapacityWarningProps {
  fit: BlockFit;
  /** Plans the mission for the block's next occurrence (absent when the block never comes back). */
  onNext?(): void;
  /** Keeps it today anyway: the warning never blocks. */
  onToday(): void;
}

/** "O bloco Treino de hoje já está cheio (2h30 de 2h). Mandar para o próximo (qui)?" */
export function CapacityWarning({ fit, onNext, onToday }: CapacityWarningProps) {
  return (
    <div className="capacity-warning">
      <p className="capacity-warning__text" role="status">
        <Icon name="timer" size={12} className="capacity-warning__icon" />
        <span>{capacityWarning(fit)}</span>
      </p>
      <div className="capacity-warning__actions">
        {onNext && <Button size="sm" variant="primary" onClick={onNext}>{sendToNextButton(fit)}</Button>}
        <Button size="sm" variant="ghost" onClick={onToday}>Hoje mesmo assim</Button>
      </div>
    </div>
  );
}
