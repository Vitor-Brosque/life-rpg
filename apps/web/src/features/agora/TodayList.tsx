import { useEffect, useId, useMemo, useState } from 'react';
import {
  closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type Announcements, type DragEndEvent, type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Area, CommitmentOccurrence, Mission } from '@life/shared';
import { Icon } from '../../art/icons';
import { formatDuration } from '../../ui/format';

/** Essential on a hard day (§8): important, light or ≤ 15 min. */
export const isEssential = (m: Mission): boolean =>
  m.important || m.energy === 'light' || (m.durationMin ?? Infinity) <= 15;

export const coarsePointer = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(pointer: coarse)').matches;

export function GripIcon() {
  return (
    <svg width="12" height="20" viewBox="0 0 6 10" shapeRendering="crispEdges" aria-hidden="true" className="icon">
      {[1, 4, 7].flatMap((y) => [0, 3].map((x) => <rect key={`${x}-${y}`} x={x + 1} y={y} width="2" height="2" fill="currentColor" />))}
    </svg>
  );
}

function RowContent({ mission, area, onOpen }: { mission: Mission; area?: Area; onOpen(m: Mission): void }) {
  return (
    <button type="button" className="row-card__main" onClick={() => onOpen(mission)}>
      <span className="row-card__stripe" style={area ? { background: area.color } : undefined} aria-hidden="true" />
      <span className="row-card__body">
        <span className="row-card__title">{mission.title}</span>
        {mission.firstStep && <span className="row-card__sub">{mission.firstStep}</span>}
      </span>
      {mission.status === 'doing' && <span className="tag tag--gold">fazendo</span>}
      {mission.durationMin !== undefined && <span className="tag tag--stone">{formatDuration(mission.durationMin)}</span>}
    </button>
  );
}

function SortableRow({ mission, area, onOpen }: { mission: Mission; area?: Area; onOpen(m: Mission): void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: mission.id });
  return (
    <li
      ref={setNodeRef}
      className={isDragging ? 'row-card row-card--dragging' : 'row-card'}
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
      <RowContent mission={mission} area={area} onOpen={onOpen} />
    </li>
  );
}

export interface TodayListProps {
  /** Missions in `todayList()` order. */
  missions: Mission[];
  commitments: CommitmentOccurrence[];
  /** Completed today (shown struck through, collapsed). */
  done: Mission[];
  areas: Area[];
  /** Hard day: non-essential missions fold away. */
  hardDay?: boolean;
  now?: number;
  onOpen(m: Mission): void;
  onReorder(ids: string[]): void;
  title?: string;
}

/** "Hoje": commitments by start time, then missions (drag to reorder), then done today. */
export function TodayList({
  missions, commitments, done, areas, hardDay = false, now = Date.now(), onOpen, onReorder, title = 'Hoje',
}: TodayListProps) {
  const headingId = useId();
  const areaOf = (m: Mission) => (m.areaId ? areas.find((a) => a.id === m.areaId) : undefined);
  const visible = hardDay ? missions.filter(isEssential) : missions;
  const folded = hardDay ? missions.filter((m) => !isEssential(m)) : [];

  const ids = visible.map((m) => m.id);
  const idsKey = ids.join(',');
  const [order, setOrder] = useState(ids);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setOrder(ids), [idsKey]);
  const byId = useMemo(() => new Map(missions.map((m) => [m.id, m])), [missions]);
  const ordered = order.map((id) => byId.get(id)).filter((m): m is Mission => m !== undefined);

  // Touch: press and hold 200 ms (so the list still scrolls); mouse: start after 4 px.
  const pointerOptions = useMemo(() => ({
    activationConstraint: coarsePointer() ? { delay: 200, tolerance: 8 } : { distance: 4 },
  }), []);
  const keyboardOptions = useMemo(() => ({ coordinateGetter: sortableKeyboardCoordinates }), []);
  const sensors = useSensors(useSensor(PointerSensor, pointerOptions), useSensor(KeyboardSensor, keyboardOptions));

  const titleOf = (id: UniqueIdentifier) => byId.get(String(id))?.title ?? 'missão';
  const pos = (id: UniqueIdentifier) => order.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Pegou ${titleOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${titleOf(active.id)} na posição ${pos(over.id)} de ${order.length}.` : `${titleOf(active.id)} fora da lista.`,
    onDragEnd: ({ active, over }) =>
      over ? `${titleOf(active.id)} ficou na posição ${pos(over.id)} de ${order.length}.` : `${titleOf(active.id)} solta.`,
    onDragCancel: ({ active }) => `Movimento cancelado. ${titleOf(active.id)} voltou ao lugar.`,
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    setOrder(next);
    onReorder([...next, ...folded.map((m) => m.id)]);
  };

  const empty = commitments.length === 0 && missions.length === 0;

  return (
    <section className="today" aria-labelledby={headingId}>
      <h2 id={headingId} className="section-title">{title}</h2>
      {empty && <p className="today__empty">Nada planejado para hoje.</p>}

      {commitments.length > 0 && (
        <ul className="today__list">
          {commitments.map((o) => {
            const state = o.endTs <= now ? ' commit-row--past' : o.startTs <= now ? ' commit-row--now' : '';
            return (
              <li key={`${o.commitment.id}-${o.date}`} className={`commit-row${state}`}>
                <Icon name="calendar" size={24} />
                <span className="commit-row__time">{o.commitment.start}–{o.commitment.end}</span>
                <span className="commit-row__title">{o.commitment.title}</span>
              </li>
            );
          })}
        </ul>
      )}

      {ordered.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable: 'Para mover, pressione espaço ou Enter. Use as setas para mudar a posição e espaço ou Enter para soltar. Esc cancela.',
            },
          }}
        >
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ul className="today__list">
              {ordered.map((m) => <SortableRow key={m.id} mission={m} area={areaOf(m)} onOpen={onOpen} />)}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {folded.length > 0 && (
        <details className="today__fold">
          <summary>Fora do essencial hoje ({folded.length})</summary>
          <ul className="today__list">
            {folded.map((m) => (
              <li key={m.id} className="row-card row-card--plain">
                <RowContent mission={m} area={areaOf(m)} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {done.length > 0 && (
        <details className="today__fold">
          <summary>Concluídas hoje ({done.length})</summary>
          <ul className="today__list today__list--done">
            {done.map((m) => <li key={m.id} className="done-row"><Icon name="check" size={12} /><s>{m.title}</s></li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
