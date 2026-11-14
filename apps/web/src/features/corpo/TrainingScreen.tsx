import { useState, type FormEvent } from 'react';
import { Link, useSearch } from 'wouter';
import type { CardioModality, DayKey, ExerciseSet, ID, TrainingExercise, TrainingLog, Workout } from '@life/shared';
import {
  CARDIO_LABEL, CARDIO_MODALITIES, EFFORT_MAX, INTENSITY_MAX, SET_ISSUE_TEXT, WORKOUT_MAX_MIN, cardioText, isValidDayKey,
  lastSession, lastSessionText, parseSet, performedName, startTrainingLog, trainingDayOf,
} from '@life/shared';
import { useTrainingLog, useTrainingLogs, useTrainingPlan, useWorkouts } from '../../db/corpoData';
import { useToday } from '../../db/hooks';
import {
  TrainingValidationError, addExtraExercise, addSet, clearExerciseStatus, finishTraining, removeCardio, removeExtraExercise,
  removeSet, reopenTraining, replaceExercise, saveCardio, setTrainingFeel, skipExercise, undoFinishTraining, updateSet,
} from '../../domain/trainingActions';
import { WorkoutValidationError } from '../../domain/workoutActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { FOCUS_PAGE, focusWhenGone } from '../../ui/focusAfter';
import { formatClock } from '../../ui/format';
import { FAILURE_TOAST, safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { shortDay } from './corpoFormat';
import './corpo.css';

const toast = (msg: string, action?: { label: string; run(): void }) => useToast.getState().show(msg, action);

const kgLabel = (kg: number): string => String(kg).replace('.', ',');
const setLine = (n: number, s: ExerciseSet): string =>
  (s.kg !== undefined ? `Série ${n}: ${s.reps} × ${kgLabel(s.kg)} kg` : `Série ${n}: ${s.reps} repetições`);

/** Runs an action; a validation error goes to `onInvalid`, anything else to the failure toast. */
async function attempt(task: () => Promise<unknown>, onInvalid?: (message: string) => void): Promise<boolean> {
  try {
    await task();
    return true;
  } catch (err) {
    if (err instanceof TrainingValidationError || err instanceof WorkoutValidationError) onInvalid?.(err.message);
    else { console.error('training action failed', err); toast(FAILURE_TOAST); }
    return false;
  }
}

/** "/corpo/treino": the day's plan, sets, skipped/swapped, cardio and "Terminei" (spec Acompanhamento A). Nothing is written by opening it. */
export function TrainingScreen() {
  const today = useToday();
  const search = new URLSearchParams(useSearch());
  const asked = search.get('dia');
  const day: DayKey | undefined = today ? (asked && isValidDayKey(asked) && asked <= today ? asked : today) : undefined;
  const plan = useTrainingPlan();
  const log = useTrainingLog(day);
  const logs = useTrainingLogs();
  const workouts = useWorkouts();
  const blockParam = search.get('bloco') ?? undefined;
  const minParam = Number(search.get('min'));
  const defaultMin = Number.isInteger(minParam) && minParam >= 1 && minParam <= WORKOUT_MAX_MIN ? minParam : 60;

  const loaded = day !== undefined && plan !== undefined && log !== undefined && logs !== undefined;
  const title = day === undefined || day === today ? 'Treino de hoje' : `Treino de ${shortDay(day)}`;
  const view = loaded ? (log ?? { ...startTrainingLog(day, plan ?? undefined) }) : undefined;
  const exercises = view?.exercises ?? [];
  const planName = view?.planName ?? (loaded ? trainingDayOf(plan ?? undefined, day)?.name : undefined);

  return (
    <section className="screen training stack" aria-labelledby="training-title">
      <Link href="/corpo" className="settings__back">‹ Corpo</Link>
      <h1 id="training-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>{title}</h1>
      {loaded && (
        <>
          {planName && <p className="training__plan">{planName}</p>}
          {exercises.length === 0 && !planName && (plan ? (
            <p className="muted">Descanso da musculação.</p>
          ) : (
            <p className="muted">
              Ainda não há plano de treino. <Link href="/corpo" className="body-card__link">Montar o plano</Link>
            </p>
          ))}
          {exercises.length === 0 && planName && <p className="muted">Descanso da musculação.</p>}
          {exercises.map((e) => (
            <ExerciseCard key={e.id} day={day} exercise={e} reference={(() => {
              const last = lastSession(logs, performedName(e), day);
              return last ? lastSessionText(last) : undefined;
            })()} />
          ))}
          {exercises.length > 0 || planName ? <AddExtra day={day} /> : null}
          <CardioSection day={day} log={log} others={(workouts ?? []).filter((w) => w.day === day && w.kind === 'cardio' && w.id !== log?.cardioWorkoutId)} />
          <Feel day={day} log={log} />
          <Footer day={day} log={log} defaultMin={defaultMin} blockId={blockParam} />
        </>
      )}
    </section>
  );
}

function ExerciseCard({ day, exercise: e, reference }: { day: DayKey; exercise: TrainingExercise; reference?: string }) {
  const [reps, setReps] = useState('');
  const [kg, setKg] = useState('');
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<number>();
  const [editReps, setEditReps] = useState('');
  const [editKg, setEditKg] = useState('');
  const [swapping, setSwapping] = useState(false);
  const [swapName, setSwapName] = useState('');
  const headingId = `training-ex-${e.id}`;
  const name = e.name;
  const toHeading = () => document.getElementById(headingId);

  const save = (ev: FormEvent) => {
    ev.preventDefault();
    const set = parseSet(reps, kg);
    if (set === 'reps' || set === 'kg') { setError(SET_ISSUE_TEXT[set]); return; }
    setError(undefined);
    safeRun(addSet(day, e.id, set));
  };
  const startEdit = (i: number, s: ExerciseSet) => {
    setEditing(i); setEditReps(String(s.reps)); setEditKg(s.kg !== undefined ? kgLabel(s.kg) : ''); setError(undefined);
  };
  const saveEdit = (i: number) => {
    const set = parseSet(editReps, editKg);
    if (set === 'reps' || set === 'kg') { setError(SET_ISSUE_TEXT[set]); return; }
    setError(undefined);
    setEditing(undefined);
    safeRun(updateSet(day, e.id, i, set));
  };
  const saveSwap = (ev: FormEvent) => {
    ev.preventDefault();
    if (swapName.trim() === '') return;
    setSwapping(false);
    setSwapName('');
    safeRun(replaceExercise(day, e.id, swapName));
  };

  const state = e.status === 'trocado' ? 'trocado' : e.status === 'pulado' ? 'pulado' : undefined;
  return (
    <article className="training-ex" aria-labelledby={headingId}>
      <div className="training-ex__head">
        <h2 id={headingId} className="training-ex__name" tabIndex={-1}>{name}</h2>
        {e.status === 'feito' && <span className="training-ex__tag">Feito</span>}
        {e.status === 'pulado' && <span className="training-ex__tag">Pulado</span>}
        {e.status === 'trocado' && <span className="training-ex__tag">{`Trocado por ${e.replacedBy ?? ''}`}</span>}
        {e.extra && (
          <Button size="sm" variant="ghost" aria-label={`Remover ${name}`}
            onClick={(ev) => { focusWhenGone(ev.currentTarget); safeRun(removeExtraExercise(day, e.id)); }}>
            Remover
          </Button>
        )}
      </div>
      {reference && <p className="training-ex__ref">{reference}</p>}
      {e.sets.length > 0 && (
        <ol className="training-sets">
          {e.sets.map((s, i) => (
            <li key={i} className="training-set">
              {editing === i ? (
                <div className="training-set__edit">
                  <label className="field">
                    <span className="field__label">Repetições</span>
                    <input aria-label={`Repetições da série ${i + 1}`} inputMode="numeric" value={editReps} onChange={(ev) => setEditReps(ev.target.value)} />
                  </label>
                  <label className="field">
                    <span className="field__label">Carga (kg)</span>
                    <input aria-label={`Carga da série ${i + 1}`} inputMode="decimal" value={editKg} onChange={(ev) => setEditKg(ev.target.value)} />
                  </label>
                  <Button size="sm" variant="primary" onClick={() => saveEdit(i)}>Salvar</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(undefined); setError(undefined); }}>Cancelar</Button>
                </div>
              ) : (
                <>
                  <span className="training-set__text">{setLine(i + 1, s)}</span>
                  <Button size="sm" variant="ghost" aria-label={`Editar série ${i + 1} de ${name}`} onClick={() => startEdit(i, s)}>Editar</Button>
                  <Button size="sm" variant="ghost" aria-label={`Apagar série ${i + 1} de ${name}`}
                    onClick={(ev) => { focusWhenGone(ev.currentTarget, toHeading); safeRun(removeSet(day, e.id, i)); }}>
                    Apagar
                  </Button>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      <form className="training-form" noValidate onSubmit={save}>
        <label className="field">
          <span className="field__label">Repetições</span>
          <input inputMode="numeric" value={reps} onChange={(ev) => { setReps(ev.target.value); setError(undefined); }} />
        </label>
        <label className="field">
          <span className="field__label">Carga (kg)</span>
          <input inputMode="decimal" value={kg} onChange={(ev) => { setKg(ev.target.value); setError(undefined); }} />
        </label>
        <Button type="submit" size="sm" variant="primary" aria-label={`Salvar série de ${name}`}>Salvar série</Button>
      </form>
      {error && <p role="alert" className="training__error">{error}</p>}
      <div className="training-ex__actions">
        {e.sets.length === 0 && !e.status && (
          <Button size="sm" aria-label={`Pulei ${name}`}
            onClick={(ev) => { focusWhenGone(ev.currentTarget, toHeading); safeRun(skipExercise(day, e.id)); }}>
            Pulei
          </Button>
        )}
        <Button size="sm" aria-expanded={swapping} onClick={() => setSwapping((v) => !v)}>Troquei por…</Button>
        {state && e.sets.length === 0 && (
          <Button size="sm" variant="ghost" aria-label={`Desfazer ${state} de ${name}`}
            onClick={(ev) => { focusWhenGone(ev.currentTarget, toHeading); safeRun(clearExerciseStatus(day, e.id)); }}>
            Desfazer
          </Button>
        )}
      </div>
      {swapping && (
        <form className="training-form" noValidate onSubmit={saveSwap}>
          <label className="field">
            <span className="field__label">Troquei por</span>
            <input value={swapName} onChange={(ev) => setSwapName(ev.target.value)} />
          </label>
          <Button type="submit" size="sm" variant="primary">Salvar troca</Button>
        </form>
      )}
    </article>
  );
}

function AddExtra({ day }: { day: DayKey }) {
  const [name, setName] = useState('');
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (name.trim() === '') return;
    setName('');
    safeRun(addExtraExercise(day, name));
  };
  return (
    <form className="training-form" noValidate onSubmit={submit}>
      <label className="field">
        <span className="field__label">Exercício fora do plano</span>
        <input value={name} onChange={(ev) => setName(ev.target.value)} />
      </label>
      <Button type="submit" size="sm">Adicionar</Button>
    </form>
  );
}

function CardioSection({ day, log, others }: { day: DayKey; log: TrainingLog | null | undefined; others: Workout[] }) {
  const cardio = log?.cardio;
  const [editing, setEditing] = useState(false);
  const [modality, setModality] = useState<CardioModality>('bicicleta');
  const [minutes, setMinutes] = useState('');
  const [intensity, setIntensity] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const edit = () => {
    if (!cardio) return;
    setModality(cardio.modality); setMinutes(String(cardio.minutes)); setIntensity(cardio.intensity !== undefined ? String(cardio.intensity) : '');
    setError(undefined); setEditing(true);
  };
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    const ok = await attempt(async () => {
      const r = await saveCardio(day, {
        modality, minutes: Number(minutes), ...(intensity !== '' ? { intensity: Number(intensity) } : {}),
      });
      toast(r.created ? (r.xp > 0 ? `Cardio registrado · +${r.xp} XP` : 'Cardio registrado.') : 'Cardio atualizado.');
    }, setError);
    setBusy(false);
    if (ok) { setEditing(false); setError(undefined); setMinutes(''); setIntensity(''); }
  };

  return (
    <section className="training-cardio stack" aria-labelledby="training-cardio-title">
      <h2 id="training-cardio-title" className="section-title">Cardio</h2>
      {cardio && !editing ? (
        <div className="training-cardio__row">
          <span>{cardioText(cardio)}</span>
          <Button size="sm" onClick={edit}>Editar cardio</Button>
          <Button size="sm" variant="ghost" onClick={(ev) => {
            focusWhenGone(ev.currentTarget);
            safeRun(async () => { await removeCardio(day); toast('Cardio apagado.'); });
          }}>
            Apagar cardio
          </Button>
        </div>
      ) : (
        <form className="training-form" noValidate onSubmit={(ev) => { void submit(ev); }}>
          <label className="field">
            <span className="field__label">Modalidade</span>
            <select value={modality} onChange={(ev) => setModality(ev.target.value as CardioModality)}>
              {CARDIO_MODALITIES.map((m) => <option key={m} value={m}>{CARDIO_LABEL[m]}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Minutos</span>
            <input inputMode="numeric" value={minutes} onChange={(ev) => { setMinutes(ev.target.value); setError(undefined); }} />
          </label>
          <label className="field">
            <span className="field__label">Intensidade (1 a 10, opcional)</span>
            <select value={intensity} onChange={(ev) => setIntensity(ev.target.value)}>
              <option value="">—</option>
              {Array.from({ length: INTENSITY_MAX }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}</option>)}
            </select>
          </label>
          <Button type="submit" size="sm" variant="primary" disabled={busy}>Salvar cardio</Button>
          {editing && <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setError(undefined); }}>Cancelar</Button>}
        </form>
      )}
      {error && <p role="alert" className="training__error">{error}</p>}
      {others.length > 0 && (
        <p className="muted">{`Também hoje: ${others.map((w) => `Cardio ${w.minutes} min${w.minimum ? ' (mínimo)' : ''}`).join(' · ')}`}</p>
      )}
    </section>
  );
}

function Feel({ day, log }: { day: DayKey; log: TrainingLog | null | undefined }) {
  const row = (field: 'effort' | 'recovery', label: string, hint: string) => {
    const current = log?.[field];
    return (
      <div className="training-feel" role="group" aria-label={label}>
        <span className="field__label">{label}</span>
        <div className="training-feel__chips">
          {Array.from({ length: EFFORT_MAX }, (_, i) => i + 1).map((n) => (
            <Chip key={n} selected={current === n} onClick={() => safeRun(setTrainingFeel(day, field, current === n ? undefined : n))}>
              {String(n)}
            </Chip>
          ))}
        </div>
        <span className="muted">{hint}</span>
      </div>
    );
  };
  return (
    <details className="training-how">
      <summary>Como foi? (opcional)</summary>
      {row('effort', 'Esforço', '1 = leve · 5 = no limite')}
      {row('recovery', 'Recuperação', '1 = ainda cansado · 5 = bem recuperado')}
    </details>
  );
}

function Footer({ day, log, defaultMin, blockId }: { day: DayKey; log: TrainingLog | null | undefined; defaultMin: number; blockId?: ID }) {
  const [minutes, setMinutes] = useState(String(defaultMin));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (log?.finishedAt !== undefined) {
    return (
      <div className="training-footer">
        <p>{`Treino encerrado às ${formatClock(log.finishedAt)}.`}</p>
        <Button onClick={(ev) => { focusWhenGone(ev.currentTarget); safeRun(reopenTraining(day)); }}>Reabrir</Button>
      </div>
    );
  }
  const finish = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    await attempt(async () => {
      const r = await finishTraining(day, Number(minutes), blockId);
      const msg = r.created
        ? (r.xp > 0 ? `Treino registrado · +${r.xp} XP` : 'Treino registrado.')
        : 'Treino encerrado. Já havia um treino de musculação registrado hoje.';
      toast(msg, { label: 'Desfazer', run: () => safeRun(undoFinishTraining(day, r)) });
      setError(undefined);
    }, setError);
    setBusy(false);
  };
  return (
    <form className="training-footer" noValidate onSubmit={(ev) => { void finish(ev); }}>
      <label className="field">
        <span className="field__label">Minutos de treino</span>
        <input type="number" inputMode="numeric" min={1} max={WORKOUT_MAX_MIN} value={minutes}
          onChange={(ev) => { setMinutes(ev.target.value); setError(undefined); }} />
      </label>
      <Button type="submit" variant="primary" disabled={busy}>Terminei o treino</Button>
      {error && <p role="alert" className="training__error">{error}</p>}
    </form>
  );
}
