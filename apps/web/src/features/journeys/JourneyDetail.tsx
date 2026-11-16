import { useEffect, useState } from 'react';
import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'wouter';
import type { Journey, Mission } from '@life/shared';
import { Icon } from '../../art/icons';
import { db } from '../../db/db';
import { useAreas, useMissions } from '../../db/hooks';
import { patch } from '../../db/repo';
import { completeJourney, createMission, updateMission } from '../../domain/actions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { formatDuration } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import { ProgressBar } from '../../ui/ProgressBar';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { GripIcon } from '../agora/TodayList';
import { useCompanion } from '../companion/store';
import { JourneyPracticeLink } from '../practice/PracticePanel';
import { EditableField } from '../mission/EditableField';
import { useMissionSheet } from '../mission/MissionSheet';
import { DRAG_INSTRUCTIONS, usePlanSensors } from '../plan/planShared';
import { byJourneyOrder, journeyStats } from './journeyData';
import '../plan/plan.css';

const STATUS_TAG: Partial<Record<Mission['status'], string>> = { doing: 'fazendo', done: 'feita', dropped: 'solta' };

function MissionItem({ mission }: { mission: Mission }) {
  const sort = useSortable({ id: mission.id });
  return (
    <li
      ref={sort.setNodeRef}
      className={`row-card journey-mission journey-mission--${mission.status}${sort.isDragging ? ' row-card--dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(sort.transform), transition: sort.transition }}
    >
      <button type="button" ref={sort.setActivatorNodeRef} className="row-card__handle"
        aria-label={`Reordenar ${mission.title}`} {...sort.attributes} {...sort.listeners}>
        <GripIcon />
      </button>
      <button type="button" className="row-card__main" onClick={() => useMissionSheet.getState().open(mission.id)}>
        {mission.status === 'done' && <Icon name="check" size={12} className="journey-mission__check" />}
        <span className="row-card__body"><span className="row-card__title">{mission.title}</span></span>
        {STATUS_TAG[mission.status] && (
          <span className={`tag ${mission.status === 'doing' ? 'tag--gold' : 'tag--stone'}`}>{STATUS_TAG[mission.status]}</span>
        )}
        {mission.durationMin !== undefined && <span className="tag tag--stone">{formatDuration(mission.durationMin)}</span>}
      </button>
    </li>
  );
}

function AddMission({ journey, nextOrder }: { journey: Journey; nextOrder: number }) {
  const [text, setText] = useState('');
  const add = () => {
    const title = text.trim();
    if (!title) return;
    setText('');
    safeRun(createMission({
      title, journeyId: journey.id, journeyOrder: nextOrder, ...(journey.areaId ? { areaId: journey.areaId } : {}),
    }).catch((e: unknown) => { setText(title); throw e; })); // keep what was typed
  };
  return (
    <form className="journey-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <label className="field">
        <span className="field__label">Nova missão da jornada</span>
        <input type="text" value={text} enterKeyHint="done" placeholder="Próximo passo…"
          onChange={(e) => setText(e.target.value)} />
      </label>
      <Button type="submit" variant="primary" icon="plus" aria-label="Adicionar missão" disabled={!text.trim()} />
    </form>
  );
}

function JourneyBody({ journey }: { journey: Journey }) {
  const allMissions = useMissions();
  const areas = useAreas();
  const sensors = usePlanSensors();
  const [confirming, setConfirming] = useState(false);

  const own = allMissions.filter((m) => m.journeyId === journey.id).sort(byJourneyOrder);
  const { done, total } = journeyStats(journey, allMissions);
  const ids = own.map((m) => m.id);
  const idsKey = ids.join(',');
  const [order, setOrder] = useState(ids);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setOrder(ids), [idsKey]);
  const byId = new Map(own.map((m) => [m.id, m]));
  const ordered = order.map((id) => byId.get(id)).filter((m): m is Mission => m !== undefined);
  const nextOrder = own.reduce((mx, m) => Math.max(mx, (m.journeyOrder ?? -1) + 1), 0);
  const inactive = journey.status !== 'active';

  const edit = (changes: Partial<Journey>) => safeRun(patch<Journey>('journeys', journey.id, changes));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    setOrder(next);
    safeRun(Promise.all(next.map((id, i) =>
      (byId.get(id)?.journeyOrder !== i ? updateMission(id, { journeyOrder: i }) : undefined))));
  };

  const finish = () => safeRun(async () => {
    const { xp } = await completeJourney(journey.id);
    setConfirming(false);
    useToast.getState().show(xp > 0 ? `Jornada concluída · +${xp} XP` : 'Jornada concluída');
    void useCompanion.getState().say('complete');
  });

  return (
    <section className="screen stack">
      <Link href="/planejar?aba=jornadas" className="journey-detail__back">← Jornadas</Link>
      <h1 className="journey-detail__title">{journey.title}</h1>
      {journey.outcome && <p className="journey-detail__outcome">{journey.outcome}</p>}
      {inactive && <p className="muted">Esta jornada está {journey.status === 'done' ? 'concluída' : 'arquivada'}.</p>}

      <ProgressBar value={done} max={total} label={total > 0 ? `${done}/${total} missões` : 'Sem missões ainda'} />
      <JourneyPracticeLink journeyId={journey.id} />

      <div>
        <h2 className="section-title">Missões</h2>
        {ordered.length === 0 && <p className="muted">Adicione a primeira missão abaixo. Só a próxima aparece na tela Agora.</p>}
        {ordered.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}
            accessibility={{ screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS } }}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <ul className="journey-list" aria-label="Missões da jornada">
                {ordered.map((m) => <MissionItem key={m.id} mission={m} />)}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <AddMission journey={journey} nextOrder={nextOrder} />

      <details className="journey-detail__edit">
        <summary>Editar título, resultado e área</summary>
        <Panel variant="stone" className="journey-detail__fields">
          <EditableField label="Título" value={journey.title} required onSave={(v) => edit({ title: v })} />
          <EditableField label="Resultado esperado" value={journey.outcome} multiline
            placeholder="O que estará pronto no fim?" onSave={(v) => edit({ outcome: v || undefined })} />
          <fieldset className="attr">
            <legend className="field__label">Área</legend>
            <div className="cluster">
              <Chip selected={!journey.areaId} onClick={() => edit({ areaId: undefined })}>Sem área</Chip>
              {areas.map((a) => (
                <Chip key={a.id} selected={journey.areaId === a.id} onClick={() => edit({ areaId: a.id })}>{a.name}</Chip>
              ))}
            </div>
          </fieldset>
        </Panel>
      </details>

      <div className="journey-detail__actions">
        {journey.status === 'active' ? (
          <>
            <Button variant="primary" icon="check" onClick={() => setConfirming(true)}>Concluir jornada</Button>
            <Button onClick={() => { edit({ status: 'archived' }); useToast.getState().show('Jornada arquivada.'); }}>Arquivar</Button>
          </>
        ) : (
          <Button onClick={() => edit({ status: 'active' })}>Reativar jornada</Button>
        )}
        {confirming && (
          <div className="journey-detail__confirm" role="group" aria-label="Confirmar conclusão">
            <p>
              Concluir esta jornada?
              {total > done ? ` Ainda há ${total - done} ${total - done === 1 ? 'missão aberta' : 'missões abertas'}.` : ''}
            </p>
            <div className="cluster">
              <Button variant="primary" onClick={finish}>Sim, concluir</Button>
              <Button onClick={() => setConfirming(false)}>Cancelar</Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** `/jornadas/:id`: edit the journey, order its missions, add more, conclude or archive. */
export function JourneyDetail({ id }: { id: string }) {
  const loaded = useLiveQuery(async () => ({ id, journey: await db.journeys.get(id) }), [id]);
  if (!loaded || loaded.id !== id) return <section className="screen"><p className="muted">Carregando…</p></section>;
  const journey = loaded.journey;
  if (!journey || journey.deleted) {
    return (
      <section className="screen stack">
        <Link href="/planejar?aba=jornadas" className="journey-detail__back">← Jornadas</Link>
        <Panel variant="stone"><p>Jornada não encontrada.</p></Panel>
      </section>
    );
  }
  return <JourneyBody journey={journey} />;
}
