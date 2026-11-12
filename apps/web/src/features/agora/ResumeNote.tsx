import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKey, ID } from '@life/shared';
import { Icon } from '../../art/icons';
import { lastNextAction } from '../../domain/actions';
import './blocks.css';

/** Next action of the block's most recent earlier session (re-read when sessions change). */
export function useResumeNote(blockId: ID | undefined, today: DayKey | undefined): string | undefined {
  return useLiveQuery(
    async () => (blockId && today ? lastNextAction(blockId, today) : undefined),
    [blockId, today],
  ) ?? undefined;
}

export interface ResumeNoteProps {
  /** `useResumeNote(currentBlock.id, today)`; nothing renders without it. */
  text?: string;
  className?: string;
}

/** "Onde você parou: …" — where to pick the block up, written at the end of the last session. */
export function ResumeNote({ text, className }: ResumeNoteProps) {
  const note = text?.trim();
  if (!note) return null;
  return (
    <p role="note" aria-label="Onde você parou" className={className ? `resume-note ${className}` : 'resume-note'}>
      <Icon name="book" size={24} className="resume-note__icon" />
      <span className="resume-note__body">
        <span className="resume-note__label">Onde você parou:</span>
        {' '}
        {note}
      </span>
    </p>
  );
}
