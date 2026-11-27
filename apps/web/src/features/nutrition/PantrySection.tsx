import { useState, type FormEvent, type RefObject } from 'react';
import type { DayKey, Food, PantryItem } from '@life/shared';
import { basisNote, foodChoices, pantryGramsIssue, pantryStatusText, parseDecimal } from '@life/shared';
import { addToPantry, confirmPantry, removeFromPantry, restorePantry } from '../../domain/nutritionActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { FoodPicker } from './FoodPicker';
import { EmptyFoods, NumberField, attempt, decimalText, issueOf, toast } from './nutritionUi';

/**
 * "Estoque de hoje" (spec §6): every food marked some day. Today's show "Tem hoje" (and the grams); older ones show
 * "Tinha em 24/11" and "Confirmar", with optional grams. "Adicionar ao estoque" uses the same food picker.
 */
export function PantrySection({ day, foods, pantry, headingRef, onAdd }: {
  day: DayKey; foods: readonly Food[]; pantry: readonly PantryItem[]; headingRef: RefObject<HTMLHeadingElement | null>; onAdd(): void;
}) {
  const byFood = new Map(pantry.filter((p) => !p.deleted).map((p) => [p.foodId, p]));
  // foodChoices: today's stock first, then by name.
  const rows = foodChoices(foods, '', pantry, day).filter((f) => byFood.has(f.id));
  return (
    <section className="stack" aria-labelledby="nutri-stock-title">
      <h2 id="nutri-stock-title" ref={headingRef} tabIndex={-1} className="section-title">Estoque de hoje</h2>
      <p className="muted">
        O que você tem hoje. O que tinha antes precisa ser confirmado no dia. As gramas são opcionais: com elas, o que você
        come é descontado.
      </p>
      {foods.length === 0 ? <EmptyFoods /> : rows.length === 0 ? (
        <p className="muted">Nenhum alimento no estoque ainda.</p>
      ) : (
        <ul className="nutri-items" aria-label="Estoque">
          {rows.map((f) => <PantryRow key={f.id} food={f} item={byFood.get(f.id)!} day={day} />)}
        </ul>
      )}
      {foods.length > 0 && <div><Button icon="plus" onClick={onAdd}>Adicionar ao estoque</Button></div>}
    </section>
  );
}

function PantryRow({ food, item, day }: { food: Food; item: PantryItem; day: DayKey }) {
  const today = item.confirmedDay === day;
  const [editing, setEditing] = useState(false);
  const [grams, setGrams] = useState('');
  const [error, setError] = useState<string>();
  const name = food.name;
  const rowId = `nutri-stock-${food.id}`;
  const toRow = () => document.getElementById(rowId);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const g = parseDecimal(grams);
    const issue = pantryGramsIssue(g);
    if (issue) { setError(issue); return; }
    void attempt(() => confirmPantry(food.id, g ?? undefined), (issues) => setError(issueOf(issues, 'grams') ?? issues[0]?.message)).then((ok) => {
      if (!ok) return;
      focusWhenGone(form, toRow);
      setEditing(false);
      setGrams('');
    });
  };
  const remove = (control: Element) => {
    focusWhenGone(control, () => document.getElementById('nutri-stock-title'), { preventScroll: true });
    safeRun(async () => {
      const gone = await removeFromPantry(food.id);
      if (gone) toast(`${name} saiu do estoque.`, { label: 'Desfazer', run: () => safeRun(restorePantry(gone)) });
    });
  };

  const gramsField = (autoFocus: boolean) => (
    <NumberField label={`Gramas (opcional)${basisNote(food.basis)}`} ariaLabel={`Gramas de ${name} no estoque`} value={grams}
      onChange={(v) => { setGrams(v); setError(undefined); }} error={error} autoFocus={autoFocus} className="nutri-grams" />
  );

  return (
    <li className="nutri-item" role="group" aria-labelledby={`${rowId}-name`}>
      <p className="nutri-item__text" id={rowId} tabIndex={-1}>
        <span className="nutri-item__name" id={`${rowId}-name`}>{name}</span>
        <span className="nutri-item__meta">{pantryStatusText(item, day, food.basis)}</span>
      </p>
      {!today && (
        <form className="nutri-item__form" noValidate onSubmit={submit}>
          {gramsField(false)}
          <Button type="submit" size="sm" variant="primary" aria-label={`Confirmar ${name}: tem hoje`}>Confirmar</Button>
          <Button size="sm" variant="ghost" aria-label={`Tirar ${name} do estoque`} onClick={(e) => remove(e.currentTarget)}>Tirar</Button>
        </form>
      )}
      {today && editing && (
        <form className="nutri-item__form" noValidate onSubmit={submit}>
          {gramsField(true)}
          <Button type="submit" size="sm" variant="primary" aria-label={`Salvar gramas de ${name} no estoque`}>Salvar</Button>
          <Button size="sm" variant="ghost" aria-label={`Cancelar a correção de ${name} no estoque`}
            onClick={(e) => { focusWhenGone(e.currentTarget, toRow); setEditing(false); setError(undefined); }}>
            Cancelar
          </Button>
        </form>
      )}
      {today && !editing && (
        <div className="nutri-item__actions">
          <Button size="sm" aria-label={`Corrigir gramas de ${name} no estoque`}
            onClick={() => { setGrams(decimalText(item.grams)); setError(undefined); setEditing(true); }}>
            Corrigir gramas
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Tirar ${name} do estoque`} onClick={(e) => remove(e.currentTarget)}>Tirar</Button>
        </div>
      )}
    </li>
  );
}

/** "Adicionar ao estoque": the food (same picker) and optional grams; it counts as confirmed today. */
export function AddStockForm({ day, foods, pantry, onDone }: { day: DayKey; foods: readonly Food[]; pantry: readonly PantryItem[]; onDone(): void }) {
  const [food, setFood] = useState<Food>();
  const [grams, setGrams] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (foods.length === 0) return <EmptyFoods />;

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!food) return;
    const g = parseDecimal(grams);
    const issue = pantryGramsIssue(g);
    if (issue) { setError(issue); return; }
    setBusy(true);
    void attempt(() => addToPantry(food.id, g ?? undefined), (issues) => setError(issueOf(issues, 'grams') ?? issues[0]?.message)).then((ok) => {
      setBusy(false);
      if (!ok) return;
      toast(`${food.name} está no estoque de hoje.`);
      onDone();
    });
  };

  return (
    <form className="stack" noValidate onSubmit={save}>
      <FoodPicker foods={foods} pantry={pantry} day={day} selected={food} onSelect={(f) => { setFood(f); setGrams(''); setError(undefined); }} />
      {food && (
        <>
          <NumberField label={`Gramas (opcional)${basisNote(food.basis)}`} ariaLabel={`Gramas de ${food.name} no estoque`} value={grams}
            onChange={(v) => { setGrams(v); setError(undefined); }} error={error} autoFocus className="nutri-grams" />
          <p className="muted">Sem gramas, fica como “tem, sem contar”.</p>
          <div><Button type="submit" variant="primary" disabled={busy}>Adicionar</Button></div>
        </>
      )}
    </form>
  );
}
