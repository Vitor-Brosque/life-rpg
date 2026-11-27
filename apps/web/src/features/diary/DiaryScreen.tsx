import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import type { DayKey, DiaryEntry, DiaryFilters, DiaryReviewRef, DiaryTheme } from '@life/shared';
import {
  DIARY_LINK_LABEL, DIARY_THEMES, DIARY_THEME_LABEL, addDays, diaryClock, diaryDayTitle, diaryFiltering, diaryLinksInUse,
  diaryPreview, diaryWeekLabel, isValidDayKey, linkKey, sameWeekLastMonth, searchDiary, ulid, weekOfDay,
} from '@life/shared';
import { Icon } from '../../art/icons';
import { useDiaryEntries, useDiaryTrash, useDiaryWeek, useLinkNames } from '../../db/diaryData';
import { useToday } from '../../db/hooks';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { ObservationCard } from './ObservationCard';
import { DiaryExportSheet } from './DiaryExportSheet';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { formatDay, plural } from '../../ui/format';
import { keptStamp, useDiaryDrafts } from './diaryDraft';
import './diary.css';

/** `?semana=` when it is a valid day: the Monday of its week. */
function weekFromSearch(search: string): DayKey | undefined {
  const asked = new URLSearchParams(search).get('semana') ?? '';
  return isValidDayKey(asked) ? weekOfDay(asked) : undefined;
}

/** `/diario`: the week's entries (newest day first), search and filters across every week, Escrever. Reading never writes. */
export function DiaryScreen() {
  const today = useToday();
  const search = useSearch();
  const [, navigate] = useLocation();
  const [monday, setMonday] = useState<DayKey | undefined>(() => weekFromSearch(search));
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<DiaryFilters>({});
  const [exporting, setExporting] = useState(false);
  const current = today ? weekOfDay(today) : undefined;
  const shown = monday ?? current;

  // Links back from an entry (`?semana=`) choose the week again; the Diário tab (no `?semana=`) is this week.
  useEffect(() => {
    setMonday(weekFromSearch(search));
  }, [search]);

  const goTo = (week: DayKey) => {
    setMonday(week);
    navigate(`/diario?semana=${week}`, { replace: true });
  };

  return (
    <section className="screen diary stack" aria-labelledby="diary-title">
      <h1 id="diary-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Diário</h1>
      <p className="muted">Escreva livremente sobre o seu dia. Nada aqui é obrigatório.</p>
      <div className="diary__bar">
        <Button variant="primary" icon="pen" onClick={() => navigate(`/diario/${ulid()}`)}>Escrever</Button>
        <Button disabled={!shown} onClick={() => setExporting(true)}>Exportar semana</Button>
        <Link href="/diario/relatorios" className="btn btn--secondary btn--md">Relatórios</Link>
        <Link href="/diario/estrategias" className="btn btn--secondary btn--md">Estratégias</Link>
        <input type="search" aria-label="Buscar no diário" placeholder="Buscar no diário" value={query}
          id="diary-search" onChange={(e) => setQuery(e.target.value)} />
      </div>
      <ObservationCard />
      <DiaryFiltersPanel filters={filters} onChange={setFilters} />
      <KeptDrafts />
      {diaryFiltering(query, filters)
        ? <DiaryResults query={query} filters={filters} today={today} onClear={() => { setQuery(''); setFilters({}); document.getElementById('diary-search')?.focus(); }} />
        : shown && current && <DiaryWeekView monday={shown} current={current} onWeek={goTo} />}
      <TrashLink />
      {shown && <DiaryExportSheet open={exporting} monday={shown} onClose={() => setExporting(false)} />}
    </section>
  );
}

function DiaryWeekView({ monday, current, onWeek }: { monday: DayKey; current: DayKey; onWeek(week: DayKey): void }) {
  const groups = useDiaryWeek(monday);
  const names = useLinkNames() ?? {};
  const labelId = useId();
  return (
    <section className="stack" aria-labelledby={labelId}>
      <div className="diary__week">
        <h2 id={labelId} className="diary__week-label">{diaryWeekLabel(monday)}</h2>
        <div className="cluster">
          <Button size="sm" id="diary-prev-week" onClick={() => onWeek(addDays(monday, -7))}>Semana anterior</Button>
          <Button size="sm" disabled={monday >= current} onClick={() => {
            // Reaching this week disables the button: keep the focus on a control that stays.
            if (addDays(monday, 7) >= current) document.getElementById('diary-prev-week')?.focus();
            onWeek(addDays(monday, 7));
          }}>Próxima semana</Button>
          <Button size="sm" variant="ghost" onClick={() => onWeek(sameWeekLastMonth(monday))}>Mesma semana, mês passado</Button>
        </div>
      </div>
      {groups && groups.length === 0 && <p className="muted">Nenhuma entrada nesta semana.</p>}
      {groups?.map((g) => (
        <section key={g.day} className="diary__day" aria-labelledby={`diary-day-${g.day}`}>
          <h3 id={`diary-day-${g.day}`} className="diary__day-title">{diaryDayTitle(g.day)}</h3>
          {g.entries.length > 0 && (
            <ul className="diary__list">
              {g.entries.map((e) => <DiaryEntryItem key={e.id} entry={e} names={names} />)}
            </ul>
          )}
          {g.reviews.map((r) => <ReviewCard key={`${r.kind}-${r.id}`} review={r} />)}
        </section>
      ))}
    </section>
  );
}

/** One entry in a list: the time (with the day in search results), the first lines (opens it) and its marks. */
export function DiaryEntryItem({ entry, names, dayLabel }: { entry: DiaryEntry; names: Record<string, string>; dayLabel?: string }) {
  const links = entry.links.filter((l) => names[linkKey(l)] !== undefined);
  const marked = entry.kind === 'fechamento' || entry.private || entry.themes.length > 0 || links.length > 0;
  return (
    <li className="diary-entry">
      <Link href={`/diario/${entry.id}`} className="diary-entry__open">
        <span className="diary-entry__time">{dayLabel ? `${dayLabel} · ${diaryClock(entry.at)}` : diaryClock(entry.at)}</span>
        <span className="diary-entry__preview">{diaryPreview(entry.text) || '(sem texto)'}</span>
      </Link>
      {marked && (
        <ul className="diary-entry__tags" aria-label="Marcas da entrada">
          {entry.kind === 'fechamento' && <li className="tag tag--stone">fechamento do dia</li>}
          {entry.private && <li className="tag tag--stone"><Icon name="lock" size={12} />privada</li>}
          {entry.themes.map((t) => <li key={t} className="tag">{DIARY_THEME_LABEL[t]}</li>)}
          {links.map((l) => <li key={linkKey(l)} className="tag">{`${DIARY_LINK_LABEL[l.kind]}: ${names[linkKey(l)]}`}</li>)}
        </ul>
      )}
    </li>
  );
}

function ReviewCard({ review }: { review: DiaryReviewRef }) {
  const titleId = useId();
  return (
    <article className="diary-review" aria-labelledby={titleId}>
      <h4 id={titleId} className="diary-review__title">{`${review.title} · respondida em ${review.day.slice(8, 10)}/${review.day.slice(5, 7)}`}</h4>
      <dl>
        {review.answers.map((a) => (
          <div key={a.label}>
            <dt>{a.label}</dt>
            <dd>{a.text}</dd>
          </div>
        ))}
      </dl>
      {review.kind === 'month' && <Link href="/padroes" className="settings__back">Ver em Padrões</Link>}
    </article>
  );
}

function DiaryFiltersPanel({ filters, onChange }: { filters: DiaryFilters; onChange(f: DiaryFilters): void }) {
  const entries = useDiaryEntries();
  const names = useLinkNames() ?? {};
  const links = useMemo(() => diaryLinksInUse(entries ?? []).filter((l) => names[linkKey(l)] !== undefined), [entries, names]);
  const selectId = useId();
  const setTheme = (t: DiaryTheme) => onChange({ ...filters, theme: filters.theme === t ? undefined : t });
  return (
    <details className="diary__filters">
      <summary>Filtros</summary>
      <fieldset>
        <legend className="field__label">Tema</legend>
        <div className="cluster">
          {DIARY_THEMES.map((t) => (
            <Chip key={t} selected={filters.theme === t} onClick={() => setTheme(t)}>{DIARY_THEME_LABEL[t]}</Chip>
          ))}
        </div>
      </fieldset>
      <label className="field" htmlFor={selectId}>
        <span className="field__label">Vínculo</span>
      </label>
      <select id={selectId} value={filters.link ? linkKey(filters.link) : ''} onChange={(e) => {
        const link = links.find((l) => linkKey(l) === e.target.value);
        onChange({ ...filters, link });
      }}>
        <option value="">Todos</option>
        {links.map((l) => <option key={linkKey(l)} value={linkKey(l)}>{`${DIARY_LINK_LABEL[l.kind]}: ${names[linkKey(l)]}`}</option>)}
      </select>
      <div className="cluster">
        <Chip selected={filters.onlyPrivate === true} onClick={() => onChange({ ...filters, onlyPrivate: !filters.onlyPrivate })}>
          Só privadas
        </Chip>
      </div>
    </details>
  );
}

function DiaryResults({ query, filters, today, onClear }: {
  query: string; filters: DiaryFilters; today?: DayKey; onClear(): void;
}) {
  const entries = useDiaryEntries();
  const names = useLinkNames() ?? {};
  const found = useMemo(() => searchDiary(entries ?? [], query, filters), [entries, query, filters]);
  if (!entries) return null;
  return (
    <section className="stack" aria-labelledby="diary-results">
      <h2 id="diary-results" className="diary__week-label">Resultados</h2>
      <p role="status">{found.length === 0 ? 'Nada encontrado com esse filtro.' : plural(found.length, 'entrada encontrada', 'entradas encontradas')}</p>
      {found.length > 0 && (
        <ul className="diary__list">
          {found.map((e) => <DiaryEntryItem key={e.id} entry={e} names={names} dayLabel={today ? formatDay(e.day, today) : e.day} />)}
        </ul>
      )}
      <div className="cluster"><Button size="sm" variant="ghost" onClick={onClear}>Limpar busca</Button></div>
    </section>
  );
}

/**
 * Texts kept on this device that did not reach the database (the app closed first, a save that did not go
 * through, a newer text written elsewhere): one line per kept draft whose words are not its entry's text,
 * whatever the entry's version (missing, deleted for good, changed since or not), so none is ever out of
 * reach. Continuar opens the entry, where the editor decides whether the text comes back or waits for a choice.
 */
function KeptDrafts() {
  const drafts = useDiaryDrafts();
  const entries = useDiaryEntries();
  const shown = useMemo(() => {
    if (!entries) return [];
    const byId = new Map(entries.map((e) => [e.id, e]));
    return drafts.filter((k) => byId.get(k.id)?.text !== k.draft.text);
  }, [drafts, entries]);
  if (shown.length === 0) return null;
  return (
    <ul className="diary__list diary__kept" aria-label="Textos não salvos">
      {shown.map((k) => {
        const stamp = keptStamp(k.keptAt);
        return (
          <li key={k.id} className="diary__kept-row">
            <span>{`Texto não salvo de ${stamp}`}</span>
            <Link href={`/diario/${k.id}`} className="btn btn--secondary btn--sm" aria-label={`Continuar o texto de ${stamp}`}>Continuar</Link>
          </li>
        );
      })}
    </ul>
  );
}

function TrashLink() {
  const trashed = useDiaryTrash();
  if (!trashed || trashed.length === 0) return null;
  return <Link href="/diario/apagadas" className="settings__back">{`Apagadas recentemente (${trashed.length})`}</Link>;
}
