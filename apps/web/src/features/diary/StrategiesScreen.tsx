import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import type { DayKey, ID, Strategy } from '@life/shared';
import {
  newStrategyDraft, strategyDue, strategyGroups, strategyLinkValue, strategyMeta, strategyTrash,
} from '@life/shared';
import { useToday } from '../../db/hooks';
import { useStrategies, useStrategyLinks } from '../../db/strategyData';
import { purgeStrategy, restoreStrategy } from '../../domain/strategyActions';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE, focusWhenGone } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { StrategySheet, type StrategyTarget } from './StrategySheet';
import './diary.css';

const INTRO = 'O que você está testando, de onde veio e o que decidiu. A decisão de testar é sempre sua: nada chega de uma IA sozinho.';
const EMPTY = 'Nenhuma estratégia ainda. Quando decidir testar algo (de uma conversa com uma IA, de uma pesquisa, de Padrões '
  + 'ou uma ideia sua), registre aqui para acompanhar e decidir depois.';
const toast = (msg: string) => useToast.getState().show(msg);

/** `/diario/estrategias`: the strategies by status, Nova estratégia and Apagadas recentemente. Reading never writes. */
export function StrategiesScreen() {
  const today = useToday();
  const strategies = useStrategies();
  const links = useStrategyLinks();
  const [target, setTarget] = useState<StrategyTarget>();
  /**
   * Set when the sheet closes (Salvar, Apagar, Cancelar, Esc): the row it was opened from may move to another group or
   * vanish, and the opener may be a toast button that is gone. Once focus is lost (on <body>), it goes to that row's
   * button in its new place, else to the heading. Waits for the list to settle; gives up after a few seconds.
   */
  const [pending, setPending] = useState<{ id?: ID }>();
  const editing = useRef<ID | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  const groups = useMemo(() => strategyGroups(strategies ?? []), [strategies]);
  const trashed = useMemo(() => strategyTrash(strategies ?? []), [strategies]);
  const toHeading = () => heading.current;
  editing.current = target?.kind === 'edit' ? target.strategy.id : editing.current;
  const close = () => {
    setPending({ id: editing.current });
    editing.current = undefined;
    setTarget(undefined);
  };

  useEffect(() => {
    if (!pending || target !== undefined) return;
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected) return;
    const row = pending.id ? document.querySelector<HTMLElement>(`[data-strategy="${pending.id}"]`) : null;
    (row ?? heading.current)?.focus();
    setPending(undefined);
  }, [pending, target, strategies]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(undefined), 3000);
    return () => clearTimeout(t);
  }, [pending]);

  return (
    <section className="screen diary stack" aria-labelledby="strategies-title">
      <Link href="/diario" className="settings__back">‹ Diário</Link>
      <h1 id="strategies-title" ref={heading} tabIndex={-1} data-focus-target={FOCUS_PAGE}>Estratégias</h1>
      <p className="muted">{INTRO}</p>
      <div className="cluster">
        <Button variant="primary" icon="pen" disabled={!today}
          onClick={() => { if (today) setTarget({ kind: 'new', draft: newStrategyDraft(today) }); }}>
          Nova estratégia
        </Button>
      </div>
      {strategies && groups.length === 0 && <p className="muted">{EMPTY}</p>}
      {today && groups.map((g) => (
        <section key={g.status} className="stack" aria-labelledby={`strategies-${g.status}`}>
          <h2 id={`strategies-${g.status}`} className="diary__week-label">{g.title}</h2>
          <ul className="diary__list">
            {g.items.map((s) => (
              <StrategyItem key={s.id} strategy={s} today={today} names={links?.names ?? {}}
                onOpen={() => setTarget({ kind: 'edit', strategy: s })} />
            ))}
          </ul>
        </section>
      ))}
      {trashed.length > 0 && <StrategyTrash items={trashed} toHeading={toHeading} />}
      {today && (
        <StrategySheet target={target} today={today} onClose={close}
          onNew={(draft) => setTarget({ kind: 'new', draft })} />
      )}
    </section>
  );
}

function StrategyItem({ strategy: s, today, names, onOpen }: {
  strategy: Strategy; today: DayKey; names: Record<string, string>; onOpen(): void;
}) {
  const due = strategyDue(s, today);
  const linkName = s.link ? names[strategyLinkValue(s.link)] : undefined;
  return (
    <li className="diary-entry strategy-item">
      <button type="button" className="strategy-item__open" data-strategy={s.id} onClick={onOpen}>
        <span className="strategy-item__title">{s.title}</span>
        <span className="diary-entry__time">{strategyMeta(s)}</span>
      </button>
      {(due || linkName) && (
        <ul className="diary-entry__tags" aria-label="Marcas da estratégia">
          {due && <li className="tag tag--gold">Hora de decidir</li>}
          {linkName && <li className="tag">{`${s.link!.kind === 'block' ? 'Bloco' : 'Jornada'}: ${linkName}`}</li>}
        </ul>
      )}
    </li>
  );
}

function StrategyTrash({ items, toHeading }: { items: Strategy[]; toHeading(): HTMLElement | null }) {
  return (
    <details className="diary__filters">
      <summary>{`Apagadas recentemente (${items.length})`}</summary>
      <ul className="diary__list" aria-label="Estratégias apagadas">
        {items.map((s) => <TrashRow key={s.id} strategy={s} toHeading={toHeading} />)}
      </ul>
    </details>
  );
}

function TrashRow({ strategy: s, toHeading }: { strategy: Strategy; toHeading(): HTMLElement | null }) {
  const [confirm, setConfirm] = useState(false);
  const openBtn = useRef<HTMLButtonElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (confirm) confirmBtn.current?.focus();
    else if (cancelled.current) {
      cancelled.current = false;
      openBtn.current?.focus();
    }
  }, [confirm]);
  const gone = (e: { currentTarget: Element }) => focusWhenGone(e.currentTarget, toHeading);
  return (
    <li className="diary-entry">
      <span className="strategy-item__title">{s.title}</span>
      {confirm ? (
        <div className="stack" role="group" aria-label={`Confirmar apagar de vez: ${s.title}`}>
          <p>Apagar de vez? Não dá para desfazer.</p>
          <div className="cluster">
            <Button ref={confirmBtn} size="sm" variant="primary" onClick={(e) => {
              gone(e);
              safeRun(purgeStrategy(s.id).then(() => toast('Estratégia apagada de vez.')));
            }}>Apagar de vez</Button>
            <Button size="sm" variant="ghost" onClick={() => { cancelled.current = true; setConfirm(false); }}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <div className="cluster">
          <Button size="sm" aria-label={`Restaurar: ${s.title}`} onClick={(e) => {
            gone(e);
            safeRun(restoreStrategy(s.id).then(() => toast('Estratégia restaurada.')));
          }}>Restaurar</Button>
          <Button ref={openBtn} size="sm" variant="ghost" aria-label={`Apagar de vez: ${s.title}`} onClick={() => setConfirm(true)}>
            Apagar de vez
          </Button>
        </div>
      )}
    </li>
  );
}
