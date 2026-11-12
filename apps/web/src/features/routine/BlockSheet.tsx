import { useId, useState } from 'react';
import type { Block } from '@life/shared';
import { useAreas, useBlocks, useJourneys, useSettings } from '../../db/hooks';
import { archiveBlock, reorderBlocks, saveBlock } from '../../domain/actions';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { ChecklistFields } from '../mission/ChecklistEditor';
import { FieldError, KindPicker, LinkSelect, MinutesField, WeekdayToggles } from './BlockFields';
import { draftOf, fieldsOf, validateDraft, type BlockDraft } from './blockForm';
import { placeByTime } from './routineShared';
import '../mission/mission.css';
import '../plan/plan.css';
import './routine.css';

export interface BlockSheetProps {
  open: boolean;
  /** The block to edit; without it the sheet creates one. */
  block?: Block;
  /** Weekday being viewed: a new block starts on it (a workday starts on Mon–Fri). */
  weekday: number;
  onClose(): void;
}

export function BlockSheet({ open, block, weekday, onClose }: BlockSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={block ? 'Editar bloco' : 'Novo bloco'}>
      <BlockForm key={block?.id ?? `new-${weekday}`} block={block} weekday={weekday} onClose={onClose} />
    </Sheet>
  );
}

function BlockForm({ block, weekday, onClose }: Omit<BlockSheetProps, 'open'>) {
  const ids = { name: useId(), start: useId(), archive: useId() };
  const areas = useAreas();
  const journeys = useJourneys();
  const blocks = useBlocks();
  const settings = useSettings();
  const [d, setD] = useState<BlockDraft>(() => draftOf(block, weekday));
  const [nameTouched, setNameTouched] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = validateDraft(d);
  const valid = Object.keys(errors).length === 0;
  const set = <K extends keyof BlockDraft>(key: K, value: BlockDraft[K]) => setD((prev) => ({ ...prev, [key]: value }));
  const toggleDay = (day: number) => setD((prev) => ({
    ...prev, weekdays: prev.weekdays.includes(day) ? prev.weekdays.filter((x) => x !== day) : [...prev.weekdays, day],
  }));

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const fields = fieldsOf(d);
      const saved = await saveBlock(block ? { ...fields, id: block.id } : fields);
      // planDay follows the routine order: a new or re-timed block goes where its time fits.
      if (!block || block.targetStart !== saved.targetStart) {
        const others = blocks.filter((b) => b.id !== saved.id);
        await reorderBlocks(placeByTime([...others, saved], saved.id, settings?.dayStartHour ?? 4));
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  // The tapped button unmounts: keep the focus inside the sheet (Esc and Tab keep working).
  const keepBlock = () => {
    setConfirmArchive(false);
    requestAnimationFrame(() => document.getElementById(ids.archive)?.focus());
  };

  const archive = async () => {
    if (!block) return;
    await archiveBlock(block.id);
    onClose();
  };

  const nameError = nameTouched ? errors.name : undefined;
  return (
    <form className="block-form" noValidate onSubmit={(e) => { e.preventDefault(); safeRun(save); }}>
      <div className="field">
        <label className="field__label" htmlFor={ids.name}>Nome</label>
        <input id={ids.name} type="text" value={d.name} placeholder="Ex.: Leitura" enterKeyHint="done"
          aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? `${ids.name}-error` : undefined}
          onChange={(e) => { set('name', e.target.value); setNameTouched(true); }} onBlur={() => setNameTouched(true)} />
        <FieldError id={`${ids.name}-error`} text={nameError} />
      </div>

      <KindPicker value={d.kind} onChange={(k) => set('kind', k)} />

      <div className="field block-form__start">
        <label className="field__label" htmlFor={ids.start}>Início</label>
        <input id={ids.start} type="time" value={d.targetStart} onChange={(e) => set('targetStart', e.target.value)} />
        <FieldError id={`${ids.start}-error`} text={errors.targetStart} />
      </div>

      <MinutesField label="Duração (min)" value={d.duration} step={15} error={errors.duration}
        onChange={(v) => set('duration', v)} />
      <MinutesField label="Versão mínima (min)" value={d.minimum} step={5} error={errors.minimum}
        onChange={(v) => set('minimum', v)} />
      <p className="block-form__hint">Começar tarde encolhe o bloco até a versão mínima, sem empurrar o resto do dia.</p>

      <WeekdayToggles legend="Dias" value={d.weekdays} onToggle={toggleDay} error={errors.weekdays} />

      <LinkSelect value={d.link} areas={areas} journeys={journeys} onChange={(v) => set('link', v)} />

      <div>
        <button type="button" role="switch" aria-checked={d.protected} className="switch-row"
          onClick={() => set('protected', !d.protected)}>
          <span className="switch-row__track" aria-hidden="true"><span className="switch-row__thumb" /></span>
          <span>Protegido</span>
        </button>
        <p className="block-form__hint">Continua no dia de recuperação, na versão mínima.</p>
      </div>

      {d.kind === 'routine' && (
        <ChecklistFields items={d.checklist} onChange={(change) => setD((prev) => ({ ...prev, checklist: change(prev.checklist) }))} />
      )}

      <div className="commit-form__actions">
        <Button type="submit" variant="primary" icon="check" disabled={!valid || busy}>Salvar</Button>
        <Button onClick={onClose}>Cancelar</Button>
      </div>

      {block && (
        <div className="commit-form__danger">
          {confirmArchive ? (
            <div className="block-form__confirm">
              <p>Arquivar este bloco? Ele sai da rotina de todos os dias; o que já foi vivido continua no histórico.</p>
              <div className="cluster">
                <Button variant="primary" onClick={() => safeRun(archive)}>Sim, arquivar</Button>
                <Button autoFocus onClick={keepBlock}>Manter bloco</Button>
              </div>
            </div>
          ) : (
            <Button id={ids.archive} variant="ghost" onClick={() => setConfirmArchive(true)}>Arquivar bloco</Button>
          )}
        </div>
      )}
    </form>
  );
}
