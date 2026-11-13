import { useState } from 'react';
import type { DayKey, ID } from '@life/shared';
import { PREP_MAX_PORTIONS, freezerStock, portionsOf, prepHints } from '@life/shared';
import { useAllRecipes, useFreezerMoves, useMenu } from '../../db/casaData';
import { finishPrep, undoPrep } from '../../domain/mealActions';
import { Button } from '../../ui/Button';
import { plural } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';

/** "Preparo em lote": how many portions of each dish went into the freezer (spec §6.5). */
export function PrepSheet({ open, week, onClose }: { open: boolean; week: DayKey; onClose(): void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Preparo em lote">
      {open && <PrepForm week={week} onClose={onClose} />}
    </Sheet>
  );
}

interface Row { recipeId: ID; name: string; hint: string }

const clampPortions = (v: string): number => Math.max(0, Math.min(PREP_MAX_PORTIONS, Math.round(Number(v)) || 0));

function PrepForm({ week, onClose }: { week: DayKey; onClose(): void }) {
  const menu = useMenu(week);
  const recipes = useAllRecipes();
  const moves = useFreezerMoves();
  const [added, setAdded] = useState<ID[]>([]);
  const [values, setValues] = useState<Record<ID, string>>({});
  const [busy, setBusy] = useState(false);
  if (menu === undefined || !recipes || !moves) return null;

  const stock = freezerStock(moves);
  const rows: Row[] = prepHints(menu ?? undefined, recipes, stock).map((h) => ({
    recipeId: h.recipeId, name: h.name, hint: `${h.planned} no cardápio · ${h.inFreezer} no freezer`,
  }));
  for (const id of added) {
    if (rows.some((r) => r.recipeId === id)) continue;
    rows.push({ recipeId: id, name: recipes.find((r) => r.id === id)?.name ?? 'Prato', hint: `${portionsOf(stock, id)} no freezer` });
  }
  const others = recipes
    .filter((r) => !r.deleted && !rows.some((x) => x.recipeId === r.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const value = (id: ID): string => values[id] ?? '0';
  const set = (id: ID, v: string) => setValues((cur) => ({ ...cur, [id]: v }));
  const step = (id: ID, d: number) => set(id, String(clampPortions(String(clampPortions(value(id)) + d))));
  const total = rows.reduce((s, r) => s + clampPortions(value(r.recipeId)), 0);

  const finish = () => {
    setBusy(true);
    safeRun(finishPrep(rows.map((r) => ({ recipeId: r.recipeId, portions: clampPortions(value(r.recipeId)) })))
      .then((res) => {
        if (res.portions === 0) return;
        useToast.getState().show(
          `Preparo registrado: +${plural(res.portions, 'marmita', 'marmitas')}${res.xp > 0 ? ` · +${res.xp} XP` : ''}`,
          { label: 'Desfazer', run: () => safeRun(undoPrep(res)) },
        );
        onClose();
      })
      .finally(() => setBusy(false)));
  };

  return (
    <div className="prep stack">
      <p>Quantas porções foram para o freezer?</p>
      {rows.length === 0 && others.length === 0 && (
        <p className="muted">Ainda não há receitas. Escolha pratos no cardápio ou crie uma em Receitas.</p>
      )}
      {rows.length > 0 && (
        <ul className="prep__rows" aria-label="Pratos do preparo">
          {rows.map((r) => (
            <li key={r.recipeId} className="prep-row">
              <span className="prep-row__name">{r.name}</span>
              <span className="prep-row__hint">{r.hint}</span>
              <span className="prep-row__stepper">
                <Button size="sm" aria-label={`Menos uma porção de ${r.name}`} onClick={() => step(r.recipeId, -1)}>−</Button>
                <input type="number" inputMode="numeric" min={0} max={PREP_MAX_PORTIONS} aria-label={`Porções de ${r.name}`}
                  value={value(r.recipeId)} onChange={(e) => set(r.recipeId, e.target.value)} />
                <Button size="sm" aria-label={`Mais uma porção de ${r.name}`} onClick={() => step(r.recipeId, 1)}>+</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <label className="field">
          <span className="field__label">Adicionar outro prato</span>
          <select value="" onChange={(e) => { const id = e.target.value; if (id) setAdded((cur) => [...cur, id]); }}>
            <option value="">Escolher…</option>
            {others.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      )}
      <div><Button variant="primary" disabled={busy || total === 0} onClick={finish}>Terminei o preparo</Button></div>
    </div>
  );
}
