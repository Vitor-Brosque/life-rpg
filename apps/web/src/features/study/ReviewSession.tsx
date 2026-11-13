import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import type { Card, CardFace, ID, Note, Rating, ScheduleCtx, StudyInput, StudyPlan } from '@life/shared';
import {
  cardFace, nextLearningAt, pickNext, previews, remainingOf, scheduleOf, studyPlan, studySettingsOf, suggestRating,
} from '@life/shared';
import { db } from '../../db/db';
import { useDayMode, useSettings, useToday } from '../../db/hooks';
import { isCardOfNote, readStudyData } from '../../db/studyData';
import { rateCard, setCardSuspended, undoRating } from '../../domain/studyActions';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { formatClock, plural } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import { FAILURE_TOAST, safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { useCompanion } from '../companion/store';
import { CodeEditor } from './CodeEditor';
import { RatingBar } from './RatingBar';
import { RevealPanel } from './RevealPanel';
import { Rich } from './Rich';
import { useSession } from './sessionStore';
import './study.css';

type View =
  | { kind: 'loading' }
  | { kind: 'card'; card: Card; note: Note; face: CardFace; shownAt: number; ctx: ScheduleCtx }
  | { kind: 'end'; nextLearning?: number; plan: StudyPlan };

const WRITE_KEY = 'life-rpg.study.writeFirst';
const readWriteFirst = (): boolean => { try { return localStorage.getItem(WRITE_KEY) === '1'; } catch { return false; } };
const storeWriteFirst = (on: boolean): void => { try { localStorage.setItem(WRITE_KEY, on ? '1' : '0'); } catch { /* storage may be unavailable */ } };
const isTypingTarget = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** "/estudo/revisar": one card at a time — answer, reveal, rate (spec §6). Every rating is saved at once. */
export function ReviewSession() {
  const [, navigate] = useLocation();
  const deckFilter = new URLSearchParams(useSearch()).get('baralho') ?? undefined;
  const settings = useSettings();
  const today = useToday();
  const mode = useDayMode();
  const session = useSession();
  const [view, setView] = useState<View>({ kind: 'loading' });
  /** When the answer was revealed (ms): the intervals shown and the one saved come from it. */
  const [revealedAt, setRevealedAt] = useState<number | undefined>(undefined);
  const revealed = revealedAt !== undefined;
  const [answer, setAnswer] = useState('');
  const [covered, setCovered] = useState<boolean[]>([]);
  const [writeFirst, setWriteFirst] = useState(readWriteFirst);
  const [remaining, setRemaining] = useState({ count: 0, minutes: 0 });
  const [goal, setGoal] = useState(false);
  const busy = useRef(false);
  const spoke = useRef(false);
  const ratedAt = useRef<number | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async (forceCardId?: ID): Promise<void> => {
    if (!settings || !today) return;
    const study = studySettingsOf(settings);
    const data = await readStudyData(today);
    if (!alive.current) return;
    const input: StudyInput = {
      cards: data.cards, reviews: data.reviews, deckOrder: data.deckOrder, settings: study, mode, today,
      now: Date.now(), dayStartHour: settings.dayStartHour,
    };
    const plan = studyPlan(input);
    const scoped = deckFilter ? { ...input, cards: input.cards.filter((c) => c.deckId === deckFilter) } : input;
    setRemaining(remainingOf(scoped, plan));
    if (!alive.current) return;
    const forced = forceCardId ? await db.cards.get(forceCardId) : undefined;
    // A card whose note vanished meanwhile (e.g. deleted on another device) is skipped, not the end.
    const skipped = new Set<ID>();
    let candidate: Card | undefined = forced && !forced.deleted ? forced : undefined;
    let card: Card | undefined;
    let note: Note | undefined;
    for (let i = 0; i <= scoped.cards.length; i++) {
      const pick = candidate ?? pickNext({ ...scoped, cards: scoped.cards.filter((c) => !skipped.has(c.id)) }, plan);
      candidate = undefined;
      if (!pick) break;
      const found = await db.notes.get(pick.noteId);
      if (!alive.current) return;
      if (isCardOfNote(pick, found)) { card = pick; note = found; break; }
      skipped.add(pick.id);
    }
    if (!alive.current) return;
    setRevealedAt(undefined);
    setAnswer('');
    setCovered([]);
    if (!card || !note) {
      setView({ kind: 'end', nextLearning: nextLearningAt(scoped.cards), plan });
      return;
    }
    setView({
      kind: 'card', card, note, face: cardFace(note, card.ord), shownAt: Date.now(),
      ctx: { dayStartHour: settings.dayStartHour, restDays: study.restDays, retention: study.retention, shortTerm: !card.topic },
    });
  }, [settings, today, mode, deckFilter]);

  // After unmount nothing is set and a late failure is swallowed (the database may be closing).
  const advance = useCallback(async (forceCardId?: ID): Promise<void> => {
    try {
      await load(forceCardId);
    } catch (e) {
      if (!alive.current) return;
      console.error('advance failed', e);
      useToast.getState().show(FAILURE_TOAST);
    }
  }, [load]);

  const ready = !!settings && !!today;
  useEffect(() => {
    if (!ready || !today) return;
    useSession.getState().start(today, deckFilter);
    void advance();
    // Only on entry (and when the day or deck changes): later moves come from rating/undo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, today, deckFilter]);

  useEffect(() => {
    if (view.kind === 'end' && session.reviewed > 0 && !spoke.current) {
      spoke.current = true;
      void useCompanion.getState().say('studyDone');
    }
  }, [view.kind, session.reviewed]);

  const ratingPreviews = useMemo(
    () => (view.kind === 'card' && revealedAt !== undefined ? previews(scheduleOf(view.card), revealedAt, view.ctx) : undefined),
    [view, revealedAt],
  );

  const reveal = (): void => {
    if (view.kind !== 'card' || revealed) return;
    setRevealedAt(Date.now());
    requestAnimationFrame(() => document.getElementById('reveal-heading')?.focus());
  };

  const onRate = async (rating: Rating): Promise<void> => {
    if (view.kind !== 'card' || revealedAt === undefined || busy.current || ratedAt.current === view.shownAt) return;
    busy.current = true;
    ratedAt.current = view.shownAt;
    try {
      const durationMs = Date.now() - view.shownAt;
      const points = view.face.points;
      const coverage = points ? { covered: points.filter((_, i) => covered[i]).length, total: points.length } : undefined;
      const r = await rateCard(view.card.id, rating, {
        durationMs, wrote: answer.trim() !== '', now: revealedAt, ...(coverage ? { coverage } : {}),
      });
      useSession.getState().rated(r.reviewId, durationMs, r.xp);
      if (r.goalReached && !useSession.getState().goalShown) {
        useSession.getState().markGoalShown();
        setGoal(true);
      }
      await advance();
    } catch (e) {
      ratedAt.current = undefined;
      console.error('rate failed', e);
      useToast.getState().show(FAILURE_TOAST);
    } finally {
      busy.current = false;
    }
  };

  const onUndo = async (): Promise<void> => {
    const { undo } = useSession.getState();
    const last = undo[undo.length - 1];
    if (!last || busy.current) return;
    busy.current = true;
    try {
      const review = await db.reviews.get(last.reviewId);
      await undoRating(last.reviewId);
      useSession.getState().undone();
      setGoal(false);
      await advance(review?.cardId);
    } finally {
      busy.current = false;
    }
  };

  const edit = (): void => {
    if (view.kind === 'card') navigate(`/estudo/nota/${view.note.id}?voltar=sessao${deckFilter ? `&baralho=${deckFilter}` : ''}`);
  };
  const suspend = (): void => {
    if (view.kind !== 'card') return;
    const id = view.card.id;
    safeRun(setCardSuspended(id, true).then(async () => {
      useToast.getState().show('Card suspenso.', { label: 'Desfazer', run: () => safeRun(setCardSuspended(id, false)) });
      await advance();
    }));
  };
  const finish = (): void => {
    useSession.getState().reset();
    navigate('/estudo');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (isTypingTarget(e.target) || document.querySelector('[aria-modal="true"]')) return;
      if ((e.key === ' ' || e.key === 'Enter') && e.target instanceof HTMLElement && e.target.closest('button, a')) return;
      if (view.kind !== 'card' || goal) return;
      const key = e.key.toLowerCase();
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); reveal(); }
      else if (revealed && /^[1-4]$/.test(e.key)) { e.preventDefault(); void onRate(Number(e.key) as Rating); }
      else if (key === 'z') { e.preventDefault(); void onUndo(); }
      else if (key === 'e') { e.preventDefault(); edit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (view.kind === 'loading') return <section className="screen review" aria-busy="true" aria-label="Revisão" />;

  if (view.kind === 'end') {
    const minutes = Math.max(1, Math.round(session.spentMs / 60_000));
    const next = view.plan.forecast[0];
    return (
      <section className="screen review stack" aria-labelledby="review-end-title">
        <h1 id="review-end-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>{session.reviewed > 0 ? 'Revisão encerrada' : 'Revisão'}</h1>
        <Panel variant="stone" className="review__end">
          {session.reviewed > 0 ? (
            <p className="review__summary">{plural(session.reviewed, 'card', 'cards')} · {minutes} min{session.xp > 0 ? ` · +${session.xp} XP` : ''}</p>
          ) : <p>Nada para revisar agora.</p>}
          {session.goalShown && <p>Meta de hoje feita.</p>}
          {view.nextLearning !== undefined && <p className="muted">Um card em aprendizado volta às {formatClock(view.nextLearning)}.</p>}
          {next && <p className="muted">Próximo dia de estudo: ~{Math.max(1, Math.round(next.min))} min.</p>}
          <div className="study-today__actions"><Button variant="primary" onClick={finish}>Voltar ao Estudo</Button></div>
        </Panel>
      </section>
    );
  }

  const { note, face } = view;
  const isCode = !!face.code;
  const isCloze = note.type === 'cloze';
  const isTopic = !!face.points;
  const toggle = (i: number): void => setCovered((c) => { const next = [...c]; next[i] = !next[i]; return next; });
  const suggested = face.points && revealed
    ? suggestRating(face.points.filter((_, i) => covered[i]).length, face.points.length) : undefined;
  const position = session.reviewed + 1;
  const total = session.reviewed + Math.max(remaining.count, 1);

  return (
    <section className="screen review" aria-labelledby="review-title">
      <header className="review__top">
        <h1 id="review-title" className="review__title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Revisão</h1>
        <span className="review__count">{position}/{total} · ~{Math.max(1, remaining.minutes)} min</span>
        <Button size="sm" variant="ghost" onClick={finish}>Parar</Button>
      </header>

      {goal ? (
        <Panel variant="stone" className="review__goal">
          <h2 className="study__subtitle">Meta de hoje feita</h2>
          <p>Você revisou o combinado para hoje. O resto espera sem pressa.</p>
          <div className="study-today__actions">
            <Button variant="primary" onClick={finish}>Encerrar</Button>
            <Button onClick={() => setGoal(false)}>Continuar</Button>
          </div>
        </Panel>
      ) : (
        <>
          <Panel variant="stone" className="review__card">
            <Rich text={isCloze && revealed ? face.back : face.front} className="review__front" />
            {isCode && (
              <CodeEditor label="Sua resposta (código)" value={answer} onChange={setAnswer} readOnly={revealed} rows={6} />
            )}
            {!isCode && !isTopic && !revealed && (
              <Button size="sm" variant="ghost" aria-pressed={writeFirst}
                onClick={() => { setWriteFirst(!writeFirst); storeWriteFirst(!writeFirst); }}>Escrever antes</Button>
            )}
            {!isCode && !isTopic && writeFirst && !revealed && (
              <div className="field">
                <label className="field__label" htmlFor="review-answer">Sua resposta</label>
                <textarea id="review-answer" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} />
              </div>
            )}
            {isTopic && !revealed && (
              <div className="field">
                <label className="field__label" htmlFor="review-answer">Sua explicação</label>
                <textarea id="review-answer" rows={6} value={answer} placeholder="Escreva tudo o que lembra, sem consultar."
                  onChange={(e) => setAnswer(e.target.value)} />
              </div>
            )}
            {!revealed && !isCode && answer.includes('$') && (
              <div className="review__preview" role="region" aria-label="Pré-visualização da resposta"><Rich text={answer} /></div>
            )}
            {revealed
              ? <RevealPanel face={face} answer={answer} cloze={isCloze} covered={covered} onToggle={toggle} />
              : <Button variant="primary" onClick={reveal} aria-keyshortcuts="Space">Mostrar resposta</Button>}
          </Panel>
          {ratingPreviews && <RatingBar previews={ratingPreviews} onRate={(r) => void onRate(r)} suggested={suggested} />}
          <div className="review__menu">
            <Button size="sm" variant="ghost" disabled={session.undo.length === 0} onClick={() => void onUndo()} aria-keyshortcuts="Z">Desfazer</Button>
            <Button size="sm" variant="ghost" onClick={edit} aria-keyshortcuts="E">Editar</Button>
            <Button size="sm" variant="ghost" onClick={suspend}>Suspender</Button>
          </div>
        </>
      )}
    </section>
  );
}
