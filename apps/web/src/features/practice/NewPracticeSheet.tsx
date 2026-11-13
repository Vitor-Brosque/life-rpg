import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ID } from '@life/shared';
import { PRACTICE_LIMITS } from '@life/shared';
import { db } from '../../db/db';
import { createPracticeSession } from '../../domain/practiceActions';
import { findTechJourney } from '../../domain/routineDefaults';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { JourneyMissionPicker } from './PracticeFields';

export interface NewPracticeSheetProps {
  open: boolean;
  onClose(): void;
  /** Where the new session's "← Voltar" goes. */
  from: string;
  /** Absent: the Tech News journey (if any). null: no journey. */
  journeyId?: ID | null;
  missionId?: ID;
  title?: string;
}

type Links = { journeyId?: ID; missionId?: ID };

/** "Nova sessão de prática" (spec §5.5): one line, journey and mission, Começar. */
export function NewPracticeSheet(props: NewPracticeSheetProps) {
  return (
    <Sheet open={props.open} onClose={props.onClose} title="Nova sessão de prática" placement="top">
      {props.open && <NewPracticeForm {...props} />}
    </Sheet>
  );
}

function NewPracticeForm({ onClose, from, journeyId, missionId, title }: NewPracticeSheetProps) {
  const [, navigate] = useLocation();
  // undefined while loading (unlike useJourneys, which gives [] then): the default needs the real list.
  const journeys = useLiveQuery(() => db.journeys.toArray());
  const [text, setText] = useState(title ?? '');
  const [links, setLinks] = useState<Links | undefined>(
    journeyId !== undefined ? { ...(journeyId ? { journeyId } : {}), ...(missionId ? { missionId } : {}) } : undefined,
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (links === undefined && journeys) setLinks({ journeyId: findTechJourney(journeys)?.id });
  }, [links, journeys]);

  const start = (): void => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    // The form goes away with the navigation: focus follows to the new screen's heading.
    focusWhenGone(document.activeElement);
    safeRun(createPracticeSession({
      title: t, ...(links?.journeyId ? { journeyId: links.journeyId } : {}), ...(links?.missionId ? { missionId: links.missionId } : {}),
    }).then((s) => {
      onClose();
      navigate(`/pratica/${s.id}?voltar=${encodeURIComponent(from)}`);
    }).finally(() => setBusy(false)));
  };

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); start(); }}>
      <label className="field practice-field">
        <span className="field__label">Sobre o que é?</span>
        <input type="text" value={text} maxLength={PRACTICE_LIMITS.title} placeholder="ex.: remover notícias repetidas pela URL"
          enterKeyHint="go" autoFocus onChange={(e) => setText(e.target.value)} />
      </label>
      {links && <JourneyMissionPicker journeyId={links.journeyId} missionId={links.missionId} onChange={setLinks} />}
      <Button type="submit" variant="primary" disabled={!text.trim() || busy}>Começar</Button>
    </form>
  );
}
