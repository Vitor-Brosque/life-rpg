import type { WeekAtypical } from '@life/shared';
import { Icon } from '../../art/icons';
import './week.css';

export interface WeekLineProps {
  /** The week's experiment (its review's adjustment). */
  experiment?: string;
  /** The week's atypical mark, while it applies (activeAtypical): shown before the experiment. */
  atypical?: WeekAtypical;
  /** Reopens the "Nova semana" card; the link shows only when given. */
  onOpen?(): void;
}

const ddmm = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** "Semana atípica (Provas) até 22/11. Versões mínimas contam tanto quanto." */
export const atypicalLineText = (a: WeekAtypical): string =>
  `Semana atípica (${a.reason})${a.returnDay ? ` até ${ddmm(a.returnDay)}` : ''}. Versões mínimas contam tanto quanto.`;

/** Under the status strip: the atypical week and "Experimento da semana: …" all week, and the "Nova semana" link. */
export function WeekLine({ experiment, atypical, onOpen }: WeekLineProps) {
  const text = experiment?.trim();
  if (!text && !atypical && !onOpen) return null;
  return (
    <div className="week-line">
      {atypical && <p className="week-line__experiment">{atypicalLineText(atypical)}</p>}
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
