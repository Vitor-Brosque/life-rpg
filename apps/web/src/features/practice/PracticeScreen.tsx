import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import type { PracticeSession, PracticeStep } from '@life/shared';
import { PRACTICE_LIMITS, PRACTICE_STEPS, nextStep, prevStep, stepFilled, stepLabel } from '@life/shared';
import { Icon } from '../../art/icons';
import { useJourneys, useMissions } from '../../db/hooks';
import { deletePractice, restorePractice, updatePractice } from '../../domain/practiceActions';
import { ensurePracticeSketch } from '../../domain/sketchActions';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { ResumeNote } from '../agora/ResumeNote';
import { useMissionSheet } from '../mission/MissionSheet';
import { PauseSheet } from './PauseSheet';
import { StepBody } from './PracticeSteps';
import { practiceBack, usePracticeSession } from './practiceData';
import { useDraftField } from './useDraftField';
import './practice.css';

/** "/pratica/:id": one practice session, step by step (spec §5.1). */
export function PracticeScreen({ id }: { id: string }) {
  const doc = usePracticeSession(id);
  if (doc.status === 'loading') return <section className="screen practice" aria-busy="true" aria-label="Sessão de prática" />;
  if (doc.status === 'missing' || !doc.session) {
    return (
      <section className="screen stack">
        <h1 tabIndex={-1} data-focus-target={FOCUS_PAGE}>Sessão não encontrada</h1>
        <Link href="/estudo/praticas">Ver sessões</Link>
      </section>
    );
  }
  return <PracticeBody session={doc.session} />;
}

function PracticeBody({ session }: { session: PracticeSession }) {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const back = practiceBack(new URLSearchParams(search).get('voltar'));
  const journeys = useJourneys();
  const missions = useMissions();
  const [step, setStep] = useState<PracticeStep>(session.step);
  const [pausing, setPausing] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const title = useDraftField(session.title, (v) => updatePractice(session.id, { title: v }));
  const journey = journeys.find((j) => j.id === session.journeyId);
  const mission = missions.find((m) => m.id === session.missionId);
  const open = session.status === 'open';
  const prev = prevStep(step);
  const next = nextStep(step);

  useEffect(() => { if (moved.current) headingRef.current?.focus(); }, [step]);

  const go = (to: PracticeStep): void => {
    moved.current = true;
    setStep(to);
    safeRun(updatePractice(session.id, { step: to }));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    // Sheets are portals, but React events still bubble here through them: leave their Ctrl+Enter alone.
    if ((e.target as HTMLElement).closest('[role="dialog"]')) return;
    if (!next) return;
    e.preventDefault();
    go(next);
  };
  const openSketch = (): void => safeRun(async () => {
    const sketch = await ensurePracticeSketch(session);
    const here = `${location}${search ? `?${search}` : ''}`;
    navigate(`/lousa/${sketch.id}?voltar=${encodeURIComponent(here)}`);
  });
  const remove = (): void => safeRun(deletePractice(session.id).then(() => {
    navigate(back);
    useToast.getState().show('Sessão apagada.', { label: 'Desfazer', run: () => safeRun(restorePractice(session.id)) });
  }));

  return (
    <section className="screen practice stack" aria-labelledby="practice-title" onKeyDown={onKeyDown}>
      <h1 id="practice-title" className="visually-hidden" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Sessão de prática</h1>
      <div className="practice__top">
        <Button size="sm" variant="ghost" onClick={() => navigate(back)}>← Voltar</Button>
        <input className="practice__title" type="text" aria-label="Título da sessão" value={title.value}
          maxLength={PRACTICE_LIMITS.title} enterKeyHint="done"
          onFocus={title.onFocus} onChange={(e) => title.onChange(e.target.value)}
          onBlur={() => { if (!title.value.trim()) title.reset(); title.onBlur(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />
        <Button size="sm" icon="pen" onClick={openSketch}>Lousa</Button>
        {open
          ? <Button size="sm" onClick={() => setPausing(true)}>Pausar</Button>
          : <span className="tag tag--stone">Encerrada</span>}
      </div>
      {(journey || mission) && (
        <p className="practice__meta">
          {journey?.title}
          {journey && mission ? ' · ' : ''}
          {mission && (
            <button type="button" className="practice__link" onClick={() => useMissionSheet.getState().open(mission.id)}>
              Missão: {mission.title}
            </button>
          )}
        </p>
      )}
      {open && <ResumeNote text={session.nextAction} />}

      <nav aria-label="Passos da sessão" className="practice-steps">
        <ol className="practice-steps__list">
          {PRACTICE_STEPS.map((s, i) => {
            const filled = stepFilled(session, s.key);
            const current = s.key === step;
            return (
              <li key={s.key}>
                <button type="button" className={current ? 'practice-steps__step is-current' : 'practice-steps__step'}
                  aria-current={current ? 'step' : undefined} aria-label={`Passo ${i + 1}: ${s.label}${filled ? ', preenchido' : ''}`}
                  onClick={() => go(s.key)}>
                  <span className="practice-steps__n" aria-hidden="true">{i + 1}</span>
                  <span aria-hidden="true">{s.label}</span>
                  {filled && <Icon name="check" size={12} />}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="practice__step">
        <StepBody key={session.id} step={step} session={session} go={go} headingRef={headingRef} />
      </div>
      <div className="practice__nav">
        {prev && <Button onClick={() => go(prev)}>Anterior: {stepLabel(prev)}</Button>}
        {next && <Button variant="primary" onClick={() => go(next)}>Próximo: {stepLabel(next)}</Button>}
      </div>

      <Button variant="ghost" className="practice__delete" onClick={remove}>Apagar sessão</Button>
      <PauseSheet open={pausing} session={session} onClose={() => setPausing(false)} onPaused={() => navigate(back)} />
    </section>
  );
}
