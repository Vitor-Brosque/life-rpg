import { MealRow } from '../casa/MealRow';
import { SleepRow } from '../corpo/SleepRow';
import '../corpo/corpo.css';

/**
 * "Cuidados" (Marco 4): the day's sleep tap and the planned meal, right under the status strip.
 * Each row hides itself when it has nothing to offer; the strip then takes no space (:empty).
 */
export function CareStrip({ now, inCommitment }: { now: number; inCommitment: boolean }) {
  return (
    <div className="care-strip">
      <SleepRow now={now} inCommitment={inCommitment} />
      <MealRow />
    </div>
  );
}
