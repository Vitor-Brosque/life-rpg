import { useState } from 'react';
import type { Area, CaptureToken, DayKey, Energy, Mission, ParsedCapture } from '@life/shared';
import { describeRecurrence } from '@life/shared';
import { areaIcon, Icon, type IconName } from '../../art/icons';
import { resolveArea, updateMission } from '../../domain/actions';
import { Chip } from '../../ui/Chip';
import { DURATION_OPTIONS, ENERGY_LABEL, ENERGY_OPTIONS, formatDay, formatDuration } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';

const TOKEN_ICON: Record<CaptureToken['type'], IconName> = {
  date: 'calendar', time: 'timer', duration: 'timer', journey: 'journey', area: 'star', important: 'star', recurrence: 'calendar',
};

function tokenLabel(t: CaptureToken, p: ParsedCapture, today: DayKey, areas: Area[]): string {
  switch (t.type) {
    case 'date': return p.date ? formatDay(p.date, today) : t.text;
    case 'time': return p.time ?? t.text;
    case 'duration': return p.durationMin !== undefined ? formatDuration(p.durationMin) : t.text;
    case 'journey': return p.journeyName ?? t.text;
    case 'area': return (p.areaQuery && resolveArea(areas, p.areaQuery)?.name) ?? t.text;
    case 'important': return 'importante';
    case 'recurrence': return p.recurrence ? `Repete ${describeRecurrence(p.recurrence)}` : t.text;
  }
}

export interface CaptureChipsProps {
  parsed: ParsedCapture;
  today: DayKey;
  areas: Area[];
  /** Only meaningful when `parsed.kind === 'commitment'`. */
  asMission: boolean;
  onToggleKind(asMission: boolean): void;
  onRemoveToken(token: CaptureToken): void;
}

/** Live chips for what the parser understood; each can be removed (drops its text). */
export function CaptureChips({ parsed, today, areas, asMission, onToggleKind, onRemoveToken }: CaptureChipsProps) {
  if (parsed.tokens.length === 0 && parsed.kind !== 'commitment') return null;
  return (
    <div className="capture-chips" aria-label="Entendido" role="group">
      {parsed.kind === 'commitment' && (
        <span className="kind-toggle" role="group" aria-label="Tipo">
          <button type="button" className="kind-toggle__opt" aria-pressed={!asMission} onClick={() => onToggleKind(false)}>
            <Icon name="calendar" size={12} />Compromisso
          </button>
          <span className="kind-toggle__sep" aria-hidden="true">⇄</span>
          <button type="button" className="kind-toggle__opt" aria-pressed={asMission} onClick={() => onToggleKind(true)}>
            Missão
          </button>
        </span>
      )}
      {parsed.tokens.map((t) => {
        const label = tokenLabel(t, parsed, today, areas);
        const area = t.type === 'area' && parsed.areaQuery ? resolveArea(areas, parsed.areaQuery) : undefined;
        const icon = area ? areaIcon(area.icon) : TOKEN_ICON[t.type];
        return (
          <Chip key={`${t.type}-${t.start}`} onRemove={() => onRemoveToken(t)} removeLabel={`Remover ${label}`}>
            <span className="chip-icon" style={area ? { color: area.color } : undefined}>
              <Icon name={icon} size={12} />
            </span>
            {label}
          </Chip>
        );
      })}
    </div>
  );
}

export interface QuickDetailsProps {
  mission: Mission;
  areas: Area[];
  /** Called on every tap so the parent can keep the row visible a bit longer. */
  onActivity(): void;
}

/** One-tap optional details for the mission just captured (never a form). */
export function QuickDetails({ mission, areas, onActivity }: QuickDetailsProps) {
  const [values, setValues] = useState<Pick<Mission, 'durationMin' | 'energy' | 'areaId'>>({
    durationMin: mission.durationMin, energy: mission.energy, areaId: mission.areaId,
  });
  const apply = (changes: Partial<Mission>) => {
    setValues((v) => ({ ...v, ...changes }));
    onActivity();
    safeRun(updateMission(mission.id, changes));
  };
  const toggleEnergy = (e: Energy) => apply({ energy: values.energy === e ? undefined : e });
  return (
    <div className="quick-details" role="group" aria-label="Detalhes rápidos">
      <div className="quick-details__row">
        <span className="quick-details__label">Duração</span>
        {DURATION_OPTIONS.map((d) => (
          <Chip key={d} selected={values.durationMin === d}
            onClick={() => apply({ durationMin: values.durationMin === d ? undefined : d })}>
            {formatDuration(d)}
          </Chip>
        ))}
      </div>
      <div className="quick-details__row">
        <span className="quick-details__label">Energia</span>
        {ENERGY_OPTIONS.map((e) => (
          <Chip key={e} selected={values.energy === e} onClick={() => toggleEnergy(e)}>{ENERGY_LABEL[e]}</Chip>
        ))}
      </div>
      {areas.length > 0 && (
        <div className="quick-details__row">
          <span className="quick-details__label">Área</span>
          {areas.map((a) => (
            <Chip key={a.id} selected={values.areaId === a.id}
              onClick={() => apply({ areaId: values.areaId === a.id ? undefined : a.id })}>
              <span className="chip-icon" style={{ color: values.areaId === a.id ? undefined : a.color }}>
                <Icon name={areaIcon(a.icon)} size={12} />
              </span>
              {a.name}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
