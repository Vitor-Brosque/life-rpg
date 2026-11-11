import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatHHmm } from '@life/shared';
import { db } from '../../db/db';
import { setSyncToken, syncNow, type TokenResult } from '../../sync/client';
import { useSyncStatus, type SyncStatus } from '../../sync/status';
import { Button } from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { SettingsSection } from './SettingsSection';

/** Status line of Ajustes → Sincronização. */
export function syncStatusLabel(s: SyncStatus): string {
  switch (s.state) {
    case 'disabled': return 'Desativada';
    case 'syncing': return 'Sincronizando…';
    case 'offline': return 'Sem conexão — tudo fica salvo no aparelho';
    case 'error': return `Erro: ${s.error ?? 'falha na sincronização'}`;
    case 'idle': {
      if (s.lastSync === undefined) return 'Sincronizado';
      const at = new Date(s.lastSync);
      return `Sincronizado às ${formatHHmm(at.getHours() * 60 + at.getMinutes())}`;
    }
  }
}

const TOKEN_TOAST: Record<TokenResult, string> = {
  ok: 'Conectado',
  invalid: 'Código inválido',
  offline: 'Sem conexão com o servidor',
};

export function SyncSection() {
  const status = useSyncStatus();
  const connected = useLiveQuery(async () => !!(await db.meta.get('syncToken')), [], false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    const token = code.trim();
    if (!token || busy) return;
    setBusy(true);
    try {
      const result = await setSyncToken(token);
      useToast.getState().show(TOKEN_TOAST[result]);
      if (result === 'ok') setCode('');
    } finally {
      setBusy(false);
    }
  };

  const pending = status.pending;
  return (
    <SettingsSection title="Sincronização" icon="sync">
      <dl className="settings-status">
        <div>
          <dt>Situação</dt>
          <dd className={`settings-status__state settings-status__state--${status.state}`}>{syncStatusLabel(status)}</dd>
        </div>
        <div>
          <dt>Pendentes</dt>
          <dd>{pending === 0 ? 'Nenhuma alteração pendente' : `${pending} ${pending === 1 ? 'alteração pendente' : 'alterações pendentes'}`}</dd>
        </div>
      </dl>
      <form className="settings-inline-form" onSubmit={(e) => { e.preventDefault(); void connect(); }}>
        <label className="field">
          <span className="field__label">Código de acesso</span>
          <input type="text" value={code} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            enterKeyHint="go" placeholder={connected ? 'Já conectado' : undefined}
            onChange={(e) => setCode(e.target.value)} />
        </label>
        <Button type="submit" variant="primary" disabled={!code.trim() || busy}>{busy ? 'Conectando…' : 'Conectar'}</Button>
      </form>
      <p className="settings-hint">O código fica no servidor (arquivo <code>data/token</code>). Basta digitar uma vez em cada aparelho.</p>
      <div>
        <Button icon="sync" disabled={!connected || status.state === 'syncing'} onClick={() => { void syncNow(); }}>
          Sincronizar agora
        </Button>
      </div>
    </SettingsSection>
  );
}
