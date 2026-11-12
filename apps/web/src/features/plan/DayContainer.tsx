import type { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Area, BlockOccurrence, CommitmentOccurrence, DayKey, Mission } from '@life/shared';
import { Icon } from '../../art/icons';
import { formatClock } from '../../ui/format';
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
  /** The routine's blocks as planned for the day (compact rows, with the commitments by time). */
  blocks?: BlockOccurrence[];
  /** A free day of a routine: "Dia livre" instead of blocks. */
  freeDay?: boolean;
  areas: Area[];
  today: DayKey;
  emptyText: string;
  actions?: ReactNode;
  className?: string;
  onOpen(m: Mission): void;
  onMove(m: Mission, day: DayKey | null): void;
  onOpenCommitment?(o: CommitmentOccurrence): void;
}

function BlockLine({ occurrence: o }: { occurrence: BlockOccurrence }) {
  const skipped = o.state === 'skipped';
  return (
    <li className={`day-block${skipped ? ' day-block--skipped' : ''}`}>
      <span className="day-block__time">{formatClock(o.start)}</span>
      <span className="day-block__name">{o.block.name}</span>
      {skipped && <span className="day-block__note">não cabe</span>}
    </li>
  );
}

/** One day (or the backlog): blocks and commitments by time, then sortable missions; a drop target. */
export function DayContainer({
  id, label, heading, day, missions, commitments = [], blocks = [], freeDay = false, areas, today, emptyText,
  actions, className, onOpen, onMove, onOpenCommitment,
}: DayContainerProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const empty = missions.length === 0 && commitments.length === 0 && blocks.length === 0 && !freeDay;
  const agenda = [
    ...blocks.map((o) => ({ at: o.start, node: <BlockLine key={`block-${o.block.id}`} occurrence={o} /> })),
    ...commitments.map((o) => ({
      at: o.startTs,
      node: (
        <li key={`${o.commitment.id}-${o.date}`} className="commit-row commit-row--btn">
          <button type="button" className="commit-row__btn" onClick={() => onOpenCommitment?.(o)}>
            <Icon name="calendar" size={24} />
            <span className="commit-row__time">{o.commitment.start}–{o.commitment.end}</span>
            <span className="commit-row__title">{o.commitment.title}</span>
          </button>
        </li>
      ),
    })),
  ].sort((a, b) => a.at - b.at);
  return (
    <section className={`day-box${isOver ? ' day-box--over' : ''}${className ? ` ${className}` : ''}`} aria-label={label}>
      <h3 className="day-box__title">{heading}</h3>
      <div ref={setNodeRef} className="day-box__drop">
        {(agenda.length > 0 || freeDay) && (
          <ul className={`today__list${blocks.length > 0 ? ' day-box__agenda' : ''}`}>
            {freeDay && (
              <li className="day-block day-block--free">
                <Icon name="leaf" size={24} />
                <span>Dia livre</span>
              </li>
            )}
            {agenda.map((a) => a.node)}
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
