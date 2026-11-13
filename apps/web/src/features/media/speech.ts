import { pickVoice } from '@life/shared';

// "Ouvir" (Marco 3c, spec §6.6): the device's text to speech, one reading at a time. No API → nothing.

export const SPEECH_LANGS: ReadonlyArray<{ tag: string; label: string }> = [
  { tag: 'pt-BR', label: 'Português (Brasil)' },
  { tag: 'en-US', label: 'Inglês (EUA)' },
  { tag: 'en-GB', label: 'Inglês (Reino Unido)' },
  { tag: 'es-ES', label: 'Espanhol' },
  { tag: 'fr-FR', label: 'Francês' },
  { tag: 'de-DE', label: 'Alemão' },
  { tag: 'it-IT', label: 'Italiano' },
  { tag: 'ja-JP', label: 'Japonês' },
];

export function speechSupported(): boolean {
  return typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance === 'function';
}

/** Reads `text` in `lang`, cancelling any reading in progress; `onEnd` runs when it ends or is cancelled. */
export function speak(text: string, lang: string, onEnd: () => void): void {
  if (!speechSupported()) { onEnd(); return; }
  const synth = globalThis.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const voice = pickVoice(synth.getVoices(), lang);
  if (voice) u.voice = voice;
  u.onend = () => onEnd();
  u.onerror = () => onEnd();
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (speechSupported()) globalThis.speechSynthesis.cancel();
}
