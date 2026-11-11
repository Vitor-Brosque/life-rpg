import { useEffect, useId, useRef, useState } from 'react';
import type { DayKey, Mission } from '@life/shared';
import { addDays } from '@life/shared';
import { finishReview, rescheduleMission, updateMission } from '../../domain/actions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { formatDay, plural } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import { useToast } from '../../ui/Toast';
import { dropWithFeedback } from '../mission/missionFeedback';
import { ShrinkDialog } from './ShrinkDialog';

export const DROP_REASONS = ['não é mais importante', 'não depende de mim', 'já resolvido de outro jeito'];

export interface ReviewSheetProps {
  /** `needsReview(missions, today)`. */
  missions: Mission[];
  today: DayKey;
  /** "Pronto" (after finishing) or "Dispensar" (hide for this session). */
  onClose(): void;
}

const deadlinePassed = (m: Mission, today: DayKey) => m.deadline !== undefined && m.deadline < today;

function ReviewItem({ mission, today, onHandled, onShrink }: {
  mission: Mission; today: DayKey; onHandled(id: string): void; onShrink(m: Mission): void;
}) {
  const [mode, setMode] = useState<'pick' | 'drop'>();
  const [date, setDate] = useState(addDays(today, 1));
  const titleId = useId();
  const passed = deadlinePassed(mission, today);

  const act = (fn: () => Promise<unknown>) => () => {
    fn().then(() => onHandled(mission.id)).catch((e) => {
      console.error('review action failed', e);
      useToast.getState().show('Algo não funcionou. Tente de novo.');
    });
  };
  // Re-planning a mission whose hard deadline passed is a conscious decision: the old deadline goes.
  const moveTo = (day: DayKey) => act(async () => {
    await rescheduleMission(mission.id, day);
    if (passed) await updateMission(mission.id, { deadline: undefined });
  });

  return (
    <li className="review__item" role="group" aria-labelledby={titleId}>
      <div className="review__item-head">
        <span id={titleId} className="review__item-title">{mission.title}</span>
        {passed ? (
          <span className="tag tag--stone">prazo passou</span>
        ) : mission.date ? (
          <span className="review__item-when">planejada para {formatDay(mission.date, today)}</span>
        ) : null}
      </div>
      <div className="review__item-actions">
        <Button size="sm" onClick={moveTo(today)}>Hoje</Button>
        <Button size="sm" onClick={moveTo(addDays(today, 1))}>Amanhã</Button>
        <Button size="sm" aria-expanded={mode === 'pick'} onClick={() => setMode(mode === 'pick' ? undefined : 'pick')}>
          Escolher dia
        </Button>
        <Button size="sm" onClick={() => onShrink(mission)}>Encolher</Button>
        <Button size="sm" variant="ghost" aria-expanded={mode === 'drop'}
          onClick={() => setMode(mode === 'drop' ? undefined : 'drop')}>
          Soltar
        </Button>
      </div>
      {mode === 'pick' && (
        <div className="review__item-extra">
          <input type="date" aria-label={`Novo dia para ${mission.title}`} value={date} min={today}
            onChange={(e) => setDate(e.target.value)} />
          <Button size="sm" variant="primary" disabled={!date} onClick={moveTo(date)}>Mover</Button>
        </div>
      )}
      {mode === 'drop' && (
        <div className="review__item-extra" role="group" aria-labelledby={`${titleId}-reason`}>
          <span id={`${titleId}-reason`} className="review__extra-label">Motivo (opcional):</span>
          {DROP_REASONS.map((r) => (
            <Chip key={r} onClick={act(() => dropWithFeedback(mission.id, r))}>{r}</Chip>
          ))}
          <Chip onClick={act(() => dropWithFeedback(mission.id))}>só soltar</Chip>
        </div>
      )}
    </li>
  );
}

/** "Revisão rápida": decide, without guilt, what to do with what was left behind. */
export function ReviewSheet({ missions, today, onClose }: ReviewSheetProps) {
  const [handled, setHandled] = useState<ReadonlySet<string>>(new Set());
  const [shrinking, setShrinking] = useState<Mission>();
  const finished = useRef(false);
  const headingId = useId();
  const items = missions.filter((m) => !handled.has(m.id));

  const finish = async () => {
    if (finished.current) return;
    finished.current = true;
    const { xp } = await finishReview();
    if (xp > 0) useToast.getState().show(`Revisão feita · +${xp} XP`);
  };

  useEffect(() => {
    if (items.length === 0) finish().catch((e) => console.error('review failed', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const markHandled = (id: string) => setHandled((s) => new Set(s).add(id));

  return (
    <Panel variant="stone" role="region" aria-labelledby={headingId} className="review px-border--gold">
      <div className="review__head">
        <h2 id={headingId} className="review__title">
          Revisão rápida — {items.length === 0
            ? 'tudo em ordem'
            : `${plural(items.length, 'missão', 'missões')} ${items.length === 1 ? 'ficou' : 'ficaram'} para trás`}
        </h2>
        <Button variant="ghost" size="sm" icon="close" aria-label="Dispensar revisão" onClick={onClose} />
      </div>
      {items.length > 0 ? (
        <>
          <p className="review__intro">Hoje, outro dia ou soltar — você escolhe. Nada aqui é atraso.</p>
          <ul className="review__list">
            {items.map((m) => (
              <ReviewItem key={m.id} mission={m} today={today} onHandled={markHandled} onShrink={setShrinking} />
            ))}
          </ul>
        </>
      ) : (
        <p className="review__intro">Tudo decidido. Bom começo de dia!</p>
      )}
      <Button variant="primary" className="review__done"
        onClick={() => { void finish().catch((e) => console.error('review failed', e)).finally(onClose); }}>
        Pronto
      </Button>
      <ShrinkDialog
        mission={shrinking}
        onClose={() => setShrinking(undefined)}
        onSaved={async (id) => { await rescheduleMission(id, today); markHandled(id); }}
      />
    </Panel>
  );
}
