import type { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Area, CommitmentOccurrence, DayKey, Mission } from '@life/shared';
import { Icon } from '../../art/icons';
import { MissionRow } from './MissionRow';

export interface DayContainerProps {
  /** Droppable id (`day:YYYY-MM-DD` or `backlog`). */
  id: string;
  /** Accessible name of the region. */
  label: string;
  heading: ReactNode;
  /** The day shown (none for the backlog); missions planned earlier get a "de outro dia" tag. */
  day?: DayKey;
  missions: Mission[];
  commitments?: CommitmentOccurrence[];
  areas: Area[];
  today: DayKey;
  emptyText: string;
  actions?: ReactNode;
  className?: string;
  onOpen(m: Mission): void;
  onMove(m: Mission, day: DayKey | null): void;
  onOpenCommitment?(o: CommitmentOccurrence): void;
}

/** One day (or the backlog): commitments, then sortable missions; a drop target for drags. */
export function DayContainer({
  id, label, heading, day, missions, commitments = [], areas, today, emptyText, actions, className,
  onOpen, onMove, onOpenCommitment,
}: DayContainerProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const empty = missions.length === 0 && commitments.length === 0;
  return (
    <section className={`day-box${isOver ? ' day-box--over' : ''}${className ? ` ${className}` : ''}`} aria-label={label}>
      <h3 className="day-box__title">{heading}</h3>
      <div ref={setNodeRef} className="day-box__drop">
        {commitments.length > 0 && (
          <ul className="today__list">
            {commitments.map((o) => (
              <li key={`${o.commitment.id}-${o.date}`} className="commit-row commit-row--btn">
                <button type="button" className="commit-row__btn" onClick={() => onOpenCommitment?.(o)}>
                  <Icon name="calendar" size={24} />
                  <span className="commit-row__time">{o.commitment.start}–{o.commitment.end}</span>
                  <span className="commit-row__title">{o.commitment.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <SortableContext items={missions.map((m) => m.id)} strategy={verticalListSortingStrategy}>
          <ul className="today__list">
            {missions.map((m) => (
              <MissionRow
                key={m.id}
                mission={m}
                area={m.areaId ? areas.find((a) => a.id === m.areaId) : undefined}
                today={today}
                fromOtherDay={day !== undefined && m.date !== undefined && m.date < day}
                onOpen={onOpen}
                onMove={onMove}
              />
            ))}
          </ul>
        </SortableContext>
        {empty && <p className="day-box__empty">{emptyText}</p>}
      </div>
      {actions && <div className="day-box__actions">{actions}</div>}
    </section>
  );
}
