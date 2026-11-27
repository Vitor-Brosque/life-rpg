import { useEffect, useId, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation } from 'wouter';
import { create } from 'zustand';
import type { Mission } from '@life/shared';
import { dayKeyOf, missionSketchId } from '@life/shared';
import { db } from '../../db/db';
import { useAreas, useJourneys, useRoutineBlocks, useToday } from '../../db/hooks';
import { deleteMission, updateMission } from '../../domain/actions';
import { ensureMissionSketch } from '../../domain/sketchActions';
import { Button } from '../../ui/Button';
import { plural } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { PurposeChainLine } from '../journeys/PurposeChain';
import { startWithCheckin } from '../agora/startWithCheckin';
import { ChecklistEditor } from './ChecklistEditor';
import { EditableField } from './EditableField';
import { MissionAttributes } from './MissionAttributes';
import { MissionResult } from './MissionResult';
import { usePartialSheet } from './PartialSheet';
import {
  completeWithFeedback, dropWithFeedback, reopenMission, splitWithFeedback,
} from './missionFeedback';
import { useTimerBridge } from './timerBridge';
import './mission.css';

interface MissionSheetStore { openId?: string; open(id: string): void; close(): void }

/** Global "ficha da missão" opener (Agora, Hoje, Planejar, Jornadas...). */
export const useMissionSheet = create<MissionSheetStore>((set) => ({
  openId: undefined,
  open: (id) => set({ openId: id }),
  close: () => set({ openId: undefined }),
}));

/** Mount once (App). */
export function MissionSheetHost() {
  const openId = useMissionSheet((s) => s.openId);
  const close = useMissionSheet((s) => s.close);
  return <MissionSheet missionId={openId} onClose={close} />;
}

export interface MissionSheetProps { missionId?: string; onClose(): void }

export function MissionSheet({ missionId, onClose }: MissionSheetProps) {
  // Tagged with the id: right after `missionId` changes, useLiveQuery still returns the previous
  // result, which must not be mistaken for "this mission is gone".
  const result = useLiveQuery(
    async () => (missionId ? { id: missionId, mission: await db.missions.get(missionId) } : undefined),
    [missionId],
  );
  const loaded = result !== undefined && result.id === missionId;
  const mission = loaded ? result.mission : undefined;
  const gone = loaded && (!mission || mission.deleted);
  useEffect(() => { if (gone) onClose(); }, [gone, onClose]);
  const open = !!mission && !mission.deleted;
  return (
    <Sheet open={open} onClose={onClose} title="Missão">
      {open && <MissionSheetBody key={mission.id} mission={mission} onClose={onClose} />}
    </Sheet>
  );
}

/** "Lousa da missão" (spec §6.3): opens the mission's lousa, creating it when missing. */
function MissionSketchButton({ missionId, onOpen }: { missionId: string; onOpen(): void }) {
  const [location, navigate] = useLocation();
  const strokes = useLiveQuery(async () => {
    const s = await db.sketches.get(missionSketchId(missionId));
    return s && !s.deleted && Array.isArray(s.strokes) ? s.strokes.length : 0;
  }, [missionId]);
  const open = (): void => safeRun(async () => {
    const s = await ensureMissionSketch(missionId);
    onOpen();
    if (location === `/lousa/${s.id}`) return; // already on it (opened from the lousa): just close
    navigate(`/lousa/${s.id}?voltar=${encodeURIComponent(location)}`);
  });
  return (
    <div className="mission-sheet__sketch">
      <Button onClick={open}>Lousa da missão</Button>
      {!!strokes && <span className="muted">{plural(strokes, 'traço', 'traços')}</span>}
    </div>
  );
}

const STATUS_TAG: Partial<Record<Mission['status'], string>> = {
  doing: 'Em andamento', done: 'Concluída', dropped: 'Solta',
};

function MissionSheetBody({ mission, onClose }: { mission: Mission; onClose(): void }) {
  const today = useToday() ?? dayKeyOf(Date.now(), 4);
  const areas = useAreas().filter((a) => !a.archived || a.id === mission.areaId);
  const journeys = useJourneys();
  // Archived blocks too: a mission still assigned to one must show it (and be able to leave it).
  const blocks = useRoutineBlocks() ?? [];
  const startTimer = useTimerBridge((s) => s.start);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hintId = useId();
  const live = mission.status === 'open' || mission.status === 'doing';
  const finished = mission.status === 'done' || mission.status === 'dropped';
  const set = (changes: Partial<Mission>) => safeRun(updateMission(mission.id, changes));
  const tag = STATUS_TAG[mission.status];

  const run = (fn: () => Promise<unknown>, close = false) => () => {
    safeRun(async () => {
      await fn();
      if (close) onClose();
    });
  };

  return (
    <div className="mission-sheet">
      {tag && (
        <p className="mission-sheet__status">
          <span className="tag tag--stone">{tag}</span>
          {finished && (
            <Button size="sm" onClick={run(() => reopenMission(mission.id))}>Reabrir</Button>
          )}
        </p>
      )}
      <PurposeChainLine journeyId={mission.journeyId} className="mission-sheet__chain" />
      <EditableField label="Título" value={mission.title} required className="field--title"
        onSave={(title) => set({ title })} />
      <EditableField label="Primeiro passo" value={mission.firstStep} placeholder="A menor ação para começar"
        onSave={(v) => set({ firstStep: v || undefined })} />
      <MissionResult mission={mission} />

      {live && (
        <div className="mission-sheet__actions">
          {mission.status === 'open' && (
            <Button variant="primary" icon="play" onClick={run(() => startWithCheckin(mission.id))}>Começar</Button>
          )}
          <Button icon="check" onClick={run(() => completeWithFeedback(mission.id), true)}>Concluir</Button>
          {/* An avaliação is an event with a date: no postpone offer (its day is the deadline). */}
          {mission.status === 'doing' && !mission.assessment && (
            <Button icon="pause" onClick={() => { onClose(); usePartialSheet.getState().open(mission.id); }}>Parcial</Button>
          )}
          {startTimer && (
            <Button icon="timer" onClick={() => { startTimer(mission.id); onClose(); }}>Cronômetro</Button>
          )}
        </div>
      )}

      <ChecklistEditor mission={mission} />
      <EditableField label="Notas" value={mission.notes} multiline placeholder="Detalhes, links, ideias…"
        onSave={(v) => set({ notes: v || undefined })} />
      <MissionSketchButton missionId={mission.id} onOpen={onClose} />
      <MissionAttributes mission={mission} areas={areas} journeys={journeys} today={today} blocks={blocks} />

      <div className="mission-sheet__danger">
        {live && (
          <>
            <Button icon="journey" disabled={mission.checklist.length === 0}
              aria-describedby={mission.checklist.length === 0 ? hintId : undefined}
              onClick={run(() => splitWithFeedback(mission.id), true)}>
              Dividir em jornada
            </Button>
            {mission.checklist.length === 0 && (
              <p id={hintId} className="mission-sheet__hint">Adicione passos ao checklist para dividir.</p>
            )}
            <Button variant="ghost" icon="drop" onClick={run(() => dropWithFeedback(mission.id), true)}>Soltar</Button>
          </>
        )}
        {confirmDelete ? (
          <div className="mission-sheet__confirm" role="group" aria-label="Confirmar exclusão">
            <p>Excluir esta missão de vez?</p>
            <div className="cluster">
              <Button variant="danger" onClick={run(() => deleteMission(mission.id), true)}>Sim, excluir</Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" icon="close" onClick={() => setConfirmDelete(true)}>Excluir</Button>
        )}
      </div>
    </div>
  );
}
