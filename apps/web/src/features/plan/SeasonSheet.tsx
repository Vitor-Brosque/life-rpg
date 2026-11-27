import { useId, useState } from 'react';
import type { DayKey, Season, SeasonDraft, SeasonFocusDraft } from '@life/shared';
import {
  SEASON_FOCUS_TEXT_MAX, SEASON_ISSUE_TEXT, SEASON_TITLE_MAX, SEASON_WEEKS, SEASON_WEEKS_LABEL, isValidDayKey, newSeasonDraft,
  pickableGoals, seasonDraftOf, seasonIssue, seasonLinkFrom, seasonLinkValue, seasonWeek, testingStrategies,
} from '@life/shared';
import { useGoals } from '../../db/goalData';
import { useAtypicalWeeks } from '../../db/seasonData';
import { useStrategies } from '../../db/strategyData';
import { SeasonError, startSeason, updateSeason } from '../../domain/seasonActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import './plan.css';

/** What the sheet shows: a new season or the active one, as it was when tapped. */
export type SeasonTarget = { kind: 'new' } | { kind: 'edit'; season: Season };

const ddmm = (day: DayKey): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const toast = (msg: string) => useToast.getState().show(msg);
const FOCUS_PLACEHOLDER = ['Ex.: bloco do Tech News todo dia útil', 'Ex.: fala, fase 1'];

export interface SeasonSheetProps {
  target?: SeasonTarget;
  today: DayKey;
  onClose(): void;
  /** "Rever e encerrar agora" (editing only): opens the review. */
  onEnd?(): void;
}

/** "Nova temporada" / "Temporada". Opening writes nothing; every write is a button. */
export function SeasonSheet({ target, today, onClose, onEnd }: SeasonSheetProps) {
  return (
    <Sheet open={target !== undefined} onClose={onClose} title={target?.kind === 'edit' ? 'Temporada' : 'Nova temporada'}>
      {target && (
        <SeasonForm key={target.kind === 'edit' ? target.season.id : 'new'} target={target} today={today} onClose={onClose} onEnd={onEnd} />
      )}
    </Sheet>
  );
}

function SeasonForm({ target, today, onClose, onEnd }: Omit<SeasonSheetProps, 'target'> & { target: SeasonTarget }) {
  const editing = target.kind === 'edit' ? target.season : undefined;
  // The values when the sheet opened: "Salvar" writes only what differs from them (seasonChanges).
  const [initial] = useState<SeasonDraft>(() => (editing ? seasonDraftOf(editing) : newSeasonDraft(today)));
  const [draft, setDraft] = useState<SeasonDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const goals = useGoals();
  const strategies = useStrategies();
  const atypical = useAtypicalWeeks();
  const id = useId();
  const issue = seasonIssue(draft, today);
  const goalOptions = pickableGoals(goals ?? []);
  const strategyOptions = testingStrategies(strategies ?? [], today);
  const names: Record<string, string> = {};
  for (const g of goals ?? []) names[`goal:${g.id}`] = g.title;
  for (const s of strategies ?? []) names[`strategy:${s.id}`] = s.title;
  const offered = new Set([...goalOptions.map((g) => `goal:${g.id}`), ...strategyOptions.map((s) => `strategy:${s.id}`)]);
  const end = atypical && isValidDayKey(draft.startDay) ? seasonWeek(draft, atypical, draft.startDay).lastWeek : undefined;
  const setFocus = (i: number, changes: Partial<SeasonFocusDraft>) =>
    setDraft((d) => ({ ...d, focus: d.focus.map((f, j) => (j === i ? { ...f, ...changes } : f)) }));

  const save = () => {
    setBusy(true);
    setRefusal('');
    safeRun((async () => {
      try {
        if (!editing) {
          await startSeason(draft);
          toast('Temporada começou. Ela fica aqui, no topo da Semana.');
        } else if (await updateSeason(editing.id, initial, draft)) {
          toast('Temporada salva.');
        }
        onClose();
      } catch (e) {
        // A refusal of the rules: its own message, here; the sheet stays open with what he typed.
        if (!(e instanceof SeasonError)) throw e;
        setRefusal(e.message);
      }
    })().finally(() => setBusy(false)));
  };

  return (
    <div className="goal-form season-form stack">
      <label className="field" htmlFor={`${id}-title`}>
        <span className="field__label">Nome da temporada</span>
        <input id={`${id}-title`} type="text" value={draft.title} maxLength={SEASON_TITLE_MAX} autoFocus={!editing}
          placeholder="Ex.: Consistência no Tech News" onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
      </label>
      {draft.focus.map((f, i) => {
        const value = seasonLinkValue(f.link);
        return (
          <div key={i} className="season-form__focus stack">
            <label className="field" htmlFor={`${id}-focus-${i}`}>
              <span className="field__label">{`Foco ${i + 1} (opcional)`}</span>
              <input id={`${id}-focus-${i}`} type="text" value={f.text} maxLength={SEASON_FOCUS_TEXT_MAX}
                placeholder={FOCUS_PLACEHOLDER[i]} onChange={(e) => setFocus(i, { text: e.target.value })} />
            </label>
            <label className="field" htmlFor={`${id}-link-${i}`}>
              <span className="field__label">{`Ligar o foco ${i + 1} a (opcional)`}</span>
              <select id={`${id}-link-${i}`} value={value} onChange={(e) => setFocus(i, { link: seasonLinkFrom(e.target.value) })}>
                <option value="">Nada</option>
                {value !== '' && !offered.has(value) && <option value={value}>{names[value] ?? 'Vínculo atual'}</option>}
                {goalOptions.length > 0 && (
                  <optgroup label="Objetivos">
                    {goalOptions.map((g) => <option key={g.id} value={`goal:${g.id}`}>{g.title}</option>)}
                  </optgroup>
                )}
                {strategyOptions.length > 0 && (
                  <optgroup label="Estratégias em teste">
                    {strategyOptions.map((s) => <option key={s.id} value={`strategy:${s.id}`}>{s.title}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
          </div>
        );
      })}
      <label className="field" htmlFor={`${id}-start`}>
        <span className="field__label">Começa em</span>
        <input id={`${id}-start`} type="date" value={draft.startDay} max={today}
          onChange={(e) => setDraft((d) => ({ ...d, startDay: e.target.value }))} />
      </label>
      <fieldset className="goal-form__chips">
        <legend className="field__label">Duração</legend>
        {SEASON_WEEKS.map((n) => (
          <Chip key={n} selected={draft.plannedWeeks === n} onClick={() => setDraft((d) => ({ ...d, plannedWeeks: n }))}>
            {SEASON_WEEKS_LABEL[n]!}
          </Chip>
        ))}
        {end && <p className="goal-form__note">{`Termina na semana de ${ddmm(end)}. Semanas atípicas não entram na conta.`}</p>}
      </fieldset>
      <p className="season-form__issue" aria-live="polite">{issue === 'start' ? SEASON_ISSUE_TEXT.start : refusal}</p>
      <div className="cluster">
        <Button variant="primary" disabled={busy || issue !== undefined} onClick={save}>{editing ? 'Salvar' : 'Começar temporada'}</Button>
        {!editing && <Button variant="ghost" onClick={onClose}>Cancelar</Button>}
      </div>
      {editing && onEnd && (
        <div className="cluster">
          <Button size="sm" variant="ghost" onClick={onEnd}>Rever e encerrar agora</Button>
        </div>
      )}
    </div>
  );
}
