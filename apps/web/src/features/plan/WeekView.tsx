import { useMemo, useState } from 'react';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import type { Commitment, DayKey, Mission } from '@life/shared';
import { addDays } from '@life/shared';
import { Button } from '../../ui/Button';
import { useMediaQuery } from '../../ui/useMediaQuery';
import { moveToDay, reorderDay } from '../../domain/actions';
import { useCaptureStore } from '../capture/CaptureBar';
import { useMissionSheet } from '../mission/MissionSheet';
import { CommitmentSheet } from './CommitmentSheet';
import { DayContainer } from './DayContainer';
import {
  backlogMissions, dayLabel, DRAG_INSTRUCTIONS, missionsOnDay, occurrencesOn, planCollision, usePlanData,
  usePlanSensors,
} from './planShared';
import { WeekStrip } from './WeekStrip';

export const WIDE_QUERY = '(min-width: 1200px)';
const BACKLOG = 'backlog';
const dayId = (d: DayKey) => `day:${d}`;

interface SheetState { commitment?: Commitment; date: DayKey }

/** "Semana": 7 days from today (strip + list on phones, 7 columns on wide screens) and the backlog. */
export function WeekView() {
  const { today, missions, commitments, areas } = usePlanData();
  const wide = useMediaQuery(WIDE_QUERY);
  const sensors = usePlanSensors();
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<DayKey>();
  const [sheet, setSheet] = useState<SheetState>();

  const start = today ? addDays(today, offset * 7) : undefined;
  const days = useMemo(() => (start ? Array.from({ length: 7 }, (_, i) => addDays(start, i)) : []), [start]);
  const selected = picked && days.includes(picked) ? picked : days[0];

  if (!today || !start || !selected) return <p className="muted">Carregando…</p>;

  const lists = new Map<string, Mission[]>(days.map((d) => [dayId(d), missionsOnDay(missions, d)]));
  lists.set(BACKLOG, backlogMissions(missions));
  const counts = new Map(days.map((d) => [d, (lists.get(dayId(d))?.length ?? 0) + occurrencesOn(commitments, d).length]));

  const shift = (weeks: number) => { setOffset((o) => o + weeks); setPicked(undefined); };
  const openMission = (m: Mission) => useMissionSheet.getState().open(m.id);
  const onMove = (m: Mission, day: DayKey | null) => { void moveToDay(m.id, day); };
  const capture = (day: DayKey) => useCaptureStore.getState().open({ defaultDate: day });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const containerOf = (id: string) =>
      lists.has(id) ? id : [...lists].find(([, ms]) => ms.some((m) => m.id === id))?.[0];
    const from = containerOf(activeId);
    const to = containerOf(overId);
    if (!from || !to || activeId === overId) return;
    const ids = (lists.get(to) ?? []).map((m) => m.id);
    const overIsItem = overId !== to;
    let next: string[];
    if (from === to) {
      if (!overIsItem) return;
      next = arrayMove(ids, ids.indexOf(activeId), ids.indexOf(overId));
    } else {
      next = ids.filter((id) => id !== activeId);
      next.splice(overIsItem ? next.indexOf(overId) : next.length, 0, activeId);
    }
    if (to === BACKLOG) {
      if (from !== BACKLOG) void moveToDay(activeId, null);
    } else {
      void reorderDay(next, to.slice('day:'.length));
    }
  };

  const dayBox = (d: DayKey) => (
    <DayContainer
      key={d}
      id={dayId(d)}
      label={dayLabel(d)}
      heading={<>{dayLabel(d)}{d === today && <span className="day-box__today"> · hoje</span>}</>}
      missions={lists.get(dayId(d)) ?? []}
      commitments={occurrencesOn(commitments, d)}
      areas={areas}
      today={today}
      emptyText="Nada planejado."
      onOpen={openMission}
      onMove={onMove}
      onOpenCommitment={(o) => setSheet({ commitment: o.commitment, date: d })}
      actions={(
        <>
          <Button size="sm" icon="plus" onClick={() => capture(d)}>Missão neste dia</Button>
          <Button size="sm" icon="calendar" onClick={() => setSheet({ date: d })}>Compromisso</Button>
        </>
      )}
    />
  );

  return (
    <div className="week">
      <WeekStrip
        days={days}
        today={today}
        selected={selected}
        counts={counts}
        onSelect={setPicked}
        onShift={shift}
        showStrip={!wide}
        onReset={offset !== 0 ? () => { setOffset(0); setPicked(undefined); } : undefined}
      />
      <DndContext
        sensors={sensors}
        collisionDetection={planCollision}
        onDragEnd={onDragEnd}
        accessibility={{ screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS } }}
      >
        {wide ? (
          <div className="week__columns">{days.map((d) => dayBox(d))}</div>
        ) : (
          dayBox(selected)
        )}
        <DayContainer
          id={BACKLOG}
          label="Sem data"
          heading="Sem data"
          missions={lists.get(BACKLOG) ?? []}
          areas={areas}
          today={today}
          emptyText="Nada sem data. Capturas sem dia ficam aqui."
          className="day-box--backlog"
          onOpen={openMission}
          onMove={onMove}
        />
      </DndContext>
      <CommitmentSheet
        open={sheet !== undefined}
        commitment={sheet?.commitment}
        defaultDate={sheet?.date ?? today}
        onClose={() => setSheet(undefined)}
      />
    </div>
  );
}
