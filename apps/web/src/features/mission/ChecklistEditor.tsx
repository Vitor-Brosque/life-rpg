import { useState } from 'react';
import type { ChecklistItem, Mission } from '@life/shared';
import { ulid } from '@life/shared';
import { Icon } from '../../art/icons';
import { db } from '../../db/db';
import { withLock } from '../../domain/common';
import { updateMission } from '../../domain/actions';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';

/**
 * Applies `change` to the saved checklist (not the rendered one), one write at a time per
 * mission, so two quick taps never overwrite each other.
 */
export function updateChecklist(missionId: string, change: (items: ChecklistItem[]) => ChecklistItem[]): Promise<void> {
  return withLock(`checklist:${missionId}`, async () => {
    const m = await db.missions.get(missionId);
    if (!m) return;
    await updateMission(missionId, { checklist: change(m.checklist) });
  });
}

/** A mission's checklist: toggle, remove and add steps. Every change is saved right away. */
export function ChecklistEditor({ mission }: { mission: Mission }) {
  return (
    <ChecklistFields items={mission.checklist} checkable
      onChange={(change) => safeRun(updateChecklist(mission.id, change))} />
  );
}

export interface ChecklistFieldsProps {
  items: ChecklistItem[];
  /** Receives a change to apply to the current list (so quick taps never overwrite each other). */
  onChange(change: (items: ChecklistItem[]) => ChecklistItem[]): void;
  /** Done checkboxes and the count (a mission's steps); without it the steps are only listed (a template). */
  checkable?: boolean;
}

/** Checklist fields: the steps (optionally checkable) with remove buttons, and a field to add one. */
export function ChecklistFields({ items, onChange, checkable = false }: ChecklistFieldsProps) {
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim();
    if (!t) return;
    const item: ChecklistItem = { id: ulid(), text: t, done: false };
    onChange((list) => [...list, item]);
    setText('');
  };
  const done = items.filter((i) => i.done).length;

  return (
    <fieldset className="checklist">
      <legend className="field__label">
        Checklist{checkable && items.length > 0 && <span className="checklist__count"> · {done}/{items.length}</span>}
      </legend>
      {items.length > 0 && (
        <ul className="checklist__list">
          {items.map((item) => (
            <li key={item.id} className={checkable && item.done ? 'checklist__item checklist__item--done' : 'checklist__item'}>
              {checkable ? (
                <label className="checklist__check">
                  <input
                    type="checkbox"
                    className="px-checkbox"
                    checked={item.done}
                    onChange={() => onChange((list) => list.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))}
                  />
                  <span>{item.text}</span>
                </label>
              ) : (
                <span className="checklist__check">{item.text}</span>
              )}
              <button
                type="button"
                className="checklist__remove"
                aria-label={`Remover passo ${item.text}`}
                onClick={() => onChange((list) => list.filter((i) => i.id !== item.id))}
              >
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="checklist__add">
        <input
          type="text"
          aria-label="Novo passo"
          placeholder="Novo passo"
          value={text}
          enterKeyHint="done"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <Button size="sm" icon="plus" aria-label="Adicionar passo" onClick={add} disabled={!text.trim()} />
      </div>
    </fieldset>
  );
}
