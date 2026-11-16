import { useId, useState, type ReactNode } from 'react';
import type { DayKey, Journey } from '@life/shared';
import { addDays, describeRecurrence, subjectJourneys } from '@life/shared';
import { areaIcon, Icon } from '../../art/icons';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { DURATION_OPTIONS, ENERGY_LABEL, ENERGY_OPTIONS, formatDay, formatDuration } from '../../ui/format';
import { RecurrencePicker } from '../mission/RecurrencePicker';
import {
  dayWhen, type CaptureCtx, type CaptureSections, type CaptureView, type JourneyChoice, type Section,
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
      {open && <div id={panelId} className="capture-opt__panel" role="group" aria-label={label}>{children}</div>}
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
  const [name, setName] = useState(value !== null && 'newName' in value ? value.newName : '');
  const subjects = subjectJourneys(ctx.journeys);
  const others = ctx.journeys.filter((j) => j.status === 'active' && j.subject !== true).sort((a, b) => a.order - b.order);
  const picked = (j: Journey): boolean => value !== null && 'id' in value && value.id === j.id;
  const chip = (j: Journey) => <Chip key={j.id} selected={picked(j)} onClick={() => onPick({ id: j.id })}>{j.title}</Chip>;
  const use = () => {
    const n = name.trim();
    if (!n) return;
    onPick({ newName: n });
    setNaming(false);
  };
  return (
    <>
      <div className="cluster">
        <Chip selected={value === null} onClick={() => onPick(null)}>Nenhuma</Chip>
      </div>
      {subjects.length > 0 && (
        <div className="capture-opt__sub" role="group" aria-labelledby={subLabel}>
          <span id={subLabel} className="capture-opt__sublabel">Faculdade</span>
          <div className="cluster">{subjects.map(chip)}</div>
        </div>
      )}
      <div className="cluster">
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

/** The option rows of the current type, each with its inline panel. */
export function CaptureOptions(props: CaptureOptionsProps) {
  return (
    <div className="capture-opts">
      {props.view.kind === 'tarefa' && <TaskOptions {...props} />}
    </div>
  );
}
