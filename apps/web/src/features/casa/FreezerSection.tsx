import { useId, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKey, ID } from '@life/shared';
import { addDays, freezerLow, freezerStock, freezerTotal, prepMissionId, weekKey } from '@life/shared';
import { useAllRecipes, useFreezerMoves } from '../../db/casaData';
import { db } from '../../db/db';
import { eatPortion, ensurePrepMission, fixPortions, undoFreezerMove } from '../../domain/mealActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { plural } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { eatToast, shortDay } from '../corpo/corpoFormat';
import { useMissionSheet } from '../mission/MissionSheet';
import { lowText } from './casaFormat';
import { focusHeadingIfLost } from './focusHeading';
import { PrepSheet } from './PrepSheet';

interface FixTarget { recipeId: ID; name: string; portions: number }

/** "Freezer": portions per dish, "Comi uma", "Ajustar", batch prep and the gentle low suggestion (spec §6.5). */
export function FreezerSection({ week, today }: { week: DayKey; today: DayKey }) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const moves = useFreezerMoves();
  const recipes = useAllRecipes();
  // "Today" is the logical day, so the prep mission belongs to the week of the logical day.
  const prepWeek = weekKey(today);
  // undefined while loading, null when neither this week nor last week (marked on a Sunday) has an open prep mission.
  const mission = useLiveQuery(async () => {
    const found = await db.missions.bulkGet([prepMissionId(prepWeek), prepMissionId(addDays(prepWeek, -7))]);
    return found.find((m) => m && !m.deleted && (m.status === 'open' || m.status === 'doing')) ?? null;
  }, [prepWeek]);
  const [prepOpen, setPrepOpen] = useState(false);
  const [fixing, setFixing] = useState<FixTarget>();
  if (!moves || !recipes || mission === undefined) {
    return <section className="casa__section" aria-labelledby={id} aria-busy="true"><h2 id={id} className="section-title">Freezer</h2></section>;
  }

  const stock = freezerStock(moves);
  const total = freezerTotal(stock);
  const nameOf = (recipeId: ID): string => recipes.find((r) => r.id === recipeId)?.name ?? 'Prato';
  const open = mission ?? undefined;
  const eat = (recipeId: ID, e: MouseEvent<HTMLButtonElement>) => {
    focusWhenGone(e.currentTarget, () => heading.current);
    safeRun(eatPortion(recipeId).then((r) => {
      if (!r.move) return;
      const moveId = r.move.id;
      useToast.getState().show(eatToast(r.total, r.low), { label: 'Desfazer', run: () => safeRun(undoFreezerMove(moveId)) });
    }));
  };
  const mark = (e: MouseEvent<HTMLButtonElement>) => {
    focusWhenGone(e.currentTarget, () => heading.current);
    safeRun(ensurePrepMission(prepWeek).then((m) => useMissionSheet.getState().open(m.id)));
  };

  return (
    <section className="casa__section stack" aria-labelledby={id}>
      <h2 id={id} ref={heading} tabIndex={-1} className="section-title">Freezer</h2>
      {stock.length === 0 ? (
        <p className="muted">Freezer vazio. Depois de um preparo em lote, as porções aparecem aqui.</p>
      ) : (
        <>
          <p className="casa__total">{plural(total, 'marmita', 'marmitas')}</p>
          <ul className="freezer" aria-label="Pratos no freezer">
            {stock.map((s) => {
              const name = nameOf(s.recipeId);
              return (
                <li key={s.recipeId} className="freezer-row">
                  <span className="freezer-row__name">{name}</span>
                  <span className="freezer-row__count">{s.portions}</span>
                  <Button size="sm" aria-label={`Comi uma: ${name}`} onClick={(e) => eat(s.recipeId, e)}>Comi uma</Button>
                  <Button size="sm" variant="ghost" aria-label={`Ajustar porções: ${name}`}
                    onClick={() => setFixing({ recipeId: s.recipeId, name, portions: s.portions })}>Ajustar</Button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {freezerLow(stock, moves) && (
        <Panel variant="stone" className="casa__low">
          <p>{open ? (open.date ? `Preparo marcado para ${shortDay(open.date)}` : 'Preparo marcado, ainda sem dia.') : lowText(total)}</p>
          {open
            ? <Button size="sm" onClick={() => useMissionSheet.getState().open(open.id)}>Ver missão</Button>
            : <Button size="sm" onClick={mark}>Marcar preparo</Button>}
        </Panel>
      )}
      <div><Button variant="primary" onClick={() => setPrepOpen(true)}>Preparo em lote</Button></div>
      <PrepSheet open={prepOpen} week={week} onClose={() => { setPrepOpen(false); focusHeadingIfLost(heading); }} />
      <FixSheet target={fixing} onClose={() => { setFixing(undefined); focusHeadingIfLost(heading); }} />
    </section>
  );
}

function FixSheet({ target, onClose }: { target?: FixTarget; onClose(): void }) {
  return (
    <Sheet open={!!target} onClose={onClose} title={target ? `Ajustar: ${target.name}` : ''}>
      {target && <FixForm key={target.recipeId} target={target} onClose={onClose} />}
    </Sheet>
  );
}

function FixForm({ target, onClose }: { target: FixTarget; onClose(): void }) {
  const [value, setValue] = useState(String(target.portions));
  const save = (e: FormEvent) => {
    e.preventDefault();
    safeRun(fixPortions(target.recipeId, Number(value) || 0).then((move) => {
      onClose();
      if (move) useToast.getState().show('Freezer ajustado.', { label: 'Desfazer', run: () => safeRun(undoFreezerMove(move.id)) });
    }));
  };
  return (
    <form className="stack" noValidate onSubmit={save}>
      <label className="field">
        <span className="field__label">Porções no freezer</span>
        <input type="number" inputMode="numeric" min={0} max={99} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <div><Button type="submit" variant="primary">Salvar</Button></div>
    </form>
  );
}
