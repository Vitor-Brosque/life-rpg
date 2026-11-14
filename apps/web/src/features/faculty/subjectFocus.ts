import { useMemo } from 'react';
import { subjectHead } from '@life/shared';
import { useCurrentBlock, useDayState, useMissions } from '../../db/hooks';

/** The head mission of the subject chosen with "Usar" for the current block, if any. */
export function useSubjectFocusId(): string | undefined {
  const current = useCurrentBlock();
  const state = useDayState();
  const missions = useMissions();
  const pick = current ? state?.subjectPicks?.[current.block.id] : undefined;
  return useMemo(() => (pick ? subjectHead(missions, pick)?.id : undefined), [pick, missions]);
}
