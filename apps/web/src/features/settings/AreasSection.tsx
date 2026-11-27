import { useId, useState } from 'react';
import type { Area } from '@life/shared';
import { areaIcon, Icon } from '../../art/icons';
import { useAreas } from '../../db/hooks';
import { newRecord, patch, put } from '../../db/repo';
import { Button } from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { AREA_COLORS, createArea } from '../../domain/areaActions';
import { EditableField } from '../mission/EditableField';
import { SettingsSection } from './SettingsSection';

export { AREA_COLORS };

function saveArea(id: string, changes: Partial<Area>): Promise<void> {
  return patch<Area>('areas', id, changes).then(() => undefined, (e: unknown) => {
    console.error('area save failed', e);
    useToast.getState().show('Não foi possível salvar. Tente de novo.');
  });
}

function ColorPicker({ value, onChange }: { value: string; onChange(color: string): void }) {
  const group = useId();
  return (
    <fieldset className="look-picker">
      <legend className="field__label">Cor</legend>
      <div className="look-picker__options">
        {AREA_COLORS.map(({ color, name }) => (
          <label key={color} className="swatch" title={name}>
            <input type="radio" name={group} className="visually-hidden" checked={value.toLowerCase() === color}
              onChange={() => onChange(color)} />
            <span className="swatch__color" style={{ background: color }} aria-hidden="true" />
            <span className="visually-hidden">{name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AreaRow({ area, open, onToggle }: { area: Area; open: boolean; onToggle(): void }) {
  const bodyId = useId();
  const archive = async () => {
    await saveArea(area.id, { archived: true });
    useToast.getState().show(`${area.name} arquivada. O XP já ganho continua.`, {
      label: 'Desfazer', run: () => { void saveArea(area.id, { archived: false }); },
    }, 6000);
  };
  return (
    <li className="area-row" style={{ ['--area-color' as string]: area.color }}>
      <button type="button" className="area-row__head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="area-row__icon" aria-hidden="true"><Icon name={areaIcon(area.icon)} size={24} /></span>
        <span className="area-row__names">
          <span className="area-row__name">{area.name}</span>
          <span className="area-row__attr">{area.attribute}</span>
        </span>
        <span className="area-row__toggle" aria-hidden="true">{open ? '–' : '+'}</span>
      </button>
      {open && (
        <div id={bodyId} className="area-row__body">
          <div className="settings-row">
            <EditableField label="Nome da área" value={area.name} required onSave={(name) => { void saveArea(area.id, { name }); }} />
            <EditableField label="Atributo" value={area.attribute} required
              onSave={(attribute) => { void saveArea(area.id, { attribute }); }} />
          </div>
          <ColorPicker value={area.color} onChange={(color) => { void saveArea(area.id, { color }); }} />
          <div><Button size="sm" onClick={() => { void archive(); }}>Arquivar área</Button></div>
        </div>
      )}
    </li>
  );
}

function NewAreaForm({ areas, onDone }: { areas: Area[]; onDone(): void }) {
  const [name, setName] = useState('');
  const [attribute, setAttribute] = useState('');
  const ready = name.trim() !== '' && attribute.trim() !== '';
  const create = async () => {
    if (!ready) return;
    await createArea(name, attribute);
    onDone();
  };
  return (
    <form className="area-form" onSubmit={(e) => { e.preventDefault(); void create(); }}>
      <div className="settings-row">
        <label className="field">
          <span className="field__label">Nome da nova área</span>
          <input type="text" value={name} placeholder="Ex.: Espiritualidade" autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Atributo da nova área</span>
          <input type="text" value={attribute} placeholder="Ex.: Fé" onChange={(e) => setAttribute(e.target.value)} />
        </label>
      </div>
      <div className="cluster">
        <Button type="submit" variant="primary" size="sm" disabled={!ready}>Criar área</Button>
        <Button size="sm" onClick={onDone}>Cancelar</Button>
      </div>
    </form>
  );
}

/** Áreas da vida: each area is an attribute of the character (rename, recolour, archive, add). */
export function AreasSection() {
  const areas = useAreas();
  const [openId, setOpenId] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const active = areas.filter((a) => !a.archived);
  const archived = areas.filter((a) => a.archived);

  return (
    <SettingsSection title="Áreas da vida" icon="star">
      <p className="settings-hint">Cada área é um atributo do personagem: o XP das missões dela faz o atributo crescer.</p>
      <ul className="area-list">
        {active.map((a) => (
          <AreaRow key={a.id} area={a} open={openId === a.id} onToggle={() => setOpenId(openId === a.id ? undefined : a.id)} />
        ))}
      </ul>
      {adding ? (
        <NewAreaForm areas={areas} onDone={() => setAdding(false)} />
      ) : (
        <div><Button size="sm" icon="plus" onClick={() => setAdding(true)}>Adicionar área</Button></div>
      )}
      {archived.length > 0 && (
        <div className="area-archived">
          <button type="button" className="settings-link" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Esconder arquivadas' : `Arquivadas (${archived.length})`}
          </button>
          {showArchived && (
            <ul className="area-archived__list">
              {archived.map((a) => (
                <li key={a.id}>
                  <span>{a.name} <span className="muted">· {a.attribute}</span></span>
                  <Button size="sm" variant="ghost" aria-label={`Restaurar ${a.name}`}
                    onClick={() => { void saveArea(a.id, { archived: false }); }}>Restaurar</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
