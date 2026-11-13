import { useState } from 'react';
import { Link } from 'wouter';
import type { BlockOccurrence, DayMode, Mission } from '@life/shared';
import { PRACTICE_LIMITS, practicePrompt } from '@life/shared';
import { useToday } from '../../db/hooks';
import { NewPracticeSheet } from './NewPracticeSheet';
import { usePracticeSessions } from './practiceData';
import './practice.css';

export interface PracticePromptProps {
  mode: DayMode;
  /** Today's current block occurrence. */
  current?: Pick<BlockOccurrence, 'block'>;
  /** The mission in focus (timer or main card): it prefills a new session when it is of the block's journey. */
  focusMission?: Pick<Mission, 'id' | 'journeyId'>;
}

/** The Agora's discreet practice line (spec §5.6): resume the open session of the block's journey, or start one. */
export function PracticePrompt({ mode, current, focusMission }: PracticePromptProps) {
  const sessions = usePracticeSessions();
  const today = useToday();
  const [creating, setCreating] = useState(false);
  const block = current?.block;
  if (!sessions || !block) return null;
  const prompt = practicePrompt({ mode, block: { kind: block.kind, journeyId: block.journeyId }, sessions, ...(today ? { today } : {}) });
  if (!prompt) return null;

  if (prompt.kind === 'resume') {
    const s = prompt.session;
    return (
      <p className="practice-line">
        <Link href={`/pratica/${s.id}?voltar=%2F`}>Retomar prática: {s.title}</Link>
        {s.nextAction && <span className="practice-line__note"> · {s.nextAction}</span>}
      </p>
    );
  }

  const missionId = focusMission && block.journeyId && focusMission.journeyId === block.journeyId ? focusMission.id : undefined;
  return (
    <>
      <p className="practice-line">
        <button type="button" className="practice__link" onClick={() => setCreating(true)}>Sessão de prática</button>
        {prompt.firstAction && <span className="practice-line__note"> · próxima ação: {prompt.firstAction}</span>}
      </p>
      <NewPracticeSheet open={creating} onClose={() => setCreating(false)} from="/" journeyId={block.journeyId ?? null}
        {...(missionId ? { missionId } : {})}
        {...(prompt.firstAction ? { title: prompt.firstAction.slice(0, PRACTICE_LIMITS.title) } : {})} />
    </>
  );
}
