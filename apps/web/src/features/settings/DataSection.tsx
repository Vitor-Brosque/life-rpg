import { useLiveQuery } from 'dexie-react-hooks';
import { EXPORT_MEDIA_MAX_BYTES } from '@life/shared';
import { useId, useState, type ChangeEvent } from 'react';
import { downloadExport } from '../../db/exportData';
import { mediaUsage } from '../../db/media';
import { Button } from '../../ui/Button';
import { formatBytes } from '../../ui/format';
import { useToast } from '../../ui/Toast';
import { ImportError, importFile, importSummary } from './importData';
import { SettingsSection } from './SettingsSection';

/** Dados: full JSON export (every synced table) and import that keeps the newer copy of each record. */
export function DataSection() {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const toast = useToast((s) => s.show);
  const usage = useLiveQuery(() => mediaUsage(), []);

  const exportJson = async () => {
    try {
      await downloadExport();
    } catch (e) {
      console.error('export failed', e);
      toast('Não foi possível exportar. Tente de novo.');
    }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      toast(importSummary(await importFile(file)));
    } catch (err) {
      if (!(err instanceof ImportError)) console.error('import failed', err);
      toast(err instanceof ImportError ? err.message : 'Não foi possível importar. Tente de novo.');
    } finally {
      input.value = ''; // choosing the same file again fires change again
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="Dados" icon="chest">
      <p className="settings-hint">
        Tudo fica salvo neste aparelho. Exporte uma cópia de segurança quando quiser; ao importar, cada
        registro só substitui o daqui se for mais novo.
      </p>
      <div className="cluster">
        <Button onClick={() => { void exportJson(); }}>Exportar JSON</Button>
        <input id={inputId} type="file" accept="application/json,.json" className="visually-hidden settings-file"
          disabled={busy} onChange={(e) => { void onFile(e); }} />
        <label htmlFor={inputId} className={`btn btn--secondary btn--md${busy ? ' is-busy' : ''}`}>
          {busy ? 'Importando…' : 'Importar JSON'}
        </label>
      </div>
      {usage && usage.count > 0 && (
        <p className="settings-hint">
          {usage.bytes <= EXPORT_MEDIA_MAX_BYTES
            ? `Imagens e áudios (${formatBytes(usage.bytes)}) entram na exportação.`
            : 'Imagens e áudios passam de 25 MB e ficam fora da exportação (continuam guardados neste aparelho e, com a sincronização, no servidor).'}
        </p>
      )}
    </SettingsSection>
  );
}
