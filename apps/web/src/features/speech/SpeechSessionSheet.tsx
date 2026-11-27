import { useEffect, useId, useRef, useState } from 'react';
import type {
  ID, SpeechContent, SpeechDraft, SpeechField, SpeechPreset, SpeechRatingKey, SpeechScore, SpeechSession, SpeechSessionPatch,
} from '@life/shared';
import {
  READING_SOURCE, SPEECH_AUDIO_MAX_MS, SPEECH_CONTENTS, SPEECH_CONTENT_LABEL, SPEECH_EXERCISES, SPEECH_EXERCISE_LABEL,
  SPEECH_KINDS, SPEECH_KIND_LABEL, SPEECH_NOTES_MAX, SPEECH_RATING_KEYS, SPEECH_RATING_LABEL, SPEECH_READINGS, SPEECH_SCORES,
  SPEECH_SIMULATIONS, SPEECH_SIMULATION_LABEL, SPEECH_SIZES, SPEECH_SIZE_LABEL, SPEECH_TOPIC_MAX, SPEECH_WPM_NOTE, asksContent,
  hasSpeechChanges, newSpeechDraft, presetFields, readingOf, sessionWpm, speechChanges, speechClock, speechDraftOf, ulid,
  wordCount,
} from '@life/shared';
import { MediaInputError, saveMediaBlob } from '../../db/media';
import { useSpeechSessionDoc, useTopicChoices } from '../../db/speechData';
import {
  SPEECH_EMPTY_TEXT, SpeechEmptyError, addSpeechRecording, closeSpeechSession, saveSpeechSession, setRecordingKeep,
} from '../../domain/speechActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { dayMonth } from '../practice/practiceData';
import { usePageHide } from '../../ui/usePageHide';
import { useRecorder, type RecorderState, type RecordingResult } from '../media/useRecorder';
import { RecordingPlayer } from './RecordingPlayer';
import { ASKING_LINE, COMFORT_LINE, RECORDER_UNSUPPORTED, RECORDING_LINE, SessionRecorder } from './SessionRecorder';
import './speech.css';

export { RECORDER_UNSUPPORTED };
export const KEEP_HINT = 'Sem “Guardar”, a gravação pode sair deste aparelho depois de 30 dias, se já estiver no servidor.';
export const SAVE_FAILED = 'Não foi possível guardar agora. O que você escreveu continua aqui.';
export const KEEP_FAILED = 'Não foi possível guardar a gravação agora. Ela continua aqui: toque em “Tentar guardar de novo”.';
export const SPEECH_COPY = {
  kept: 'Gravação guardada.',
  keptCapped: 'Gravação guardada. Ela parou no limite de 3 minutos.',
  comfort: COMFORT_LINE,
  recording: RECORDING_LINE,
  asking: ASKING_LINE,
  closedXp: (xp: number) => `Sessão de fala encerrada · +${xp} XP`,
  closed: 'Sessão de fala encerrada.',
  keptOpen: 'Sessão guardada em aberto.',
  saved: 'Alterações guardadas.',
} as const;

const NO_SPEED = 'Sem velocidade: gravação com menos de 10 segundos ou parada no limite de 3 minutos.';

export interface SpeechSessionSheetProps {
  open: boolean;
  onClose(): void;
  /** An existing session; absent for a new one. */
  sessionId?: ID;
  /** A suggestion tapped by him: its fields count as chosen. */
  preset?: SpeechPreset;
}

/** "Nova sessão de fala" / "Sessão de fala". Opening writes nothing; see SessionBody for when it writes. */
export function SpeechSessionSheet({ open, ...rest }: SpeechSessionSheetProps) {
  if (!open) return null;
  return <SessionLoader {...rest} />;
}

function SessionLoader({ onClose, sessionId, preset }: Omit<SpeechSessionSheetProps, 'open'>) {
  const [id] = useState(() => sessionId ?? ulid());
  const doc = useSpeechSessionDoc(sessionId);
  // The Sheet mounts only once the session was read: it then captures the control that opened it.
  if (doc.status === 'loading') return null;
  return <SessionBody id={id} isNew={!sessionId} start={doc.session} preset={preset} onClose={onClose} />;
}

type Done = Extract<RecorderState, { kind: 'done' }>;

function SessionBody({ id, isNew, start, preset, onClose }: {
  id: ID; isNew: boolean; start?: SpeechSession; preset?: SpeechPreset; onClose(): void;
}) {
  const uid = useId();
  // A recording still running or not stored when the sheet goes away (the screen left) is stored after it.
  const rec = useRecorder(SPEECH_AUDIO_MAX_MS, { onUnmount: (r) => storeLater(r) });
  const live = useSpeechSessionDoc(id);
  const session = live.status === 'ready' ? live.session : start;
  const [initial, setInitial] = useState<SpeechDraft>(() => (start ? speechDraftOf(start) : newSpeechDraft()));
  const [draft, setDraft] = useState<SpeechDraft>(() => (start ? speechDraftOf(start) : newSpeechDraft(preset)));
  const [touched, setTouched] = useState<ReadonlySet<SpeechField>>(() => new Set(!start && preset ? presetFields(preset) : []));
  const [recMsg, setRecMsg] = useState('');
  const [alert, setAlert] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [closeSaving, setCloseSaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // A prefilled topic (the bridge from practice) is not typed text: only a different one counts.
  const [prefill] = useState(() => (!start ? newSpeechDraft(preset).topic : ''));

  // Read by the async paths (keep, close), which outlive the render that started them.
  const latest = useRef({ draft, initial, touched, exists: !!session });
  latest.current = { draft, initial, touched, exists: latest.current.exists || !!session };
  const closing = useRef(false);
  const keepingNow = useRef(false);

  const changes = (): SpeechSessionPatch => {
    const { draft: d, initial: i, touched: t } = latest.current;
    return speechChanges(i, d, t);
  };
  /** What a write sends: the touched changes, plus the activity while the session does not exist yet (it needs one). */
  const pending = (): SpeechSessionPatch => {
    const { draft: d, exists } = latest.current;
    return { ...changes(), ...(!exists && d.kind ? { kind: d.kind } : {}) };
  };
  /** The patch to send and the draft it comes from, taken at the same moment. */
  const snapshot = (): { p: SpeechSessionPatch; snap: SpeechDraft } => ({ p: pending(), snap: latest.current.draft });
  /** `snap` (the draft a write sent) is now stored: the new baseline, also for the async path still running. */
  const savedNow = (snap: SpeechDraft): void => {
    latest.current = { ...latest.current, initial: snap, exists: true };
    setInitial(snap);
  };

  const set = <K extends keyof SpeechDraft>(k: K & SpeechField, v: SpeechDraft[K]): void => {
    setDraft((d) => ({ ...d, [k]: v }));
    setTouched((t) => (t.has(k) ? t : new Set([...t, k])));
    setAlert(undefined);
  };

  /** Closing (and leaving) writes only what changed; chips alone on a session that does not exist yet create nothing. */
  const worthSaving = (): boolean => {
    const { draft: d, exists } = latest.current;
    // The topic counts as typed only when it is not empty and differs from the prefill (clearing it is not typing).
    const typed = (d.topic.trim() !== '' && d.topic.trim() !== prefill.trim()) || d.notes.trim() !== '';
    return hasSpeechChanges(changes()) && !!d.kind && (exists || typed);
  };

  const finishClose = async (): Promise<void> => {
    if (!worthSaving()) { onClose(); return; }
    const { exists } = latest.current;
    const { p, snap } = snapshot();
    setCloseSaving(true);
    try {
      await saveSpeechSession(id, p);
      savedNow(snap);
      useToast.getState().show(exists ? SPEECH_COPY.saved : SPEECH_COPY.keptOpen);
      onClose();
    } catch (e) {
      console.error('speech save failed', e);
      closing.current = false;
      setAlert(SAVE_FAILED);   // the sheet stays open with his text
    } finally {
      setCloseSaving(false);
    }
  };

  /** The quiet save being written, if any; `quietAgain`: another was asked for meanwhile. */
  const quietRun = useRef<Promise<void> | undefined>(undefined);
  const quietAgain = useRef(false);
  /** Resolves once no quiet save is in flight (whatever its outcome). */
  const quietSettled = async (): Promise<void> => {
    while (quietRun.current) await quietRun.current.catch(() => undefined);
  };

  /**
   * The page goes to the background, or the sheet goes away: the same save, fire-and-forget (no toast, nothing closes).
   * The iPhone sends `visibilitychange` and `pagehide` together, and the unmount can follow: while one write is in
   * flight the others wait for it, then one more runs only if something changed after it.
   */
  const saveQuietly = (): void => {
    if (quietRun.current) { quietAgain.current = true; return; }
    if (!worthSaving()) return;
    const { p, snap } = snapshot();
    // The baseline moves only after the write: if it fails, closing still tries again.
    const run = saveSpeechSession(id, p).then(() => savedNow(snap)).finally(() => {
      quietRun.current = undefined;
      if (quietAgain.current) { quietAgain.current = false; quiet.current(); }
    });
    quietRun.current = run;
    safeRun(run);
  };
  usePageHide(saveQuietly);
  const quiet = useRef(saveQuietly);
  quiet.current = saveQuietly;
  useEffect(() => () => quiet.current(), []);

  /** A recording the recorder handed over after the sheet went away: stored and added, with what he chose. */
  const storeLater = (r: RecordingResult): void => {
    safeRun((async () => {
      const info = await saveMediaBlob(r.blob);
      // After a quiet save in flight (the unmount starts one): what it wrote is not sent again.
      await quietSettled();
      const { p, snap } = snapshot();
      await addSpeechRecording(id, { hash: info.hash, durationMs: r.durationMs, at: Date.now(), ...(r.capped ? { capped: true } : {}) }, p);
      savedNow(snap);
    })());
  };

  const keep = async (s: Done): Promise<void> => {
    if (keepingNow.current) return;
    keepingNow.current = true;
    setKeeping(true);
    setRecMsg('');
    try {
      const info = await saveMediaBlob(s.blob);
      const { p, snap } = snapshot();   // after the blob is stored: text typed meanwhile goes in this write, once
      await addSpeechRecording(id, { hash: info.hash, durationMs: s.durationMs, at: Date.now(), ...(s.capped ? { capped: true } : {}) }, p);
      savedNow(snap);
      rec.reset();
      setRecMsg(s.capped ? SPEECH_COPY.keptCapped : SPEECH_COPY.kept);
      keepingNow.current = false;
      if (closing.current) await finishClose();
    } catch (e) {
      if (!(e instanceof MediaInputError)) console.error('speech recording failed', e);
      closing.current = false;
      setRecMsg(e instanceof MediaInputError ? e.message : KEEP_FAILED);   // the same recording stays for "Tentar guardar de novo"
    } finally {
      keepingNow.current = false;
      setKeeping(false);
    }
  };

  // Kept as soon as it stops: Parar, the 3-minute limit, or an interrupted track (once per finished recording).
  const keptState = useRef<RecorderState>(undefined);
  useEffect(() => {
    const s = rec.state;
    if (s.kind === 'asking') setRecMsg('');
    if (s.kind === 'done' && keptState.current !== s) { keptState.current = s; void keep(s); }
    // Closing waited for a recording that ended in an error (an empty one): stay open with the recorder's message;
    // the next close goes the normal way.
    if (s.kind === 'error' && closing.current) closing.current = false;
  }, [rec.state]);   // eslint-disable-line react-hooks/exhaustive-deps

  // A control that becomes disabled (Gravar while asking, Encerrar while busy) drops focus: keep it in the sheet.
  useEffect(() => {
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected && !a.matches(':disabled')) return;
    const target = root.current?.querySelector<HTMLElement>('.media-rec button:not([disabled])')
      ?? root.current?.closest<HTMLElement>('[role="dialog"]');
    target?.focus();
  }, [rec.state.kind, keeping, busy, closeSaving]);

  const requestClose = (): void => {
    if (closing.current) return;
    const s = rec.state;
    closing.current = true;
    if (s.kind === 'recording') { rec.stop(); return; }   // keep() closes after storing it
    if (s.kind === 'done') { void keep(s); return; }       // a keep running (or failed): it closes after storing
    if (s.kind === 'asking') rec.stop();
    void finishClose();
  };

  const endSession = (): void => {
    if (busy) return;
    setBusy(true);
    setAlert(undefined);
    const { p, snap } = snapshot();
    safeRun(closeSpeechSession(id, p)
      .then(({ xp }) => {
        savedNow(snap);
        useToast.getState().show(xp > 0 ? SPEECH_COPY.closedXp(xp) : SPEECH_COPY.closed);
        onClose();
      })
      .catch((e: unknown) => {
        if (e instanceof SpeechEmptyError) { setAlert(SPEECH_EMPTY_TEXT); return; }   // nothing written; the sheet stays
        throw e;
      })
      .finally(() => setBusy(false)));
  };

  const saveClosed = (): void => {
    if (busy) return;
    setBusy(true);
    setAlert(undefined);
    const { p, snap } = snapshot();
    saveSpeechSession(id, p)
      .then(() => {
        savedNow(snap);
        useToast.getState().show(SPEECH_COPY.saved);
        onClose();
      }, (e: unknown) => {
        console.error('speech save failed', e);
        setAlert(SAVE_FAILED);
      })
      .finally(() => setBusy(false));
  };

  const kind = draft.kind;
  const reading = kind === 'leitura';
  const passage = reading ? readingOf(draft.passage) : undefined;
  const topics = useTopicChoices();
  const recordings = session?.recordings ?? [];
  const closedAt = session?.closedAt;
  // Recording, asking for the mic, storing, or a recording not stored yet: Encerrar and Salvar wait (closing would drop it).
  const recBusy = rec.state.kind === 'recording' || rec.state.kind === 'asking' || rec.state.kind === 'done' || keeping;
  const anySpeed = !!session && reading && recordings.some((r) => sessionWpm(session, r) !== undefined);
  const hasTopicChoices = !!topics && (topics.journeys.length > 0 || topics.topics.length > 0);

  const chooseKind = (k: NonNullable<SpeechDraft['kind']>): void => {
    if (k === kind) return;   // the activity is required: tapping it again keeps it
    set('kind', k);
    if (k === 'leitura' && !draft.passage) set('passage', 'feira');
  };
  const pickTopic = (value: string): void => {
    const [type, rid] = [value.slice(0, 2), value.slice(2)];
    const list = type === 'j:' ? topics?.journeys : type === 't:' ? topics?.topics : undefined;
    const found = list?.find((x) => x.id === rid);
    if (found) set('topic', found.title.slice(0, SPEECH_TOPIC_MAX));
  };
  const rate = (k: SpeechRatingKey, n: SpeechScore): void => {
    set('ratings', { ...draft.ratings, [k]: draft.ratings[k] === n ? undefined : n });
  };

  return (
    <Sheet open onClose={requestClose} title={isNew ? 'Nova sessão de fala' : 'Sessão de fala'}>
      <div ref={root} className="stack speech-sheet">
        <fieldset className="speech-chips">
          <legend className="field__label">Tamanho (opcional)</legend>
          {SPEECH_SIZES.map((n) => (
            <Chip key={n} selected={draft.size === n} onClick={() => set('size', draft.size === n ? undefined : n)}>{SPEECH_SIZE_LABEL[n]}</Chip>
          ))}
        </fieldset>
        <fieldset className="speech-chips">
          <legend className="field__label">Atividade</legend>
          {SPEECH_KINDS.map((k) => (
            <Chip key={k} selected={kind === k} onClick={() => chooseKind(k)}>{SPEECH_KIND_LABEL[k]}</Chip>
          ))}
        </fieldset>

        {!kind ? (
          <p className="muted">Escolha a atividade para continuar.</p>
        ) : (
          <>
            {kind === 'exercicio' && (
              <fieldset className="speech-chips">
                <legend className="field__label">Exercício (opcional)</legend>
                {SPEECH_EXERCISES.map((x) => (
                  <Chip key={x} selected={draft.exercise === x} onClick={() => set('exercise', draft.exercise === x ? undefined : x)}>
                    {SPEECH_EXERCISE_LABEL[x]}
                  </Chip>
                ))}
              </fieldset>
            )}
            {kind === 'simulacao' && (
              <fieldset className="speech-chips">
                <legend className="field__label">Simulação (opcional)</legend>
                {SPEECH_SIMULATIONS.map((x) => (
                  <Chip key={x} selected={draft.simulation === x} onClick={() => set('simulation', draft.simulation === x ? undefined : x)}>
                    {SPEECH_SIMULATION_LABEL[x]}
                  </Chip>
                ))}
              </fieldset>
            )}
            {reading && (
              <>
                <fieldset className="speech-chips">
                  <legend className="field__label">Texto</legend>
                  {SPEECH_READINGS.map((r) => (
                    <Chip key={r.id} selected={draft.passage === r.id} onClick={() => set('passage', r.id)}>{r.title}</Chip>
                  ))}
                </fieldset>
                {passage && (
                  <figure className="speech-reading">
                    <blockquote>{passage.text}</blockquote>
                    <figcaption>{`${READING_SOURCE} · ${wordCount(passage.text)} palavras`}</figcaption>
                  </figure>
                )}
              </>
            )}
            {!reading && (
              <>
                <label className="field" htmlFor={`${uid}-topic`}>
                  <span className="field__label">Tema (opcional)</span>
                  <input id={`${uid}-topic`} type="text" value={draft.topic} maxLength={SPEECH_TOPIC_MAX}
                    placeholder="Ex.: explicar um JOIN" onChange={(e) => set('topic', e.target.value)} />
                </label>
                {hasTopicChoices && (
                  <select aria-label="Escolher tema de…" value="" onChange={(e) => pickTopic(e.target.value)}>
                    <option value="">Escolher de…</option>
                    {topics!.journeys.length > 0 && (
                      <optgroup label="Jornadas e matérias">
                        {topics!.journeys.map((j) => <option key={j.id} value={`j:${j.id}`}>{j.title}</option>)}
                      </optgroup>
                    )}
                    {topics!.topics.length > 0 && (
                      <optgroup label="Cards de tópico">
                        {topics!.topics.map((t) => <option key={t.id} value={`t:${t.id}`}>{t.title}</option>)}
                      </optgroup>
                    )}
                  </select>
                )}
              </>
            )}

            <div className="speech-group" role="group" aria-labelledby={`${uid}-recs`}>
              <h3 id={`${uid}-recs`} className="speech-group__title">Gravações</h3>
              <SessionRecorder rec={rec} message={recMsg} saving={keeping}
                onRetry={() => { if (rec.state.kind === 'done') void keep(rec.state); }} />
              {session && recordings.length > 0 && (
                <ul className="speech-recordings" aria-label="Gravações desta sessão">
                  {recordings.map((r, i) => {
                    const wpm = sessionWpm(session, r);
                    return (
                      <li key={r.hash}>
                        <RecordingPlayer hash={r.hash} label={`Gravação ${i + 1} · ${speechClock(r.durationMs)}`} />
                        {session.kind === 'leitura' ? (
                          <>
                            <p className="speech-recordings__fact">
                              {wpm !== undefined ? `Velocidade na leitura de referência: ${wpm} palavras por minuto` : NO_SPEED}
                            </p>
                            <p className="speech-recordings__fact">Referência · sempre guardada</p>
                          </>
                        ) : (
                          <Chip selected={r.keep === true} aria-label={`Guardar gravação ${i + 1}`}
                            onClick={() => safeRun(setRecordingKeep(id, r.hash, !r.keep))}>Guardar</Chip>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {session && recordings.length > 0 && (session.kind === 'leitura'
                ? (anySpeed && <p className="muted">{SPEECH_WPM_NOTE}</p>)
                : <p className="muted">{KEEP_HINT}</p>)}
            </div>

            <div className="speech-chips">
              <Chip selected={draft.done} onClick={() => set('done', !draft.done)}>Fiz a atividade (sem gravar)</Chip>
            </div>

            <div className="speech-group" role="group" aria-labelledby={`${uid}-rate`}>
              <p id={`${uid}-rate`} className="field__label">Como você percebeu? (1 a 5, opcional)</p>
              <p className="muted">1 = longe do que eu queria · 5 = como eu queria. É percepção, não medida.</p>
              {SPEECH_RATING_KEYS.map((k) => (
                <fieldset key={k} className="speech-chips">
                  <legend className="field__label">{SPEECH_RATING_LABEL[k]}</legend>
                  {SPEECH_SCORES.map((n) => (
                    <Chip key={n} selected={draft.ratings[k] === n} aria-label={`${SPEECH_RATING_LABEL[k]}: ${n} de 5`}
                      onClick={() => rate(k, n)}>{n}</Chip>
                  ))}
                </fieldset>
              ))}
            </div>

            {asksContent(kind) && (
              <fieldset className="speech-chips">
                <legend className="field__label">Consegui explicar? (opcional)</legend>
                {SPEECH_CONTENTS.map((c: SpeechContent) => (
                  <Chip key={c} selected={draft.content === c} onClick={() => set('content', draft.content === c ? undefined : c)}>
                    {SPEECH_CONTENT_LABEL[c]}
                  </Chip>
                ))}
                <p className="muted strategy-form__hint">É sobre o conteúdo, separado da fala.</p>
              </fieldset>
            )}

            <label className="field" htmlFor={`${uid}-notes`}>
              <span className="field__label">Notas (opcional)</span>
              <textarea id={`${uid}-notes`} rows={3} value={draft.notes} maxLength={SPEECH_NOTES_MAX}
                onChange={(e) => set('notes', e.target.value)} />
            </label>
          </>
        )}

        <p className="practice__hint">Fechar guarda o que você mudou; a sessão fica em aberto até você encerrar.</p>
        {alert && <p role="alert" className="practice__alert">{alert}</p>}
        {kind && (closedAt === undefined ? (
          <Button variant="primary" disabled={recBusy || busy || closeSaving} onClick={endSession}>Encerrar sessão</Button>
        ) : (
          <>
            <p>{`Encerrada em ${dayMonth(closedAt)}.`}</p>
            <Button variant="primary" disabled={recBusy || busy || closeSaving || !hasSpeechChanges(speechChanges(initial, draft, touched))}
              onClick={saveClosed}>Salvar</Button>
          </>
        ))}
      </div>
    </Sheet>
  );
}
