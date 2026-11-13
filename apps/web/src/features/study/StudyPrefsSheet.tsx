import { useState } from 'react';
import type { StudySettings } from '@life/shared';
import { studySettingsOf } from '@life/shared';
import { useSettings } from '../../db/hooks';
import { saveStudySettings } from '../../domain/studyActions';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { blockedNotificationsHint } from '../reminders/reminders';
import { WeekdayToggles } from '../routine/BlockFields';

const RETENTIONS = [0.8, 0.85, 0.9, 0.95];
const DEFAULT_REMINDER_AT = '18:00';

/** Budget, new-card cap, desired retention and rest days (spec §6). */
export function StudyPrefsSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const settings = useSettings();
  // The form mounts only once the saved values are loaded, and starts from them for this opening:
  // a later settings change (or a late first load) can never reset what was typed.
  return (
    <Sheet open={open} onClose={onClose} title="Preferências de estudo">
      {open && settings && <StudyPrefsForm initial={studySettingsOf(settings)} onClose={onClose} />}
    </Sheet>
  );
}

function StudyPrefsForm({ initial, onClose }: { initial: StudySettings; onClose(): void }) {
  const [d, setD] = useState<StudySettings>(initial);
  const toggle = (wd: number): void => setD((p) => ({
    ...p, restDays: p.restDays.includes(wd) ? p.restDays.filter((x) => x !== wd) : [...p.restDays, wd],
  }));
  const lastStudyDay = d.restDays.length === 6 ? [0, 1, 2, 3, 4, 5, 6].find((x) => !d.restDays.includes(x)) : undefined;

  return (
      <form className="stack" onSubmit={(e) => { e.preventDefault(); safeRun(saveStudySettings({ ...d, reminderAt: d.reminderAt }).then(onClose)); }}>
        <div className="field">
          <label className="field__label" htmlFor="study-budget">Minutos de revisão por dia</label>
          <input id="study-budget" type="number" inputMode="numeric" min={5} max={120} step={5} value={d.budgetMin}
            onChange={(e) => setD({ ...d, budgetMin: Number(e.target.value) || 0 })} />
          <p className="block-form__hint">Cards novos só entram enquanto a previsão dos próximos dias couber nesse tempo.</p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="study-new">Teto de cards novos por dia</label>
          <input id="study-new" type="number" inputMode="numeric" min={0} max={50} value={d.maxNewPerDay}
            onChange={(e) => setD({ ...d, maxNewPerDay: Number(e.target.value) || 0 })} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="study-retention">Retenção desejada</label>
          <select id="study-retention" value={String(d.retention)} onChange={(e) => setD({ ...d, retention: Number(e.target.value) })}>
            {RETENTIONS.map((r) => <option key={r} value={String(r)}>{Math.round(r * 100)}%</option>)}
          </select>
          <p className="block-form__hint">Mais retenção significa mais revisões por dia.</p>
        </div>
        <WeekdayToggles legend="Dias sem revisão" value={d.restDays} onToggle={toggle} disabled={lastStudyDay} />
        <div className="field">
          <button type="button" role="switch" aria-checked={d.reminderAt !== undefined} className="switch-row"
            onClick={() => setD((p) => {
              const { reminderAt: _off, ...rest } = p;
              return p.reminderAt === undefined ? { ...rest, reminderAt: DEFAULT_REMINDER_AT } : rest;
            })}>
            <span className="switch-row__track" aria-hidden="true"><span className="switch-row__thumb" /></span>
            <span>Lembrete de estudo</span>
          </button>
          <label className="field">
            <span className="field__label">Horário do lembrete de estudo</span>
            <input type="time" value={d.reminderAt ?? ''} disabled={d.reminderAt === undefined}
              onChange={(e) => { if (e.target.value) setD({ ...d, reminderAt: e.target.value }); }} />
          </label>
          <p className="block-form__hint">
            Um aviso por dia de estudo, só se houver cards para hoje e a meta ainda não foi cumprida. No iPhone, só funciona com o app na Tela de Início.
          </p>
          {d.reminderAt !== undefined && blockedNotificationsHint() && (
            <p className="block-form__hint" role="status">{blockedNotificationsHint()}</p>
          )}
        </div>
        <div className="commit-form__actions">
          <Button type="submit" variant="primary" icon="check">Salvar</Button>
          <Button onClick={onClose}>Cancelar</Button>
        </div>
      </form>
  );
}
