import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'wouter';
import type { DayKey } from '@life/shared';
import { OBSERVATION_DAYS, OBSERVATION_INTRO, addDays, observationOf, observationState } from '@life/shared';
import { useSettings, useToday } from '../../db/hooks';
import { endObservation, startObservation } from '../../domain/observationActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { plural } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';

const ddmm = (day: DayKey): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const toast = (msg: string) => useToast.getState().show(msg);

/** The Diário card of the 14-day observation: start, follow, end (asking first) and reach the summary. */
export function ObservationCard() {
  const settings = useSettings();
  const today = useToday();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const [asking, setAsking] = useState(false);
  const openBtn = useRef<HTMLButtonElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (asking) confirmBtn.current?.focus();
    else if (cancelled.current) {
      cancelled.current = false;
      openBtn.current?.focus();
    }
  }, [asking]);
  const state = settings && today ? observationState(observationOf(settings), today) : undefined;
  const running = state?.kind === 'active';
  useEffect(() => {
    if (!running) setAsking(false);
  }, [running]);
  if (!settings || !today || !state) return null;
  /** The tapped button goes away with the state it belongs to: focus goes to the card's title. */
  const toTitle = (e: MouseEvent<HTMLElement>) => focusWhenGone(e.currentTarget, () => title.current);
  const start = (e: MouseEvent<HTMLElement>) => {
    toTitle(e);
    safeRun(startObservation().then(() => toast(`Observação começou. Até ${ddmm(addDays(today, OBSERVATION_DAYS - 1))}.`)));
  };

  return (
    <section className="diary-observation px-border" role="region" aria-labelledby={titleId}>
      <h2 id={titleId} ref={title} tabIndex={-1} className="diary-observation__title">Observação de 14 dias</h2>
      {state.kind === 'none' && (
        <>
          <p className="muted">{OBSERVATION_INTRO}</p>
          <div className="cluster"><Button size="sm" variant="primary" onClick={start}>Começar</Button></div>
        </>
      )}
      {state.kind === 'active' && (
        <>
          <p>{`Dia ${state.day} de 14 · de ${ddmm(state.start)} a ${ddmm(state.plannedEnd)}.`}</p>
          {asking ? (
            <div className="stack" role="group" aria-label="Confirmar encerrar observação">
              <p>Encerrar agora? O resumo mostra os dias até hoje.</p>
              <div className="cluster">
                <Button ref={confirmBtn} size="sm" variant="primary" onClick={(e) => {
                  toTitle(e);
                  setAsking(false);
                  safeRun(endObservation().then(() => toast('Observação encerrada. O resumo está pronto.')));
                }}>Encerrar</Button>
                <Button size="sm" variant="ghost" onClick={() => { cancelled.current = true; setAsking(false); }}>Continuar observando</Button>
              </div>
            </div>
          ) : (
            <div className="cluster">
              <Button ref={openBtn} size="sm" variant="ghost" onClick={() => setAsking(true)}>Encerrar observação</Button>
            </div>
          )}
        </>
      )}
      {state.kind === 'ended' && (
        <>
          <p>{`De ${ddmm(state.start)} a ${ddmm(state.end)} (${plural(state.days, 'dia', 'dias')}).`}</p>
          <div className="cluster">
            <Link href="/diario/observacao" className="btn btn--secondary btn--sm">Ver resumo</Link>
            <Button size="sm" onClick={start}>Começar outra</Button>
          </div>
          <p className="muted">A anterior sai daqui; um relatório de período personalizado ainda mostra aqueles dias.</p>
        </>
      )}
    </section>
  );
}
