import { useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useLocation } from 'wouter';
import type { DiaryEntry, DiaryLink, ID } from '@life/shared';
import {
  DIARY_LINKS_MAX, DIARY_LINK_LABEL, DIARY_THEMES, DIARY_THEME_LABEL, dayKeyOf, diaryClock, diaryDayTitle, diaryMoment,
  linkKey, normalize, sameLink, weekOfDay,
} from '@life/shared';
import { useLinkNames, useDiaryEntry } from '../../db/diaryData';
import { useJourneys, useMissions, useSettings } from '../../db/hooks';
import { restoreDiaryEntry, trashDiaryEntry, type DiaryDraft } from '../../domain/diaryActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { FOCUS_PAGE, focusWhenGone } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { readDiaryDraft } from './diaryDraft';
import { useDiaryAutosave } from './useDiaryAutosave';
import '../plan/plan.css';
import './diary.css';

const PICKER_MAX = 8;
const weekHref = (day: string) => `/diario?semana=${weekOfDay(day)}`;

/** `/diario/:id`: an entry, or a new one when `id` has no record yet (nothing is written until there is text). */
export function DiaryEditorScreen({ id }: { id: ID }) {
  const entry = useDiaryEntry(id);
  const settings = useSettings();
  if (entry === undefined || !settings) return <section className="screen diary" aria-busy="true" />;
  if (entry?.deleted) {
    return (
      <section className="screen diary stack">
        <Link href="/diario" className="settings__back">‹ Diário</Link>
        <h1 tabIndex={-1} data-focus-target={FOCUS_PAGE}>Entrada do diário</h1>
        <p className="muted">Esta entrada foi apagada.</p>
      </section>
    );
  }
  if (entry && entry.trashedAt !== undefined) {
    return (
      <section className="screen diary stack">
        <Link href="/diario/apagadas" className="settings__back">‹ Apagadas recentemente</Link>
        <h1 tabIndex={-1} data-focus-target={FOCUS_PAGE}>Entrada do diário</h1>
        <p className="muted">Esta entrada está em Apagadas recentemente.</p>
        <div className="cluster"><Button onClick={() => safeRun(restoreDiaryEntry(id))}>Restaurar</Button></div>
      </section>
    );
  }
  return <DiaryEditorForm key={id} id={id} entry={entry ?? undefined} dayStartHour={settings.dayStartHour} />;
}

function startDraft(id: ID, entry: DiaryEntry | undefined, dayStartHour: number): { draft: DiaryDraft; restored: boolean } {
  const now = Date.now();
  const base: DiaryDraft = entry
    ? { text: entry.text, day: entry.day, at: entry.at, themes: entry.themes, links: entry.links, private: entry.private }
    : { text: '', day: dayKeyOf(now, dayStartHour), at: now, themes: [], links: [], private: false };
  const kept = readDiaryDraft(id);
  return kept && kept.text !== base.text ? { draft: kept, restored: true } : { draft: base, restored: false };
}

function DiaryEditorForm({ id, entry, dayStartHour }: { id: ID; entry?: DiaryEntry; dayStartHour: number }) {
  const [start] = useState(() => startDraft(id, entry, dayStartHour));
  const isNew = entry === undefined;
  const auto = useDiaryAutosave(id, start.draft, isNew, start.restored);
  const { draft } = auto;
  const live = useDiaryEntry(id);
  const [, navigate] = useLocation();
  const textId = useId();
  const [moving, setMoving] = useState(false);
  const fechamento = entry?.kind === 'fechamento';

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
      <h1 tabIndex={-1} data-focus-target={FOCUS_PAGE}>{isNew ? 'Nova entrada' : 'Entrada do diário'}</h1>
      <p className="diary-editor__when">
        {`${diaryDayTitle(draft.day)} · ${diaryClock(draft.at)}`}{fechamento ? ' · fechamento do dia' : ''}
      </p>
      <label htmlFor={textId} className="visually-hidden">Texto da entrada</label>
      <textarea id={textId} className="diary-editor__text" value={draft.text} rows={10} autoFocus={isNew}
        placeholder="Escreva livremente." onChange={(e) => auto.type(e.target.value)} />
      <p className="diary-editor__status">
        {!draft.text.trim() && !isNew ? 'Texto vazio não é salvo. Para tirar a entrada, use Apagar.'
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
