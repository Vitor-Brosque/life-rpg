import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { requestMedia, useMediaStatus } from '../../sync/media';
import { Button } from '../../ui/Button';
import { focusWhenGone, mainHeading } from '../../ui/focusAfter';
import { AudioButton } from '../media/AudioPlayer';
import './speech.css';

/**
 * A speech recording: played from this device when its file is here; otherwise a calm line and "Buscar no servidor"
 * (a file that left this device is never fetched without a tap).
 */
export function RecordingPlayer({ hash, label }: { hash: string; label: string }) {
  const here = useLiveQuery(async () => !!(await db.mediaInfo.get(hash)), [hash]);
  const status = useMediaStatus((s) => s[hash]);
  if (here === undefined) return <span className="audio-player" aria-busy="true" />;
  if (here) return <AudioButton hash={hash} label={label} />;
  const line = status === 'downloading' ? `${label} · baixando…`
    : status === 'missing' ? `${label} · ainda não chegou a este aparelho`
    : `${label} · não está neste aparelho`;
  return (
    <span className="speech-away">
      <span className="muted">{line}</span>
      {/* Never disabled (a disabled focused button drops focus); requestMedia ignores a second tap while downloading. */}
      <Button size="sm" aria-label={`Buscar no servidor: ${label}`} onClick={(e) => {
        // When the file arrives this line becomes the player: focus moves to the new button in the same row.
        const row = e.currentTarget.closest('li');
        focusWhenGone(e.currentTarget, () => row?.querySelector<HTMLElement>('button') ?? mainHeading());
        requestMedia(hash);
      }}>
        Buscar no servidor
      </Button>
    </span>
  );
}
