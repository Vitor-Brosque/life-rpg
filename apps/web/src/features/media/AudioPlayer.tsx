import { useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { useMediaUrl } from './useMediaUrl';
import './media.css';

export const PLAY_FAILED = 'Não foi possível tocar este áudio neste aparelho.';

/** The element playing now: starting another one pauses it (one sound at a time). */
let playing: HTMLAudioElement | undefined;

/** Pauses whatever is playing (card change, end of the session). */
export function stopAllAudio(): void {
  playing?.pause();
  playing = undefined;
}

export interface AudioPlayerProps {
  /** Object URL of the sound; absent while it is not on this device (the button is disabled). */
  url?: string;
  /** Visible text. */
  label: string;
  /** Shown after the label while there is no URL ("baixando…"). */
  status?: string;
  /** Accessible names; default "Tocar áudio: <label>" / "Pausar áudio: <label>". */
  names?: { play: string; pause: string };
}

/** A play/pause button over a hidden <audio>. play() runs inside the tap, as iOS requires. */
export function AudioPlayer({ url, label, status, names }: AudioPlayerProps) {
  const ref = useRef<HTMLAudioElement>(null);
  const [on, setOn] = useState(false);
  const pending = useRef(false); // play() called, not settled yet
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el && playing === el) { el.pause(); playing = undefined; }
    };
  }, [url]);
  const toggle = (): void => {
    const el = ref.current;
    if (!el || !url) return;
    if (on || pending.current) { el.pause(); return; }
    if (playing && playing !== el) playing.pause();
    playing = el;
    const p = el.play();
    if (p && typeof p.then === 'function') {
      pending.current = true;
      p.then(() => { pending.current = false; }, (err: unknown) => {
        pending.current = false;
        // AbortError: another sound started or the card changed while play() was pending; not a failure.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (playing === el) playing = undefined;
        setOn(false);
        useToast.getState().show(PLAY_FAILED);
      });
    }
  };
  const playName = names?.play ?? `Tocar áudio: ${label}`;
  const pauseName = names?.pause ?? `Pausar áudio: ${label}`;
  const waiting = !url && status ? ` · ${status}` : '';
  return (
    <span className="audio-player">
      <Button size="sm" icon={on ? 'pause' : 'play'} disabled={!url} onClick={toggle} aria-label={on ? pauseName : `${playName}${waiting}`}>
        {!url && status ? `${label} · ${status}` : label}
      </Button>
      {url && (
        <audio ref={ref} src={url} preload="metadata" playsInline
          onPlay={() => setOn(true)} onPause={() => setOn(false)} onEnded={() => setOn(false)} />
      )}
    </span>
  );
}

/** A card's audio reference: its file from this device (or downloaded), as an AudioPlayer. */
export function AudioButton({ hash, label }: { hash: string; label: string }) {
  const media = useMediaUrl(hash);
  const status = media.state === 'downloading' ? 'baixando…' : media.state === 'missing' ? 'ainda não chegou a este aparelho' : undefined;
  return <AudioPlayer url={media.state === 'ready' ? media.url : undefined} label={label.trim() || 'áudio'} status={status} />;
}
