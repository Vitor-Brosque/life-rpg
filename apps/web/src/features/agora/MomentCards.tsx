import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { DayKey, Mission, MomentKind } from '@life/shared';
import { MOMENT_HINT, MOMENT_TITLE, monthName, pickMoment } from '@life/shared';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { DayCloseCard } from '../dayClose/DayCloseCard';
import { useDayCloseDue } from '../dayClose/useDayClose';
import { MonthCard } from '../patterns/MonthCard';
import type { MonthCycle } from '../patterns/monthCycle';
import { WeekCard } from '../week/WeekCard';
import type { WeekCycle } from '../week/weekCycle';
import { useWeekCardData } from '../week/weekData';
import { pickDayMode } from './blockFeedback';
import { DayTypeCard } from './DayTypeCard';
import { ReviewSheet } from './ReviewSheet';
import type { DayType } from './useAgoraData';

interface MomentSession { day?: DayKey; chosen?: MomentKind }

/** The card he brought up from "Mais para hoje": this app session and this day only, never persisted. */
export const useMomentSession = create<MomentSession>(() => ({ day: undefined, chosen: undefined }));
export const chooseMoment = (day: DayKey, kind: MomentKind): void => useMomentSession.setState({ day, chosen: kind });

const FIRST_CONTROL = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * Focuses the first control inside `slot` once it shows: the card brought up may still be reading its data (the Nova semana
 * renders nothing until then). Only while focus is still where the sheet left it (`opener`, "Mais para hoje") or nowhere:
 * if he moved on to something else, that is where he stays. Gives up after 3 s, never leaving focus on <body>.
 * Returns the cancel function (the timer and the observer go with the component).
 */
export function focusInto(slot: HTMLElement | null, opener: () => HTMLElement | null): () => void {
  if (!slot || typeof MutationObserver === 'undefined') return () => {};
  let observer: MutationObserver | undefined;
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    clearTimeout(start);
    clearTimeout(giveUp);
    observer?.disconnect();
  };
  /** True when there is nothing more to wait for (focused, or he went elsewhere). */
  const attempt = (): boolean => {
    const a = document.activeElement;
    if (a && a !== document.body && a !== opener() && !slot.contains(a)) return true;
    const el = slot.querySelector<HTMLElement>(FIRST_CONTROL);
    el?.focus();
    return el !== null;
  };
  // After the click's render (the new card is in the slot, or loading) and after the sheet gave focus back.
  const start = setTimeout(() => {
    if (attempt()) return;
    observer = new MutationObserver(() => { if (attempt()) stop(); });
    observer.observe(slot, { childList: true, subtree: true });
    giveUp = setTimeout(stop, 3000);
  }, 0);
  return stop;
}

export interface MomentCardsProps {
  today: DayKey;
  now: number;
  dayType: DayType;
  cycle: WeekCycle;
  month: MonthCycle;
  review: { show: boolean; items: Mission[]; close(): void };
}

/**
 * At most one "moment" card above the current block (Agora and the Painel's Agora column): Como foi hoje? (in its window),
 * Como está hoje?, Nova semana, last month's reflection, the quick review. Each card keeps its own rule; this only picks
 * which one is on screen. The others wait behind "Mais para hoje (N)". Nothing here writes.
 */
export function MomentCards({ today, now, dayType, cycle, month, review }: MomentCardsProps) {
  const closeDue = useDayCloseDue(today, dayType.mode, now);
  // Read only while the week card is offered: a card with nothing to ask (no numbers, no main block) is not a moment.
  const weekData = useWeekCardData(today, cycle.showCard ? cycle.weekId : undefined);
  const chosen = useMomentSession((s) => (s.day === today ? s.chosen : undefined));
  const [moreOpen, setMoreOpen] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const cancelFocus = useRef<() => void>(() => {});
  useEffect(() => () => cancelFocus.current(), []);

  const weekEmpty = !!weekData && !weekData.stats && weekData.groups.length === 0;
  const due: MomentKind[] = [];
  if (closeDue) due.push('fechamento');
  if (!dayType.asked && !dayType.weekend) due.push('tipo');
  if (cycle.showCard && cycle.weekId && !weekEmpty) due.push('semana');
  if (month.show && month.month) due.push('mes');
  if (review.show && dayType.mode !== 'free') due.push('revisao');
  const { shown, more } = pickMoment(due, chosen);
  if (!shown) return null;

  const title = (k: MomentKind): string => (k === 'mes' && month.month ? `Reflexão de ${monthName(month.month)}` : MOMENT_TITLE[k]);
  const bringUp = (k: MomentKind) => {
    chooseMoment(today, k);
    setMoreOpen(false);
    // The sheet gives focus back to "Mais para hoje"; then it moves into the card brought up.
    cancelFocus.current();
    cancelFocus.current = focusInto(slotRef.current, () => moreRef.current);
  };

  return (
    <>
      <div ref={slotRef} className="moment-slot">
        {shown === 'fechamento' && <DayCloseCard today={today} mode={dayType.mode} now={now} />}
        {shown === 'tipo' && <DayTypeCard onPick={pickDayMode} />}
        {shown === 'semana' && cycle.weekId && (
          <WeekCard today={today} weekId={cycle.weekId} collapsed={!cycle.started} onStart={cycle.start}
            onLater={cycle.later} onDone={cycle.finish} />
        )}
        {shown === 'mes' && <MonthCard cycle={month} />}
        {shown === 'revisao' && <ReviewSheet missions={review.items} today={today} onClose={review.close} />}
      </div>
      {more.length > 0 && (
        <div className="moment-more">
          <Button ref={moreRef} size="sm" variant="ghost" onClick={() => setMoreOpen(true)}>{`Mais para hoje (${more.length})`}</Button>
        </div>
      )}
      <Sheet open={moreOpen && more.length > 0} onClose={() => setMoreOpen(false)} title="Mais para hoje">
        <p className="muted moment-sheet__intro">Um card por vez no Agora. Escolha outro para trazer para cima; o que estava lá vem para cá.</p>
        <ul className="moment-list">
          {more.map((k) => (
            <li key={k}>
              <button type="button" className="moment-list__item" onClick={() => bringUp(k)}>
                <span className="moment-list__title">{title(k)}</span>
                <span className="moment-list__hint">{MOMENT_HINT[k]}</span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}
