import { useEffect, useId, useRef, useState } from 'react';
import type { ChecklistItem, ID, PracticeScore } from '@life/shared';
import { PRACTICE_LIMITS, listOps, ulid } from '@life/shared';
import { useJourneys, useMissions } from '../../db/hooks';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { useDraftField } from './useDraftField';
import './practice.css';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export interface DraftTextProps {
  label: string;
  saved: string;
  onSave(v: string): Promise<unknown>;
  maxLength: number;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  hint?: string;
}

/** A labelled text field that saves itself (useDraftField). */
export function DraftText({ label, saved, onSave, maxLength, multiline, rows = 3, placeholder, hint }: DraftTextProps) {
  const id = useId();
  const draft = useDraftField(saved, onSave);
  const common = {
    id, value: draft.value, maxLength, placeholder, onFocus: draft.onFocus, onBlur: draft.onBlur,
    'aria-describedby': hint ? `${id}-hint` : undefined,
  };
  return (
    <div className="field practice-field">
      <label className="field__label" htmlFor={id}>{label}</label>
      {multiline
        ? <textarea {...common} rows={rows} onChange={(e) => draft.onChange(e.target.value)} />
        : <input type="text" {...common} onChange={(e) => draft.onChange(e.target.value)} />}
      {hint && <p id={`${id}-hint`} className="practice-field__hint">{hint}</p>}
    </div>
  );
}

interface RowProps {
  item: ChecklistItem; index: number; noun: string;
  onEdit(fn: (items: ChecklistItem[]) => ChecklistItem[]): void;
  checkLabel?: (text: string) => string;
}

function ItemRow({ item, index, noun, onEdit, checkLabel }: RowProps) {
  const [text, setText] = useState(item.text);
  const editing = useRef(false);
  const touched = useRef(false);
  // A row being edited (focused or with local changes) keeps its text when the list changes from outside.
  useEffect(() => { if (!editing.current && !touched.current) setText(item.text); }, [item.text]);
  const n = index + 1;
  const commit = (): void => {
    editing.current = false;
    if (!touched.current) { setText(item.text); return; }
    touched.current = false;
    const t = text.trim();
    if (t === item.text) { setText(t); return; }
    onEdit((xs) => (t ? listOps.set(xs, item.id, { text: t }) : listOps.remove(xs, item.id)));
  };
  return (
    <li className="practice-list__item">
      {checkLabel && (
        <input type="checkbox" className="px-checkbox" checked={item.done} aria-label={checkLabel(item.text)}
          onChange={(e) => { const done = e.target.checked; onEdit((xs) => listOps.set(xs, item.id, { done })); }} />
      )}
      <input type="text" className="practice-list__text" aria-label={`${cap(noun)} ${n}`} value={text}
        maxLength={PRACTICE_LIMITS.item} enterKeyHint="done"
        onFocus={() => { editing.current = true; }}
        onChange={(e) => { touched.current = true; setText(e.target.value); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); touched.current = false; setText(item.text); }
        }} />
      {index > 0 && (
        <Button size="sm" variant="ghost" aria-label={`Subir ${noun} ${n}`} onClick={() => onEdit((xs) => listOps.moveUp(xs, item.id))}>↑</Button>
      )}
      <Button size="sm" variant="ghost" icon="close" aria-label={`Remover ${noun} ${n}`}
        onClick={() => onEdit((xs) => listOps.remove(xs, item.id))} />
    </li>
  );
}

export interface ListFieldProps {
  legend: string;
  /** Lower-case noun for the names: "passo" → "Passo 2", "Remover passo 2", "Novo passo", "Adicionar passo". */
  noun: string;
  items: readonly ChecklistItem[];
  onEdit(fn: (items: ChecklistItem[]) => ChecklistItem[]): void;
  placeholder?: string;
  /** A checkbox per item with this name, e.g. "Passou: <caso>". */
  checkLabel?: (text: string) => string;
}

/** An editable list: Enter adds and keeps the focus; items edit in place (spec §5.2). */
export function ListField({ legend, noun, items, onEdit, placeholder, checkLabel }: ListFieldProps) {
  const [draft, setDraft] = useState('');
  const add = (): void => {
    const t = draft.trim();
    if (!t) return;
    onEdit((xs) => listOps.add(xs, t, ulid()));
    setDraft('');
  };
  return (
    <fieldset className="practice-list">
      <legend className="field__label">{legend}</legend>
      {items.length > 0 && (
        <ol className="practice-list__items">
          {items.map((it, i) => <ItemRow key={it.id} item={it} index={i} noun={noun} onEdit={onEdit} checkLabel={checkLabel} />)}
        </ol>
      )}
      {items.length >= PRACTICE_LIMITS.items ? <p className="muted">Limite de 30 itens.</p> : (
        <div className="practice-list__add">
          <input type="text" aria-label={`Novo ${noun}`} placeholder={placeholder} value={draft} maxLength={PRACTICE_LIMITS.item}
            enterKeyHint="enter" onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <Button size="sm" icon="plus" aria-label={`Adicionar ${noun}`} disabled={!draft.trim()} onClick={add} />
        </div>
      )}
    </fieldset>
  );
}

export interface ScoreChoiceProps {
  name: string;
  legend: string;
  options: readonly [string, string, string];
  value?: PracticeScore;
  onChange(v: PracticeScore): void;
}

/** One indicator: three radios that look like chips, saved at once by the caller. */
export function ScoreChoice({ name, legend, options, value, onChange }: ScoreChoiceProps) {
  return (
    <fieldset className="practice-score">
      <legend className="field__label">{legend}</legend>
      <div className="practice-score__options">
        {([0, 1, 2] as const).map((v) => (
          <label key={v} className={value === v ? 'practice-score__option is-on' : 'practice-score__option'}>
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
            <span>{options[v]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export interface JourneyMissionPickerProps {
  journeyId?: ID;
  missionId?: ID;
  onChange(next: { journeyId?: ID; missionId?: ID }): void;
}

/** Journey chips, then the open missions of the chosen journey. Changing the journey clears the mission. */
export function JourneyMissionPicker({ journeyId, missionId, onChange }: JourneyMissionPickerProps) {
  const journeys = useJourneys().filter((j) => j.status === 'active' || j.id === journeyId).sort((a, b) => a.order - b.order);
  const missions = useMissions().filter((m) => journeyId !== undefined && m.journeyId === journeyId
    && (m.status === 'open' || m.status === 'doing' || m.id === missionId))
    .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  return (
    <div className="practice-links">
      <fieldset className="attr">
        <legend className="field__label">Jornada</legend>
        <div className="cluster">
          <Chip selected={!journeyId} onClick={() => onChange({})}>Nenhuma</Chip>
          {journeys.map((j) => (
            <Chip key={j.id} selected={journeyId === j.id} onClick={() => onChange({ journeyId: j.id })}>{j.title}</Chip>
          ))}
        </div>
      </fieldset>
      {journeyId && (
        <label className="field">
          <span className="field__label">Missão (opcional)</span>
          <select value={missionId ?? ''}
            onChange={(e) => onChange({ journeyId, ...(e.target.value ? { missionId: e.target.value } : {}) })}>
            <option value="">Sem missão</option>
            {missions.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
