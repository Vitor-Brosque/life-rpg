import { useEffect, useId, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { create } from 'zustand';
import type { Mission } from '@life/shared';
import { dayKeyOf } from '@life/shared';
import { db } from '../../db/db';
import { useAreas, useBlocks, useJourneys, useToday } from '../../db/hooks';
import { deleteMission, updateMission } from '../../domain/actions';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { ChecklistEditor } from './ChecklistEditor';
import { EditableField } from './EditableField';
import { MissionAttributes } from './MissionAttributes';
import {
  completeWithFeedback, dropWithFeedback, reopenMission, splitWithFeedback, startWithFeedback,
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

const STATUS_TAG: Partial<Record<Mission['status'], string>> = {
  doing: 'Em andamento', done: 'Concluída', dropped: 'Solta',
};

function MissionSheetBody({ mission, onClose }: { mission: Mission; onClose(): void }) {
  const today = useToday() ?? dayKeyOf(Date.now(), 4);
  const areas = useAreas().filter((a) => !a.archived || a.id === mission.areaId);
  const journeys = useJourneys();
  const blocks = useBlocks();
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
      <EditableField label="Título" value={mission.title} required className="field--title"
        onSave={(title) => set({ title })} />
      <EditableField label="Primeiro passo" value={mission.firstStep} placeholder="A menor ação para começar"
        onSave={(v) => set({ firstStep: v || undefined })} />

      {live && (
        <div className="mission-sheet__actions">
          {mission.status === 'open' && (
            <Button variant="primary" icon="play" onClick={run(() => startWithFeedback(mission.id))}>Começar</Button>
          )}
          <Button icon="check" onClick={run(() => completeWithFeedback(mission.id), true)}>Concluir</Button>
          {startTimer && (
            <Button icon="timer" onClick={() => { startTimer(mission.id); onClose(); }}>Cronômetro</Button>
          )}
        </div>
      )}

      <ChecklistEditor mission={mission} />
      <EditableField label="Notas" value={mission.notes} multiline placeholder="Detalhes, links, ideias…"
        onSave={(v) => set({ notes: v || undefined })} />
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
