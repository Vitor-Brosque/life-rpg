import { Chip } from '../../ui/Chip';
import { KINDS, KIND_LABEL, type CaptureKind } from './captureModel';

/** "Tipo" at the top of the "+": Tarefa · Compromisso · Prova ou trabalho · Card. */
export function CaptureKindPicker({ value, onChange }: { value: CaptureKind; onChange(kind: CaptureKind): void }) {
  return (
    <div className="capture-kinds" role="group" aria-label="Tipo">
      {KINDS.map((k) => (
        <Chip key={k} selected={value === k} onClick={() => onChange(k)}>{KIND_LABEL[k]}</Chip>
      ))}
    </div>
  );
}
