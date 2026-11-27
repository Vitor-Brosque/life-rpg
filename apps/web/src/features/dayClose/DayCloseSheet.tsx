import { useId, useState, type MouseEvent } from 'react';
import { useLocation } from 'wouter';
import type { DayCloseSummary, DayKey, DayState, DayStateChoices, DayStateKey, DiaryEntry, Mission } from '@life/shared';
import {
  BLOCK_OUTCOME_LABEL, CLOSE_BLOCK_LABEL, DAY_STATE_KEYS, DAY_STATE_LEGEND, DAY_STATE_OPTIONS, WORKOUT_LABEL, addDays,
  pickChoices, ulid,
} from '@life/shared';
import { diaryCloseId } from '@life/shared';
import { db } from '../../db/db';
import { useToday } from '../../db/hooks';
import { rescheduleMission } from '../../domain/actions';
import { closeDay, saveDayChoices } from '../../domain/dayCloseActions';
import { saveCloseNote } from '../../domain/diaryActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { focusWhenGone } from '../../ui/focusAfter';
import { formatClock, formatDuration, plural } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { DROP_REASONS } from '../agora/ReviewSheet';
import { dropWithFeedback } from '../mission/missionFeedback';
import { useSituationSheet } from '../speech/SituationSheet';
import { DayCloseCorrections } from './DayCloseCorrections';
import { useDayCloseData, useDayCloseSheet } from './useDayClose';
import './dayClose.css';

const toast = (msg: string) => useToast.getState().show(msg);

/** Mount once (App). The sheet shows today and writes nothing until a button is pressed. */
export function DayCloseSheetHost() {
  const { isOpen, close } = useDayCloseSheet();
  return (
    <Sheet open={isOpen} onClose={close} title="Como foi hoje">
      {isOpen && <DayCloseContent onClose={close} />}
    </Sheet>
  );
}

function DayCloseContent({ onClose }: { onClose(): void }) {
  const today = useToday();
  const data = useDayCloseData(today);
  if (!today || !data) return <div aria-busy="true" className="day-close" />;
  return <DayCloseForm today={today} summary={data.summary} state={data.state} closeEntry={data.closeEntry} onClose={onClose} />;
}

function observedLines(s: DayCloseSummary): string[] {
  const lines: string[] = [];
  const started = s.counts.normal + s.counts.minimo;
  const total = started + s.counts.pulado + s.counts['nao-iniciado'];
  if (total > 0) {
    lines.push(`${started} de ${total} blocos iniciados`
      + (s.counts.minimo ? ` (${s.counts.minimo} na versão mínima)` : '')
      + (s.counts.pulado ? ` · ${plural(s.counts.pulado, 'pulado', 'pulados')}` : '') + '.');
  }
  const done = s.completed.length;
  const inv = s.partial.filter((p) => p.investigated).length;
  const part = s.partial.length - inv;
  const tail = [part ? plural(part, 'parcial', 'parciais') : '', inv ? plural(inv, 'investigação', 'investigações') : '']
    .filter(Boolean).join(' · ');
  if (done > 0) lines.push(plural(done, 'missão concluída', 'missões concluídas') + (tail ? ` · ${tail}` : ''));
  else if (part > 0) lines.push(plural(part, 'missão parcial', 'missões parciais') + (inv ? ` · ${plural(inv, 'investigação', 'investigações')}` : ''));
  else if (inv > 0) lines.push(plural(inv, 'missão com investigação', 'missões com investigação'));
  if (s.focusMin > 0) lines.push(`${formatDuration(s.focusMin)} de foco registrado`);
  if (s.training) lines.push(s.training);
  else if (s.workouts.length > 0) lines.push(s.workouts.map((w) => `${WORKOUT_LABEL[w.kind]} ${w.minutes} min`).join(' · '));
  if (s.reviews > 0) lines.push(plural(s.reviews, 'card revisado', 'cards revisados'));
  if (s.practiceClosed > 0) lines.push(plural(s.practiceClosed, 'sessão de prática encerrada', 'sessões de prática encerradas'));
  return lines;
}

function Observed({ summary }: { summary: DayCloseSummary }) {
  const lines = observedLines(summary);
  const hasBlocks = summary.blocks.length > 0;
  return (
    <section className="day-close" aria-labelledby="day-close-observed">
      <h3 id="day-close-observed" tabIndex={-1}>Observado</h3>
      {!hasBlocks && <p className="day-close__line">Nenhum bloco planejado hoje.</p>}
      {lines.map((l) => <p key={l} className="day-close__line">{l}</p>)}
      {hasBlocks && (
        <ul className="day-close__list" aria-label="Blocos de hoje">
          {summary.blocks.map((b) => (
            <li key={b.blockId}>
              {`${b.name} — ${CLOSE_BLOCK_LABEL[b.state]}`
                + (b.retro ? ' · registrado depois' : '')
                + (b.startedAt !== undefined ? ` · ${formatClock(b.startedAt)}–${formatClock(b.endedAt ?? b.startedAt)}` : '')
                + (b.outcome ? ` · ${BLOCK_OUTCOME_LABEL[b.outcome]}` : '')}
            </li>
          ))}
        </ul>
      )}
      {summary.completed.length > 0 && (
        <ul className="day-close__list" aria-label="Missões concluídas hoje">
          {summary.completed.map((m) => <li key={m.id}>{m.title}</li>)}
        </ul>
      )}
      {!hasBlocks && lines.length === 0 && <p className="day-close__line">Nenhum registro hoje.</p>}
    </section>
  );
}

const pendingTarget = (): HTMLElement | null =>
  document.getElementById('day-close-pending') ?? document.getElementById('day-close-observed');

function PendingItem({ mission, today, onHandled, onUnhandled }: {
  mission: Mission; today: DayKey; onHandled(id: string): void; onUnhandled(id: string): void;
}) {
  const [mode, setMode] = useState<'pick' | 'drop'>();
  const tomorrow = addDays(today, 1);
  const [date, setDate] = useState(tomorrow);
  const titleId = useId();

  // Decided at the tap (the row leaves right away); a failed write brings it back. The row's controls go
  // with it: focus moves to "Pendências de hoje", or to "Observado" when it was the last one.
  const act = (fn: () => Promise<unknown>) => (e: MouseEvent<HTMLElement>) => {
    focusWhenGone(e.currentTarget, pendingTarget);
    onHandled(mission.id);
    safeRun(async () => {
      try {
        await fn();
      } catch (e) {
        onUnhandled(mission.id);
        throw e;
      }
    });
  };
  const moveTo = (day: DayKey) => act(() => rescheduleMission(mission.id, day));
  const drop = (reason?: string) => act(() => dropWithFeedback(mission.id, reason, () => onUnhandled(mission.id)));

  const title = mission.title;
  return (
    <li>
      <div className="day-close__item" role="group" aria-labelledby={titleId}>
        <span id={titleId} className="day-close__item-title">{title}</span>
        <div className="day-close__row-actions">
          <Button size="sm" aria-label={`Amanhã: ${title}`} onClick={moveTo(tomorrow)}>Amanhã</Button>
          <Button size="sm" aria-label={`Escolher dia para ${title}`} aria-expanded={mode === 'pick'}
            onClick={() => setMode(mode === 'pick' ? undefined : 'pick')}>
            Escolher dia
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Soltar ${title}`} aria-expanded={mode === 'drop'}
            onClick={() => setMode(mode === 'drop' ? undefined : 'drop')}>
            Soltar
          </Button>
        </div>
        {mode === 'pick' && (
          <div className="day-close__extra">
            <input type="date" aria-label={`Novo dia para ${title}`} value={date} min={tomorrow}
              onChange={(e) => setDate(e.target.value)} />
            <Button size="sm" variant="primary" aria-label={`Mover ${title}`} disabled={!date || date < tomorrow}
              onClick={moveTo(date)}>Mover</Button>
          </div>
        )}
        {mode === 'drop' && (
          <div className="day-close__extra" role="group" aria-labelledby={`${titleId}-reason`}>
            <span id={`${titleId}-reason`} className="day-close__extra-label">Motivo (opcional):</span>
            {DROP_REASONS.map((r) => <Chip key={r} aria-label={`${r} — soltar ${title}`} onClick={drop(r)}>{r}</Chip>)}
            <Chip aria-label={`só soltar ${title}`} onClick={drop()}>só soltar</Chip>
          </div>
        )}
      </div>
    </li>
  );
}

function DayCloseForm({ today, summary, state, closeEntry, onClose }: {
  today: DayKey; summary: DayCloseSummary; state?: DayState; closeEntry?: DiaryEntry; onClose(): void;
}) {
  const [handled, setHandled] = useState<ReadonlySet<string>>(new Set());
  // The four choices as they were when the sheet opened, and which ones he touched: only those are written.
  const [choices, setChoices] = useState<DayStateChoices>(() => ({
    tiredness: state?.tiredness, mood: state?.mood, load: state?.load, concentration: state?.concentration,
  }));
  const [touched, setTouched] = useState<ReadonlySet<DayStateKey>>(() => new Set());
  const stateId = useId();
  const choose = (key: DayStateKey, value: string) => {
    setChoices((c) => ({ ...c, [key]: c[key] === value ? undefined : value }) as DayStateChoices);
    setTouched((t) => new Set(t).add(key));
  };
  // The text shown when the sheet opened: the observation is written only when he changed it, so a newer
  // version (another device, the diary) is never replaced by this copy, nor trashed by an untouched empty field.
  // When he did change it, a version newer than this one is kept in Apagadas recentemente (saveCloseNote).
  const [initialNote] = useState(closeEntry?.text ?? '');
  const [note, setNote] = useState(initialNote);
  const noteChanged = note !== initialNote;
  const [busy, setBusy] = useState(false);
  const noteId = useId();
  const [, navigate] = useLocation();
  const pending = summary.pending.filter((m) => !handled.has(m.id));
  const closed = state?.closedAt;

  const mark = (id: string) => setHandled((s) => new Set(s).add(id));
  const unmark = (id: string) => setHandled((s) => {
    const next = new Set(s);
    next.delete(id);
    return next;
  });
  // His changed note goes over a version that changed while the sheet was open: saveCloseNote keeps that newer
  // version in Apagadas recentemente, and the toast says so (same condition as saveCloseNote's).
  // Read from the database at save time, so the check never depends on when the screen last re-rendered.
  const keepsNewer = async (): Promise<boolean> => {
    if (!noteChanged) return false;
    const fresh = await db.diaryEntries.get(diaryCloseId(today));
    return fresh !== undefined && fresh.trashedAt === undefined && !fresh.deleted
      && fresh.text !== initialNote && fresh.text.trim() !== note.trim();
  };
  const KEPT_NEWER = ' A versão mais nova da observação ficou em Apagadas recentemente.';
  // What he typed or tapped is kept before the sheet hands over to the diary or to "Situação real" (the day is not closed).
  const keepTyped = async (): Promise<void> => {
    const kept = await keepsNewer();
    if (noteChanged) await saveCloseNote(today, note, { shown: initialNote });
    if (touched.size > 0) await saveDayChoices(today, pickChoices(choices, touched));
    if (kept) toast(KEPT_NEWER.trim());
  };
  const save = () => {
    setBusy(true);
    safeRun(async () => {
      try {
        const kept = await keepsNewer();
        await closeDay(today, { ...pickChoices(choices, touched), ...(noteChanged ? { note, noteShown: initialNote } : {}) });
        toast(`${closed === undefined ? 'Dia fechado.' : 'Fechamento atualizado.'}${kept ? KEPT_NEWER : ''}`);
        onClose();
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <div className="day-close">
      <Observed summary={summary} />
      {pending.length > 0 && (
        <section className="day-close" aria-labelledby="day-close-pending">
          <h3 id="day-close-pending" tabIndex={-1}>Pendências de hoje</h3>
          <p className="day-close__hint">Amanhã, outro dia ou soltar — você escolhe.</p>
          <ul className="day-close__pending">
            {pending.map((m) => <PendingItem key={m.id} mission={m} today={today} onHandled={mark} onUnhandled={unmark} />)}
          </ul>
        </section>
      )}
      <div className="day-close__state" role="group" aria-labelledby={stateId}>
        <p id={stateId} className="day-close__state-title">Como você esteve (tudo opcional)</p>
        {DAY_STATE_KEYS.map((key) => (
          <fieldset key={key} className="day-close__tiredness">
            <legend>{DAY_STATE_LEGEND[key]}</legend>
            {DAY_STATE_OPTIONS[key].map((o) => (
              <Chip key={o.value} selected={choices[key] === o.value} onClick={() => choose(key, o.value)}>{o.label}</Chip>
            ))}
          </fieldset>
        ))}
      </div>
      <label className="field" htmlFor={noteId}>
        <span className="field__label">Observação (opcional)</span>
      </label>
      <textarea id={noteId} value={note} rows={4} placeholder="Escreva o quanto quiser, se quiser"
        aria-describedby={`${noteId}-hint`} onChange={(e) => setNote(e.target.value)} />
      <p id={`${noteId}-hint`} className="day-close__hint">Fica no diário como o fechamento do dia.</p>
      <div className="cluster">
        <Button size="sm" variant="ghost" icon="diary" onClick={() => safeRun(async () => {
          // What was typed is never lost: it is saved as the fechamento (the day is not closed by this).
          await keepTyped();
          onClose();
          navigate(`/diario/${ulid()}`);
        })}>Escrever no diário</Button>
        <Button size="sm" variant="ghost" icon="mic" onClick={() => safeRun(async () => {
          await keepTyped();
          onClose();
          useSituationSheet.getState().open();
        })}>Situação de fala</Button>
      </div>
      <DayCloseCorrections blocks={summary.blocks} focus={summary.focus} />
      <div className="day-close__footer">
        {closed !== undefined && <p className="day-close__hint">{`Dia fechado às ${formatClock(closed)}.`}</p>}
        <Button variant="primary" disabled={busy} onClick={save}>{closed === undefined ? 'Fechar o dia' : 'Salvar'}</Button>
      </div>
    </div>
  );
}
