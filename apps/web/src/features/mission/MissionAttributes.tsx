import type { Area, Block, DayKey, Journey, Mission } from '@life/shared';
import { isOfBlock } from '@life/shared';
import { areaIcon, Icon } from '../../art/icons';
import { db } from '../../db/db';
import { moveToDay, updateMission } from '../../domain/actions';
import { Chip } from '../../ui/Chip';
import { DURATION_OPTIONS, ENERGY_LABEL, ENERGY_OPTIONS, formatDuration } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { RecurrencePicker } from './RecurrencePicker';

interface Props { mission: Mission; areas: Area[]; journeys: Journey[]; today: DayKey; blocks?: Block[] }

/** Optional date field; cleared with an "×" or, when `noneLabel` is given, a "Sem data"-style chip. */
function DateField({ label, value, onChange, min, noneLabel }: {
  label: string; value?: DayKey; min?: DayKey; noneLabel?: string; onChange(v: DayKey | undefined): void;
}) {
  return (
    <div className="date-field">
      <label className="field">
        <span className="field__label">{label}</span>
        <input type="date" value={value ?? ''} min={min} onChange={(e) => onChange(e.target.value || undefined)} />
      </label>
      {noneLabel ? (
        <Chip selected={!value} onClick={() => onChange(undefined)}>{noneLabel}</Chip>
      ) : value && (
        <button type="button" className="date-field__clear" aria-label={`Limpar ${label.toLowerCase()}`}
          onClick={() => onChange(undefined)}>
          <Icon name="close" size={12} />
        </button>
      )}
    </div>
  );
}

/** Chips (duration, energy, area, important), dates, recurrence and journey. Saved on change. */
export function MissionAttributes({ mission, areas, journeys, today, blocks = [] }: Props) {
  const set = (changes: Partial<Mission>) => safeRun(updateMission(mission.id, changes));
  const durations = [...new Set([...DURATION_OPTIONS, ...(mission.durationMin ? [mission.durationMin] : [])])]
    .sort((a, b) => a - b);
  const activeJourneys = journeys.filter((j) => j.status === 'active' || j.id === mission.journeyId)
    .sort((a, b) => a.order - b.order);

  const setJourney = (journeyId: string) => safeRun(async () => {
    if (!journeyId) { await updateMission(mission.id, { journeyId: undefined, journeyOrder: undefined }); return; }
    const siblings = await db.missions.where('journeyId').equals(journeyId).filter((m) => !m.deleted).toArray();
    const order = siblings.reduce((mx, m) => Math.max(mx, (m.journeyOrder ?? -1) + 1), 0);
    await updateMission(mission.id, { journeyId, journeyOrder: order });
  });

  return (
    <>
      <fieldset className="attr">
        <legend className="field__label">Duração</legend>
        <div className="cluster">
          {durations.map((d) => (
            <Chip key={d} selected={mission.durationMin === d}
              onClick={() => set({ durationMin: mission.durationMin === d ? undefined : d })}>
              {formatDuration(d)}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="attr">
        <legend className="field__label">Energia</legend>
        <div className="cluster">
          {ENERGY_OPTIONS.map((e) => (
            <Chip key={e} selected={mission.energy === e}
              onClick={() => set({ energy: mission.energy === e ? undefined : e })}>
              {ENERGY_LABEL[e]}
            </Chip>
          ))}
          <Chip selected={mission.important} onClick={() => set({ important: !mission.important })}>
            <Icon name="star" size={12} />Importante
          </Chip>
        </div>
      </fieldset>

      {areas.length > 0 && (
        <fieldset className="attr">
          <legend className="field__label">Área</legend>
          <div className="cluster">
            {areas.map((a) => (
              <Chip key={a.id} selected={mission.areaId === a.id}
                onClick={() => set({ areaId: mission.areaId === a.id ? undefined : a.id })}>
                <span className="chip-icon" style={{ color: mission.areaId === a.id ? undefined : a.color }}>
                  <Icon name={areaIcon(a.icon)} size={12} />
                </span>
                {a.name}
              </Chip>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="attr">
        <legend className="field__label">Quando</legend>
        <div className="attr__dates">
          <DateField label="Dia planejado" value={mission.date} noneLabel="Sem data"
            onChange={(d) => safeRun(moveToDay(mission.id, d ?? null))} />
          <DateField label="Prazo" value={mission.deadline} onChange={(deadline) => set({ deadline })} />
          <DateField label="Não antes de" value={mission.notBefore} min={today}
            onChange={(notBefore) => set({ notBefore })} />
        </div>
      </fieldset>

      <RecurrencePicker
        value={mission.recurrence}
        baseDay={mission.date ?? today}
        onChange={(recurrence) => set({ recurrence })}
      />

      <label className="field attr">
        <span className="field__label">Jornada</span>
        <select value={mission.journeyId ?? ''} onChange={(e) => setJourney(e.target.value)}>
          <option value="">Nenhuma</option>
          {activeJourneys.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
      </label>

      <BlockSelect mission={mission} blocks={blocks} onChange={(blockId) => set({ blockId })} />
    </>
  );
}

/** "Bloco": automatic (by area/journey, naming the block it lands in) or one block explicitly. */
function BlockSelect({ mission, blocks, onChange }: {
  mission: Mission; blocks: Block[]; onChange(blockId: string | undefined): void;
}) {
  const live = blocks.filter((b) => !b.deleted && (!b.archived || b.id === mission.blockId));
  if (live.length === 0) return null;
  const auto = live.find((b) => !b.archived && isOfBlock({ ...mission, blockId: undefined }, b));
  return (
    <label className="field attr">
      <span className="field__label">Bloco</span>
      <select value={mission.blockId ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{auto ? `Automático — ${auto.name}` : 'Automático (pela área ou jornada)'}</option>
        {live.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
  );
}
