import { useLiveQuery } from 'dexie-react-hooks';
import type { Mission } from '@life/shared';
import { latestResult } from '@life/shared';
import { db } from '../../db/db';
import { noteResult } from '../../domain/missionActions';
import { safeRun } from '../../ui/safeRun';
import { EditableField } from './EditableField';

/**
 * "O que saiu?" on the mission sheet: a concluded mission takes one optional line (append-only
 * `result` events, the newest counts); a live mission shows the last "Parcial", when there is one.
 */
export function MissionResult({ mission }: { mission: Mission }) {
  const events = useLiveQuery(() => db.events.where('missionId').equals(mission.id).toArray(), [mission.id]);
  if (mission.status === 'done') {
    return (
      <EditableField label="O que saiu?" value={events ? latestResult(events, mission.id)?.result : undefined}
        placeholder="Uma linha: o que ficou pronto" onSave={(v) => safeRun(noteResult(mission.id, v))} />
    );
  }
  if (mission.status === 'open' || mission.status === 'doing') {
    const partial = events ? latestResult(events, mission.id, ['partial']) : undefined;
    if (partial) return <p className="mission-sheet__hint">{`Última parcial: ${partial.result}`}</p>;
  }
  return null;
}
