import { useEffect, useId, useRef, useState } from 'react';
import { AUDIO_MAX_MS, MEDIA_MAX_BYTES, mediaKindOf, sniffMediaType } from '@life/shared';
import type { MediaInfo } from '../../db/db';
import { MediaInputError, saveMediaBlob, storeMedia } from '../../db/media';
import { Button } from '../../ui/Button';
import { formatMinSec } from '../../ui/format';
import { FAILURE_TOAST } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { AudioPlayer } from './AudioPlayer';
import { useRecorder } from './useRecorder';
import './media.css';

export const AUDIO_MESSAGES = {
  asking: 'Aguardando o microfone…',
  capped: 'Limite de 2 minutos atingido.',
  unsupported: 'Este navegador não grava áudio. Você ainda pode escolher um arquivo.',
  format: 'Formato de áudio não aceito. Use MP3, M4A, OGG ou WEBM.',
  tooBig: 'Áudio grande demais (máximo 8 MB).',
} as const;

/** An audio file picked or dropped: at most 8 MB and an accepted audio format; stored and queued. */
export async function saveAudioFile(file: Blob): Promise<MediaInfo> {
  if (file.size > MEDIA_MAX_BYTES) throw new MediaInputError(AUDIO_MESSAGES.tooBig);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffMediaType(bytes);
  if (!type || mediaKindOf(type) !== 'audio') throw new MediaInputError(AUDIO_MESSAGES.format);
  return (await storeMedia(bytes, { upload: true })).info;
}

/** "Áudio" in the note editor (spec §6.4): record (≤ 2 min) or pick a file, then insert. */
export function AudioSheet({ open, onClose, onInsert }: { open: boolean; onClose(): void; onInsert(hash: string): void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Áudio">
      {open && <AudioBody onInsert={onInsert} />}
    </Sheet>
  );
}

/** Mounted only while open: closing unmounts it, which drops the recording and frees the microphone. */
function AudioBody({ onInsert }: { onInsert(hash: string): void }) {
  const rec = useRecorder();
  const fileId = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const s = rec.state;
  const root = useRef<HTMLDivElement>(null);
  // The buttons swap as the state changes, which drops focus to <body>: put it back on the sheet so Esc keeps closing it.
  useEffect(() => {
    if (document.activeElement === document.body || !document.activeElement) {
      root.current?.closest<HTMLElement>('[role="dialog"]')?.focus();
    }
  }, [s.kind]);
  const start = (): void => { setMessage(''); rec.start(); };
  const save = async (task: () => Promise<MediaInfo>): Promise<void> => {
    setBusy(true);
    setMessage('');
    try {
      onInsert((await task()).hash);
    } catch (e) {
      if (!(e instanceof MediaInputError)) console.error('audio failed', e);
      setMessage(e instanceof MediaInputError ? e.message : FAILURE_TOAST);
    } finally {
      setBusy(false);
    }
  };
  const status = message
    || (s.kind === 'error' ? s.message
      : s.kind === 'asking' ? AUDIO_MESSAGES.asking
      : s.kind === 'done' && s.capped ? AUDIO_MESSAGES.capped
      : '');
  return (
    <div ref={root} className="stack media-sheet">
      {!rec.supported ? <p className="muted">{AUDIO_MESSAGES.unsupported}</p>
        : s.kind === 'recording' ? (
          <div className="media-rec">
            <span className="media-rec__time">Gravando · {formatMinSec(s.elapsedMs)} / {formatMinSec(AUDIO_MAX_MS)}</span>
            <Button icon="stop" onClick={rec.stop}>Parar</Button>
          </div>
        ) : s.kind === 'done' ? (
          <div className="media-rec">
            <span className="media-rec__time">Gravação · {formatMinSec(s.durationMs)}</span>
            <AudioPlayer url={s.url} label="Ouvir a gravação" names={{ play: 'Ouvir a gravação', pause: 'Pausar a gravação' }} />
            <Button onClick={start}>Gravar de novo</Button>
            <Button variant="primary" icon="check" disabled={busy} onClick={() => void save(() => saveMediaBlob(s.blob))}>Inserir no card</Button>
          </div>
        ) : (
          <Button variant="primary" icon="mic" disabled={s.kind === 'asking'} onClick={start}>Gravar</Button>
        )}
      <p className="media-sheet__msg" role="status">{status}</p>
      <hr className="media-sheet__rule" />
      <input id={fileId} type="file" accept="audio/*" className="visually-hidden" disabled={busy}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void save(() => saveAudioFile(file));
        }} />
      <label htmlFor={fileId} className={`btn btn--secondary btn--md${busy ? ' is-busy' : ''}`}>Escolher arquivo</label>
      <p className="block-form__hint">MP3, M4A, OGG ou WEBM, até 8 MB.</p>
    </div>
  );
}
