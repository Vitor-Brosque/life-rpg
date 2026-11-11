import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Area, DayKey, Mission } from '@life/shared';
import { addDays } from '@life/shared';
import { Button } from '../../ui/Button';
import { formatDuration } from '../../ui/format';
import { GripIcon } from '../agora/TodayList';
import { MoveMenu } from './MoveMenu';

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

/** "Escolher dia": the date only applies with "Mover", so scrolling the picker never moves anything. */
function PickDay({ mission, onPick }: { mission: Mission; onPick(day: DayKey): void }) {
  const [date, setDate] = useState<DayKey>(mission.date ?? '');
  return (
    <div className="move-panel__date">
      <label className="field">
        <span className="field__label">Escolher dia</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <Button size="sm" variant="primary" disabled={!date || date === mission.date} onClick={() => onPick(date)}>
        Mover
      </Button>
    </div>
  );
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
        {(close) => (
          <>
            <PickDay mission={mission} onPick={(day) => { onMove(mission, day); close(); }} />
            <div className="cluster">
              <Button size="sm" onClick={() => { onMove(mission, today); close(); }}>Hoje</Button>
              <Button size="sm" onClick={() => { onMove(mission, addDays(today, 1)); close(); }}>Amanhã</Button>
              <Button size="sm" onClick={() => { onMove(mission, null); close(); }}>Sem data</Button>
            </div>
          </>
        )}
      </MoveMenu>
    </li>
  );
}
