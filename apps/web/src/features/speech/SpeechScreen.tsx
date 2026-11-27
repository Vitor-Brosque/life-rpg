import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import type { ID, SpeechPreset, SpeechSession } from '@life/shared';
import { SITUATION_CONTEXT_LABEL, SPEECH_SIZE_LABEL, clampWeek, presetOf, speechRecordings, speechSessionTitle, speechSuggestions } from '@life/shared';
import { useToday } from '../../db/hooks';
import { useSpeechProgram, useSpeechSessions, useSpeechSituations, useSpeechSpace } from '../../db/speechData';
import { removeSituation, restoreSituation } from '../../domain/speechActions';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { situationLine, useSituationSheet } from './SituationSheet';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE, focusIfLost, focusWhenGone } from '../../ui/focusAfter';
import { ddmm, plural } from '../../ui/format';
import { CompareSheet } from './CompareSheet';
import { ProgramCard } from './ProgramCard';
import { VocalLimits, VocalNote } from './VocalNote';
import { SPACE_RULE, SpaceSheet, spaceLine } from './SpaceSheet';
import { SpeechSessionSheet } from './SpeechSessionSheet';
import '../study/study.css';
import './speech.css';

/** The open sheet: a session (`id`) or a new one (optionally from a suggestion); `n` remounts it on every open. */
export interface SheetState { id?: ID; preset?: SpeechPreset; n: number }

const SHOWN = 10;

const titleEl = (): HTMLElement | null => document.getElementById('speech-title');

function sessionMeta(s: SpeechSession): string {
  const n = s.recordings.length;
  return [
    s.size ? SPEECH_SIZE_LABEL[s.size] : '',
    n > 0 ? plural(n, 'gravação', 'gravações') : '',
    s.done ? 'Fiz a atividade' : '',
    s.closedAt !== undefined ? 'Encerrada' : 'Em aberto',
  ].filter(Boolean).join(' · ');
}

/** "/estudo/fala": today's suggestions, the sessions and the session sheet. Opening it writes nothing. */
export function SpeechScreen() {
  const sessions = useSpeechSessions();
  const program = useSpeechProgram();
  const [sheet, setSheet] = useState<SheetState>();
  const [showAll, setShowAll] = useState(false);
  const situations = useSpeechSituations();
  const registerRef = useRef<HTMLButtonElement>(null);
  const today = useToday();
  const space = useSpeechSpace(today);
  const [compareOpen, setCompareOpen] = useState(false);
  const [spaceOpen, setSpaceOpen] = useState(false);
  const spaceButton = useRef<HTMLButtonElement>(null);
  const seq = useRef(0);
  const opener = useRef<Element | null>(null);
  const titleNext = useRef(false);

  const openSheet = (s: Omit<SheetState, 'n'>): void => {
    opener.current = document.activeElement;
    seq.current += 1;
    setSheet({ ...s, n: seq.current });
  };
  // "Explicar em voz alta": the topic arrives in the address; the sheet opens prefilled and the address is cleaned.
  const search = useSearch();
  const [, navigate] = useLocation();
  useEffect(() => {
    // Read from the raw address: wouter's `search` is already passed through decodeURI, and decoding it a second time
    // garbles accents next to an encoded "%" (e.g. "100%" in the title).
    const topic = new URLSearchParams(window.location.search).get('explicar');
    if (topic === null) return;
    // An empty topic opens nothing; the address is cleaned all the same.
    if (topic.trim() !== '') openSheet({ preset: { kind: 'explicacao', topic } });
    navigate('/estudo/fala', { replace: true });
  }, [search]);   // eslint-disable-line react-hooks/exhaustive-deps
  const closeSheet = (): void => {
    // The Sheet gives focus back to its opener; if that control is gone by then, the screen title takes it.
    focusWhenGone(opener.current, titleEl);
    // Opened from the address (no control had focus): the Sheet has nothing to return to, so the title takes it.
    if (!opener.current || opener.current === document.body) titleNext.current = true;
    setSheet(undefined);
  };
  useEffect(() => {
    if (sheet || !titleNext.current) return;
    titleNext.current = false;
    focusIfLost(titleEl());
  }, [sheet]);

  if (sessions === undefined || program === undefined || situations === undefined) return <section className="screen" aria-busy="true" aria-label="Fala" />;

  const { focus, activities } = speechSuggestions(program ?? undefined);
  const recordings = speechRecordings(sessions);
  const shown = showAll ? sessions : sessions.slice(0, SHOWN);

  return (
    <section className="screen stack speech" aria-labelledby="speech-title">
      <Link href="/estudo" className="deck__back">← Estudo</Link>
      <h1 id="speech-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Fala</h1>

      <VocalNote />

      <section className="stack" aria-labelledby="speech-today">
        <h2 id="speech-today" className="section-title">Hoje</h2>
        <p className="muted">{program ? `Semana ${clampWeek(program.week)} · ${focus}` : 'Sugestões livres, todas opcionais.'}</p>
        <ul className="speech-suggestions">
          {activities.map((a, i) => {
            const title = speechSessionTitle(presetOf(a));
            const size = SPEECH_SIZE_LABEL[a.size];
            return (
              <li key={`${a.size}-${i}`}>
                <span className="speech-suggestion__head">{`${size} · ${title}`}</span>
                <span className="speech-suggestion__text">{a.text}</span>
                <Button size="sm" aria-label={`Começar: ${size}, ${title}`} onClick={() => openSheet({ preset: presetOf(a) })}>Começar</Button>
              </li>
            );
          })}
        </ul>
        <div className="cluster">
          <Button icon="plus" onClick={() => openSheet({})}>Nova sessão</Button>
        </div>
      </section>

      <ProgramCard program={program} />

      <section className="stack" aria-labelledby="speech-situations">
        <h2 id="speech-situations" className="section-title">Situações reais</h2>
        <p className="muted">Um toque depois de uma aula, conversa ou entrevista. É o que mostra se a prática chega ao dia a dia.</p>
        <div className="cluster">
          <Button ref={registerRef} icon="plus" onClick={() => useSituationSheet.getState().open()}>Registrar situação real</Button>
        </div>
        {situations.length === 0 ? (
          <p className="muted">Nenhuma situação registrada ainda.</p>
        ) : (
          <ul className="speech-situations" aria-label="Situações reais recentes">
            {situations.slice(0, 5).map((x) => (
              <li key={x.id}>
                <span>{situationLine(x)}</span>
                {x.note && <span className="muted">{`"${x.note}"`}</span>}
                <Button size="sm" variant="ghost" aria-label={`Apagar situação de ${ddmm(x.day)} (${SITUATION_CONTEXT_LABEL[x.context]})`}
                  onClick={(e) => {
                    focusWhenGone(e.currentTarget, () => registerRef.current);
                    safeRun(removeSituation(x.id).then(() => {
                      useToast.getState().show('Situação apagada.', { label: 'Desfazer', run: () => safeRun(restoreSituation(x.id)) });
                    }));
                  }}>Apagar</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stack" aria-labelledby="speech-sessions">
        <h2 id="speech-sessions" className="section-title">Sessões</h2>
        {sessions.length === 0 ? (
          <p className="muted">Nenhuma sessão ainda. Escolha uma sugestão acima ou toque em Nova sessão.</p>
        ) : (
          <>
            <ul className="study-list speech-list" aria-label="Sessões de fala">
              {shown.map((s) => (
                <li key={s.id}>
                  <button type="button" className="row-card speech-row" onClick={() => openSheet({ id: s.id })}>
                    <span className="speech-row__title">{`${ddmm(s.day)} · ${speechSessionTitle(s)}`}</span>
                    <span className="speech-row__meta">{sessionMeta(s)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {!showAll && sessions.length > SHOWN && (
              <Button size="sm" variant="ghost" onClick={(e) => {
                // The button goes away: focus moves to the first row it revealed.
                focusWhenGone(e.currentTarget, () => document.querySelectorAll<HTMLElement>('.speech-row')[SHOWN] ?? titleEl());
                setShowAll(true);
              }}>{`Mostrar todas (${sessions.length})`}</Button>
            )}
          </>
        )}
      </section>

      {recordings.length >= 1 && (
        <section className="stack" aria-labelledby="speech-compare">
          <h2 id="speech-compare" className="section-title">Comparar gravações</h2>
          {recordings.length === 1 ? (
            <p className="muted">Com duas gravações, dá para ouvir uma depois da outra aqui.</p>
          ) : (
            <>
              <p className="muted">A primeira e a última leitura do mesmo texto, ou outras duas que você escolher.</p>
              <div className="cluster"><Button onClick={() => setCompareOpen(true)}>Abrir comparação</Button></div>
            </>
          )}
        </section>
      )}

      {recordings.length >= 1 && space && (
        <section className="stack" aria-labelledby="speech-space-title">
          <h2 id="speech-space-title" className="section-title" tabIndex={-1}>Espaço das gravações</h2>
          <p>{spaceLine(space)}</p>
          <p className="muted">{SPACE_RULE}</p>
          {space.waiting > 0 && (
            <p className="muted">
              {space.synced
                ? `${plural(space.waiting, 'gravação vai', 'gravações vão')} para o servidor na próxima sincronização.`
                : 'A sincronização não está conectada: as gravações ainda não foram para o servidor e ficam todas neste aparelho.'}
            </p>
          )}
          {space.candidates.length > 0 && !space.synced && (
            <p className="muted">Para tirar gravações deste aparelho, a sincronização precisa estar conectada: o app confere com o servidor antes.</p>
          )}
          {space.candidates.length > 0 && space.synced && (
            <div className="cluster">
              <Button ref={spaceButton} onClick={() => setSpaceOpen(true)}>Tirar gravações antigas deste aparelho</Button>
            </div>
          )}
        </section>
      )}

      <CompareSheet open={compareOpen} onClose={() => setCompareOpen(false)} sessions={sessions} />
      <SpaceSheet open={spaceOpen} onClose={() => setSpaceOpen(false)} candidates={space?.candidates ?? []}
        onFreed={() => focusWhenGone(spaceButton.current, () => document.getElementById('speech-space-title'))} />

      <VocalLimits />

      <SpeechSessionSheet key={sheet?.n} open={!!sheet} onClose={closeSheet} sessionId={sheet?.id} preset={sheet?.preset} />
    </section>
  );
}
