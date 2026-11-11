import { useMemo } from 'react';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useDraggable, useDroppable,
  useSensor, useSensors, type CollisionDetection, type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Area, DayKey, Mission } from '@life/shared';
import { db } from '../../db/db';
import { moveToDay, startMission, updateMission } from '../../domain/actions';
import { formatDuration, plural } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { coarsePointer, GripIcon } from '../agora/TodayList';
import { completeWithFeedback, reopenMission } from '../mission/missionFeedback';
import { useMissionSheet } from '../mission/MissionSheet';
import { MoveMenu } from './MoveMenu';
import { byDayOrder, DRAG_INSTRUCTIONS, usePlanData } from './planShared';
import './plan.css';

export type ColumnId = 'backlog' | 'today' | 'doing' | 'done';

export const COLUMNS: Array<{ id: ColumnId; title: string; empty: string }> = [
  { id: 'backlog', title: 'Sem data', empty: 'Nada sem data.' },
  { id: 'today', title: 'Hoje', empty: 'Nada para hoje.' },
  { id: 'doing', title: 'Em andamento', empty: 'Nada em andamento.' },
  { id: 'done', title: 'Feito (7 dias)', empty: 'Nada concluído ainda.' },
];

const WEEK_MS = 7 * 86_400_000;

/** Which column a mission lives in, or undefined when it is hidden (future day, dropped, old). */
export function columnOf(m: Mission, today: DayKey, now: number): ColumnId | undefined {
  if (m.status === 'dropped') return undefined;
  if (m.status === 'done') return (m.completedAt ?? m.updatedAt) >= now - WEEK_MS ? 'done' : undefined;
  if (m.status === 'doing') return 'doing';
  if (m.date === undefined) return 'backlog';
  return m.date <= today ? 'today' : undefined;
}

/** Applies a column drop / menu choice to a mission. */
export async function moveToColumn(m: Mission, to: ColumnId, today: DayKey): Promise<void> {
  if (to === 'done') { await completeWithFeedback(m.id); return; }
  // Moving out of "Feito" means it wasn't really done: undo the completion (and its XP),
  // so completing it again can't award XP twice.
  if (m.status === 'done') await reopenMission(m.id);
  if (to === 'doing') { await startMission(m.id); return; }
  if ((await db.missions.get(m.id))?.status === 'doing') await updateMission(m.id, { status: 'open' });
  await moveToDay(m.id, to === 'today' ? today : null);
}

const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCenter(args);
};

function BoardCard({ mission, area, current, today }: { mission: Mission; area?: Area; current: ColumnId; today: DayKey }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({ id: mission.id });
  return (
    <li
      ref={setNodeRef}
      className={`row-card plan-row${isDragging ? ' row-card--dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform) }}
    >
      <button type="button" ref={setActivatorNodeRef} className="row-card__handle"
        aria-label={`Arrastar ${mission.title}`} {...attributes} {...listeners}>
        <GripIcon />
      </button>
      <button type="button" className="row-card__main" onClick={() => useMissionSheet.getState().open(mission.id)}>
        <span className="row-card__stripe" style={area ? { background: area.color } : undefined} aria-hidden="true" />
        <span className="row-card__body">
          <span className="row-card__title">{mission.title}</span>
          {mission.durationMin !== undefined && <span className="row-card__sub">{formatDuration(mission.durationMin)}</span>}
        </span>
      </button>
      <MoveMenu title={mission.title}>
        {(close) => (
          <ul className="move-panel__list" aria-label={`Mover ${mission.title} para`}>
            {COLUMNS.filter((c) => c.id !== current).map((c) => (
              <li key={c.id}>
                <button type="button" className="move-panel__item"
                  onClick={() => { safeRun(moveToColumn(mission, c.id, today)); close(); }}>
                  {c.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </MoveMenu>
    </li>
  );
}

function Column({ id, title, empty, missions, areas, today }: {
  id: ColumnId; title: string; empty: string; missions: Mission[]; areas: Area[]; today: DayKey;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section className={`board__col${isOver ? ' board__col--over' : ''}`} aria-label={title}>
      <h3 className="board__title">
        {title} <span className="board__count" aria-hidden="true">{missions.length}</span>
      </h3>
      <div ref={setNodeRef} className="board__drop">
        <ul className="today__list">
          {missions.map((m) => (
            <BoardCard key={m.id} mission={m} current={id} today={today}
              area={m.areaId ? areas.find((a) => a.id === m.areaId) : undefined} />
          ))}
        </ul>
        {missions.length === 0 && <p className="day-box__empty">{empty}</p>}
      </div>
    </section>
  );
}

/** "Quadro": Sem data · Hoje · Em andamento · Feito. Drag a card (or use "Mover para…") to change its state. */
export function BoardView() {
  const { today, missions, areas } = usePlanData();
  const pointerOptions = useMemo(() => ({
    activationConstraint: coarsePointer() ? { delay: 200, tolerance: 8 } : { distance: 4 },
  }), []);
  const sensors = useSensors(useSensor(PointerSensor, pointerOptions), useSensor(KeyboardSensor));

  if (!today) return <p className="muted">Carregando…</p>;

  const now = Date.now();
  const cols: Record<ColumnId, Mission[]> = { backlog: [], today: [], doing: [], done: [] };
  let later = 0;
  for (const m of missions) {
    const c = columnOf(m, today, now);
    if (c) cols[c].push(m);
    else if (m.status === 'open') later += 1;
  }
  cols.backlog.sort(byDayOrder);
  cols.today.sort(byDayOrder);
  cols.doing.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  cols.done.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const to = over?.id as ColumnId | undefined;
    const m = missions.find((x) => x.id === active.id);
    if (!m || !to || !COLUMNS.some((c) => c.id === to)) return;
    if (columnOf(m, today, now) === to) return;
    safeRun(moveToColumn(m, to, today));
  };

  return (
    <div className="board-wrap">
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragEnd={onDragEnd}
        accessibility={{ screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS } }}
      >
        <div className="board">
          {COLUMNS.map((c) => (
            <Column key={c.id} {...c} missions={cols[c.id]} areas={areas} today={today} />
          ))}
        </div>
      </DndContext>
      {later > 0 && (
        <p className="muted board__later">
          {plural(later, 'missão planejada', 'missões planejadas')} para dias futuros — veja em Semana.
        </p>
      )}
    </div>
  );
}
