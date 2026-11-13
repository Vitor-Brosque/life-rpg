import { useState, type FormEvent } from 'react';
import { create } from 'zustand';
import type { ID, WorkoutKind } from '@life/shared';
import { CARDIO_MINIMUM_MIN, WORKOUT_DEFAULT_MIN, WORKOUT_KINDS, WORKOUT_LABEL } from '@life/shared';
import { WorkoutValidationError, logWorkout, removeWorkout } from '../../domain/workoutActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { FAILURE_TOAST, safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';

export interface WorkoutPreset { kind?: WorkoutKind; minutes?: number; blockId?: ID }

interface WorkoutSheetStore { isOpen: boolean; preset?: WorkoutPreset; open(preset?: WorkoutPreset): void; close(): void }

/** "Registrar treino" for the whole app (Corpo screen and the body block). */
export const useWorkoutSheet = create<WorkoutSheetStore>((set) => ({
  isOpen: false,
  preset: undefined,
  open: (preset) => {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    set({ isOpen: true, preset });
  },
  close: () => {
    // The opener may be gone by then (the cardio button hides once a cardio is logged): focus must not fall on <body>.
    focusWhenGone(opener);
    set({ isOpen: false, preset: undefined });
  },
}));

let opener: HTMLElement | null = null;

const toast = (msg: string, action?: { label: string; run(): void }) => useToast.getState().show(msg, action);

/** Mount once (App). */
export function WorkoutSheetHost() {
  const { isOpen, preset, close } = useWorkoutSheet();
  return (
    <Sheet open={isOpen} onClose={close} title="Registrar treino">
      {isOpen && <WorkoutForm preset={preset} onClose={close} />}
    </Sheet>
  );
}

function WorkoutForm({ preset, onClose }: { preset?: WorkoutPreset; onClose(): void }) {
  const first = preset?.kind ?? 'musculacao';
  const [kind, setKind] = useState<WorkoutKind>(first);
  const [minutes, setMinutes] = useState(String(preset?.minutes ?? WORKOUT_DEFAULT_MIN[first]));
  // The suggested minutes follow the kind until they are typed by hand.
  const [typed, setTyped] = useState(preset?.minutes !== undefined);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const pick = (k: WorkoutKind) => {
    setKind(k);
    if (!typed) setMinutes(String(WORKOUT_DEFAULT_MIN[k]));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { workout, xp } = await logWorkout({
        kind, minutes: Number(minutes), ...(preset?.blockId ? { blockId: preset.blockId } : {}),
      });
      toast(xp > 0 ? `Treino registrado · +${xp} XP` : 'Treino registrado.', {
        label: 'Desfazer', run: () => safeRun(removeWorkout(workout.id)),
      });
      onClose();
    } catch (err) {
      if (err instanceof WorkoutValidationError) setError(err.message);
      else { console.error('workout save failed', err); toast(FAILURE_TOAST); }
    } finally {
      setBusy(false);
    }
  };

  return (
    // noValidate: our PT-BR message ("Informe quantos minutos durou.") instead of the browser bubble.
    <form className="workout-form stack" noValidate onSubmit={(e) => { void submit(e); }}>
      <fieldset className="workout-form__kinds">
        <legend className="field__label">Tipo</legend>
        {WORKOUT_KINDS.map((k) => (
          <label key={k} className="workout-form__kind">
            <input type="radio" name="workout-kind" value={k} checked={kind === k} onChange={() => pick(k)} />
            <span>{WORKOUT_LABEL[k]}</span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span className="field__label">Minutos</span>
        <input type="number" inputMode="numeric" min={1} max={300} value={minutes}
          onChange={(e) => { setMinutes(e.target.value); setTyped(true); setError(undefined); }} />
      </label>
      {error && <p role="alert" className="sleep-form__error">{error}</p>}
      <div className="sleep-form__actions">
        <Button type="submit" variant="primary" disabled={busy}>Registrar</Button>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}

/** "Fiz o cardio mínimo": 10 min of cardio, `minimum: true`, with its toast and Desfazer. */
export async function logMinimumCardio(blockId?: ID): Promise<void> {
  const { workout, xp } = await logWorkout({
    kind: 'cardio', minutes: CARDIO_MINIMUM_MIN, minimum: true, ...(blockId ? { blockId } : {}),
  });
  toast(xp > 0 ? `Cardio mínimo registrado · +${xp} XP` : 'Cardio mínimo registrado.', {
    label: 'Desfazer', run: () => safeRun(removeWorkout(workout.id)),
  });
}
