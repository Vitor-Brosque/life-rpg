import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { DndContext, closestCenter, type Announcements, type DragEndEvent, type UniqueIdentifier } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Area, Block, Journey } from '@life/shared';
import { reorderBlocks } from '../../domain/actions';
import { Button } from '../../ui/Button';
import { WEEKDAY_ABBR } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { tabKeyTarget } from '../../ui/tabKeys';
import { DRAG_INSTRUCTIONS, usePlanSensors } from '../plan/planShared';
import { BlockCard } from './BlockCard';
import {
  WEEK_ORDER, WEEKDAY_IN, WEEKDAY_NAME, byPlanOrder, isWeekend, logicalMinutes, mergeDayOrder, pendingSettled, shownOrder,
} from './routineShared';

export interface RoutineEditorProps {
  /** Live (not archived) blocks, in routine order. */
  blocks: Block[];
  areas: Area[];
  journeys: Journey[];
  weekday: number;
  todayWeekday: number;
  /** Logical day start: times before it belong to the next morning. */
  dayStartHour: number;
  onWeekday(weekday: number): void;
  onOpen(block: Block): void;
  onAdd(): void;
  onCopy(): void;
}

/** Weekday tabs (seg … dom) and the day's block cards; dragging a card reorders the routine. */
export function RoutineEditor({
  blocks, areas, journeys, weekday, todayWeekday, dayStartHour, onWeekday, onOpen, onAdd, onCopy,
}: RoutineEditorProps) {
  const sensors = usePlanSensors();
  const dayBlocks = useMemo(() => blocks.filter((b) => b.weekdays.includes(weekday)).sort(byPlanOrder), [blocks, weekday]);
  const ids = dayBlocks.map((b) => b.id);
  const idsKey = ids.join(',');
  // The dropped order shows at once and stays until the live query has the whole new order.
  const [pending, setPending] = useState<string[]>();
  const order = shownOrder(ids, pending);
  useEffect(() => {
    if (pending && pendingSettled(ids, pending)) setPending(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, pending]);
  const byId = new Map(dayBlocks.map((b) => [b.id, b]));
  const shown = order.map((id) => byId.get(id)).filter((b): b is Block => b !== undefined);

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = tabKeyTarget(e.key, WEEK_ORDER.indexOf(weekday), WEEK_ORDER.length);
    if (next < 0) return;
    e.preventDefault();
    const d = WEEK_ORDER[next]!;
    onWeekday(d);
    document.getElementById(`routine-day-${d}`)?.focus();
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    setPending(next);
    safeRun(reorderBlocks(mergeDayOrder([...blocks].sort(byPlanOrder).map((b) => b.id), next)).catch((e: unknown) => {
      setPending(undefined); // not saved: show the stored order again
      throw e;
    }));
  };
  const nameOf = (id: UniqueIdentifier) => byId.get(String(id))?.name ?? 'bloco';
  const pos = (id: UniqueIdentifier) => order.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Pegou ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${nameOf(active.id)} na posição ${pos(over.id)} de ${order.length}.` : `${nameOf(active.id)} fora da lista.`,
    onDragEnd: ({ active, over }) =>
      over ? `${nameOf(active.id)} ficou na posição ${pos(over.id)} de ${order.length}.` : `${nameOf(active.id)} solta.`,
    onDragCancel: ({ active }) => `Movimento cancelado. ${nameOf(active.id)} voltou ao lugar.`,
  };

  const areaOf = (id?: string) => (id ? areas.find((a) => a.id === id) : undefined);
  return (
    <div className="routine">
      <div className="routine__days" role="tablist" aria-label="Dias da semana" onKeyDown={onTabKey}>
        {WEEK_ORDER.map((d) => {
          const n = blocks.filter((b) => b.weekdays.includes(d)).length;
          return (
            <button key={d} type="button" role="tab" id={`routine-day-${d}`} aria-selected={d === weekday}
              tabIndex={d === weekday ? 0 : -1} aria-controls="routine-day-panel"
              className={`routine__day${d === todayWeekday ? ' is-today' : ''}`} onClick={() => onWeekday(d)}>
              <span>{WEEKDAY_ABBR[d]}</span>
              <span className={`routine__count${n === 0 ? ' is-empty' : ''}`} aria-hidden="true">{n}</span>
            </button>
          );
        })}
      </div>

      <div id="routine-day-panel" role="tabpanel" aria-labelledby={`routine-day-${weekday}`} className="routine__panel">
        {shown.length > 1 && <p className="routine__hint muted">A ordem vale para todos os dias que têm estes blocos.</p>}
        {shown.length === 0 ? (
          <p className="day-box__empty">
            Nenhum bloco {WEEKDAY_IN[weekday]}.
            {isWeekend(weekday) && ' Sábado e domingo são dias livres; dá para copiar blocos para cá se quiser.'}
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}
            accessibility={{ announcements, screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS } }}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <ul className="today__list" aria-label={`Blocos de ${WEEKDAY_NAME[weekday]}`}>
                {shown.map((b, i) => {
                  const journey = b.journeyId ? journeys.find((j) => j.id === b.journeyId) : undefined;
                  const prev = shown[i - 1];
                  const outOfOrder = prev !== undefined
                    && logicalMinutes(b.targetStart, dayStartHour) < logicalMinutes(prev.targetStart, dayStartHour);
                  return (
                    <BlockCard key={b.id} block={b} journey={journey} area={areaOf(b.areaId ?? journey?.areaId)}
                      outOfOrder={outOfOrder} onOpen={onOpen} />
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>
        )}
        <div className="routine__actions">
          <Button icon="plus" aria-label="Novo bloco" onClick={onAdd}>Bloco</Button>
          <Button icon="calendar" disabled={shown.length === 0} onClick={onCopy}>Copiar este dia para…</Button>
        </div>
      </div>
      <p className="routine__note muted">Horários e durações são palpites: ajuste quando a semana mostrar o que funciona.</p>
    </div>
  );
}
