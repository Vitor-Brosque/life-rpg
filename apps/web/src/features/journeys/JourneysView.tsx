import { useEffect, useId, useMemo, useRef, useState, type HTMLAttributes, type MouseEvent, type ReactNode, type Ref } from 'react';
import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link } from 'wouter';
import type { Area, Goal, GoalGroup, ID, Journey, Mission } from '@life/shared';
import { GOAL_STATUS_TAG, goalGroups, goalMeta, oldGoals, pickableGoals } from '@life/shared';
import { areaIcon, Icon } from '../../art/icons';
import { db } from '../../db/db';
import { useGoals } from '../../db/goalData';
import { useAreas, useJourneys, useMissions } from '../../db/hooks';
import { newRecord, patch, put } from '../../db/repo';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { focusWhenGone } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { ProgressBar } from '../../ui/ProgressBar';
import { safeRun } from '../../ui/safeRun';
import { GripIcon } from '../agora/TodayList';
import { DRAG_INSTRUCTIONS, usePlanSensors } from '../plan/planShared';
import { createJourney } from '../../domain/journeyActions';
import { GoalChips, GoalSheet, type GoalTarget } from './GoalSheet';
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

function NewJourneyForm({ goals, onDone }: { goals: Goal[]; onDone(): void }) {
  const [title, setTitle] = useState('');
  const [outcome, setOutcome] = useState('');
  const [goalId, setGoalId] = useState<ID>();
  const formRef = useRef<HTMLFormElement>(null);
  /** Closes the form; focus goes to "Nova jornada" once the form is gone (never <body>). */
  const done = () => {
    focusWhenGone(formRef.current, () => document.querySelector<HTMLElement>('[data-journey-new]'));
    onDone();
  };
  const create = async () => {
    const t = title.trim();
    if (!t) return;
    await createJourney({ title: t, outcome, ...(goalId ? { goalId } : {}) });
    done();
  };
  return (
    <Panel variant="stone">
      <form ref={formRef} className="journey-form" onSubmit={(e) => { e.preventDefault(); safeRun(create); }}>
        <label className="field">
          <span className="field__label">Título</span>
          <input type="text" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Resultado esperado</span>
          <input type="text" value={outcome} placeholder="O que estará pronto no fim?"
            onChange={(e) => setOutcome(e.target.value)} />
        </label>
        {goals.length > 0 && <GoalChips goals={goals} value={goalId} legend="Objetivo (opcional)" onChange={setGoalId} />}
        <div className="cluster">
          <Button type="submit" variant="primary" disabled={!title.trim()}>Criar jornada</Button>
          <Button onClick={done}>Cancelar</Button>
        </div>
      </form>
    </Panel>
  );
}

/** The active journeys of one group, dragged to reorder inside it. */
function GroupJourneys({ journeys, missions, areas, label, onReorder }: {
  journeys: Journey[]; missions: Mission[]; areas: Area[]; label: string; onReorder(next: ID[]): void;
}) {
  const sensors = usePlanSensors();
  const ids = journeys.map((j) => j.id);
  const idsKey = ids.join(',');
  const [order, setOrder] = useState(ids);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setOrder(ids), [idsKey]);
  const byId = new Map(journeys.map((j) => [j.id, j]));
  const ordered = order.map((id) => byId.get(id)).filter((j): j is Journey => j !== undefined);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    setOrder(next);
    onReorder(next);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}
      accessibility={{ screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS } }}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ul className="journey-list" aria-label={label}>
          {ordered.map((j) => <SortableJourney key={j.id} journey={j} missions={missions} areas={areas} />)}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

/** One goal (or "Sem objetivo" / "Jornadas") with its active journeys. */
function GoalSection({ group, title, missions, areas, onEdit, onReorder }: {
  group: GoalGroup; title: string; missions: Mission[]; areas: Area[];
  onEdit(e: MouseEvent<HTMLButtonElement>): void; onReorder(next: ID[]): void;
}) {
  const headingId = useId();
  const { goal, journeys } = group;
  const meta = goal ? goalMeta(goal) : '';
  const label = goal ? `Jornadas de ${goal.title}` : title === 'Jornadas' ? 'Jornadas ativas' : 'Jornadas sem objetivo';
  return (
    <section className="goal-group" aria-labelledby={headingId}>
      <div className="goal-group__head">
        <h2 id={headingId} className="goal-group__title">{title}</h2>
        {goal && <Button size="sm" variant="ghost" aria-label={`Editar objetivo ${goal.title}`} onClick={onEdit}>Editar</Button>}
      </div>
      {meta && <p className="goal-group__meta">{meta}</p>}
      {goal?.why && <p className="goal-group__why">{goal.why}</p>}
      {journeys.length === 0
        ? <p className="muted goal-group__empty">Nenhuma jornada ligada ainda. Ligue uma em Nova jornada ou na ficha da jornada.</p>
        : <GroupJourneys journeys={journeys} missions={missions} areas={areas} label={label} onReorder={onReorder} />}
    </section>
  );
}

/** Planejar → Objetivos: goals as groups with their active journeys (drag inside a group), then the journeys without one. */
export function JourneysView() {
  const journeys = useJourneys();
  const goals = useGoals();
  const missions = useMissions();
  const areas = useAreas();
  const [adding, setAdding] = useState(false);
  const [showOld, setShowOld] = useState(false);
  const [target, setTarget] = useState<GoalTarget>();
  const [opener, setOpener] = useState<HTMLElement | null>(null);

  const groups = useMemo(() => (goals ? goalGroups(goals, journeys) : undefined), [goals, journeys]);
  const oldJourneys = useMemo(() => journeys.filter((j) => j.status !== 'active').sort(orderOf), [journeys]);
  const old = useMemo(() => (goals ? oldGoals(goals, journeys) : []), [goals, journeys]);
  const pickable = useMemo(() => pickableGoals(goals ?? []), [goals]);
  const onlyLoose = groups?.length === 1 && groups[0]!.goal === undefined;

  const open = (t: GoalTarget, e: MouseEvent<HTMLElement>) => {
    setOpener(e.currentTarget);
    setTarget(t);
  };
  const close = () => {
    // The tapped "Editar" may go with its group (a goal archived): focus moves to "Novo objetivo", never <body>.
    focusWhenGone(opener, () => document.querySelector<HTMLElement>('[data-goal-new]'));
    setTarget(undefined);
  };
  /** A drag inside a group: every active journey gets its index in the order shown (groups in order). */
  const reorder = (index: number, next: ID[]) => {
    if (!groups) return;
    const byId = new Map(journeys.map((j) => [j.id, j]));
    const all = groups.flatMap((g, i) => (i === index ? next : g.journeys.map((j) => j.id)));
    safeRun(Promise.all(all.map((id, i) =>
      (byId.get(id)?.order !== i ? patch<Journey>('journeys', id, { order: i }) : undefined))));
  };

  return (
    <div className="journeys stack">
      <p className="muted">Objetivos são o porquê; jornadas são os projetos que servem a eles, em missões. Só a próxima missão aparece no Agora.</p>
      <div className="journeys__bar">
        <div className="cluster">
          <Button variant="primary" icon="plus" data-goal-new onClick={(e) => open({ kind: 'new' }, e)}>Novo objetivo</Button>
          {!adding && <Button icon="plus" data-journey-new onClick={() => setAdding(true)}>Nova jornada</Button>}
        </div>
        {(oldJourneys.length > 0 || old.length > 0) && (
          <Chip selected={showOld} onClick={() => setShowOld((v) => !v)}>Mostrar concluídos e arquivados</Chip>
        )}
      </div>
      {adding && <NewJourneyForm goals={pickable} onDone={() => setAdding(false)} />}

      {groups && groups.length === 0 && !adding && (
        <Panel variant="stone">
          <p className="muted">
            Nenhum objetivo nem jornada ativa ainda. Um objetivo é o porquê (ex.: “Primeira vaga em Engenharia de Dados · 2027”);
            uma jornada é um projeto que serve a ele, quebrado em missões.
          </p>
        </Panel>
      )}
      {groups?.map((g, i) => (
        <GoalSection key={g.goal?.id ?? 'sem-objetivo'} group={g} title={g.goal ? g.goal.title : onlyLoose ? 'Jornadas' : 'Sem objetivo'}
          missions={missions} areas={areas} onEdit={(e) => { if (g.goal) open({ kind: 'edit', goal: g.goal }, e); }}
          onReorder={(next) => reorder(i, next)} />
      ))}

      {showOld && (
        <div className="journeys__archived">
          <h2 className="section-title">Concluídos e arquivados</h2>
          {old.length > 0 && (
            <ul className="journey-list" aria-label="Objetivos concluídos e arquivados">
              {old.map((g) => (
                <li key={g.id} className="row-card">
                  <button type="button" className="row-card__main" onClick={(e) => open({ kind: 'edit', goal: g }, e)}>
                    <span className="row-card__body"><span className="row-card__title">{g.title}</span></span>
                    <span className="tag tag--stone">{GOAL_STATUS_TAG[g.status]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {oldJourneys.length > 0 && (
            <ul className="journey-list" aria-label="Jornadas concluídas e arquivadas">
              {oldJourneys.map((j) => <JourneyCard key={j.id} journey={j} missions={missions} areas={areas} />)}
            </ul>
          )}
        </div>
      )}
      <GoalSheet target={target} onClose={close} />
    </div>
  );
}
