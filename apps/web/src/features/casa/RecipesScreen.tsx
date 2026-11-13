import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import type { ID, Recipe } from '@life/shared';
import { RECIPE_NAME_MAX, ingredientKey } from '@life/shared';
import { db } from '../../db/db';
import { useAllRecipes } from '../../db/casaData';
import { RecipeValidationError, deleteRecipe, restoreRecipe, saveRecipe } from '../../domain/mealActions';
import { Button } from '../../ui/Button';
import { FAILURE_TOAST, safeRun } from '../../ui/safeRun';
import { focusWhenGone } from '../../ui/focusAfter';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { ingredientsText } from './casaFormat';
import { focusHeadingIfLost } from './focusHeading';
import './casa.css';

const NAME_TAKEN = 'Já existe uma receita com esse nome.';

/** Undo of a delete: a live recipe may have taken the name meanwhile, so it stays deleted (and says so). */
async function restoreIfFree(id: ID): Promise<void> {
  const gone = await db.recipes.get(id);
  if (!gone) return;
  const key = ingredientKey(gone.name);
  const taken = (await db.recipes.toArray()).some((r) => !r.deleted && r.id !== id && ingredientKey(r.name) === key);
  if (taken) {
    useToast.getState().show(`${NAME_TAKEN} A receita apagada não foi restaurada.`);
    return;
  }
  await restoreRecipe(id);
}

/** "/casa/receitas": the dishes of the menu, each with its ingredient list (spec §6.6). */
export function RecipesScreen() {
  const recipes = useAllRecipes();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ recipe?: Recipe }>();
  const heading = useRef<HTMLHeadingElement>(null);
  const live = (recipes ?? []).filter((r) => !r.deleted).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const q = ingredientKey(query);
  const shown = live.filter((r) => ingredientKey(r.name).includes(q));
  const opener = useRef<HTMLElement | null>(null);
  const close = () => {
    setEditing(undefined);
    // A deleted recipe's row leaves a moment after the sheet closes (the live query), taking focus with it.
    focusWhenGone(opener.current, () => heading.current);
    focusHeadingIfLost(heading);
  };

  return (
    <section className="screen casa-screen stack" aria-labelledby="receitas-title">
      <Link href="/planejar?aba=casa" className="settings__back">‹ Casa</Link>
      <h1 id="receitas-title" ref={heading} tabIndex={-1}>Receitas</h1>
      <div className="casa-screen__bar">
        <Button variant="primary" icon="plus" onClick={() => setEditing({})}>Nova receita</Button>
        <input type="search" aria-label="Buscar receita" placeholder="Buscar receita" value={query}
          onChange={(e) => setQuery(e.target.value)} />
      </div>
      {recipes && live.length === 0 && (
        <p className="muted">Nenhuma receita ainda. Ao escolher um prato no cardápio, ele aparece aqui.</p>
      )}
      {live.length > 0 && shown.length === 0 && <p className="muted">Nada encontrado.</p>}
      {shown.length > 0 && (
        <ul className="recipe-list" aria-label="Receitas">
          {shown.map((r) => (
            <li key={r.id}>
              <button type="button" className="recipe-row" onClick={(e) => { opener.current = e.currentTarget; setEditing({ recipe: r }); }}>
                <span className="recipe-row__name">{r.name}</span>
                <span className="recipe-row__meta">{ingredientsText(r.ingredients.length)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={!!editing} onClose={close} title={editing?.recipe ? 'Editar receita' : 'Nova receita'} placement="top">
        {editing && <RecipeForm key={editing.recipe?.id ?? 'nova'} recipe={editing.recipe} onClose={close} />}
      </Sheet>
    </section>
  );
}

function RecipeForm({ recipe, onClose }: { recipe?: Recipe; onClose(): void }) {
  const [name, setName] = useState(recipe?.name ?? '');
  const [text, setText] = useState(recipe?.ingredients.join('\n') ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await saveRecipe({ ...(recipe ? { id: recipe.id } : {}), name, ingredients: text });
      onClose();
    } catch (err) {
      if (err instanceof RecipeValidationError) setError(err.message);
      else { console.error('recipe save failed', err); useToast.getState().show(FAILURE_TOAST); }
    } finally {
      setBusy(false);
    }
  };
  const remove = () => {
    if (!recipe) return;
    const id = recipe.id;
    safeRun(deleteRecipe(id).then(() => {
      onClose();
      useToast.getState().show('Receita apagada.', { label: 'Desfazer', run: () => safeRun(restoreIfFree(id)) });
    }));
  };

  return (
    <form className="stack" noValidate onSubmit={(e) => { void save(e); }}>
      <label className="field">
        <span className="field__label">Nome do prato</span>
        <input type="text" value={name} maxLength={RECIPE_NAME_MAX} onChange={(e) => { setName(e.target.value); setError(undefined); }} />
      </label>
      <label className="field">
        <span className="field__label">Ingredientes (um por linha)</span>
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <p className="muted">A quantidade é opcional, na própria linha: “frango 1 kg”.</p>
      {error && <p role="alert" className="sleep-form__error">{error}</p>}
      <div className="sleep-form__actions">
        <Button type="submit" variant="primary" disabled={busy}>Salvar</Button>
        {recipe && <Button variant="ghost" onClick={remove}>Apagar receita</Button>}
      </div>
    </form>
  );
}
