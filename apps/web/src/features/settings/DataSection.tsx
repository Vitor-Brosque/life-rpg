import { useLiveQuery } from 'dexie-react-hooks';
import { EXPORT_MEDIA_MAX_BYTES } from '@life/shared';
import { useId, useState, type ChangeEvent } from 'react';
import { PDF_EXPORT_NOTE, canShareFiles, deliverExport, prepareExport, type PreparedExport } from '../../db/exportData';
import { db } from '../../db/db';
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
  // PDFs of Materiais exist (on this device or only on the PC): the export leaves their files out.
  const hasPdfs = useLiveQuery(async () => (await db.studyFiles.toArray()).some((f) => !f.deleted), [], false);

  const [preparing, setPreparing] = useState(false);
  const [ready, setReady] = useState<PreparedExport | undefined>(undefined);

  // Where the device shares files (iPhone), share() needs a fresh tap: the first tap builds the
  // file, the second one ("Compartilhar arquivo") hands it over. Elsewhere one tap does both.
  const exportJson = async () => {
    setPreparing(true);
    try {
      const prepared = await prepareExport();
      if (canShareFiles() && navigator.canShare?.({ files: [prepared.file] })) setReady(prepared);
      else await deliverExport(prepared.file);
    } catch (e) {
      console.error('export failed', e);
      toast('Não foi possível exportar. Tente de novo.');
    } finally {
      setPreparing(false);
    }
  };

  const handOver = (): void => {
    if (!ready) return;
    const file = ready.file;
    setReady(undefined);
    deliverExport(file).catch((e: unknown) => {
      console.error('export failed', e);
      toast('Não foi possível exportar. Tente de novo.');
    });
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
        {ready ? (
          <Button onClick={handOver}>Compartilhar arquivo</Button>
        ) : (
          <Button disabled={preparing} onClick={() => { void exportJson(); }}>
            {preparing ? 'Preparando…' : canShareFiles() ? 'Preparar exportação' : 'Exportar JSON'}
          </Button>
        )}
        <input id={inputId} type="file" accept="application/json,.json" className="visually-hidden settings-file"
          disabled={busy} onChange={(e) => { void onFile(e); }} />
        <label htmlFor={inputId} className={`btn btn--secondary btn--md${busy ? ' is-busy' : ''}`}>
          {busy ? 'Importando…' : 'Importar JSON'}
        </label>
      </div>
      <p className="settings-hint" role="status" hidden={!preparing && !ready}>
        {preparing ? 'Preparando a exportação…'
          : ready ? `Exportação pronta. Toque em "Compartilhar arquivo" para salvar em Arquivos ou enviar.${ready.mediaNote ? ` ${ready.mediaNote}` : ''}`
            : ''}
      </p>
      {usage && usage.count > usage.pdfCount && (
        <p className="settings-hint">
          {usage.bytes - usage.pdfBytes <= EXPORT_MEDIA_MAX_BYTES
            ? `Imagens e áudios (${formatBytes(usage.bytes - usage.pdfBytes)}) entram na exportação.`
            : 'Imagens e áudios passam de 25 MB: entram na exportação até esse limite, primeiro os que ainda esperam o envio ao servidor. Os demais continuam guardados neste aparelho e, com a sincronização, no servidor.'}
        </p>
      )}
      {(hasPdfs || (usage && usage.pdfCount > 0)) && <p className="settings-hint">{PDF_EXPORT_NOTE}</p>}
    </SettingsSection>
  );
}
