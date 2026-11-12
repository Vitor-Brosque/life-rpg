import { useId, useState } from 'react';
import type { ID, WeekObjective } from '@life/shared';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import type { BlockGroup } from './weekData';

export const MAX_OBJECTIVES = 3;

export type NewObjective = { blockId: ID; text: string; done: boolean };
type Choice = 'keep' | 'drop';

export interface WeekObjectivesProps {
  groups: BlockGroup[];
  /** Last week's open objectives, by group key. */
  carry: Array<{ objective: WeekObjective; group: string }>;
  onDone(list: NewObjective[]): Promise<void>;
  /** "Fazer depois" (only while nothing of the week is saved yet). */
  onLater?(): void;
}

/**
 * Step 2 "Objetivos": per main block, last week's open objectives first (Manter copies it into
 * this week, Soltar lets it go), then up to 3 in total — one empty field at a time.
 */
export function WeekObjectives({ groups, carry, onDone, onLater }: WeekObjectivesProps) {
  const [choices, setChoices] = useState<Record<ID, Choice>>({});
  const [texts, setTexts] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const titleId = useId();

  const carriedOf = (g: BlockGroup) => carry.filter((c) => c.group === g.key).map((c) => c.objective);
  const keptOf = (g: BlockGroup) => carriedOf(g).filter((o) => choices[o.id] === 'keep');
  /** Fields on screen: the filled ones plus one empty, within what the kept ones leave. */
  const fieldsOf = (g: BlockGroup) => {
    const own = texts[g.key] ?? [];
    const free = MAX_OBJECTIVES - keptOf(g).length;
    return Math.max(0, Math.min(free, own.filter((t) => t.trim()).length + 1));
  };
  const setText = (key: string, i: number, value: string) =>
    setTexts((all) => {
      const list = [...(all[key] ?? [])];
      list[i] = value;
      return { ...all, [key]: list };
    });

  const finish = () => {
    const list: NewObjective[] = groups.flatMap((g) => [
      ...keptOf(g).map((o) => ({ blockId: g.blockId, text: o.text, done: false })),
      ...(texts[g.key] ?? []).slice(0, fieldsOf(g))
        .filter((t) => t.trim())
        .map((t) => ({ blockId: g.blockId, text: t.trim(), done: false })),
    ]);
    setSaving(true);
    safeRun(onDone(list).finally(() => setSaving(false)));
  };

  return (
    <section className="week-card__section" aria-labelledby={titleId}>
      <h3 id={titleId} className="week-card__subtitle">Objetivos</h3>
      <p className="week-card__note">
        {groups.length > 0
          ? 'De 1 a 3 por bloco principal, todos opcionais. Eles aparecem na faixa do bloco.'
          : 'Nenhum bloco de foco ou estudo na rotina ainda.'}
      </p>
      {carry.length > 0 && (
        <p className="week-card__note">Da semana passada ficaram abertos: Manter traz para esta semana, Soltar deixa ir.</p>
      )}

      {groups.map((g) => {
        const carried = carriedOf(g);
        const kept = keptOf(g).length;
        return (
          <fieldset key={g.key} className="week-group">
            <legend className="week-group__name">{g.name}</legend>
            {carried.length > 0 && (
              <ul className="week-carry">
                {carried.map((o) => (
                  <li key={o.id} className={`week-carry__item${choices[o.id] === 'drop' ? ' is-dropped' : ''}`}>
                    <span className="week-carry__text">{o.text}</span>
                    <div role="group" aria-label={o.text} className="week-carry__choice">
                      {(['keep', 'drop'] as const).map((c) => (
                        <button key={c} type="button" className="week-carry__btn" aria-pressed={choices[o.id] === c}
                          onClick={() => setChoices((all) => ({ ...all, [o.id]: c }))}>
                          {c === 'keep' ? 'Manter' : 'Soltar'}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {Array.from({ length: fieldsOf(g) }, (_, i) => (
              <input
                key={i}
                type="text"
                className="week-group__input"
                aria-label={`Objetivo ${kept + i + 1} · ${g.name}`}
                placeholder={kept + i === 0 ? 'Um objetivo para esta semana' : 'Mais um (opcional)'}
                enterKeyHint="next"
                value={texts[g.key]?.[i] ?? ''}
                onChange={(e) => setText(g.key, i, e.target.value)}
              />
            ))}
          </fieldset>
        );
      })}

      <div className="week-card__actions">
        <Button variant="primary" disabled={saving} onClick={finish}>Concluir</Button>
        {onLater && <Button variant="ghost" onClick={onLater}>Fazer depois</Button>}
      </div>
    </section>
  );
}
