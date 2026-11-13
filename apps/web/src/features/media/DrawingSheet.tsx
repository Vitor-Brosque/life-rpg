import { useState } from 'react';
import type { Stroke } from '@life/shared';
import { MediaInputError, saveMediaBlob } from '../../db/media';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { SketchPad } from '../sketch/SketchPad';
import { drawingToImage } from './drawingImage';
import './media.css';

export const DRAWING_FAILED = 'Não foi possível criar a imagem do desenho.';

/** "Desenho" in the note editor (spec §6.3): draw, then insert as an image. Not kept as a lousa. */
export function DrawingSheet({ open, onClose, onInsert }: { open: boolean; onClose(): void; onInsert(hash: string): void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Desenho">
      {open && <DrawingBody onClose={onClose} onInsert={onInsert} />}
    </Sheet>
  );
}

/** Mounted only while open: every opening starts with an empty pad. */
function DrawingBody({ onClose, onInsert }: { onClose(): void; onInsert(hash: string): void }) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const insert = async (): Promise<void> => {
    setBusy(true);
    setMessage('');
    try {
      const blob = await drawingToImage(strokes);
      if (!blob) { setMessage(DRAWING_FAILED); return; }
      onInsert((await saveMediaBlob(blob)).hash);
    } catch (e) {
      if (!(e instanceof MediaInputError)) console.error('drawing failed', e);
      setMessage(e instanceof MediaInputError ? e.message : DRAWING_FAILED);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack media-sheet">
      <SketchPad className="media-sheet__pad" label="Desenho do card" initial={[]} onChange={setStrokes} wheelPans={false} />
      <p className="media-sheet__msg" role="status">{message}</p>
      <div className="commit-form__actions">
        <Button variant="primary" icon="check" disabled={strokes.length === 0 || busy} onClick={() => void insert()}>Inserir no card</Button>
        <Button onClick={onClose}>Cancelar</Button>
      </div>
    </div>
  );
}
