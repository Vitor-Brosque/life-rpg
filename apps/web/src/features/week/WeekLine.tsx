import { Icon } from '../../art/icons';
import './week.css';

export interface WeekLineProps {
  /** The week's experiment (its review's adjustment). */
  experiment?: string;
  /** Reopens the "Nova semana" card; the link shows only when given. */
  onOpen?(): void;
}

/** Under the status strip: "Experimento da semana: …" all week, and the "Nova semana" link. */
export function WeekLine({ experiment, onOpen }: WeekLineProps) {
  const text = experiment?.trim();
  if (!text && !onOpen) return null;
  return (
    <div className="week-line">
      {text && <p className="week-line__experiment">{`Experimento da semana: ${text}`}</p>}
      {onOpen && (
        <button type="button" className="week-line__link" onClick={onOpen}>
          <Icon name="calendar" size={12} />
          Nova semana
        </button>
      )}
    </div>
  );
}
