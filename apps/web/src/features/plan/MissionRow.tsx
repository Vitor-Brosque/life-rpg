import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Area, DayKey, Mission } from '@life/shared';
import { formatDuration } from '../../ui/format';
import { GripIcon } from '../agora/TodayList';
import { MoveMenu } from './MoveMenu';
import { MoveOptions } from './MoveOptions';

export interface MissionRowProps {
  mission: Mission;
  area?: Area;
  today: DayKey;
  /** Planned for an earlier day but listed under today: neutral "de outro dia" tag. */
  fromOtherDay?: boolean;
  onOpen(m: Mission): void;
  /** Move to a day, or to the backlog with `null`. */
  onMove(m: Mission, day: DayKey | null): void;
}

/** Week/backlog row: drag handle, title (opens the sheet), and the "Mover para…" menu. */
export function MissionRow({ mission, area, today, fromOtherDay, onOpen, onMove }: MissionRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: mission.id });
  return (
    <li
      ref={setNodeRef}
      className={`row-card plan-row${isDragging ? ' row-card--dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="row-card__handle"
        aria-label={`Reordenar ${mission.title}`}
        {...attributes}
        {...listeners}
      >
        <GripIcon />
      </button>
      <button type="button" className="row-card__main" onClick={() => onOpen(mission)}>
        <span className="row-card__stripe" style={area ? { background: area.color } : undefined} aria-hidden="true" />
        <span className="row-card__body">
          <span className="row-card__title">{mission.title}</span>
        </span>
        {fromOtherDay && <span className="tag tag--stone">de outro dia</span>}
        {mission.status === 'doing' && <span className="tag tag--gold">fazendo</span>}
        {mission.durationMin !== undefined && <span className="tag tag--stone">{formatDuration(mission.durationMin)}</span>}
      </button>
      <MoveMenu title={mission.title}>
        {(close) => <MoveOptions mission={mission} today={today} onMove={(day) => { onMove(mission, day); close(); }} />}
      </MoveMenu>
    </li>
  );
}
