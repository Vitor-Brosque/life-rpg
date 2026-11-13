import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { setWeekExperiment } from '../../domain/patternActions';
import { useWeek } from '../../db/hooks';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';

export interface UseAsExperimentProps {
  text: string;
  label?: string;
  /** Instead of saving (the "Nova semana" card puts the text in its own field). */
  onUse?(text: string): void;
}

type Want = 'ask' | 'main';

/**
 * The week's experiment as a screen already read it. A screen that has the data (Padrões) provides it, so the
 * button knows the answer on its first render instead of after its own query; elsewhere `useWeek` answers.
 */
export const WeekExperimentContext = createContext<{ current?: string } | undefined>(undefined);

/** "Usar como experimento da semana": saves the week's experiment, asking before replacing another. */
export function UseAsExperiment({ text, label = 'Usar como experimento da semana', onUse }: UseAsExperimentProps) {
  const week = useWeek();
  const provided = useContext(WeekExperimentContext);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [want, setWant] = useState<Want | undefined>();
  const box = useRef<HTMLDivElement>(null);

  // Focus never falls to <body> when one button is swapped for another.
  useEffect(() => {
    if (!want) return;
    box.current?.querySelector<HTMLElement>(want === 'ask' ? '[data-use="swap"]' : '[data-use="main"]')?.focus();
    setWant(undefined);
  }, [want]);

  if (onUse) return <Button size="sm" onClick={() => onUse(text)}>{label}</Button>;
  const current = (provided ? provided.current : week?.experiment)?.trim() || undefined;
  const save = () => {
    setBusy(true);
    // The button is about to be disabled or replaced: park focus on the wrapper, which stays.
    box.current?.focus();
    safeRun(setWeekExperiment(text)
      .then(() => {
        setAsking(false);
        useToast.getState().show('Experimento da semana salvo. Ele aparece no Agora.');
      })
      .finally(() => setBusy(false)));
  };
  let content;
  if (current === text.trim()) {
    content = <Button size="sm" disabled>Já é o experimento da semana</Button>;
  } else if (asking && current) {
    content = (
      <div className="use-experiment__ask" role="group" aria-label="Trocar experimento">
        <p>{`Esta semana já tem o experimento “${current}”. Trocar por este?`}</p>
        <Button size="sm" variant="primary" data-use="swap" disabled={busy} onClick={save}>Trocar</Button>
        <Button size="sm" variant="ghost" onClick={() => { setAsking(false); setWant('main'); }}>Manter o atual</Button>
      </div>
    );
  } else {
    content = (
      <Button
        size="sm" variant="primary" data-use="main" disabled={busy}
        onClick={() => { if (current) { setAsking(true); setWant('ask'); } else save(); }}
      >
        {label}
      </Button>
    );
  }
  return <div className="use-experiment" ref={box} tabIndex={-1}>{content}</div>;
}
