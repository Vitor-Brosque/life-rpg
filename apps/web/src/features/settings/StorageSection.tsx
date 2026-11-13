import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { mediaUsage } from '../../db/media';
import { Button } from '../../ui/Button';
import { formatBytes, plural } from '../../ui/format';
import { useToast } from '../../ui/Toast';
import { SettingsSection } from './SettingsSection';

export const STORAGE_TEXT = {
  none: 'Nenhuma',
  noSync: 'Sem sincronização: as mídias ficam só neste aparelho.',
  persisted: 'Sim — o navegador não apaga estes dados sozinho.',
  notPersisted: 'Não garantido — o navegador pode liberar espaço se o aparelho ficar cheio.',
  ask: 'Pedir para manter os dados',
  granted: 'Pronto: o navegador vai manter os dados.',
  refused: 'O navegador não aceitou agora. Instalar o app na tela de início costuma ajudar.',
} as const;

/** Ajustes → Armazenamento (spec §6.8): media on this device, uploads waiting, space and persistence. */
export function StorageSection() {
  const usage = useLiveQuery(() => mediaUsage(), []);
  const connected = useLiveQuery(async () => !!(await db.meta.get('syncToken')), [], false);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | undefined>(undefined);
  const [persisted, setPersisted] = useState<boolean | undefined>(undefined);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const e = await navigator.storage?.estimate?.();
      if (e && typeof e.usage === 'number' && typeof e.quota === 'number' && e.quota > 0) setEstimate({ usage: e.usage, quota: e.quota });
    } catch { /* not available: the row stays hidden */ }
    try {
      const p = await navigator.storage?.persisted?.();
      if (typeof p === 'boolean') setPersisted(p);
    } catch { /* idem */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const ask = async (): Promise<void> => {
    let granted = false;
    try { granted = (await navigator.storage?.persist?.()) === true; } catch { granted = false; }
    useToast.getState().show(granted ? STORAGE_TEXT.granted : STORAGE_TEXT.refused);
    await refresh();
  };

  return (
    <SettingsSection title="Armazenamento" icon="drive">
      <dl className="settings-status">
        <div>
          <dt>Mídias neste aparelho</dt>
          <dd>{!usage || usage.count === 0 ? STORAGE_TEXT.none : `${plural(usage.count, 'arquivo', 'arquivos')} · ${formatBytes(usage.bytes)}`}</dd>
        </div>
        {usage && usage.pending > 0 && (
          <div><dt>Aguardando envio</dt><dd>{connected ? plural(usage.pending, 'mídia', 'mídias') : STORAGE_TEXT.noSync}</dd></div>
        )}
        {estimate && (
          <div><dt>Espaço usado pelo app</dt><dd>{formatBytes(estimate.usage)} de {formatBytes(estimate.quota)}</dd></div>
        )}
        {persisted !== undefined && (
          <div><dt>Armazenamento persistente</dt><dd>{persisted ? STORAGE_TEXT.persisted : STORAGE_TEXT.notPersisted}</dd></div>
        )}
      </dl>
      {persisted === false && <div><Button onClick={() => { void ask(); }}>{STORAGE_TEXT.ask}</Button></div>}
    </SettingsSection>
  );
}
