import { useEffect } from 'react';
import { AUDIO_MAX_MS } from '@life/shared';
import { Button } from '../../ui/Button';
import { formatMinSec } from '../../ui/format';
import { AudioPlayer } from './AudioPlayer';
import { useRecorder, type RecorderState } from './useRecorder';
import './media.css';

export type SpokenKind = RecorderState['kind'];
const MINE = { play: 'Ouvir minha resposta', pause: 'Pausar minha resposta' };

/**
 * "Responder falando" (spec §6.5): record the answer before revealing, listen to it afterwards.
 * Transient: nothing is saved; a new key (next card) or unmounting drops it and frees the microphone.
 */
export function SpokenAnswer({ revealed, onKind }: { revealed: boolean; onKind(kind: SpokenKind): void }) {
  const rec = useRecorder();
  const { state: s, start, stop } = rec;
  useEffect(() => { onKind(s.kind); }, [s.kind, onKind]);
  useEffect(() => { if (revealed) stop(); }, [revealed, stop]);
  if (revealed) {
    if (s.kind !== 'done') return null;
    return (
      <div className="spoken">
        <h3 className="reveal__label">Sua resposta falada</h3>
        <AudioPlayer url={s.url} label="Ouvir minha resposta" names={MINE} />
      </div>
    );
  }
  const message = s.kind === 'error' ? s.message : s.kind === 'asking' ? 'Aguardando o microfone…' : '';
  return (
    <div className="spoken" role="group" aria-labelledby="spoken-title">
      <p id="spoken-title" className="field__label">Sua resposta falada</p>
      <div className="media-rec">
        {s.kind === 'recording' && (
          <span className="media-rec__time">Gravando · {formatMinSec(s.elapsedMs)} / {formatMinSec(AUDIO_MAX_MS)}</span>
        )}
        {s.kind === 'done' && <AudioPlayer url={s.url} label="Ouvir minha resposta" names={MINE} />}
        {/* One persistent button (same place in the tree): focus stays on it as its label changes. */}
        <Button size="sm" icon={s.kind === 'recording' ? 'stop' : 'mic'} disabled={s.kind === 'asking'}
          aria-label={s.kind === 'recording' ? 'Parar a gravação' : undefined}
          onClick={s.kind === 'recording' ? stop : start}>
          {s.kind === 'recording' ? 'Parar' : s.kind === 'done' ? 'Gravar de novo' : 'Gravar resposta'}
        </Button>
      </div>
      <p className="media-sheet__msg" role="status">{message}</p>
    </div>
  );
}
