import type { MouseEvent } from 'react';
import { Link } from 'wouter';
import type { WatchNotice as WatchNoticeData } from '@life/shared';
import { dismissWatch } from '../../domain/patternActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { safeRun } from '../../ui/safeRun';
import { useToday } from '../../db/hooks';
import { useSeasonNow } from '../../db/seasonData';
import { useToast } from '../../ui/Toast';
import { EvidenceLine } from './Evidence';
import './patterns.css';
import { WATCH_CONTEXT, WATCH_CONTEXT_SHORT, watchExperiment, watchObservedText } from './patternText';
import { TestAsStrategy } from './TestAsStrategy';

export interface WatchNoticeProps {
  notice: WatchNoticeData;
  variant?: 'full' | 'compact';
  /** Compact only: where the experiment text goes (the "Nova semana" card's own field). */
  onUse?(text: string): void;
}

/** Weeks 5–8 notice (spec §5.5): observed numbers, a calm context and a small experiment; never a grade. */
export function WatchNotice({ notice, variant = 'full', onUse }: WatchNoticeProps) {
  const season = useSeasonNow(useToday());
  const experiment = watchExperiment(notice);
  const name = `Semanas 5–8: ${notice.name}`;
  if (variant === 'compact') {
    return (
      <div className="watch-compact" role="group" aria-label={name}>
        <p>{`Semanas 5–8 · ${notice.name}: ${watchObservedText(notice)}`}</p>
        <p className="watch-notice__context">{WATCH_CONTEXT_SHORT}</p>
        {season && <p className="watch-notice__season">{season.line}</p>}
        <div className="watch-notice__actions">
          <TestAsStrategy text={experiment} label="Usar no ajuste" onUse={onUse} />
          <Link href="/padroes" className="btn btn--secondary btn--sm">Ver em Padrões</Link>
        </div>
      </div>
    );
  }
  const dismiss = (e: MouseEvent<HTMLButtonElement>) => {
    focusWhenGone(e.currentTarget);
    safeRun(dismissWatch(notice.key).then(() => useToast.getState().show('Combinado. Este aviso não volta para este começo.')));
  };
  return (
    <Panel className="watch-notice px-border--gold" role="region" aria-label={name}>
      <h2 className="watch-notice__title">{`Semanas 5–8 · ${notice.name}`}</h2>
      <EvidenceLine kind="observado">{watchObservedText(notice)}</EvidenceLine>
      <p className="watch-notice__context">{WATCH_CONTEXT}</p>
      {season && <p className="watch-notice__season">{season.line}</p>}
      <EvidenceLine kind="experimento">{experiment}</EvidenceLine>
      <div className="watch-notice__actions">
        <TestAsStrategy text={experiment} />
        <Link href="/planejar?aba=rotina" className="btn btn--secondary btn--sm">Ajustar a rotina</Link>
        <Button size="sm" variant="ghost" onClick={dismiss}>Está tudo bem assim</Button>
      </div>
    </Panel>
  );
}
