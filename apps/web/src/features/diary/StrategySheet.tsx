import { useId, useState } from 'react';
import type { DayKey, Strategy, StrategyDraft } from '@life/shared';
import {
  SOURCE_NOTE_SOURCES, STRATEGY_CHOICE_LABEL, STRATEGY_ISSUE_TEXT, STRATEGY_NOTE_MAX, STRATEGY_REVIEW_DAYS, STRATEGY_REVIEW_LABEL,
  STRATEGY_SOURCES, STRATEGY_SOURCE_LABEL, STRATEGY_SOURCE_NOTE_MAX, STRATEGY_STATUSES, STRATEGY_TEXT_MAX, STRATEGY_TITLE_MAX,
  addDays, adjustedDraft, diffDays, isValidDayKey, strategyDraftOf, strategyDue, strategyIssue, strategyLinkFrom, strategyLinkValue,
} from '@life/shared';
import { useStrategyLinks } from '../../db/strategyData';
import { createStrategy, postponeStrategy, trashStrategy, updateStrategy } from '../../domain/strategyActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast, type ToastAction } from '../../ui/Toast';

/** What the sheet shows: a new strategy (maybe prefilled) or a stored one, as it was when tapped. */
export type StrategyTarget = { kind: 'new'; draft: StrategyDraft } | { kind: 'edit'; strategy: Strategy };

const ddmm = (day: DayKey): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const toast = (msg: string, action?: ToastAction) => useToast.getState().show(msg, action);

export interface StrategySheetProps {
  target?: StrategyTarget;
  today: DayKey;
  onClose(): void;
  /** "Testar a versão ajustada": opens Nova estratégia with this draft. */
  onNew(draft: StrategyDraft): void;
}

/** "Nova estratégia" / "Estratégia". Opening writes nothing; every write is a button. */
export function StrategySheet({ target, today, onClose, onNew }: StrategySheetProps) {
  return (
    <Sheet open={target !== undefined} onClose={onClose} title={target?.kind === 'edit' ? 'Estratégia' : 'Nova estratégia'}>
      {target && (
        <StrategyForm key={target.kind === 'edit' ? target.strategy.id : 'new'} target={target} today={today}
          onClose={onClose} onNew={onNew} />
      )}
    </Sheet>
  );
}

function StrategyForm({ target, today, onClose, onNew }: Required<Omit<StrategySheetProps, 'target'>> & { target: StrategyTarget }) {
  const editing = target.kind === 'edit' ? target.strategy : undefined;
  // The values when the sheet opened: "Salvar" writes only what differs from them (strategyChanges).
  const [initial] = useState<StrategyDraft>(() => (target.kind === 'edit' ? strategyDraftOf(target.strategy) : target.draft));
  const [draft, setDraft] = useState<StrategyDraft>(initial);
  const [busy, setBusy] = useState(false);
  const links = useStrategyLinks();
  const id = useId();
  const issue = strategyIssue(draft, today);
  const set = (changes: Partial<StrategyDraft>) => setDraft((d) => ({ ...d, ...changes }));
  const offset = isValidDayKey(draft.startDay) && isValidDayKey(draft.reviewDay) ? diffDays(draft.startDay, draft.reviewDay) : undefined;
  const due = editing !== undefined && strategyDue(editing, today);
  const linkValue = strategyLinkValue(draft.link);
  const offered = new Set([...(links?.blocks ?? []).map((b) => `block:${b.id}`), ...(links?.journeys ?? []).map((j) => `journey:${j.id}`)]);

  const run = (work: () => Promise<void>) => {
    setBusy(true);
    safeRun(work().finally(() => setBusy(false)));
  };
  /** A new start keeps the chosen distance to the decision (1 to 4 weeks). */
  const changeStart = (startDay: string) => setDraft((d) => {
    const kept = offset !== undefined && STRATEGY_REVIEW_DAYS.includes(offset) && isValidDayKey(startDay);
    return { ...d, startDay, ...(kept ? { reviewDay: addDays(startDay, offset) } : {}) };
  });
  const save = () => run(async () => {
    if (!editing) {
      await createStrategy(draft);
      toast('Estratégia em teste. Ela aparece no Agora.');
      onClose();
      return;
    }
    if (await updateStrategy(editing.id, initial, draft)) {
      const decided = draft.status !== initial.status && draft.status !== 'testando';
      if (decided && draft.status === 'ajustada') {
        const next = adjustedDraft(draft, today);
        toast('Decisão registrada.', { label: 'Testar a versão ajustada', run: () => onNew(next) });
      } else {
        toast(decided ? 'Decisão registrada.' : 'Estratégia salva.');
      }
    }
    onClose();
  });
  const postpone = () => run(async () => {
    // His unsaved words are kept first (text fields only; the decision itself waits).
    await updateStrategy(editing!.id, initial, draft, { keepStatus: true });
    const day = await postponeStrategy(editing!.id);
    if (day) toast(`Combinado: decidir em ${ddmm(day)}.`);
    onClose();
  });
  /** The adjusted version: what is typed is saved first, exactly as Salvar would, then the new sheet opens. */
  const testAdjusted = () => run(async () => {
    await updateStrategy(editing!.id, initial, draft);
    onNew(adjustedDraft(draft, today));
  });
  const trash = () => run(async () => {
    await trashStrategy(editing!.id);
    toast('Estratégia apagada. Ela fica em Apagadas recentemente.');
    onClose();
  });

  return (
    <div className="strategy-form stack">
      {due && <p className="strategy-form__due">Hora de decidir: manter, ajustar ou descartar. Decidir é opcional.</p>}
      <label className="field" htmlFor={`${id}-title`}>
        <span className="field__label">O que vai testar?</span>
        <input id={`${id}-title`} type="text" value={draft.title} maxLength={STRATEGY_TITLE_MAX} autoFocus={!editing}
          placeholder="Ex.: celular em outro cômodo no bloco do Tech News" onChange={(e) => set({ title: e.target.value })} />
      </label>
      <fieldset className="strategy-form__chips">
        <legend className="field__label">De onde veio?</legend>
        {STRATEGY_SOURCES.map((s) => (
          <Chip key={s} selected={draft.source === s} onClick={() => set({ source: s })}>{STRATEGY_SOURCE_LABEL[s]}</Chip>
        ))}
      </fieldset>
      {SOURCE_NOTE_SOURCES.includes(draft.source) && (
        <label className="field" htmlFor={`${id}-source`}>
          <span className="field__label">Qual conversa ou fonte? (opcional)</span>
          <input id={`${id}-source`} type="text" value={draft.sourceNote} maxLength={STRATEGY_SOURCE_NOTE_MAX}
            placeholder="Ex.: conversa com o Claude de 15/11" onChange={(e) => set({ sourceNote: e.target.value })} />
        </label>
      )}
      <label className="field" htmlFor={`${id}-why`}>
        <span className="field__label">Por quê? (opcional)</span>
        <input id={`${id}-why`} type="text" value={draft.why} maxLength={STRATEGY_TEXT_MAX} onChange={(e) => set({ why: e.target.value })} />
      </label>
      <label className="field" htmlFor={`${id}-observe`}>
        <span className="field__label">O que observar? (opcional)</span>
        <input id={`${id}-observe`} type="text" value={draft.observe} maxLength={STRATEGY_TEXT_MAX}
          placeholder="Ex.: escapes e início do bloco" onChange={(e) => set({ observe: e.target.value })} />
      </label>
      <label className="field" htmlFor={`${id}-link`}>
        <span className="field__label">Ligar a (opcional)</span>
        <select id={`${id}-link`} value={linkValue} onChange={(e) => set({ link: strategyLinkFrom(e.target.value) })}>
          <option value="">Nada</option>
          {linkValue !== '' && !offered.has(linkValue) && <option value={linkValue}>{links?.names[linkValue] ?? 'Vínculo atual'}</option>}
          {(links?.blocks.length ?? 0) > 0 && (
            <optgroup label="Blocos">
              {links!.blocks.map((b) => <option key={b.id} value={`block:${b.id}`}>{b.name}</option>)}
            </optgroup>
          )}
          {(links?.journeys.length ?? 0) > 0 && (
            <optgroup label="Jornadas">
              {links!.journeys.map((j) => <option key={j.id} value={`journey:${j.id}`}>{j.title}</option>)}
            </optgroup>
          )}
        </select>
      </label>
      <label className="field" htmlFor={`${id}-start`}>
        <span className="field__label">Desde</span>
        <input id={`${id}-start`} type="date" value={draft.startDay} max={today} onChange={(e) => changeStart(e.target.value)} />
      </label>
      <fieldset className="strategy-form__chips">
        <legend className="field__label">Decidir em</legend>
        {STRATEGY_REVIEW_DAYS.map((n) => (
          <Chip key={n} selected={offset === n}
            onClick={() => { if (isValidDayKey(draft.startDay)) set({ reviewDay: addDays(draft.startDay, n) }); }}>
            {STRATEGY_REVIEW_LABEL[n]!}
          </Chip>
        ))}
        {isValidDayKey(draft.reviewDay) && <p className="muted strategy-form__hint">{`Decidir em ${ddmm(draft.reviewDay)}.`}</p>}
      </fieldset>
      {editing && (
        <fieldset className="strategy-form__chips">
          <legend className="field__label">Decisão (opcional)</legend>
          {STRATEGY_STATUSES.map((st) => (
            <Chip key={st} selected={draft.status === st} onClick={() => set({ status: st })}>{STRATEGY_CHOICE_LABEL[st]}</Chip>
          ))}
        </fieldset>
      )}
      {editing && draft.status !== 'testando' && (
        <label className="field" htmlFor={`${id}-note`}>
          <span className="field__label">Nota da decisão (opcional)</span>
          <textarea id={`${id}-note`} rows={3} value={draft.decisionNote} maxLength={STRATEGY_NOTE_MAX}
            placeholder="Com as suas palavras: o que viu e por que decidiu" onChange={(e) => set({ decisionNote: e.target.value })} />
        </label>
      )}
      <p className="strategy-form__issue" aria-live="polite">{issue && issue !== 'title' ? STRATEGY_ISSUE_TEXT[issue] : ''}</p>
      <div className="cluster">
        <Button variant="primary" disabled={busy || issue !== undefined} onClick={save}>{editing ? 'Salvar' : 'Começar a testar'}</Button>
        {!editing && <Button variant="ghost" onClick={onClose}>Cancelar</Button>}
      </div>
      {editing && (
        <div className="cluster">
          {due && <Button size="sm" disabled={busy} onClick={postpone}>Decidir depois (+7 dias)</Button>}
          {editing.status === 'ajustada' && (
            <Button size="sm" disabled={busy} onClick={testAdjusted}>Testar a versão ajustada</Button>
          )}
          <Button size="sm" variant="ghost" icon="trash" disabled={busy} onClick={trash}>Apagar</Button>
        </div>
      )}
    </div>
  );
}
