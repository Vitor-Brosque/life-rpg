import { useMemo } from 'react';
import { subjectHead } from '@life/shared';
import { useCurrentBlock, useDayState, useJourneys, useMissions, validPick } from '../../db/hooks';

/** The head mission of the subject chosen with "Usar" for the current block, while it is an active subject. */
export function useSubjectFocusId(): string | undefined {
  const current = useCurrentBlock();
  const state = useDayState();
  const missions = useMissions();
  const journeys = useJourneys();
  const stored = current ? state?.subjectPicks?.[current.block.id] : undefined;
  const pick = validPick(stored, journeys);
  return useMemo(() => (pick ? subjectHead(missions, pick)?.id : undefined), [pick, missions]);
}
