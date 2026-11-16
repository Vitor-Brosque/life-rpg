import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'wouter';
import type { DayKey, Journey } from '@life/shared';
import { ASSESSMENT_LABEL, addDays, describeRecurrence, subjectJourneys } from '@life/shared';
import { areaIcon, Icon } from '../../art/icons';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { DURATION_OPTIONS, ENERGY_LABEL, ENERGY_OPTIONS, WEEKDAY_ABBR, formatDay, formatDuration } from '../../ui/format';
import { RecurrencePicker } from '../mission/RecurrencePicker';
import {
  dayWhen, defaultEnd, type CaptureCtx, type CaptureSections, type CaptureView, type JourneyChoice, type Section,
} from './captureModel';
import '../mission/mission.css';
import '../plan/plan.css';

export type RowId =
  | 'when' | 'recurrence' | 'journey' | 'area' | 'duration' | 'energy'
  | 'day' | 'start' | 'end' | 'weekdays' | 'until' | 'subject' | 'date' | 'deck';

export type ChooseFn = <S extends Section, F extends keyof CaptureSections[S] & string>(
  section: S, field: F, value: CaptureSections[S][F],
) => void;

export interface CaptureOptionsProps {
  view: CaptureView;
  ctx: CaptureCtx;
  /** The one open panel (one at a time). */
  openRow?: RowId;
  onToggleRow(id: RowId): void;
  choose: ChooseFn;
  /** "Cadastrar em Matérias": the "+" closes before the route changes. */
  onLeave(): void;
}

interface RowProps {
  id: RowId; label: string; value: string; required?: boolean; openRow?: RowId; onToggleRow(id: RowId): void; children: ReactNode;
}

/** One option row: label + current value; tapping opens its panel inside the same sheet. */
function OptionRow({ id, label, value, required = false, openRow, onToggleRow, children }: RowProps) {
  const panelId = useId();
  const open = openRow === id;
  const panelRef = useRef<HTMLDivElement>(null);
  // An opened panel may sit below the fold of the sheet; bring it into view (jsdom has no scrollIntoView).
  useEffect(() => {
    if (open) panelRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);
  return (
    <div className="capture-opt">
      <button type="button" className="capture-opt__row" aria-expanded={open} aria-controls={open ? panelId : undefined}
        aria-label={`${label}: ${value}`} onClick={() => onToggleRow(id)}>
        <span className="capture-opt__label">
          {label}{required && <span className="capture-opt__req" aria-hidden="true"> *</span>}
        </span>
        <span className="capture-opt__value">{value}</span>
        <span className="capture-opt__mark" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div ref={panelRef} id={panelId} className="capture-opt__panel" role="group" aria-label={label}>{children}</div>}
    </div>
  );
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch-row capture-opt__switch"
      onClick={() => onChange(!checked)}>
      <span className="switch-row__track" aria-hidden="true"><span className="switch-row__thumb" /></span>
      <span>{label}</span>
    </button>
  );
}

/** Sem data (optional) · Hoje · Amanhã · Escolher dia. */
function DayChoices({ value, today, allowNone, onPick }: {
  value?: DayKey; today: DayKey; allowNone: boolean; onPick(day: DayKey | undefined): void;
}) {
  const tomorrow = addDays(today, 1);
  return (
    <>
      <div className="cluster">
        {allowNone && <Chip selected={value === undefined} onClick={() => onPick(undefined)}>Sem data</Chip>}
        <Chip selected={value === today} onClick={() => onPick(today)}>Hoje</Chip>
        <Chip selected={value === tomorrow} onClick={() => onPick(tomorrow)}>Amanhã</Chip>
      </div>
      <label className="capture-opt__field">
        <span>Escolher dia</span>
        <input type="date" value={value ?? ''} onChange={(e) => onPick(e.target.value || undefined)} />
      </label>
    </>
  );
}

function journeyText(choice: JourneyChoice, ctx: CaptureCtx): string {
  if (choice === null) return 'Nenhuma';
  if ('newName' in choice) return `Nova jornada: ${choice.newName}`;
  return ctx.journeys.find((j) => j.id === choice.id)?.title ?? 'Nenhuma';
}

/** Nenhuma · disciplinas (under "Faculdade") · other active journeys · "Nova jornada…" (created only by Salvar). */
function JourneyPanel({ value, ctx, onPick }: { value: JourneyChoice; ctx: CaptureCtx; onPick(j: JourneyChoice): void }) {
  const subLabel = useId();
  const [naming, setNaming] = useState(false);
  const newChipsRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(value !== null && 'newName' in value ? value.newName : '');
  const subjects = subjectJourneys(ctx.journeys);
  const others = ctx.journeys.filter((j) => j.status === 'active' && j.subject !== true).sort((a, b) => a.order - b.order);
  const picked = (j: Journey): boolean => value !== null && 'id' in value && value.id === j.id;
  const chip = (j: Journey) => <Chip key={j.id} selected={picked(j)} onClick={() => { setNaming(false); onPick({ id: j.id }); }}>{j.title}</Chip>;
  const use = () => {
    const n = name.trim();
    if (!n) return;
    // The field unmounts with the focus inside it: move the focus to the "Nova jornada…" chip (now pressed).
    flushSync(() => {
      onPick({ newName: n });
      setNaming(false);
    });
    newChipsRef.current?.querySelector<HTMLElement>('button[aria-pressed="true"]')?.focus();
  };
  return (
    <>
      <div className="cluster">
        <Chip selected={value === null} onClick={() => { setNaming(false); onPick(null); }}>Nenhuma</Chip>
      </div>
      {subjects.length > 0 && (
        <div className="capture-opt__sub" role="group" aria-labelledby={subLabel}>
          <span id={subLabel} className="capture-opt__sublabel">Faculdade</span>
          <div className="cluster">{subjects.map(chip)}</div>
        </div>
      )}
      <div className="cluster" ref={newChipsRef}>
        {others.map(chip)}
        <Chip selected={naming || (value !== null && 'newName' in value)} onClick={() => setNaming(true)}>Nova jornada…</Chip>
      </div>
      {naming && (
        <div className="capture-opt__new">
          <label className="capture-opt__field">
            <span>Nome da nova jornada</span>
            <input
              type="text"
              value={name}
              autoComplete="off"
              enterKeyHint="done"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); use(); } }}
            />
          </label>
          <Button size="sm" onClick={use}>Usar este nome</Button>
        </div>
      )}
    </>
  );
}

function TaskOptions({ view, ctx, openRow, onToggleRow, choose }: CaptureOptionsProps) {
  const t = view.task;
  const row = { openRow, onToggleRow };
  const whenDay = t.when.kind === 'day' ? t.when.day : undefined;
  return (
    <>
      <OptionRow id="when" label="Quando" value={whenDay ? formatDay(whenDay, ctx.today) : 'Sem data'} {...row}>
        <DayChoices value={whenDay} today={ctx.today} allowNone
          onPick={(d) => choose('task', 'when', d ? dayWhen(d) : { kind: 'none' })} />
      </OptionRow>
      <OptionRow id="recurrence" label="Repetir" value={t.recurrence ? describeRecurrence(t.recurrence) : 'Não repete'} {...row}>
        <RecurrencePicker value={t.recurrence ?? undefined} baseDay={whenDay ?? ctx.today}
          onChange={(r) => choose('task', 'recurrence', r ?? null)} />
      </OptionRow>
      <OptionRow id="journey" label="Jornada" value={journeyText(t.journey, ctx)} {...row}>
        <JourneyPanel value={t.journey} ctx={ctx} onPick={(j) => choose('task', 'journey', j)} />
      </OptionRow>
      <OptionRow id="area" label="Área" value={ctx.areas.find((a) => a.id === t.areaId)?.name ?? 'Nenhuma'} {...row}>
        <div className="cluster">
          <Chip selected={t.areaId === null} onClick={() => choose('task', 'areaId', null)}>Nenhuma</Chip>
          {ctx.areas.map((a) => (
            <Chip key={a.id} selected={t.areaId === a.id} onClick={() => choose('task', 'areaId', a.id)}>
              <span className="chip-icon" style={{ color: t.areaId === a.id ? undefined : a.color }}>
                <Icon name={areaIcon(a.icon)} size={12} />
              </span>
              {a.name}
            </Chip>
          ))}
        </div>
      </OptionRow>
      <OptionRow id="duration" label="Duração" value={t.durationMin !== null ? formatDuration(t.durationMin) : '—'} {...row}>
        <div className="cluster">
          {DURATION_OPTIONS.map((d) => (
            <Chip key={d} selected={t.durationMin === d}
              onClick={() => choose('task', 'durationMin', t.durationMin === d ? null : d)}>
              {formatDuration(d)}
            </Chip>
          ))}
        </div>
      </OptionRow>
      <OptionRow id="energy" label="Energia" value={t.energy ? ENERGY_LABEL[t.energy] : '—'} {...row}>
        <div className="cluster">
          {ENERGY_OPTIONS.map((e) => (
            <Chip key={e} selected={t.energy === e} onClick={() => choose('task', 'energy', t.energy === e ? null : e)}>
              {ENERGY_LABEL[e]}
            </Chip>
          ))}
        </div>
      </OptionRow>
      <SwitchRow label="Importante" checked={t.important} onChange={(v) => choose('task', 'important', v)} />
    </>
  );
}

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_NAME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function CommitmentOptions({ view, ctx, openRow, onToggleRow, choose }: CaptureOptionsProps) {
  const c = view.commitment;
  const row = { openRow, onToggleRow };
  const end = c.end ?? (c.start ? defaultEnd(c.start) : undefined);
  const days = [...c.weekdays].sort((a, b) => a - b);
  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b);
    choose('commitment', 'weekdays', next);
    if (next.length === 0) choose('commitment', 'until', undefined);
  };
  const daysText = days.length === 0 ? 'Não' : days.length === 7 ? 'todo dia' : days.map((d) => WEEKDAY_ABBR[d]).join(', ');
  return (
    <>
      <OptionRow id="day" label="Dia" required value={c.day ? formatDay(c.day, ctx.today) : '—'} {...row}>
        <DayChoices value={c.day} today={ctx.today} allowNone={false} onPick={(d) => choose('commitment', 'day', d)} />
      </OptionRow>
      <OptionRow id="start" label="Início" required value={c.start ?? '—'} {...row}>
        <input type="time" aria-label="Início" value={c.start ?? ''}
          onChange={(e) => choose('commitment', 'start', e.target.value || undefined)} />
      </OptionRow>
      <OptionRow id="end" label="Fim" value={end ?? '—'} {...row}>
        <input type="time" aria-label="Fim" value={end ?? ''}
          onChange={(e) => choose('commitment', 'end', e.target.value || undefined)} />
      </OptionRow>
      <OptionRow id="weekdays" label="Toda semana" value={daysText} {...row}>
        <div className="recurrence__weekdays">
          {WEEK.map((d) => (
            <button key={d} type="button" className="weekday-toggle" aria-pressed={days.includes(d)}
              aria-label={WEEKDAY_NAME[d]} onClick={() => toggleDay(d)}>
              {WEEKDAY_ABBR[d]}
            </button>
          ))}
        </div>
      </OptionRow>
      {days.length > 0 && (
        <OptionRow id="until" label="Até (opcional)" value={c.until ? formatDay(c.until, ctx.today) : '—'} {...row}>
          <input type="date" aria-label="Até (opcional)" value={c.until ?? ''} min={c.day}
            onChange={(e) => choose('commitment', 'until', e.target.value || undefined)} />
        </OptionRow>
      )}
      <SwitchRow label="Lembrar antes" checked={c.remind} onChange={(v) => choose('commitment', 'remind', v)} />
    </>
  );
}

function AssessmentOptions({ view, ctx, openRow, onToggleRow, choose, onLeave }: CaptureOptionsProps) {
  const a = view.assessment;
  const row = { openRow, onToggleRow };
  const subjects = subjectJourneys(ctx.journeys);
  return (
    <>
      <div className="cluster capture-opt__assessment" role="group" aria-label="Avaliação">
        {(['prova', 'trabalho'] as const).map((k) => (
          <Chip key={k} selected={a.kind === k} onClick={() => choose('assessment', 'kind', k)}>{ASSESSMENT_LABEL[k]}</Chip>
        ))}
      </div>
      <OptionRow id="subject" label="Matéria" required
        value={subjects.find((j) => j.id === a.journeyId)?.title ?? '—'} {...row}>
        {subjects.length === 0 ? (
          <p className="capture__hint">
            Nenhuma disciplina ainda.{' '}
            <Link className="capture-opt__link" href="/estudo/materias" onClick={onLeave}>Cadastrar em Matérias</Link>
          </p>
        ) : (
          <div className="cluster">
            {subjects.map((j) => (
              <Chip key={j.id} selected={a.journeyId === j.id} onClick={() => choose('assessment', 'journeyId', j.id)}>
                {j.title}
              </Chip>
            ))}
          </div>
        )}
      </OptionRow>
      <OptionRow id="date" label="Data" required value={a.date ? formatDay(a.date, ctx.today) : '—'} {...row}>
        <DayChoices value={a.date} today={ctx.today} allowNone={false} onPick={(d) => choose('assessment', 'date', d)} />
      </OptionRow>
    </>
  );
}

function CardOptions({ view, ctx, openRow, onToggleRow, choose }: CaptureOptionsProps) {
  const deckId = view.card.deckId;
  return (
    <OptionRow id="deck" label="Baralho" value={ctx.decks.find((d) => d.id === deckId)?.name ?? 'Caixa de entrada'}
      openRow={openRow} onToggleRow={onToggleRow}>
      <div className="cluster">
        <Chip selected={deckId === null} onClick={() => choose('card', 'deckId', null)}>Caixa de entrada</Chip>
        {ctx.decks.map((d) => (
          <Chip key={d.id} selected={deckId === d.id} onClick={() => choose('card', 'deckId', d.id)}>{d.name}</Chip>
        ))}
      </div>
    </OptionRow>
  );
}

/** The option rows of the current type, each with its inline panel. */
export function CaptureOptions(props: CaptureOptionsProps) {
  return (
    <div className="capture-opts">
      {props.view.kind === 'tarefa' && <TaskOptions {...props} />}
      {props.view.kind === 'compromisso' && <CommitmentOptions {...props} />}
      {props.view.kind === 'avaliacao' && <AssessmentOptions {...props} />}
      {props.view.kind === 'card' && <CardOptions {...props} />}
    </div>
  );
}
