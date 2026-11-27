import { useState } from 'react';
import type { SpeechRecordingItem, SpeechSession } from '@life/shared';
import {
  SPEECH_RATING_KEYS, SPEECH_RATING_LABEL, SPEECH_WPM_NOTE, compareDefaults, recordingLabel, speechRecordings,
} from '@life/shared';
import { Sheet } from '../../ui/Sheet';
import { RecordingPlayer } from './RecordingPlayer';
import './speech.css';

export interface CompareSheetProps { open: boolean; onClose(): void; sessions: SpeechSession[] }

const perception = (item: SpeechRecordingItem): string => {
  const given = SPEECH_RATING_KEYS.filter((k) => item.ratings[k] !== undefined);
  return given.length > 0
    ? `Percepção (1 a 5): ${given.map((k) => `${SPEECH_RATING_LABEL[k]} ${item.ratings[k]}`).join(' · ')}`
    : 'Sem autoavaliação nesta sessão.';
};

function Side({ item, name, listen }: { item: SpeechRecordingItem; name: string; listen: string }) {
  return (
    <section className="speech-compare__side stack" aria-label={name}>
      <h3 className="speech-group__title">{recordingLabel(item)}</h3>
      <RecordingPlayer key={item.key} hash={item.hash} label={listen} />
      {item.wpm !== undefined && <p>{`Velocidade na leitura de referência: ${item.wpm} palavras por minuto`}</p>}
      <p className="muted">{perception(item)}</p>
    </section>
  );
}

/** Two recordings, one after the other. Nothing is written, not even the choice in the selects. */
export function CompareSheet({ open, onClose, sessions }: CompareSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Comparar gravações">
      <CompareBody sessions={sessions} />
    </Sheet>
  );
}

function CompareBody({ sessions }: { sessions: SpeechSession[] }) {
  const items = speechRecordings(sessions);
  const defaults = compareDefaults(items);
  const [picked, setPicked] = useState<{ a?: string; b?: string }>({});
  const find = (key: string | undefined, fallback: string | undefined): SpeechRecordingItem | undefined =>
    items.find((i) => i.key === key) ?? items.find((i) => i.key === fallback);
  const a = find(picked.a, defaults.a);
  const b = find(picked.b, defaults.b);
  if (!a || !b) return <p className="muted">Com duas gravações, dá para ouvir uma depois da outra aqui.</p>;
  const options = items.map((i) => <option key={i.key} value={i.key}>{recordingLabel(i)}</option>);
  return (
    <div className="stack speech-sheet">
      <label className="field">
        <span className="field__label">Primeira gravação</span>
        <select value={a.key} onChange={(e) => setPicked((p) => ({ ...p, a: e.target.value }))}>{options}</select>
      </label>
      <label className="field">
        <span className="field__label">Segunda gravação</span>
        <select value={b.key} onChange={(e) => setPicked((p) => ({ ...p, b: e.target.value }))}>{options}</select>
      </label>
      <div className="speech-compare">
        <Side item={a} name="Primeira gravação" listen="Ouvir a primeira" />
        <Side item={b} name="Segunda gravação" listen="Ouvir a segunda" />
      </div>
      <p className="muted">Ouça uma e depois a outra. Sem nota: o que mudou é você quem percebe.</p>
      {(a.wpm !== undefined || b.wpm !== undefined) && <p className="muted">{SPEECH_WPM_NOTE}</p>}
    </div>
  );
}
