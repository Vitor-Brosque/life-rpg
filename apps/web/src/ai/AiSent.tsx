import './ai.css';

/** The "IA" label every AI region and answer carries (text, not just colour). */
export function AiTag() {
  return <span className="ai-tag">IA</span>;
}

/** "O que é enviado": the exact text that leaves the device, built by the same function the server uses. */
export function AiSent({ text, note }: { text: string; note?: string }) {
  return (
    <details className="ai-sent">
      <summary>O que é enviado</summary>
      {note && <p className="ai-sent__note">{note}</p>}
      <pre className="ai-sent__text" tabIndex={0} aria-label="Texto enviado">{text}</pre>
      <p className="ai-sent__note">Vai do seu servidor para a API da Anthropic, só quando você toca no botão.</p>
    </details>
  );
}
