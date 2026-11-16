import { useEffect, useMemo, useState, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link } from 'wouter';
import type { Area, Journey, Mission } from '@life/shared';
import { areaIcon, Icon } from '../../art/icons';
import { db } from '../../db/db';
import { useAreas, useJourneys, useMissions } from '../../db/hooks';
import { newRecord, patch, put } from '../../db/repo';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { Panel } from '../../ui/Panel';
import { ProgressBar } from '../../ui/ProgressBar';
import { safeRun } from '../../ui/safeRun';
import { GripIcon } from '../agora/TodayList';
import { DRAG_INSTRUCTIONS, usePlanSensors } from '../plan/planShared';
import { journeyStats } from './journeyData';
import '../plan/plan.css';

const orderOf = (a: Journey, b: Journey) => a.order - b.order || a.createdAt - b.createdAt;

interface CardProps { journey: Journey; missions: Mission[]; areas: Area[] }

function JourneyCard({ journey, missions, areas, handle, liProps }: CardProps & {
  handle?: ReactNode; liProps?: HTMLAttributes<HTMLLIElement> & { ref?: Ref<HTMLLIElement> };
}) {
  const { done, total, next } = journeyStats(journey, missions);
  const area = areas.find((a) => a.id === journey.areaId);
  const label = total > 0 ? `${done}/${total}` : 'Sem missões ainda';
  return (
    <li {...liProps} className={`row-card journey-card${liProps?.className ? ` ${liProps.className}` : ''}`}>
      {handle ?? <span className="row-card__stripe" aria-hidden="true" />}
      <Link href={`/jornadas/${journey.id}`} className="journey-card__link">
        <span className="journey-card__head">
          <Icon name={areaIcon(area?.icon)} size={24} />
          <span className="journey-card__title">{journey.title}</span>
          {journey.status !== 'active' && (
            <span className="tag tag--stone">{journey.status === 'done' ? 'concluída' : 'arquivada'}</span>
          )}
        </span>
        <ProgressBar value={done} max={total} label={label} {...(area ? { color: area.color } : {})} />
        <p className="journey-card__next">
          {next ? `Próxima: ${next.firstStep ?? next.title}` : total > 0 && done === total ? 'Todas as missões feitas' : 'Sem próxima missão'}
        </p>
      </Link>
    </li>
  );
}

function SortableJourney(props: CardProps) {
  const sort = useSortable({ id: props.journey.id });
  return (
    <JourneyCard
      {...props}
      liProps={{
        ref: sort.setNodeRef,
        className: sort.isDragging ? 'row-card--dragging' : '',
        style: { transform: CSS.Transform.toString(sort.transform), transition: sort.transition },
      }}
      handle={(
        <button type="button" ref={sort.setActivatorNodeRef} className="row-card__handle"
          aria-label={`Reordenar ${props.journey.title}`} {...sort.attributes} {...sort.listeners}>
          <GripIcon />
        </button>
      )}
    />
  );
}

function NewJourneyForm({ onDone }: { onDone(): void }) {
  const [title, setTitle] = useState('');
  const [outcome, setOutcome] = useState('');
  const create = async () => {
    const t = title.trim();
    if (!t) return;
    const all = await db.journeys.filter((j) => !j.deleted).toArray();
    const order = all.reduce((mx, j) => Math.max(mx, j.order + 1), 0);
    await put('journeys', newRecord<Journey>({
      title: t, status: 'active', order, ...(outcome.trim() ? { outcome: outcome.trim() } : {}),
    }));
    onDone();
  };
  return (
    <Panel variant="stone">
      <form className="journey-form" onSubmit={(e) => { e.preventDefault(); safeRun(create); }}>
        <label className="field">
          <span className="field__label">Título</span>
          <input type="text" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Resultado esperado</span>
          <input type="text" value={outcome} placeholder="O que estará pronto no fim?"
            onChange={(e) => setOutcome(e.target.value)} />
        </label>
        <div className="cluster">
          <Button type="submit" variant="primary" disabled={!title.trim()}>Criar jornada</Button>
          <Button onClick={onDone}>Cancelar</Button>
        </div>
      </form>
    </Panel>
  );
}

/** Planejar → Jornadas: active journeys (drag to reorder) with progress and the next mission. */
export function JourneysView() {
  const journeys = useJourneys();
  const missions = useMissions();
  const areas = useAreas();
  const sensors = usePlanSensors();
  const [adding, setAdding] = useState(false);
  const [showOld, setShowOld] = useState(false);

  const active = useMemo(() => journeys.filter((j) => j.status === 'active').sort(orderOf), [journeys]);
  const old = useMemo(() => journeys.filter((j) => j.status !== 'active').sort(orderOf), [journeys]);
  const ids = active.map((j) => j.id);
  const idsKey = ids.join(',');
  const [order, setOrder] = useState(ids);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setOrder(ids), [idsKey]);
  const byId = new Map(active.map((j) => [j.id, j]));
  const ordered = order.map((id) => byId.get(id)).filter((j): j is Journey => j !== undefined);

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    if (!over || a.id === over.id) return;
    const next = arrayMove(order, order.indexOf(String(a.id)), order.indexOf(String(over.id)));
    setOrder(next);
    safeRun(Promise.all(next.map((id, i) =>
      (byId.get(id)?.order !== i ? patch<Journey>('journeys', id, { order: i }) : undefined))));
  };

  return (
    <div className="journeys stack">
      <p className="muted">Um objetivo, várias missões. Só a próxima aparece na tela Agora.</p>
      <div className="journeys__bar">
        {!adding && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Nova jornada</Button>}
        {old.length > 0 && (
          <Chip selected={showOld} onClick={() => setShowOld((v) => !v)}>Mostrar concluídas/arquivadas</Chip>
        )}
      </div>
      {adding && <NewJourneyForm onDone={() => setAdding(false)} />}

      {ordered.length === 0 && !adding && (
        <Panel variant="stone"><p className="muted">Nenhuma jornada ativa. Crie uma para quebrar um projeto em missões.</p></Panel>
      )}
      {ordered.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}
          accessibility={{ screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS } }}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ul className="journey-list" aria-label="Jornadas ativas">
              {ordered.map((j) => <SortableJourney key={j.id} journey={j} missions={missions} areas={areas} />)}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {showOld && (
        <div className="journeys__archived">
          <h2 className="section-title">Concluídas e arquivadas</h2>
          <ul className="journey-list">
            {old.map((j) => <JourneyCard key={j.id} journey={j} missions={missions} areas={areas} />)}
          </ul>
        </div>
      )}
    </div>
  );
}
