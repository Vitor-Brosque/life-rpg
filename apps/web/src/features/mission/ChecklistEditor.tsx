import { useState } from 'react';
import type { ChecklistItem, Mission } from '@life/shared';
import { ulid } from '@life/shared';
import { Icon } from '../../art/icons';
import { updateMission } from '../../domain/actions';
import { Button } from '../../ui/Button';

/** Checklist: toggle, remove and add steps. Every change is saved right away. */
export function ChecklistEditor({ mission }: { mission: Mission }) {
  const [text, setText] = useState('');
  const items = mission.checklist;
  const save = (checklist: ChecklistItem[]) => { void updateMission(mission.id, { checklist }); };
  const add = () => {
    const t = text.trim();
    if (!t) return;
    save([...items, { id: ulid(), text: t, done: false }]);
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
                  onChange={() => save(items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))}
                />
                <span>{item.text}</span>
              </label>
              <button
                type="button"
                className="checklist__remove"
                aria-label={`Remover passo ${item.text}`}
                onClick={() => save(items.filter((i) => i.id !== item.id))}
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
