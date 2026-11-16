import { useMemo, useState } from 'react';
import type { DayKey, DiaryExportOptions } from '@life/shared';
import { DIARY_EXPORT_DEFAULTS, addDays, diaryFileName, diaryMarkdown, diaryWeekLabel, weekOfDay } from '@life/shared';
import { canShareFiles, deliverExport } from '../../db/exportData';
import { useDiaryExport } from '../../db/diaryData';
import { useToday } from '../../db/hooks';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import '../plan/plan.css';
import './diary.css';

const SWITCHES: ReadonlyArray<{ key: keyof DiaryExportOptions; label: string }> = [
  { key: 'includePrivate', label: 'Incluir entradas privadas' },
  { key: 'includeApp', label: 'Registrado pelo app' },
  { key: 'includeReviews', label: 'Revisões da semana e do mês' },
];

/** "Exportar semana": the week as Markdown with privacy choices, a preview of the exact text, and the file. */
export function DiaryExportSheet({ open, monday, onClose }: { open: boolean; monday: DayKey; onClose(): void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Exportar semana">
      {open && <DiaryExportContent initial={monday} />}
    </Sheet>
  );
}

function DiaryExportContent({ initial }: { initial: DayKey }) {
  const today = useToday();
  const [monday, setMonday] = useState(initial);
  const [options, setOptions] = useState<DiaryExportOptions>(DIARY_EXPORT_DEFAULTS);
  const data = useDiaryExport(monday);
  const text = useMemo(() => (data && today ? diaryMarkdown({ monday, exportedOn: today, ...data, options }) : undefined), [data, today, monday, options]);
  const current = today ? weekOfDay(today) : monday;
  const share = canShareFiles();

  // Straight from the tap: share() needs the tap's user activation. MIME text/plain: the share sheets accept it.
  const deliver = () => {
    if (text === undefined) return;
    const file = new File([text], diaryFileName(monday), { type: 'text/plain' });
    deliverExport(file, 'LIFE RPG — diário').catch((e: unknown) => {
      console.error('diary export failed', e);
      useToast.getState().show('Não foi possível exportar. Tente de novo.');
    });
  };

  return (
    <div className="diary-export stack">
      <div className="stack" role="group" aria-labelledby="diary-export-period">
        <span id="diary-export-period" className="field__label">Período</span>
        <div className="diary__week">
          <p className="diary__week-label">{diaryWeekLabel(monday)}</p>
          <div className="cluster">
            <Button size="sm" onClick={() => setMonday(addDays(monday, -7))}>Semana anterior</Button>
            <Button size="sm" disabled={monday >= current} onClick={() => setMonday(addDays(monday, 7))}>Próxima semana</Button>
          </div>
        </div>
      </div>
      {SWITCHES.map((s) => (
        <button key={s.key} type="button" role="switch" aria-checked={options[s.key]} className="switch-row"
          onClick={() => setOptions((o) => ({ ...o, [s.key]: !o[s.key] }))}>
          <span className="switch-row__track" aria-hidden="true"><span className="switch-row__thumb" /></span>
          <span>{s.label}</span>
        </button>
      ))}
      <h3 id="diary-export-preview" className="field__label">Prévia</h3>
      <pre className="diary-export__preview" aria-labelledby="diary-export-preview" tabIndex={0}>{text ?? ''}</pre>
      <div className="cluster">
        <Button variant="primary" disabled={text === undefined} onClick={deliver}>{share ? 'Compartilhar' : 'Baixar'}</Button>
      </div>
    </div>
  );
}
