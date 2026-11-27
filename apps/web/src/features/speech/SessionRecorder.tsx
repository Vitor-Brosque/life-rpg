import { SPEECH_AUDIO_MAX_MS } from '@life/shared';
import { Button } from '../../ui/Button';
import { formatMinSec } from '../../ui/format';
import type { Recorder } from '../media/useRecorder';
import '../media/media.css';
import './speech.css';

export const RECORDER_UNSUPPORTED = 'Gravação indisponível neste navegador ou conexão (é preciso HTTPS). Dá para registrar a sessão com “Fiz a atividade”.';
export const RECORDING_LINE = 'Gravando. Toque em Parar quando terminar.';
/** The microphone request already had this text; kept as it is. */
export const ASKING_LINE = 'Aguardando o microfone…';
export const COMFORT_LINE = 'Fale num volume confortável. Na leitura, toque em Parar logo ao terminar: a velocidade usa a duração da gravação.';

/**
 * The session's recorder: Gravar → Parar; the recording is kept by the sheet as soon as it stops (no "Inserir").
 * `saving`: that keep is running (the button waits). After a failed keep the same recording stays for
 * "Tentar guardar de novo" (`onRetry`). One persistent button in the same place of the tree, so focus stays on it.
 */
export function SessionRecorder({ rec, message, onRetry, saving = false }: {
  rec: Recorder; message: string; onRetry(): void; saving?: boolean;
}) {
  if (!rec.supported) return <p className="muted">{RECORDER_UNSUPPORTED}</p>;
  const s = rec.state;
  const recording = s.kind === 'recording';
  const retry = s.kind === 'done' && !saving;
  const status = message
    || (s.kind === 'asking' ? ASKING_LINE : s.kind === 'recording' ? RECORDING_LINE : s.kind === 'error' ? s.message : '');
  return (
    <>
      <div className="media-rec">
        {recording && (
          <span className="media-rec__time">{`Gravando · ${formatMinSec(s.elapsedMs)} / ${formatMinSec(SPEECH_AUDIO_MAX_MS)}`}</span>
        )}
        <Button
          variant={recording ? 'secondary' : 'primary'}
          icon={recording ? 'stop' : retry ? undefined : 'mic'}
          disabled={s.kind === 'asking' || (s.kind === 'done' && saving)}
          aria-label={recording ? 'Parar a gravação' : undefined}
          onClick={recording ? rec.stop : retry ? onRetry : rec.start}
        >
          {recording ? 'Parar' : retry ? 'Tentar guardar de novo' : 'Gravar'}
        </Button>
      </div>
      <p className="media-sheet__msg" role="status">{status}</p>
      <p className="muted">{COMFORT_LINE}</p>
    </>
  );
}
