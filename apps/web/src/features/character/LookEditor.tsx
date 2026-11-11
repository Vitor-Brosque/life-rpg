import { useId, useState } from 'react';
import type { CharacterLook, Profile } from '@life/shared';
import { Avatar } from '../../art/Avatar';
import { HAIR_COLOR_NAMES, OUTFIT_NAMES, SKIN_NAMES } from '../../art/palette';
import { HAIR_COLORS, HAIR_STYLE_NAMES, HAIR_STYLES_COUNT, OUTFIT_COLORS, SKIN_TONES } from '../../art/sprites';
import { useProfile } from '../../db/hooks';
import { patch } from '../../db/repo';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import './character.css';

export const DEFAULT_COMPANION = 'Faísca';

/** What the look editor (and the first-access step 1) edits. */
export interface LookDraft { name: string; companionName: string; look: CharacterLook }

export function draftFromProfile(p?: Profile): LookDraft {
  return {
    name: p?.name ?? '',
    companionName: p?.companionName || DEFAULT_COMPANION,
    look: p?.look ?? { skin: 0, hair: 0, hairColor: 0, outfit: 0 },
  };
}

/** Profile fields to save from a draft (empty companion name falls back to "Faísca"). */
export function profileChanges(d: LookDraft): Partial<Profile> {
  return { name: d.name.trim(), companionName: d.companionName.trim() || DEFAULT_COMPANION, look: d.look };
}

interface SwatchGroupProps { legend: string; colors: string[]; names: string[]; value: number; onChange(i: number): void }

/** Native radio group drawn as pixel colour swatches (arrow keys move between them). */
function SwatchGroup({ legend, colors, names, value, onChange }: SwatchGroupProps) {
  const group = useId();
  return (
    <fieldset className="look-picker">
      <legend className="field__label">{legend}</legend>
      <div className="look-picker__options">
        {colors.map((color, i) => (
          <label key={color} className="swatch" title={names[i]}>
            <input type="radio" name={group} className="visually-hidden" checked={value === i} onChange={() => onChange(i)} />
            <span className="swatch__color" style={{ background: color }} aria-hidden="true" />
            <span className="visually-hidden">{names[i]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export interface LookFieldsProps {
  value: LookDraft;
  onChange(next: LookDraft): void;
  nameLabel?: string;
}

/** Name, companion name and the layered look pickers, with a live avatar preview. */
export function LookFields({ value, onChange, nameLabel = 'Nome' }: LookFieldsProps) {
  const group = useId();
  const { look } = value;
  const setLook = (changes: Partial<CharacterLook>) => onChange({ ...value, look: { ...look, ...changes } });
  return (
    <div className="look-fields">
      <div className="look-fields__head">
        <div className="look-fields__preview" aria-hidden="true"><Avatar look={look} scale={5} /></div>
        <div className="look-fields__names">
          <label className="field">
            <span className="field__label">{nameLabel}</span>
            <input type="text" value={value.name} maxLength={40} autoComplete="given-name" enterKeyHint="done"
              onChange={(e) => onChange({ ...value, name: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">Nome do companheiro</span>
            <input type="text" value={value.companionName} maxLength={30} autoComplete="off" enterKeyHint="done"
              onChange={(e) => onChange({ ...value, companionName: e.target.value })} />
          </label>
        </div>
      </div>

      <SwatchGroup legend="Tom de pele" colors={SKIN_TONES} names={SKIN_NAMES} value={look.skin}
        onChange={(skin) => setLook({ skin })} />

      <fieldset className="look-picker">
        <legend className="field__label">Cabelo</legend>
        <div className="look-picker__options look-picker__options--styles">
          {Array.from({ length: HAIR_STYLES_COUNT }, (_, hair) => (
            <label key={hair} className="look-style">
              <input type="radio" name={group} className="visually-hidden" checked={look.hair === hair}
                onChange={() => setLook({ hair })} />
              <span className="look-style__card" aria-hidden="true"><Avatar look={{ ...look, hair }} scale={3} /></span>
              <span className="look-style__name">{HAIR_STYLE_NAMES[hair]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <SwatchGroup legend="Cor do cabelo" colors={HAIR_COLORS} names={HAIR_COLOR_NAMES} value={look.hairColor}
        onChange={(hairColor) => setLook({ hairColor })} />
      <SwatchGroup legend="Cor da roupa" colors={OUTFIT_COLORS} names={OUTFIT_NAMES} value={look.outfit}
        onChange={(outfit) => setLook({ outfit })} />
    </div>
  );
}

function LookEditorForm({ profile, onDone }: { profile: Profile; onDone(): void }) {
  const [draft, setDraft] = useState(() => draftFromProfile(profile));
  const save = async () => {
    await patch<Profile>('profile', profile.id, profileChanges(draft));
    onDone();
  };
  return (
    <form className="look-editor" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <LookFields value={draft} onChange={setDraft} />
      <div className="look-editor__actions">
        <Button type="submit" variant="primary">Salvar</Button>
        <Button onClick={onDone}>Cancelar</Button>
      </div>
    </form>
  );
}

/** "Editar aparência" sheet. The draft starts from the profile each time it opens; "Salvar" writes it. */
export function LookEditor({ open, onClose }: { open: boolean; onClose(): void }) {
  const profile = useProfile();
  return (
    <Sheet open={open && profile !== undefined} onClose={onClose} title="Editar aparência">
      {profile && <LookEditorForm profile={profile} onDone={onClose} />}
    </Sheet>
  );
}
