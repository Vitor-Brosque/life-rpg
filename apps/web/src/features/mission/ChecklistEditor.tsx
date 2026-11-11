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

/** Checklist: toggle, remove and add steps. Every change is saved right away. */
export function ChecklistEditor({ mission }: { mission: Mission }) {
  const [text, setText] = useState('');
  const items = mission.checklist;
  const save = (change: (items: ChecklistItem[]) => ChecklistItem[]) => safeRun(updateChecklist(mission.id, change));
  const add = () => {
    const t = text.trim();
    if (!t) return;
    const item: ChecklistItem = { id: ulid(), text: t, done: false };
    save((list) => [...list, item]);
    setText('');
  };
  const done = items.filter((i) => i.done).length;

  return (
    <fieldset className="checklist">
      <legend className="field__label">
        Checklist{items.length > 0 && <span className="checklist__count"> · {done}/{items.length}</span>}
      </legend>
      {items.length > 0 && (
        <ul className="checklist__list">
          {items.map((item) => (
            <li key={item.id} className={item.done ? 'checklist__item checklist__item--done' : 'checklist__item'}>
              <label className="checklist__check">
                <input
                  type="checkbox"
                  className="px-checkbox"
                  checked={item.done}
                  onChange={() => save((list) => list.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))}
                />
                <span>{item.text}</span>
              </label>
              <button
                type="button"
                className="checklist__remove"
                aria-label={`Remover passo ${item.text}`}
                onClick={() => save((list) => list.filter((i) => i.id !== item.id))}
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
