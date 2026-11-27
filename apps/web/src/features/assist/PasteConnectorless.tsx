import { useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { addPastedProposal, buildPasteRequest, issueText } from '../../domain/proposalActions';
import { getToday } from '../../domain/common';
import './assist.css';

const ERROR_TEXT = {
  empty: 'Cole a resposta do chat.',
  'too-big': 'A resposta passou do limite. Peça uma proposta menor.',
  'not-json': 'Não encontrei a proposta nesse texto. Peça ao chat para responder só com o bloco JSON.',
} as const;

export interface PasteButtonsProps {
  /** The copy button's label. */
  copyLabel: string;
  /** The request to copy (built when the button is tapped). */
  buildRequest: () => Promise<string>;
  /** The toast after a successful copy. */
  copiedText?: string;
  /** Where the review's back link returns to (a subject page); only `/estudo/materias/<id>` is accepted there. */
  from?: string;
}

/**
 * The copy-and-paste pair: copy a request for any chat, then paste the chat's answer, which is validated like a
 * proposal from a connector and opens its review. Used by Ajustes → Assistentes and by a subject's "Chat da disciplina".
 */
export function PasteButtons({ copyLabel, buildRequest, copiedText = 'Pedido copiado. Cole no chat e converse sobre o que mudar.', from }: PasteButtonsProps) {
  const [, navigate] = useLocation();
  const [requestText, setRequestText] = useState<string>();   // set only when the clipboard is not available
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const copyRequest = async () => {
    const request = await buildRequest();
    try {
      await navigator.clipboard.writeText(request);
      useToast.getState().show(copiedText);
    } catch {
      setRequestText(request);
    }
  };

  const review = async () => {
    if (busy) return;
    setBusy(true); setError(undefined); setIssues([]);
    try {
      const r = await addPastedProposal(text, await getToday());
      if ('id' in r) { setPasteOpen(false); setText(''); navigate(`/propostas/${r.id}${from ? `?from=${encodeURIComponent(from)}` : ''}`); }
      else if ('issues' in r) { setError('A proposta tem problemas. Mostre isto ao chat e peça para corrigir:'); setIssues(r.issues.map(issueText)); }
      else setError(ERROR_TEXT[r.error]);
    } finally { setBusy(false); }
  };

  const closePaste = () => { setPasteOpen(false); setError(undefined); setIssues([]); };

  return (
    <>
      <div className="body-block__actions">
        <Button size="sm" onClick={() => { safeRun(copyRequest()); }}>{copyLabel}</Button>
        <Button size="sm" onClick={() => setPasteOpen(true)}>Colar resposta do chat</Button>
      </div>

      <Sheet open={requestText !== undefined} onClose={() => setRequestText(undefined)} title="Pedido para o chat">
        <div className="stack">
          <p className="muted">Não deu para copiar sozinho. Selecione todo o texto, copie e cole no chat.</p>
          <label className="field">
            <span className="field__label">Pedido para o chat</span>
            <textarea className="assist__text" readOnly rows={10} value={requestText ?? ''} onFocus={(e) => e.currentTarget.select()} />
          </label>
        </div>
      </Sheet>

      <Sheet open={pasteOpen} onClose={closePaste} title="Colar proposta">
        <form className="stack" onSubmit={(e) => { e.preventDefault(); safeRun(review()); }}>
          <label className="field">
            <span className="field__label">Resposta do chat</span>
            <textarea className="assist__text" rows={10} value={text} spellCheck={false} autoComplete="off"
              onChange={(e) => { setText(e.target.value); setError(undefined); setIssues([]); }} />
          </label>
          {error && (
            <div role="alert" className="training__error">
              <p>{error}</p>
              {issues.length > 0 && <ul>{issues.map((i, n) => <li key={n}>{i}</li>)}</ul>}
            </div>
          )}
          <Button type="submit" variant="primary" disabled={busy}>Revisar proposta</Button>
        </form>
      </Sheet>
    </>
  );
}

/** Ajustes → Assistentes → "Sem conector": any chat, by copy and paste. No server, no sync, works offline. */
export function PasteConnectorless() {
  return (
    <div className="stack">
      <h3 className="corpo__subtitle">Sem conector</h3>
      <p>Funciona com qualquer chat: copie o pedido, converse lá e cole a resposta aqui.</p>
      <PasteButtons copyLabel="Copiar pedido para o chat" buildRequest={() => buildPasteRequest()} />
    </div>
  );
}
