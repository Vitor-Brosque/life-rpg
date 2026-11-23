import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useLocation } from 'wouter';
import type { DiaryEntry, DiaryKind, DiaryLink, ID } from '@life/shared';
import {
  DIARY_LINKS_MAX, DIARY_LINK_LABEL, DIARY_THEMES, DIARY_THEME_LABEL, dayKeyOf, diaryClock, diaryDayTitle, diaryMoment,
  diaryPreview, linkKey, normalize, sameLink, weekOfDay,
} from '@life/shared';
import { useLinkNames, useDiaryEntry } from '../../db/diaryData';
import { useJourneys, useMissions, useSettings } from '../../db/hooks';
import { diaryDraftOf, restoreDiaryEntry, saveDiaryEntry, trashDiaryEntry, type DiaryDraft } from '../../domain/diaryActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { FOCUS_PAGE, focusIfLost, focusWhenGone } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { clearDiaryDraft, keptStamp, readDiaryDraft, useDiaryDrafts, type KeptDiaryDraft } from './diaryDraft';
import { useDiaryAutosave, type DiaryStart } from './useDiaryAutosave';
import '../plan/plan.css';
import './diary.css';

const PICKER_MAX = 8;
const weekHref = (day: string) => `/diario?semana=${weekOfDay(day)}`;

/** `/diario/:id`: an entry, or a new one when `id` has no record yet (nothing is written until there is text). */
export function DiaryEditorScreen({ id }: { id: ID }) {
  const entry = useDiaryEntry(id);
  const settings = useSettings();
  // The text this screen last saw the entry with, for when it is then deleted for good (elsewhere).
  const seen = useRef<{ id: ID; text: string }>(undefined);
  useEffect(() => {
    if (entry && !entry.deleted) seen.current = { id, text: entry.text };
  }, [id, entry]);
  if (entry === undefined || !settings) return <section className="screen diary" aria-busy="true" />;
  if (entry?.deleted) {
    return (
      <section className="screen diary stack">
        <Link href="/diario" className="settings__back">‹ Diário</Link>
        <h1 tabIndex={-1} data-focus-target={FOCUS_PAGE}>Entrada do diário</h1>
        <p className="muted">Esta entrada foi apagada.</p>
        <KeptOnDeleted id={id} kind={entry.kind} formerText={seen.current?.id === id ? seen.current.text : undefined} />
      </section>
    );
  }
  if (entry && entry.trashedAt !== undefined) {
    return (
      <section className="screen diary stack">
        <Link href="/diario/apagadas" className="settings__back">‹ Apagadas recentemente</Link>
        <h1 tabIndex={-1} data-focus-target={FOCUS_PAGE}>Entrada do diário</h1>
        <p className="muted">Esta entrada está em Apagadas recentemente.</p>
        <div className="cluster">
          <Button onClick={(e) => {
            focusWhenGone(e.currentTarget);
            safeRun(restoreDiaryEntry(id));
          }}>Restaurar</Button>
        </div>
      </section>
    );
  }
  return <DiaryEditorForm id={id} entry={entry ?? undefined} dayStartHour={settings.dayStartHour} />;
}

const draftKey = (d: DiaryDraft): string =>
  JSON.stringify([d.text, d.day, d.at, d.themes, d.links.map((l) => [l.kind, l.id]), d.private]);

/**
 * How the editor opens `entry` (missing = never saved). A draft kept on this device comes back when the
 * record is missing or still is the version the draft was based on; when the record changed since, the field
 * shows the database text and the kept text waits for a choice (only when the texts differ).
 */
function startOf(id: ID, entry: DiaryEntry | undefined, dayStartHour: number): DiaryStart {
  const now = Date.now();
  const shown: DiaryDraft = entry
    ? diaryDraftOf(entry)
    : { text: '', day: dayKeyOf(now, dayStartHour), at: now, themes: [], links: [], private: false };
  const common = {
    isNew: entry === undefined, kind: entry?.kind ?? 'livre',
    base: entry ? { updatedAt: entry.updatedAt, text: entry.text } : { text: '' },
  } as const;
  const kept = readDiaryDraft(id);
  if (kept && (!entry || kept.base === entry.updatedAt)) {
    if (draftKey(kept.draft) !== draftKey(shown)) return { ...common, draft: kept.draft, restored: true };
  } else if (kept && entry && kept.draft.text !== entry.text) {
    return { ...common, draft: shown, restored: false, conflict: kept };
  }
  return { ...common, draft: shown, restored: false };
}

/** "Há um texto não salvo deste aparelho…": the kept text, with Usar este texto and Descartar. */
function KeptNotice({ kept, labelId, onTake, onDrop }: {
  kept: KeptDiaryDraft; labelId: string; onTake(e: MouseEvent<HTMLElement>): void; onDrop(e: MouseEvent<HTMLElement>): void;
}) {
  return (
    <div className="diary-editor__kept stack" role="group" aria-labelledby={labelId}>
      <p id={labelId} className="diary-editor__kept-title">{`Há um texto não salvo deste aparelho, de ${keptStamp(kept.keptAt)}.`}</p>
      <p className="diary-editor__kept-text">{diaryPreview(kept.draft.text)}</p>
      <div className="cluster">
        <Button size="sm" variant="primary" onClick={onTake}>Usar este texto</Button>
        <Button size="sm" variant="ghost" onClick={onDrop}>Descartar</Button>
      </div>
    </div>
  );
}

/**
 * An entry deleted for good elsewhere while this device kept a draft of it: the draft can bring it back. The
 * drafts are read live (one kept by a save that did not go through on leaving the form shows at once). A draft
 * holding the very text the entry had when this screen last saw it is no unsaved text: it is forgotten, so
 * the words deleted for good leave this device too.
 */
function KeptOnDeleted({ id, kind, formerText }: { id: ID; kind: DiaryKind; formerText?: string }) {
  const kept = useDiaryDrafts().find((k) => k.id === id);
  const labelId = useId();
  const stale = kept !== undefined && formerText !== undefined && kept.draft.text === formerText;
  useEffect(() => {
    if (stale) clearDiaryDraft(id);
  }, [stale, id]);
  if (!kept || stale) return null;
  return (
    <KeptNotice kept={kept} labelId={labelId}
      onTake={(e) => {
        focusWhenGone(e.currentTarget);
        safeRun(async () => {
          await saveDiaryEntry(id, kept.draft, { kind });
          clearDiaryDraft(id);
        });
      }}
      onDrop={(e) => {
        focusWhenGone(e.currentTarget);
        clearDiaryDraft(id);
      }} />
  );
}

function DiaryEditorForm({ id, entry, dayStartHour }: { id: ID; entry?: DiaryEntry; dayStartHour: number }) {
  const [start] = useState(() => startOf(id, entry, dayStartHour));
  const { isNew } = start; // frozen: this session created the entry or did not
  const auto = useDiaryAutosave(id, start);
  const { draft } = auto;
  const live = useDiaryEntry(id);
  const [, navigate] = useLocation();
  const textId = useId();
  const keptId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [moving, setMoving] = useState(false);
  const fechamento = entry?.kind === 'fechamento';

  // An existing entry opened from a list: the tapped link is gone, so focus goes to the heading, not <body>.
  useEffect(() => {
    if (!isNew) focusIfLost(heading.current);
  }, [isNew]);
  const toText = (e: MouseEvent<HTMLElement>) => focusWhenGone(e.currentTarget, () => textRef.current);

  const leaveTo = (e: MouseEvent<HTMLElement>) => {
    focusWhenGone(e.currentTarget);
    navigate(weekHref(draft.day));
  };
  const trash = (e: MouseEvent<HTMLElement>) => safeRun(async () => {
    focusWhenGone(e.currentTarget);
    await auto.flush();
    auto.markGone();
    await trashDiaryEntry(id);
    useToast.getState().show('Entrada em Apagadas recentemente.', { label: 'Desfazer', run: () => safeRun(restoreDiaryEntry(id)) });
    navigate(weekHref(draft.day));
  });

  return (
    <section className="screen diary diary-editor stack">
      <Link href={weekHref(draft.day)} className="settings__back">‹ Diário</Link>
      <h1 ref={heading} tabIndex={-1} data-focus-target={FOCUS_PAGE}>{isNew ? 'Nova entrada' : 'Entrada do diário'}</h1>
      <p className="diary-editor__when">
        {`${diaryDayTitle(draft.day)} · ${diaryClock(draft.at)}`}{fechamento ? ' · fechamento do dia' : ''}
      </p>
      {auto.conflict && (
        <KeptNotice kept={auto.conflict} labelId={keptId}
          onTake={(e) => { toText(e); auto.takeKept(); }}
          onDrop={(e) => { toText(e); auto.dropKept(); }} />
      )}
      <label htmlFor={textId} className="visually-hidden">Texto da entrada</label>
      {/* Read-only while a kept text waits for a choice, so neither text can be lost. */}
      <textarea ref={textRef} id={textId} className="diary-editor__text" value={draft.text} rows={10} autoFocus={isNew}
        readOnly={auto.conflict !== undefined} aria-describedby={auto.conflict ? keptId : undefined}
        placeholder="Escreva livremente." onChange={(e) => auto.type(e.target.value)} />
      <p className="diary-editor__status">
        {auto.conflict ? 'Escolha um dos textos acima para continuar.'
          : !draft.text.trim() && !isNew ? 'Texto vazio não é salvo. Para tirar a entrada, use Apagar.'
            : auto.savedAt !== undefined ? `Salvo às ${diaryClock(auto.savedAt)}.`
              : 'A entrada é salva sozinha enquanto você escreve.'}
      </p>

      <div className="diary-editor__options stack">
        {!fechamento && (
          <div className="stack">
            <Button size="sm" variant="ghost" aria-expanded={moving} onClick={() => setMoving((v) => !v)}>Mudar data e hora</Button>
            {moving && (
              <div className="cluster">
                <label className="field">
                  <span className="field__label">Dia</span>
                  <input type="date" value={draft.day} onChange={(e) => {
                    const m = diaryMoment(e.target.value, diaryClock(draft.at), dayStartHour);
                    if (m) auto.change(m);
                  }} />
                </label>
                <label className="field">
                  <span className="field__label">Hora</span>
                  <input type="time" value={diaryClock(draft.at)} onChange={(e) => {
                    const m = diaryMoment(draft.day, e.target.value, dayStartHour);
                    if (m) auto.change(m);
                  }} />
                </label>
              </div>
            )}
          </div>
        )}
        <LinkPicker links={draft.links} onChange={(links) => auto.change({ links })} />
        <fieldset className="diary-editor__themes">
          <legend className="field__label">Temas</legend>
          <div className="cluster">
            {DIARY_THEMES.map((t) => (
              <Chip key={t} selected={draft.themes.includes(t)} onClick={() => auto.change({
                themes: draft.themes.includes(t) ? draft.themes.filter((x) => x !== t) : [...draft.themes, t],
              })}>{DIARY_THEME_LABEL[t]}</Chip>
            ))}
          </div>
        </fieldset>
        <button type="button" role="switch" aria-checked={draft.private} className="switch-row"
          onClick={() => auto.change({ private: !draft.private })}>
          <span className="switch-row__track" aria-hidden="true"><span className="switch-row__thumb" /></span>
          <span>Privada</span>
        </button>
        <p className="diary-editor__hint">Uma entrada privada fica fora das exportações, a menos que você a inclua.</p>
      </div>

      <div className="cluster diary-editor__footer">
        <Button variant="primary" onClick={leaveTo}>Pronto</Button>
        {live && !live.deleted && live.trashedAt === undefined && <Button variant="ghost" icon="trash" onClick={trash}>Apagar</Button>}
      </div>
    </section>
  );
}

/** "Ligar a…": a journey (the subjects are journeys) or a mission, up to DIARY_LINKS_MAX. */
function LinkPicker({ links, onChange }: { links: DiaryLink[]; onChange(links: DiaryLink[]): void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const names = useLinkNames() ?? {};
  const journeys = useJourneys();
  const missions = useMissions();
  const options = useMemo(() => {
    const q = normalize(query.trim());
    const all: Array<{ link: DiaryLink; title: string }> = [
      ...journeys.filter((j) => j.status === 'active').map((j) => ({ link: { kind: 'journey' as const, id: j.id }, title: j.title })),
      ...missions.filter((m) => m.status === 'open' || m.status === 'doing').map((m) => ({ link: { kind: 'mission' as const, id: m.id }, title: m.title })),
    ];
    return all.filter((o) => !links.some((l) => sameLink(l, o.link)) && normalize(o.title).includes(q)).slice(0, PICKER_MAX);
  }, [journeys, missions, links, query]);
  const full = links.length >= DIARY_LINKS_MAX;
  const hintId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="stack">
      {links.length > 0 && (
        <ul className="cluster diary-editor__links" aria-label="Ligada a">
          {links.map((l) => {
            const name = names[linkKey(l)] ?? 'item apagado';
            return (
              <li key={linkKey(l)}>
                <Chip removeLabel={`Desligar ${name}`} onRemove={() => {
                  focusWhenGone(document.activeElement, () => toggleRef.current);
                  onChange(links.filter((x) => !sameLink(x, l)));
                }}>
                  {`${DIARY_LINK_LABEL[l.kind]}: ${name}`}
                </Chip>
              </li>
            );
          })}
        </ul>
      )}
      <Button ref={toggleRef} size="sm" variant="ghost" aria-expanded={open} disabled={full} aria-describedby={full ? hintId : undefined}
        onClick={() => setOpen((v) => !v)}>Ligar a…</Button>
      {full && <p id={hintId} className="diary-editor__hint">{`Até ${DIARY_LINKS_MAX} vínculos por entrada.`}</p>}
      {open && !full && (
        <div className="diary-editor__picker stack" role="group" aria-label="Ligar a uma missão ou jornada">
          <input type="search" aria-label="Buscar missão ou jornada" placeholder="Buscar missão ou jornada" value={query}
            onChange={(e) => setQuery(e.target.value)} />
          {options.length === 0 && <p className="muted">Nada encontrado.</p>}
          <ul className="diary-editor__options-list">
            {options.map((o) => (
              <li key={linkKey(o.link)}>
                <Button size="sm" className="diary-editor__option" onClick={(e) => {
                  const label = `Desligar ${o.title}`;
                  focusWhenGone(e.currentTarget, () => [...document.querySelectorAll<HTMLElement>('.diary-editor__links .chip__remove')]
                    .find((b) => b.getAttribute('aria-label') === label) ?? toggleRef.current);
                  onChange([...links, o.link]);
                  setOpen(false);
                  setQuery('');
                }}>{`${DIARY_LINK_LABEL[o.link.kind]}: ${o.title}`}</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
