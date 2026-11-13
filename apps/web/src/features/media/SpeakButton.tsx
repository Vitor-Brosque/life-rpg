import { useEffect, useMemo, useRef, useState } from 'react';
import { speakableText } from '@life/shared';
import { Button } from '../../ui/Button';
import { stopAllAudio } from './AudioPlayer';
import { speak, speechSupported, stopSpeaking } from './speech';

/** "Ouvir" for a card side: only with a language, the API and something to read (spec §6.6). */
export function SpeakButton({ text, lang, label }: { text: string; lang?: string; label: string }) {
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const alive = useRef(true);
  const spoken = useMemo(() => speakableText(text), [text]);
  useEffect(() => { // another text: the reading of the old one is over
    speakingRef.current = false;
    setSpeaking(false);
  }, [text]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (speakingRef.current) stopSpeaking();
    };
  }, []);
  if (!lang || !speechSupported() || !spoken) return null;
  const set = (on: boolean): void => {
    speakingRef.current = on;
    if (alive.current) setSpeaking(on);
  };
  const toggle = (): void => {
    if (speaking) { stopSpeaking(); set(false); return; }
    set(true);
    stopAllAudio();
    speak(spoken, lang, () => set(false));
  };
  return (
    <Button size="sm" variant="ghost" icon="speaker" className="speak-button" onClick={toggle}
      aria-label={speaking ? 'Parar a leitura' : label}>{speaking ? 'Parar leitura' : 'Ouvir'}</Button>
  );
}
