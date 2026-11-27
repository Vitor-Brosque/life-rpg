import { useState, type MouseEvent } from 'react';
import { speechClock } from '@life/shared';
import { freeSpeechRecordings, type FreedSpace } from '../../domain/speechActions';
import type { SpaceCandidate, SpeechSpace } from '../../db/speechData';
import { Button } from '../../ui/Button';
import { ddmm, formatBytes, plural } from '../../ui/format';
import { Sheet } from '../../ui/Sheet';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import './speech.css';

export const SPACE_RULE = 'Leituras de referência e gravações com “Guardar” ficam sempre. As outras podem sair deste aparelho '
  + 'depois de 30 dias, se já estiverem no servidor. Nada sai sozinho.';
export const spaceLine = (s: Pick<SpeechSpace, 'onDevice'>): string => (s.onDevice.count > 0
  ? `${plural(s.onDevice.count, 'gravação', 'gravações')} neste aparelho · ${formatBytes(s.onDevice.bytes)}`
  : 'Nenhuma gravação neste aparelho agora; as outras estão no servidor.');

/** The toast after "Tirar": what left, and what stayed because the server did not confirm it. */
export function freedMessage({ count, unconfirmed }: FreedSpace): string {
  if (count === 0) {
    return unconfirmed >= 1
      ? 'Nada saiu: o servidor não confirmou essas gravações agora. Elas continuam neste aparelho.'
      : 'Nada saiu: essas gravações mudaram enquanto a folha estava aberta.';
  }
  const done = count === 1
    ? '1 gravação saiu deste aparelho e continua no servidor.'
    : `${count} gravações saíram deste aparelho e continuam no servidor.`;
  if (unconfirmed === 0) return done;
  return `${done} ${unconfirmed === 1 ? '1 ficou aqui: o servidor ainda não confirmou.' : `${unconfirmed} ficaram aqui: o servidor ainda não confirmou.`}`;
}

export interface SpaceSheetProps { open: boolean; onClose(): void; candidates: SpaceCandidate[]; onFreed(): void }

/** Lists the recordings that may leave this device and frees them, one tap, after the server confirms each. */
export function SpaceSheet({ open, onClose, candidates: live, onFreed }: SpaceSheetProps) {
  const [busy, setBusy] = useState(false);
  // While the server is being asked the list stays as it was: it never shows "Tirar 0 gravações" before the sheet closes.
  const [frozen, setFrozen] = useState<SpaceCandidate[]>();
  const candidates = frozen ?? live;
  const total = candidates.reduce((s, c) => s + c.size, 0);
  const n = candidates.length;
  const free = (e: MouseEvent<HTMLButtonElement>): void => {
    if (busy) return;
    // The button is about to be disabled, which would drop its focus to <body>: the dialog keeps it meanwhile.
    e.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus();
    setBusy(true);
    setFrozen(live);
    safeRun((async () => {
      try {
        const out = await freeSpeechRecordings(candidates.map((c) => c.hash));
        useToast.getState().show(freedMessage(out));
        onFreed();
        onClose();
      } finally {
        setBusy(false);
        setFrozen(undefined);
      }
    })());
  };
  return (
    <Sheet open={open} onClose={onClose} title="Espaço das gravações">
      <div className="stack speech-sheet">
        <p>Antes de tirar, o app confere com o servidor, uma a uma. As que o servidor confirmar saem deste aparelho e continuam lá. Para ouvir de novo, toque em “Buscar no servidor”.</p>
        <ul className="speech-recordings" aria-label="Gravações que podem sair deste aparelho">
          {candidates.map((c) => (
            <li key={c.hash}>{`${ddmm(c.day)} · ${c.title} · ${speechClock(c.durationMs)} · ${formatBytes(c.size)}`}</li>
          ))}
        </ul>
        <p>{`Total: ${formatBytes(total)}`}</p>
        <Button variant="primary" disabled={busy || n === 0} onClick={free}>
          {busy ? 'Conferindo com o servidor…' : `Tirar ${plural(n, 'gravação', 'gravações')} deste aparelho`}
        </Button>
      </div>
    </Sheet>
  );
}
