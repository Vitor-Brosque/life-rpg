import { useCallback, useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { ProposalStatus } from '@life/shared';
import { proposalItems } from '@life/shared';
import { Button } from '../../ui/Button';
import { plural } from '../../ui/format';
import { useToast } from '../../ui/Toast';
import { SettingsSection } from '../settings/SettingsSection';
import { getAssist, revokeAssistant, setAssist, type AssistResult } from './assistClient';
import { PasteConnectorless } from './PasteConnectorless';
import { useProposals } from './proposalData';
import './assist.css';

export const FUNNEL_COMMAND = 'tailscale funnel --bg --https=8443 http://127.0.0.1:8788';
const STATUS_SHORT: Record<ProposalStatus, string> = {
  pending: 'para revisar', applied: 'aplicada', partial: 'aplicada em parte', rejected: 'recusada', replaced: 'substituída',
};
const NOT_READY: Record<Exclude<AssistResult, { ok: true }>['reason'], string> = {
  'no-sync': 'Conecte a sincronização acima primeiro: o assistente fala com o seu servidor, não com este aparelho.',
  offline: 'Sem conexão com o servidor agora. Tente de novo quando ele estiver no ar.',
  'old-server': 'O servidor ainda roda uma versão sem assistentes. Reinicie o LIFE RPG no computador que serve o app.',
  invalid: 'O servidor recusou o pedido.',
};
const when = (ts: number): string => new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    useToast.getState().show('Copiado.');
  } catch {
    useToast.getState().show('Não deu para copiar. Selecione o texto e copie.');
  }
}

/** Ajustes → Assistentes (ChatGPT e Claude): spec 2026-11-25 §3 and §7.1. */
export function AssistSection() {
  const [state, setState] = useState<AssistResult>();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const proposals = useProposals();

  const load = useCallback(async () => {
    const r = await getAssist();
    setState(r);
    if (r.ok) setUrl((u) => u || r.status.publicUrl);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const change = async (enabled: boolean) => {
    setBusy(true); setError(undefined);
    const r = await setAssist(enabled, enabled ? url : undefined);
    setBusy(false);
    if (r.ok) { setState(r); useToast.getState().show(enabled ? 'Assistentes ligados.' : 'Assistentes desligados. Os acessos foram revogados.'); }
    else setError(r.message ?? NOT_READY[r.reason]);
  };
  const revoke = async (id: string, name: string) => {
    const r = await revokeAssistant(id);
    if (r.ok) { setState(r); useToast.getState().show(`${name} foi desconectado.`); }
    else setError(NOT_READY[r.reason]);
  };

  const status = state?.ok ? state.status : undefined;
  const pending = (proposals ?? []).filter((p) => p.status === 'pending');
  const decided = (proposals ?? []).filter((p) => p.status !== 'pending').slice(0, 10);

  return (
    <SettingsSection title="Assistentes (ChatGPT e Claude)" icon="star">
      <p>Conecte o ChatGPT ou o Claude ao LIFE RPG: numa conversa, o assistente lê como o app está montado e manda propostas (rotina, áreas, jornadas, missões, objetivos, treino, disciplinas, o caderno e as apostilas de cada disciplina). Você revisa cada proposta aqui e aplica só o que quiser.</p>
      <p className="muted">O assistente lê o perfil, as áreas, a rotina, os compromissos fixos, as jornadas, os objetivos, as missões abertas, o treino, as disciplinas, um resumo em números das últimas 4 semanas e o estudo das disciplinas: caderno, apostilas, o texto dos PDFs das disciplinas, assuntos, provas e trabalhos, os cards dos baralhos ligados a elas e o perfil de estudo. Nunca lê diário, sono, nutrição, check-ins, registros de energia, estratégias, baralhos fora das disciplinas nem os PDFs de "Sem disciplina". A conversa fica guardada pela empresa do assistente, pelas regras dela.</p>
      {state && !state.ok && <p className="assist__notice">{NOT_READY[state.reason]}</p>}
      {status && (
        <div className="stack">
          <ol className="assist__steps">
            <li>
              <p>No computador que serve o app, rode este comando. Ele publica só a porta do assistente; o app continua privado.</p>
              <div className="assist__copy">
                <code>{FUNNEL_COMMAND}</code>
                <Button size="sm" onClick={() => { void copy(FUNNEL_COMMAND); }}>Copiar comando</Button>
              </div>
            </li>
            <li>
              <label className="field">
                <span className="field__label">Endereço público (o https:// que o Funnel mostrou)</span>
                <input type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://…:8443" value={url}
                  onChange={(e) => { setUrl(e.target.value); setError(undefined); }} />
              </label>
              <div className="body-block__actions">
                {status.enabled ? (
                  <>
                    {url.replace(/\/+$/, '') !== status.publicUrl && <Button size="sm" disabled={busy} onClick={() => { void change(true); }}>Salvar endereço</Button>}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void change(false); }}>Desligar assistentes</Button>
                  </>
                ) : (
                  <Button size="sm" variant="primary" disabled={busy || url.trim() === ''} onClick={() => { void change(true); }}>Ligar assistentes</Button>
                )}
              </div>
            </li>
            {status.enabled && (
              <li>
                <p>No ChatGPT ou no Claude, adicione um conector personalizado (MCP) com este endereço. O nome do menu muda conforme a versão do app deles. Na hora de conectar, abre uma página do LIFE RPG que pede o seu código de acesso.</p>
                <div className="assist__copy">
                  <code>{`${status.publicUrl}/mcp`}</code>
                  <Button size="sm" onClick={() => { void copy(`${status.publicUrl}/mcp`); }}>Copiar endereço</Button>
                </div>
                <p className="muted">O computador precisa estar ligado e com o LIFE RPG aberto enquanto você conversa com o assistente.</p>
              </li>
            )}
          </ol>
          {status.locked && <p className="assist__notice">O login de assistentes está bloqueado por 1 hora depois de muitas tentativas com o código errado.</p>}
          {error && <p role="alert" className="training__error">{error}</p>}
          <h3 className="corpo__subtitle">Assistentes conectados</h3>
          {status.clients.length === 0 ? <p className="muted">Nenhum ainda.</p> : (
            <ul className="assist__list">
              {status.clients.map((c) => (
                <li key={c.id}>
                  <span>{`${c.name} · conectado em ${when(c.connectedAt)}${c.lastUsedAt ? ` · último uso ${when(c.lastUsedAt)}` : ''}`}</span>
                  <Button size="sm" variant="ghost" aria-label={`Revogar ${c.name}`} onClick={() => { void revoke(c.id, c.name); }}>Revogar</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && !status && <p role="alert" className="training__error">{error}</p>}
      <PasteConnectorless />
      <h3 className="corpo__subtitle">Propostas</h3>
      {pending.length === 0 && decided.length === 0 ? <p className="muted">Nenhuma proposta ainda.</p> : (
        <ul className="assist__list">
          {[...pending, ...decided].map((p) => (
            <li key={p.id}>
              <Link href={`/propostas/${p.id}`} className="body-card__link">{p.payload.title}</Link>
              <span className="muted">{` · ${p.source} · ${plural(proposalItems(p.payload).length, 'item', 'itens')} · ${STATUS_SHORT[p.status]}`}</span>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
