import { useEffect, useId, useState } from 'react';
import type { Mission } from '@life/shared';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { shrinkWithFeedback } from '../mission/missionFeedback';

export const SHRINK_TEMPLATES = [
  'Só abrir e olhar por 5 min',
  'Fazer só o primeiro item',
  'Escrever 3 linhas',
  'Separar o material',
];

export interface ShrinkDialogProps {
  mission?: Pick<Mission, 'id' | 'title'>;
  onClose(): void;
  /** After the 5-minute version is saved (e.g. the review also moves it to today). */
  onSaved?(missionId: string): void | Promise<void>;
}

/** "Qual é uma versão de 5 minutos?" → saved as the first step. */
export function ShrinkDialog({ mission, onClose, onSaved }: ShrinkDialogProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  useEffect(() => { setText(''); }, [mission?.id]);

  const save = async () => {
    const t = text.trim();
    if (!mission || !t || busy) return;
    setBusy(true);
    try {
      await shrinkWithFeedback(mission.id, t);
      await onSaved?.(mission.id);
      onClose();
    } catch (e) {
      console.error('shrink failed', e);
      useToast.getState().show('Não foi possível salvar. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!mission} onClose={onClose} title="Encolher">
      <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <p className="dialog-form__context">{mission?.title}</p>
        <label htmlFor={inputId} className="dialog-form__question">Qual é uma versão de 5 minutos?</label>
        <div className="cluster dialog-form__chips" role="group" aria-label="Sugestões">
          {SHRINK_TEMPLATES.map((t) => (
            <Chip key={t} selected={text === t} onClick={() => setText(t)}>{t}</Chip>
          ))}
        </div>
        <input id={inputId} type="text" value={text} placeholder="Ou escreva a sua" enterKeyHint="done"
          onChange={(e) => setText(e.target.value)} />
        <Button type="submit" variant="primary" icon="shrink" disabled={!text.trim() || busy}>
          Salvar
        </Button>
      </form>
    </Sheet>
  );
}
