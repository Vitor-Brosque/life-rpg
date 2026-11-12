import type { IntervalPreview, Rating } from '@life/shared';
import { useMediaQuery } from '../../ui/useMediaQuery';

const LABELS: Record<Rating, string> = { 1: 'Errei', 2: 'Difícil', 3: 'Bom', 4: 'Fácil' };
const RATINGS: Rating[] = [1, 2, 3, 4];

/** Errei · Difícil · Bom · Fácil with the next interval under each (no red: forgetting is normal). */
export function RatingBar({ previews, onRate, disabled, suggested }: {
  previews: Record<Rating, IntervalPreview>; onRate(r: Rating): void; disabled?: boolean; suggested?: Rating;
}) {
  const touch = useMediaQuery('(pointer: coarse)');
  return (
    <div className="rating" role="group" aria-label="Como foi?">
      {RATINGS.map((r) => (
        <button key={r} type="button" disabled={disabled}
          className={['rating__btn', r === 3 && 'rating__btn--good', r === suggested && 'rating__btn--suggested'].filter(Boolean).join(' ')}
          aria-label={`${LABELS[r]}, próxima revisão em ${previews[r].long}${r === suggested ? ', sugerido' : ''}`}
          aria-keyshortcuts={String(r)} onClick={() => onRate(r)}>
          <span className="rating__label">{LABELS[r]}</span>
          <span className="rating__interval">{previews[r].short}</span>
          {!touch && <kbd className="rating__key" aria-hidden="true">{r}</kbd>}
        </button>
      ))}
    </div>
  );
}
