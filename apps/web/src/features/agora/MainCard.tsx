import { useId, useState } from 'react';
import type { Area, CommitmentOccurrence, Suggestion } from '@life/shared';
import { Companion, SpeechBubble } from '../../art/Companion';
import { areaIcon, Icon } from '../../art/icons';
import { useBlocks, useToday } from '../../db/hooks';
import { Button } from '../../ui/Button';
import { ENERGY_LABEL, formatDuration, formatPoints } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import { useCompanion } from '../companion/store';
import type { AgoraActions } from './useAgora';

/** Companion sitting on the card corner, with its speech bubble. */
function CardCompanion() {
  const message = useCompanion((s) => s.message);
  return (
    <>
      <span className="main-card__companion"><Companion scale={3} speaking={!!message} /></span>
      <SpeechBubble message={message} className="main-card__speech" />
    </>
  );
}

function reasonsLine(s: Suggestion): string {
  if (s.reasons.length === 0) return 'está esperando há mais tempo';
  return s.reasons.slice(0, 3).map((r) => r.text).join(' · ');
}

function MissionView({ suggestion, area, canSkip, actions }: {
  suggestion: Suggestion; area?: Area; canSkip: boolean; actions: AgoraActions;
}) {
  const [why, setWhy] = useState(false);
  const whyId = useId();
  const m = suggestion.mission;
  const cueBlock = useBlocks().find((b) => b.id === m.cueBlockId);
  const today = useToday();
  // The if-then plan line shows in the cue block or on the day the plan is for.
  const planActive = suggestion.reasons.some((r) => r.code === 'cue') || (m.date !== undefined && today !== undefined && m.date <= today);
  const doneSteps = m.checklist.filter((c) => c.done).length;

  return (
    <>
      <p className="main-card__eyebrow">{m.firstStep ? 'Primeiro passo' : 'Agora'}</p>
      <h2 className="main-card__step">{m.firstStep ?? m.title}</h2>
      {m.firstStep && <p className="main-card__title">{m.title}</p>}
      {cueBlock && m.firstStep && planActive && (
        <p className="main-card__plan">Plano: {cueBlock.name}</p>
      )}

      <div className="main-card__tags">
        {m.status === 'doing' && <span className="tag tag--gold">Em andamento</span>}
        {m.durationMin !== undefined && (
          <span className="tag"><Icon name="timer" size={12} />{formatDuration(m.durationMin)}</span>
        )}
        {area && (
          <span className="tag">
            <span className="tag__area" style={{ color: area.color }}><Icon name={areaIcon(area.icon)} size={12} /></span>
            {area.name}
          </span>
        )}
        {m.energy && <span className="tag"><Icon name="energy" size={12} />{ENERGY_LABEL[m.energy]}</span>}
        {m.important && <span className="tag"><Icon name="star" size={12} />importante</span>}
        {m.checklist.length > 0 && (
          <span className="tag"><Icon name="check" size={12} />{doneSteps}/{m.checklist.length}</span>
        )}
      </div>

      <p className="main-card__reasons">{reasonsLine(suggestion)}</p>
      <button type="button" className="main-card__why-toggle" aria-expanded={why} aria-controls={whyId}
        onClick={() => setWhy((v) => !v)}>
        <span aria-hidden="true">{why ? '▾' : '▸'}</span> Por que esta?
      </button>
      <ul id={whyId} className="main-card__why" hidden={!why}>
        {suggestion.reasons.map((r) => (
          <li key={r.code + r.text}>
            <span className={r.points < 0 ? 'pts pts--neg' : 'pts'}>{r.points === 0 ? '·' : formatPoints(r.points)}</span>
            {r.text}
          </li>
        ))}
        {suggestion.reasons.length === 0 && <li><span className="pts">·</span>nenhum motivo especial</li>}
      </ul>

      {/* Once shrunk, the user already answered the nudge. */}
      {suggestion.postponedHint && !m.shrunk && (
        <div className="main-card__hint" role="group" aria-label={`Adiada ${m.postponeCount} vezes`}>
          <p>Adiada {m.postponeCount} vezes — quer encolher, dividir ou soltar?</p>
          <div className="main-card__hint-actions">
            <Button size="sm" onClick={() => actions.shrink(m)}>Encolher</Button>
            <Button size="sm" onClick={() => actions.split(m)}>Dividir</Button>
            <Button size="sm" onClick={() => actions.drop(m)}>Soltar</Button>
          </div>
        </div>
      )}

      <div className="main-card__actions">
        {m.status === 'doing' ? (
          <Button variant="primary" icon="play" onClick={() => actions.open(m)}>Continuar</Button>
        ) : (
          <Button variant="primary" icon="play" onClick={() => actions.start(m)}>Começar</Button>
        )}
        <Button icon="check" onClick={() => actions.complete(m)}>Concluir</Button>
      </div>
      <div className="main-card__tools">
        <Button size="sm" variant="ghost" icon="skip" className="btn--stacked" disabled={!canSkip}
          onClick={() => actions.other(m)}>Outra</Button>
        <Button size="sm" variant="ghost" icon="shrink" className="btn--stacked" onClick={() => actions.shrink(m)}>
          Encolher
        </Button>
        <Button size="sm" variant="ghost" icon="snooze" className="btn--stacked" onClick={() => actions.snooze(m)}>
          Agora não
        </Button>
      </div>
    </>
  );
}

export interface MainCardProps {
  suggestion?: Suggestion;
  area?: Area;
  /** Set while the user is inside a commitment: the card shows it and "Depois: …". */
  commitment?: CommitmentOccurrence;
  canSkip: boolean;
  actions: AgoraActions;
}

/** The one mission for now (parchment card), or the current commitment. */
export function MainCard({ suggestion, area, commitment, canSkip, actions }: MainCardProps) {
  // "Ver a missão agora" applies to this occurrence only: the next commitment shows itself again.
  const occurrenceKey = commitment ? `${commitment.commitment.id}@${commitment.startTs}` : undefined;
  const [missionShownFor, setMissionShownFor] = useState<string>();
  const showMission = occurrenceKey !== undefined && missionShownFor === occurrenceKey;
  const inCommitment = commitment !== undefined && (!showMission || !suggestion);
  return (
    <Panel role="region" aria-label="Missão agora" className="main-card">
      <CardCompanion />
      {inCommitment ? (
        <>
          <p className="main-card__eyebrow">Em compromisso</p>
          <h2 className="main-card__step">{commitment.commitment.title}</h2>
          <p className="main-card__title">
            {commitment.commitment.start}–{commitment.commitment.end}
          </p>
          {suggestion && (
            <>
              <p className="main-card__after">Depois: <strong>{suggestion.mission.title}</strong></p>
              <Button size="sm" variant="ghost" onClick={() => setMissionShownFor(occurrenceKey)}>Ver a missão agora</Button>
            </>
          )}
        </>
      ) : suggestion ? (
        <MissionView suggestion={suggestion} area={area} canSkip={canSkip} actions={actions} />
      ) : null}
    </Panel>
  );
}

/** Nothing to do: companion + permission to rest. */
export function MainCardEmpty({ onCapture }: { onCapture(): void }) {
  const message = useCompanion((s) => s.message);
  return (
    <Panel role="region" aria-label="Missão agora" className="main-card main-card--empty">
      <Companion scale={4} speaking={!!message} />
      <SpeechBubble message={message} className="main-card__speech--empty" />
      <p className="main-card__empty-text">
        Nada pendente. Capture algo com +, ou descanse — descanso também conta.
      </p>
      <Button variant="primary" icon="plus" onClick={onCapture}>Capturar</Button>
    </Panel>
  );
}
