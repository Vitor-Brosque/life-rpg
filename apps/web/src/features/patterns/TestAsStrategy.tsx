import { useRef, useState } from 'react';
import { strategyKey, strategyTitleOf, testingStrategies } from '@life/shared';
import { useToday } from '../../db/hooks';
import { useStrategies } from '../../db/strategyData';
import { testStrategy } from '../../domain/strategyActions';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';

export interface TestAsStrategyProps {
  text: string;
  label?: string;
  /** Instead of saving (the "Nova semana" card puts the text in its own adjustment field). */
  onUse?(text: string): void;
}

/**
 * "Testar como estratégia": a suggestion of Padrões becomes a testing strategy (source Padrões) by one tap. Several can be
 * in test at once, so nothing is replaced; with one of the same title already in test the button says so.
 */
export function TestAsStrategy({ text, label = 'Testar como estratégia', onUse }: TestAsStrategyProps) {
  const strategies = useStrategies();
  const today = useToday();
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  if (onUse) return <Button size="sm" onClick={() => onUse(text)}>{label}</Button>;
  const key = strategyKey(strategyTitleOf(text));
  const testing = strategies !== undefined && today !== undefined
    && testingStrategies(strategies, today).some((s) => strategyKey(s.title) === key);
  const start = () => {
    setBusy(true);
    // The button is about to be disabled or replaced: park focus on the wrapper, which stays.
    box.current?.focus();
    safeRun(testStrategy(text, 'padroes')
      .then((s) => { if (s) useToast.getState().show('Estratégia em teste. Ela aparece no Agora e em Diário → Estratégias.'); })
      .finally(() => setBusy(false)));
  };
  return (
    <div className="use-experiment" ref={box} tabIndex={-1}>
      {testing
        ? <Button size="sm" disabled>Já está em teste</Button>
        : <Button size="sm" variant="primary" disabled={busy} onClick={start}>{label}</Button>}
    </div>
  );
}
