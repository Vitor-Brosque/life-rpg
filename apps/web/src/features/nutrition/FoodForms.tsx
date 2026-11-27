import { useId, useRef, useState, type FormEvent } from 'react';
import type {
  FieldIssue, Food, FoodBasis, FoodGroup, FoodInput, FoodLike, FoodSource, ID, NutritionMeal, RecipeInput,
} from '@life/shared';
import {
  FOOD_BASIS_LABEL, FOOD_GROUP_LABEL, FOOD_LIKE_LABEL, FOOD_NAME_MAX, FOOD_SOURCE_LABEL, NUTRITION_MEALS, NUTRITION_MEAL_LABEL,
  estimateText, intText, kcalWarning, nutrientsText, parseDecimal, recipeFatNote, recipeValues, validateFood, validateRecipe,
} from '@life/shared';
import { deleteFood, restoreFood, saveFood, saveRecipe } from '../../domain/nutritionActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { focusWhenGone } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { FoodPicker } from './FoodPicker';
import { ChoiceChips, NumberField, TextField, attempt, decimalText, issueOf, toast } from './nutritionUi';

const BASES: readonly FoodBasis[] = ['pronto', 'cru'];
const SOURCES: readonly FoodSource[] = ['rotulo', 'tabela', 'estimativa'];
const GROUPS: readonly FoodGroup[] = ['proteina', 'carboidrato', 'verdura', 'fruta', 'laticinio', 'gordura', 'outro'];
const LIKES: readonly FoodLike[] = ['gosto', 'normal', 'pouco', 'nunca'];

const GROUP_HINT = 'O plano usa o grupo para montar as refeições: proteína ou laticínio, carboidrato ou fruta, verdura e gordura. Outro fica de fora do plano.';
const LIKE_HINT = 'Pouco: no máximo uma refeição por dia no plano. Nunca: o plano não sugere (dá para registrar se comeu).';
const CHECK_FIELDS = 'Confira os campos marcados.';
const KEEPS_DIARY = 'Apagar não muda o diário: o que já foi registrado guarda uma cópia dos valores.';

/** "Bom para": six toggle buttons (none = every meal). */
function GoodForChips({ value, onChange }: { value: readonly NutritionMeal[]; onChange(v: NutritionMeal[]): void }) {
  const id = useId();
  const toggle = (m: NutritionMeal) => onChange(NUTRITION_MEALS.filter((x) => (x === m ? !value.includes(m) : value.includes(x))));
  return (
    <div className="nutri-choice" role="group" aria-labelledby={id}>
      <span id={id} className="field__label">Bom para</span>
      <div className="nutri-chips">
        {NUTRITION_MEALS.map((m) => (
          <Chip key={m} selected={value.includes(m)} aria-label={`Bom para ${NUTRITION_MEAL_LABEL[m]}`} onClick={() => toggle(m)}>
            {NUTRITION_MEAL_LABEL[m]}
          </Chip>
        ))}
      </div>
      <p className="muted nutri-hint">Nenhuma marcada vale para todas. O plano só põe o alimento nas refeições marcadas.</p>
    </div>
  );
}

/** Unit (name and grams) and maximum portion: optional in both forms. */
function Extras({ unitName, unitGrams, maxPortion, issues, onChange }: {
  unitName: string; unitGrams: string; maxPortion: string; issues: readonly FieldIssue[];
  onChange(patch: { unitName?: string; unitGrams?: string; maxPortion?: string }): void;
}) {
  return (
    <>
      <fieldset className="nutri-fieldset">
        <legend className="field__label">Unidade (opcional), ex.: 1 fatia = 25 g</legend>
        <div className="nutri-grid">
          <TextField label="Nome da unidade" value={unitName} maxLength={30} error={issueOf(issues, 'unit')}
            onChange={(v) => onChange({ unitName: v })} />
          <NumberField label="Gramas da unidade" value={unitGrams} error={issueOf(issues, 'unitGrams')} onChange={(v) => onChange({ unitGrams: v })} />
        </div>
      </fieldset>
      <NumberField label="Porção máxima por refeição (g, opcional)" value={maxPortion} error={issueOf(issues, 'maxPortion')}
        onChange={(v) => onChange({ maxPortion: v })} className="nutri-grams" />
      <p className="muted nutri-hint">Vazia: o plano usa o limite do grupo (por exemplo, 250 g de proteína) e, com unidade, até 4 unidades.</p>
    </>
  );
}

const unitInput = (name: string, grams: string) => (name.trim() !== '' || grams.trim() !== '' ? { unit: { name, grams: parseDecimal(grams) } } : {});

// ------------------------------------------------------------------ food

interface FoodDraft {
  name: string; basis: FoodBasis; source: FoodSource; group: FoodGroup; like: FoodLike;
  kcal: string; protein: string; carbs: string; fat: string; fiber: string;
  unitName: string; unitGrams: string; maxPortion: string; meals: NutritionMeal[];
}

const foodDraftOf = (f?: Food): FoodDraft => ({
  name: f?.name ?? '', basis: f?.basis ?? 'pronto', source: f?.source ?? 'rotulo', group: f?.group ?? 'outro', like: f?.like ?? 'normal',
  kcal: decimalText(f?.per100.kcal), protein: decimalText(f?.per100.protein), carbs: decimalText(f?.per100.carbs),
  fat: decimalText(f?.per100.fat), fiber: decimalText(f?.per100.fiber),
  unitName: f?.unit?.name ?? '', unitGrams: decimalText(f?.unit?.grams), maxPortion: decimalText(f?.maxPortion), meals: [...(f?.meals ?? [])],
});

const foodInputOf = (d: FoodDraft): FoodInput => ({
  name: d.name,
  per100: { kcal: parseDecimal(d.kcal), protein: parseDecimal(d.protein), carbs: parseDecimal(d.carbs), fat: parseDecimal(d.fat), fiber: parseDecimal(d.fiber) },
  basis: d.basis, source: d.source, group: d.group, like: d.like,
  ...unitInput(d.unitName, d.unitGrams),
  maxPortion: parseDecimal(d.maxPortion),
  meals: d.meals,
});

/** "Novo alimento" / editing one: every field of spec §6. Nothing saves while a field has a problem (§7). */
export function FoodForm({ food, onClose }: { food?: Food; onClose(): void }) {
  const [draft, setDraft] = useState<FoodDraft>(() => foodDraftOf(food));
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<FoodDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    const touched = Object.keys(patch);
    setIssues((is) => is.filter((i) => !touched.includes(i.field) && !(touched.includes('unitName') && i.field === 'unit')));
  };
  const input = foodInputOf(draft);
  const p = input.per100;
  const warning = typeof p.kcal === 'number' && typeof p.protein === 'number' && typeof p.carbs === 'number' && typeof p.fat === 'number'
    ? kcalWarning({ kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat }) : undefined;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const checked = validateFood(input).issues;
    if (checked.length > 0) { setIssues(checked); return; }
    setBusy(true);
    const ok = await attempt(() => saveFood(input, food?.id), setIssues);
    setBusy(false);
    if (!ok) return;
    toast(food ? 'Alimento salvo.' : 'Alimento cadastrado.');
    onClose();
  };
  const remove = () => {
    if (!food) return;
    safeRun(async () => {
      const gone = await deleteFood(food.id);
      onClose();
      if (gone) toast('Alimento apagado. O diário não muda.', { label: 'Desfazer', run: () => safeRun(restoreFood(gone)) });
    });
  };

  return (
    <form className="stack nutri-form" noValidate onSubmit={(e) => { void save(e); }}>
      <TextField label="Nome" value={draft.name} maxLength={FOOD_NAME_MAX} error={issueOf(issues, 'name')} onChange={(v) => set({ name: v })} />
      <ChoiceChips label="Referência" options={BASES} labels={FOOD_BASIS_LABEL} value={draft.basis} onChange={(v) => set({ basis: v })}
        hint="Pronto: cozido, pronto para comer. Cru: os valores e as gramas são do alimento cru." />
      <fieldset className="nutri-fieldset">
        <legend className="field__label">Valores por 100 g</legend>
        <div className="nutri-grid">
          <NumberField label="Calorias (kcal)" value={draft.kcal} error={issueOf(issues, 'kcal')} onChange={(v) => set({ kcal: v })} />
          <NumberField label="Proteína (g)" value={draft.protein} error={issueOf(issues, 'protein')} onChange={(v) => set({ protein: v })} />
          <NumberField label="Carboidratos (g)" value={draft.carbs} error={issueOf(issues, 'carbs')} onChange={(v) => set({ carbs: v })} />
          <NumberField label="Gorduras (g)" value={draft.fat} error={issueOf(issues, 'fat')} onChange={(v) => set({ fat: v })} />
          <NumberField label="Fibra (g, opcional)" value={draft.fiber} error={issueOf(issues, 'fiber')} onChange={(v) => set({ fiber: v })} />
        </div>
        {warning && <p className="nutri-warning">{warning}</p>}
      </fieldset>
      <ChoiceChips label="Fonte" options={SOURCES} labels={FOOD_SOURCE_LABEL} value={draft.source} onChange={(v) => set({ source: v })}
        hint="Tabela: você consultou uma base reconhecida. Estimativa aparece marcada como “estimado” nos totais." />
      <ChoiceChips label="Grupo" options={GROUPS} labels={FOOD_GROUP_LABEL} value={draft.group} onChange={(v) => set({ group: v })} hint={GROUP_HINT} />
      <Extras unitName={draft.unitName} unitGrams={draft.unitGrams} maxPortion={draft.maxPortion} issues={issues} onChange={set} />
      <ChoiceChips label="Preferência" options={LIKES} labels={FOOD_LIKE_LABEL} value={draft.like} onChange={(v) => set({ like: v })} hint={LIKE_HINT} />
      <GoodForChips value={draft.meals} onChange={(v) => set({ meals: v })} />
      {issues.length > 0 && <p role="alert" className="nutri-error">{CHECK_FIELDS}</p>}
      {food && <p className="muted">{KEEPS_DIARY}</p>}
      <div className="nutri-form__actions">
        <Button type="submit" variant="primary" disabled={busy}>Salvar</Button>
        {food && <Button variant="ghost" icon="trash" onClick={remove}>Apagar alimento</Button>}
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ recipe

interface DraftIngredient { key: number; foodId: ID; grams: string }
interface RecipeDraft {
  name: string; ingredients: DraftIngredient[]; yieldGrams: string; group: FoodGroup; like: FoodLike; meals: NutritionMeal[];
  unitName: string; unitGrams: string; maxPortion: string;
}

let nextKey = 1;

const recipeDraftOf = (f?: Food): RecipeDraft => ({
  name: f?.name ?? '',
  ingredients: (f?.recipe?.ingredients ?? []).map((i) => ({ key: nextKey++, foodId: i.foodId, grams: decimalText(i.grams) })),
  yieldGrams: decimalText(f?.recipe?.yieldGrams), group: f?.group ?? 'outro', like: f?.like ?? 'normal', meals: [...(f?.meals ?? [])],
  unitName: f?.unit?.name ?? '', unitGrams: decimalText(f?.unit?.grams), maxPortion: decimalText(f?.maxPortion),
});

const recipeInputOf = (d: RecipeDraft): RecipeInput => ({
  name: d.name,
  ingredients: d.ingredients.map((i) => ({ foodId: i.foodId, grams: parseDecimal(i.grams) })),
  yieldGrams: parseDecimal(d.yieldGrams),
  group: d.group, like: d.like, meals: d.meals,
  ...unitInput(d.unitName, d.unitGrams),
  maxPortion: parseDecimal(d.maxPortion),
});

/**
 * "Nova receita" / editing one: ingredients (a food and its grams, the cooking fat included) and the final weight once
 * ready. The values per 100 g are computed as you type and stored when saved.
 */
export function RecipeForm({ recipe, foods, onClose }: { recipe?: Food; foods: readonly Food[]; onClose(): void }) {
  const [draft, setDraft] = useState<RecipeDraft>(() => recipeDraftOf(recipe));
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [focusKey, setFocusKey] = useState<number>();
  const addButton = useRef<HTMLButtonElement>(null);
  const set = (patch: Partial<RecipeDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    const touched = Object.keys(patch);
    setIssues((is) => is.filter((i) => !touched.includes(i.field) && !(touched.includes('unitName') && i.field === 'unit')
      && !(touched.includes('ingredients') && i.field.startsWith('ingredients'))));
  };
  const setGrams = (key: number, grams: string) => set({ ingredients: draft.ingredients.map((i) => (i.key === key ? { ...i, grams } : i)) });
  const nameOf = (id: ID): string => foods.find((f) => f.id === id)?.name ?? 'Alimento apagado';

  const valid = draft.ingredients.flatMap((i) => {
    const g = parseDecimal(i.grams);
    return typeof g === 'number' && g > 0 ? [{ foodId: i.foodId, grams: g }] : [];
  });
  const y = parseDecimal(draft.yieldGrams);
  const values = valid.length > 0 && typeof y === 'number' && y > 0 ? recipeValues({ ingredients: valid, yieldGrams: y }, foods) : undefined;
  const fatNote = draft.ingredients.length > 0 ? recipeFatNote(draft.ingredients, foods) : undefined;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const input = recipeInputOf(draft);
    const checked = validateRecipe(input, foods, recipe?.id).issues;
    if (checked.length > 0) { setIssues(checked); return; }
    setBusy(true);
    const ok = await attempt(() => saveRecipe(input, recipe?.id), setIssues);
    setBusy(false);
    if (!ok) return;
    toast(recipe ? 'Receita salva.' : 'Receita cadastrada.');
    onClose();
  };
  const remove = () => {
    if (!recipe) return;
    safeRun(async () => {
      const gone = await deleteFood(recipe.id);
      onClose();
      if (gone) toast('Receita apagada. O diário não muda.', { label: 'Desfazer', run: () => safeRun(restoreFood(gone)) });
    });
  };
  const add = (f: Food | undefined) => {
    if (!f) return;
    const key = nextKey++;
    set({ ingredients: [...draft.ingredients, { key, foodId: f.id, grams: '' }] });
    setFocusKey(key);
    setPicking(false);
  };
  const removeIngredient = (key: number, control: Element) => {
    focusWhenGone(control, () => addButton.current);
    set({ ingredients: draft.ingredients.filter((i) => i.key !== key) });
  };

  const choosable = foods.filter((f) => f.id !== recipe?.id);
  return (
    <form className="stack nutri-form" noValidate onSubmit={(e) => { void save(e); }}>
      <TextField label="Nome" value={draft.name} maxLength={FOOD_NAME_MAX} error={issueOf(issues, 'name')} onChange={(v) => set({ name: v })} />
      <fieldset className="nutri-fieldset stack">
        <legend className="field__label">Ingredientes (com a gordura do preparo)</legend>
        {draft.ingredients.length > 0 && (
          <ul className="nutri-ingredients">
            {draft.ingredients.map((ing, i) => {
              const name = nameOf(ing.foodId);
              return (
                <li key={ing.key} className="nutri-ingredient" role="group" aria-label={name}>
                  <span className="nutri-ingredient__name">{name}</span>
                  <NumberField label="Gramas" ariaLabel={`Gramas de ${name} na receita`} value={ing.grams} autoFocus={ing.key === focusKey}
                    error={issueOf(issues, `ingredients.${i}`)} onChange={(v) => setGrams(ing.key, v)} className="nutri-grams" />
                  <Button size="sm" variant="ghost" aria-label={`Remover ${name} da receita`} onClick={(e) => removeIngredient(ing.key, e.currentTarget)}>
                    Remover
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {issueOf(issues, 'ingredients') && <p className="nutri-error">{issueOf(issues, 'ingredients')}</p>}
        {choosable.length === 0 ? (
          <p className="muted">Para montar uma receita, cadastre antes os ingredientes em Novo alimento.</p>
        ) : picking ? (
          <div className="stack">
            <FoodPicker foods={choosable} pantry={[]} day="" onSelect={add} label="Ingrediente" autoFocus />
            <div>
              <Button size="sm" variant="ghost" onClick={(e) => { focusWhenGone(e.currentTarget, () => addButton.current); setPicking(false); }}>
                Fechar a busca
              </Button>
            </div>
          </div>
        ) : (
          <div><Button ref={addButton} size="sm" icon="plus" onClick={() => setPicking(true)}>Adicionar ingrediente</Button></div>
        )}
      </fieldset>
      <NumberField label="Rendimento final (g, pesado depois de pronto)" value={draft.yieldGrams} error={issueOf(issues, 'yieldGrams')}
        onChange={(v) => set({ yieldGrams: v })} className="nutri-grams" />
      {values && (
        <p className="nutri-computed" aria-live="polite">
          {`Por 100 g (calculado): ${nutrientsText(values.per100)}${values.per100.fiber !== undefined ? ` · fibra ${intText(values.per100.fiber)} g` : ''}${values.source === 'estimativa' ? ` · ${estimateText(true)}` : ''}`}
        </p>
      )}
      {fatNote && <p className="muted">{fatNote}</p>}
      <ChoiceChips label="Grupo" options={GROUPS} labels={FOOD_GROUP_LABEL} value={draft.group} onChange={(v) => set({ group: v })} hint={GROUP_HINT} />
      <ChoiceChips label="Preferência" options={LIKES} labels={FOOD_LIKE_LABEL} value={draft.like} onChange={(v) => set({ like: v })} hint={LIKE_HINT} />
      <GoodForChips value={draft.meals} onChange={(v) => set({ meals: v })} />
      <Extras unitName={draft.unitName} unitGrams={draft.unitGrams} maxPortion={draft.maxPortion} issues={issues} onChange={set} />
      {issues.length > 0 && <p role="alert" className="nutri-error">{CHECK_FIELDS}</p>}
      {recipe && <p className="muted">{KEEPS_DIARY}</p>}
      <div className="nutri-form__actions">
        <Button type="submit" variant="primary" disabled={busy}>Salvar</Button>
        {recipe && <Button variant="ghost" icon="trash" onClick={remove}>Apagar receita</Button>}
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}
