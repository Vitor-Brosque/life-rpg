import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import type { DayKey, FieldIssue, Macro, MacroTarget, NutritionSettings, NutritionTarget, WeighIn } from '@life/shared';
import {
  MACROS, NUTRITION_MEALS, NUTRITION_MEAL_LABEL, WEIGH_IN_NOTE, kcalText, macroKcal, macroTargetIssues, parseDecimal,
  targetGroups, targetHistoryText, targetRecordFor, weekTargets, weighInIssue, weighInSummary, weightChangeText, weightText,
} from '@life/shared';
import { useNutritionSettings, useNutritionTargets, useWeighIns } from '../../db/nutritionData';
import { useToday } from '../../db/hooks';
import { addWeighIn, deleteWeighIn, restoreWeighIn, saveTargets, setMealOn } from '../../domain/nutritionActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { FOCUS_PAGE, focusWhenGone } from '../../ui/focusAfter';
import { ddmm } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { NumberField, attempt, decimalText, issueOf, toast } from './nutritionUi';
import './nutrition.css';

const RECENT_WEIGH_INS = 10;

/** "/corpo/nutricao/metas": the targets with history, the meals switched on and the weigh-ins (spec §6). */
export function NutritionTargetsScreen() {
  const today = useToday();
  const targets = useNutritionTargets();
  const settings = useNutritionSettings();
  const weighIns = useWeighIns();
  return (
    <section className="screen nutri stack" aria-labelledby="targets-title">
      <Link href="/corpo/nutricao" className="settings__back">‹ Nutrição</Link>
      <h1 id="targets-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Metas e peso</h1>
      {today && targets && <TargetsSection today={today} targets={targets} />}
      {settings && <MealsSection settings={settings} />}
      {weighIns && <WeightSection weighIns={weighIns} />}
    </section>
  );
}

type GroupKey = 'weekdays' | 'weekend';
type GroupDraft = Record<Macro, string>;
const GROUP_LABEL: Record<GroupKey, string> = { weekdays: 'Segunda a sexta', weekend: 'Sábado e domingo' };
const MACRO_FIELD: Record<Macro, string> = { protein: 'Proteína (g)', carbs: 'Carboidratos (g)', fat: 'Gorduras (g)' };

const groupDraftOf = (t?: MacroTarget): GroupDraft => ({ protein: decimalText(t?.protein), carbs: decimalText(t?.carbs), fat: decimalText(t?.fat) });
const parsedOf = (g: GroupDraft) => ({ protein: parseDecimal(g.protein), carbs: parseDecimal(g.carbs), fat: parseDecimal(g.fat) });

const draftOf = (rec?: NutritionTarget): Record<GroupKey, GroupDraft> => {
  const g = rec ? targetGroups(rec) : {};
  return { weekdays: groupDraftOf(g.weekdays), weekend: groupDraftOf(g.weekend) };
};
const recordKey = (rec?: NutritionTarget): string => (rec ? `${rec.id}:${rec.updatedAt}` : '');

function TargetsSection({ today, targets }: { today: DayKey; targets: readonly NutritionTarget[] }) {
  const rec = targetRecordFor(targets, today);
  const [draft, setDraft] = useState<Record<GroupKey, GroupDraft>>(() => draftOf(rec));
  // While the form is untouched it follows the record in force (one that arrives by sync after the screen opened, or
  // the one just saved); once typed in, what was typed stays.
  const [dirty, setDirty] = useState(false);
  const [seeded, setSeeded] = useState(() => recordKey(rec));
  if (!dirty && seeded !== recordKey(rec)) {
    setSeeded(recordKey(rec));
    setDraft(draftOf(rec));
  }
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (group: GroupKey, macro: Macro, v: string) => {
    setDirty(true);
    setDraft((d) => ({ ...d, [group]: { ...d[group], [macro]: v } }));
    setIssues((is) => is.filter((i) => i.field !== `${group}.${macro}`));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const wd = parsedOf(draft.weekdays);
    const we = parsedOf(draft.weekend);
    const found = [...macroTargetIssues(wd, 'weekdays.'), ...macroTargetIssues(we, 'weekend.')];
    if (found.length > 0) { setIssues(found); return; }
    setBusy(true);
    const ok = await attempt(() => saveTargets(weekTargets(wd as MacroTarget, we as MacroTarget)), () => setIssues([{ field: 'form', message: 'Confira os campos.' }]));
    setBusy(false);
    if (!ok) return;
    setDirty(false);
    toast('Metas salvas. Valem a partir de hoje.');
  };

  return (
    <section className="stack" aria-labelledby="targets-goals-title">
      <h2 id="targets-goals-title" className="section-title">Metas</h2>
      <p className="muted">Proteína, carboidratos e gorduras em gramas. As calorias saem deles: 4 kcal por grama de proteína e de carboidrato, 9 por grama de gordura.</p>
      <form className="stack" noValidate onSubmit={(e) => { void save(e); }}>
        {(['weekdays', 'weekend'] as const).map((group) => {
          const parsed = parsedOf(draft[group]);
          const kcal = MACROS.every((m) => typeof parsed[m] === 'number') ? macroKcal(parsed as MacroTarget) : undefined;
          return (
            <fieldset key={group} className="nutri-fieldset">
              <legend className="corpo__subtitle">{GROUP_LABEL[group]}</legend>
              <div className="nutri-grid">
                {MACROS.map((m) => (
                  <NumberField key={m} label={MACRO_FIELD[m]} ariaLabel={`${MACRO_FIELD[m]}, ${GROUP_LABEL[group].toLowerCase()}`}
                    value={draft[group][m]} error={issueOf(issues, `${group}.${m}`)} onChange={(v) => set(group, m, v)} />
                ))}
              </div>
              <p className="nutri-computed" aria-live="polite">{`Calorias: ${kcal === undefined ? '—' : kcalText(kcal)}`}</p>
            </fieldset>
          );
        })}
        {issues.length > 0 && <p role="alert" className="nutri-error">Confira os campos marcados.</p>}
        <p className="muted">Salvar cria uma meta que vale a partir de hoje. As anteriores ficam no histórico, e os dias passados continuam com a meta que valia neles.</p>
        <div><Button type="submit" variant="primary" disabled={busy}>Salvar metas</Button></div>
      </form>
      <h3 className="corpo__subtitle">Histórico</h3>
      {targets.length === 0 ? (
        <p className="muted">Nenhuma meta salva ainda.</p>
      ) : (
        <ul className="nutri-history" aria-label="Histórico das metas">
          {targets.map((t) => <li key={t.id}>{targetHistoryText(t)}</li>)}
        </ul>
      )}
    </section>
  );
}

function MealsSection({ settings }: { settings: NutritionSettings }) {
  const [error, setError] = useState<string>();
  const toggle = (meal: (typeof NUTRITION_MEALS)[number]) => {
    setError(undefined);
    void attempt(() => setMealOn(meal, !settings.meals.includes(meal)), (issues) => setError(issues[0]?.message));
  };
  return (
    <section className="stack" aria-labelledby="targets-meals-title">
      <h2 id="targets-meals-title" className="section-title">Refeições</h2>
      <p className="muted">Ligue as refeições que você faz. As desligadas não aparecem e não entram no plano; o que já foi registrado nelas continua aparecendo.</p>
      <div className="nutri-chips" role="group" aria-label="Refeições ligadas">
        {NUTRITION_MEALS.map((m) => (
          <Chip key={m} selected={settings.meals.includes(m)} onClick={() => toggle(m)}>{NUTRITION_MEAL_LABEL[m]}</Chip>
        ))}
      </div>
      {error && <p role="alert" className="nutri-error">{error}</p>}
    </section>
  );
}

function WeightSection({ weighIns }: { weighIns: readonly WeighIn[] }) {
  const [kg, setKg] = useState('');
  const [error, setError] = useState<string>();
  const summary = weighInSummary(weighIns);

  const register = (e: FormEvent) => {
    e.preventDefault();
    const v = parseDecimal(kg);
    const issue = weighInIssue(v);
    if (issue) { setError(issue); return; }
    void attempt(() => addWeighIn(v!), (issues) => setError(issues[0]?.message)).then((ok) => {
      if (!ok) return;
      setKg('');
      toast('Pesagem registrada.');
    });
  };
  const remove = (w: WeighIn, control: Element) => {
    focusWhenGone(control, () => document.getElementById('targets-weight-title'), { preventScroll: true });
    safeRun(async () => {
      const gone = await deleteWeighIn(w.id);
      if (gone) toast('Pesagem apagada.', { label: 'Desfazer', run: () => safeRun(restoreWeighIn(gone)) });
    });
  };

  return (
    <section className="stack" aria-labelledby="targets-weight-title">
      <h2 id="targets-weight-title" className="section-title" tabIndex={-1}>Peso</h2>
      <form className="nutri-item__form" noValidate onSubmit={register}>
        <NumberField label="Peso (kg)" value={kg} error={error} onChange={(v) => { setKg(v); setError(undefined); }} className="nutri-grams" />
        <Button type="submit" variant="primary">Registrar</Button>
      </form>
      {summary.last && (
        <dl className="nutri-weight">
          <div><dt>Última</dt><dd>{`${weightText(summary.last.kg)} em ${ddmm(summary.last.day)}`}</dd></div>
          {summary.average !== undefined && (
            <div>
              <dt>{summary.days === 1 ? 'Média de 1 dia com pesagem' : `Média dos últimos ${summary.days} dias com pesagem`}</dt>
              <dd>{weightText(summary.average)}</dd>
            </div>
          )}
          {summary.change !== undefined && (
            <div><dt>Mudança em relação à média anterior</dt><dd>{weightChangeText(summary.change)}</dd></div>
          )}
        </dl>
      )}
      <p className="muted">{WEIGH_IN_NOTE}</p>
      {weighIns.length > 0 && (
        <>
          <h3 className="corpo__subtitle">Últimas pesagens</h3>
          <ul className="nutri-items" aria-label="Últimas pesagens">
            {weighIns.slice(0, RECENT_WEIGH_INS).map((w) => (
              <li key={w.id} className="nutri-weigh-in">
                <span>{`${ddmm(w.day)} · ${weightText(w.kg)}`}</span>
                <Button size="sm" variant="ghost" icon="trash" aria-label={`Apagar a pesagem de ${ddmm(w.day)}, ${weightText(w.kg)}`}
                  onClick={(e) => remove(w, e.currentTarget)}>
                  Apagar
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
