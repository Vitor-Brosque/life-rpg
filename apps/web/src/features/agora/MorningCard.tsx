import type { DayKey, Mission } from '@life/shared';
import { MonthCard } from '../patterns/MonthCard';
import type { MonthCycle } from '../patterns/monthCycle';
import { WeekCard } from '../week/WeekCard';
import type { WeekCycle } from '../week/weekCycle';
import { pickDayMode } from './blockFeedback';
import { DayTypeCard } from './DayTypeCard';
import { ReviewSheet } from './ReviewSheet';
import type { DayType } from './useAgoraData';

export interface MorningCardProps {
  today: DayKey;
  dayType: DayType;
  cycle: WeekCycle;
  month: MonthCycle;
  review: { show: boolean; items: Mission[]; close(): void };
}

/**
 * One morning card at a time above the block banner, so the main action stays in reach:
 * "Como está hoje?" first, then "Nova semana" (Monday/Tuesday), then last month's reflection
 * (days 1–7), then the quick review. Each one waits for the one before it.
 */
export function MorningCard({ today, dayType, cycle, month, review }: MorningCardProps) {
  if (!dayType.asked && !dayType.weekend) return <DayTypeCard onPick={pickDayMode} />;
  // "Fim de semana sem cobrança": leftovers wait for the next workday.
  const reviewCard = review.show && dayType.mode !== 'free'
    ? <ReviewSheet missions={review.items} today={today} onClose={review.close} />
    : null;
  const next = month.show && month.month ? <MonthCard cycle={month} /> : reviewCard;
  if (cycle.showCard && cycle.weekId) {
    return (
      <WeekCard today={today} weekId={cycle.weekId} collapsed={!cycle.started} onStart={cycle.start}
        onLater={cycle.later} onDone={cycle.finish} fallback={next} />
    );
  }
  return next;
}
