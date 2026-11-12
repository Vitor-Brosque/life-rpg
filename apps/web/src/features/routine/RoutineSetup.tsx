import { useId, useMemo, useState } from 'react';
import type { HHmm } from '@life/shared';
import { Icon, type IconName } from '../../art/icons';
import { useAreas, useCommitments, useJourneys, useSettings, useToday } from '../../db/hooks';
import { ROUTINE_BASE_START, applyRoutine, defaultRoutine, type RoutinePreview } from '../../domain/actions';
import { Button } from '../../ui/Button';
import { formatDuration } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { KIND_ICON, logicalMinutes } from './routineShared';

export interface RoutineSetupProps {
  /** "Começar sem rotina". */
  onSkip(): void;
  onCreated(): void;
}

interface Row { key: string; time: string; name: string; detail: string; icon: IconName; warn?: string; commitment?: boolean }

/** Preview rows: the blocks and, when it will be created, the class, in time order. */
function rowsOf(p: RoutinePreview, dayStartHour: number): Row[] {
  const rows: Row[] = p.blocks.map((b, i) => ({
    key: `b${i}`, time: b.targetStart, name: b.name, detail: formatDuration(b.durationMin), icon: KIND_ICON[b.kind],
    warn: p.warnings.find((w) => w.startsWith(`${b.name} `)),
  }));
  if (p.createCommitment) {
    const c = p.createCommitment;
    rows.push({ key: 'aula', time: c.start, name: c.title, detail: `até ${c.end}`, icon: 'calendar', commitment: true });
  }
  return rows.sort((a, b) => logicalMinutes(a.time, dayStartHour) - logicalMinutes(b.time, dayStartHour));
}

/** What else the routine creates (journey, area, class), as short list items. */
function creations(p: RoutinePreview): string[] {
  return [
    p.createJourney && `jornada ${p.createJourney.title}`,
    p.createArea && `área ${p.createArea.name} (${p.createArea.attribute})`,
    p.createCommitment && `compromisso ${p.createCommitment.title}, ${p.createCommitment.start}–${p.createCommitment.end}, seg a sex`,
  ].filter((x): x is string => Boolean(x));
}

/** First visit: one question, then the suggested Mon–Fri routine as a preview, then "Criar rotina". */
export function RoutineSetup({ onSkip, onCreated }: RoutineSetupProps) {
  const timeId = useId();
  const settings = useSettings();
  const today = useToday();
  const journeys = useJourneys();
  const areas = useAreas();
  const commitments = useCommitments();
  const [start, setStart] = useState<HHmm>(ROUTINE_BASE_START);
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => (settings && today && /^\d{2}:\d{2}$/.test(start)
    ? defaultRoutine(start, {
      journeys, areas, commitments, today, dayEndHour: settings.dayEndHour, dayStartHour: settings.dayStartHour,
    })
    : undefined), [start, settings, today, journeys, areas, commitments]);

  const create = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      await applyRoutine(preview);
      useToast.getState().show('Rotina criada. Ajuste o que quiser.');
      onCreated();
    } finally {
      setBusy(false);
    }
  };

  const extra = preview ? creations(preview) : [];
  return (
    <section className="routine-setup stack" aria-labelledby={`${timeId}-title`}>
      <div>
        <h2 id={`${timeId}-title`} className="routine-setup__title">Sua rotina</h2>
        <p className="muted routine-setup__intro">Uma pergunta só. O resto é um palpite inicial, que você ajusta depois.</p>
      </div>
      <div className="field routine-setup__question">
        <label className="field__label" htmlFor={timeId}>A que horas você costuma começar o dia?</label>
        <input id={timeId} type="time" value={start} onChange={(e) => setStart(e.target.value)} />
      </div>

      {preview && settings && (
        <>
          <h3 className="routine-setup__subtitle">Segunda a sexta</h3>
          <ul className="routine-preview" aria-label="Prévia da rotina">
            {rowsOf(preview, settings.dayStartHour).map((r) => (
              <li key={r.key} className={`routine-preview__row${r.commitment ? ' is-commitment' : ''}${r.warn ? ' is-warn' : ''}`}>
                <span className="routine-preview__time">{r.time}</span>
                <Icon name={r.icon} size={24} className="routine-preview__icon" />
                <span className="routine-preview__name">{r.name}</span>
                <span className="routine-preview__detail">{r.detail}</span>
              </li>
            ))}
          </ul>
          {preview.warnings.length > 0 && (
            <div className="routine-notes routine-notes--warn">
              <ul>
                {preview.warnings.map((w) => (
                  <li key={w}><Icon name="shrink" size={24} /><span>{w}</span></li>
                ))}
              </ul>
              <p>Nada é corrigido sozinho: ajuste no editor. No dia, o plano encolhe ou pula o que não couber.</p>
            </div>
          )}
          {(preview.dayEndHour === 0 || extra.length > 0) && (
            <div className="routine-notes">
              {preview.dayEndHour === 0 && <p>O dia passa a terminar à meia-noite para caber a Desaceleração.</p>}
              {extra.length > 0 && (
                <>
                  <p>Também será criado:</p>
                  <ul className="routine-notes__list">{extra.map((x) => <li key={x}>{x}</li>)}</ul>
                </>
              )}
            </div>
          )}
        </>
      )}

      <div className="routine-setup__actions">
        <Button variant="primary" size="lg" icon="check" disabled={!preview || busy} onClick={() => safeRun(create)}>
          Criar rotina
        </Button>
        <Button variant="ghost" onClick={onSkip}>Começar sem rotina</Button>
      </div>
    </section>
  );
}
