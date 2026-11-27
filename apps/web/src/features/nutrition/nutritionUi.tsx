import { useId, type Ref } from 'react';
import { Link } from 'wouter';
import type { FieldIssue, NutritionMeal } from '@life/shared';
import { NutritionValidationError } from '../../domain/nutritionActions';
import { Chip } from '../../ui/Chip';
import { FAILURE_TOAST } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';

// Small pieces shared by the Nutrição screens (spec 2026-11-25-nutricao-design.md §6). The rules live in
// @life/shared (nutrition.ts) and the writes in domain/nutritionActions.ts; this file only formats and wires.

export const toast = (msg: string, action?: { label: string; run(): void }) => useToast.getState().show(msg, action);

/** "no Almoço", "na Ceia": the meal after "Gramas de Arroz …" in accessible names. */
export const MEAL_IN: Record<NutritionMeal, string> = {
  cafe: 'no Café da manhã', lanche: 'no Lanche da manhã', almoco: 'no Almoço', tarde: 'no Café da tarde', jantar: 'no Jantar', ceia: 'na Ceia',
};
/** "do Almoço", "da Ceia". */
export const MEAL_FROM: Record<NutritionMeal, string> = {
  cafe: 'do Café da manhã', lanche: 'do Lanche da manhã', almoco: 'do Almoço', tarde: 'do Café da tarde', jantar: 'do Jantar', ceia: 'da Ceia',
};

/** A stored number back in a field: 12.5 → "12,5". */
export const decimalText = (n: number | undefined): string => (n === undefined ? '' : String(n).replace('.', ','));

/** The sentence of one field, if any. */
export const issueOf = (issues: readonly FieldIssue[], field: string): string | undefined => issues.find((i) => i.field === field)?.message;

/**
 * Runs a Nutrição action. A form problem goes to `onInvalid` with every field; anything else is logged and gets the
 * failure toast. Resolves true when it worked.
 */
export async function attempt(task: () => Promise<unknown>, onInvalid?: (issues: FieldIssue[]) => void): Promise<boolean> {
  try {
    await task();
    return true;
  } catch (err) {
    if (err instanceof NutritionValidationError) onInvalid?.(err.issues);
    else { console.error('nutrition action failed', err); toast(FAILURE_TOAST); }
    return false;
  }
}

export interface NumberFieldProps {
  label: string;
  value: string;
  onChange(v: string): void;
  error?: string;
  /** Accessible name when the visible label is not enough ("Gramas de Arroz no Almoço"). */
  ariaLabel?: string;
  placeholder?: string;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
  /** The label stays for assistive technology only (compact rows: the accessible name is `ariaLabel`). */
  hideLabel?: boolean;
}

/** A number typed with the keyboard's decimal pad (comma accepted); the sentence of the field stays right under it. */
export function NumberField({ label, value, onChange, error, ariaLabel, placeholder, autoFocus, inputRef, className, hideLabel }: NumberFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label className={hideLabel ? 'visually-hidden' : 'field__label'} htmlFor={id}>{label}</label>
      <input id={id} ref={inputRef} type="text" inputMode="decimal" autoComplete="off" value={value} placeholder={placeholder}
        aria-label={ariaLabel} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
        // Only fields that appear right after a choice (a food picked, an item to correct) ask for the focus.
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)} />
      {error && <p id={errorId} className="nutri-error">{error}</p>}
    </div>
  );
}

/** A short text (a name), with its sentence under it. */
export function TextField({ label, value, onChange, error, maxLength, ariaLabel }: {
  label: string; value: string; onChange(v: string): void; error?: string; maxLength?: number; ariaLabel?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <input id={id} type="text" autoComplete="off" value={value} maxLength={maxLength} aria-label={ariaLabel}
        aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} onChange={(e) => onChange(e.target.value)} />
      {error && <p id={errorId} className="nutri-error">{error}</p>}
    </div>
  );
}

/** One choice among a few, as buttons (taps over typing): Pronto/Cru, the source, the group, the preference. */
export function ChoiceChips<T extends string>({ label, options, labels, value, onChange, hint }: {
  label: string; options: readonly T[]; labels: Record<T, string>; value: T; onChange(v: T): void; hint?: string;
}) {
  const id = useId();
  return (
    <div className="nutri-choice" role="group" aria-labelledby={id}>
      <span id={id} className="field__label">{label}</span>
      <div className="nutri-chips">
        {options.map((o) => <Chip key={o} selected={value === o} onClick={() => onChange(o)}>{labels[o]}</Chip>)}
      </div>
      {hint && <p className="muted nutri-hint">{hint}</p>}
    </div>
  );
}

/** No food yet: says why the list is empty and links to "Novo alimento". */
export function EmptyFoods() {
  return (
    <div className="stack nutri-empty">
      <p className="muted">
        Nenhum alimento cadastrado ainda. Cadastre os que você come, com os valores por 100 g do rótulo ou de uma tabela.
      </p>
      <div><Link href="/corpo/nutricao/alimentos?novo=alimento" className="btn btn--primary btn--md">Novo alimento</Link></div>
    </div>
  );
}
