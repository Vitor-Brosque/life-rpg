import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { create } from 'zustand';
import type { DayKey, Deck } from '@life/shared';
import { dayKeyOf } from '@life/shared';
import { db } from '../../db/db';
import { useAreas, useJourneys, useToday } from '../../db/hooks';
import { FacultyValidationError } from '../../domain/facultyActions';
import { Button } from '../../ui/Button';
import { formatDay } from '../../ui/format';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { usePageHide } from '../../ui/usePageHide';
import { CaptureKindPicker } from './CaptureKindPicker';
import {
  buildRequests, choose as chooseOption, chooseKind, initialState, isSingleLineKind, joinLines, missing, prefill,
  type CaptureCtx, type CaptureKind, type CaptureState,
} from './captureModel';
import { CaptureOptions, type ChooseFn, type RowId } from './CaptureOptions';
import { isCardDraft, isMission, saveCaptureRequests, type Captured } from './captureSave';
import './capture.css';

// ------------------------------------------------------------------ global opener

interface CaptureStore {
  isOpen: boolean;
  defaultDate?: DayKey;
  open(opts?: { defaultDate?: DayKey }): void;
  close(): void;
}

let opener: HTMLElement | null = null;

/** Global capture opener: the "+" button, the N / Ctrl+K shortcuts, empty states, Planejar... */
export const useCaptureStore = create<CaptureStore>((set) => ({
  isOpen: false,
  open(opts) {
    if (!useCaptureStore.getState().isOpen) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    set({ isOpen: true, defaultDate: opts?.defaultDate });
  },
  close() {
    set({ isOpen: false, defaultDate: undefined });
    const el = opener;
    opener = null;
    // The sheet's own focus restore points at the (now removed) textarea; return to the opener.
    if (el) setTimeout(() => { if (document.contains(el)) el.focus(); }, 0);
  },
}));

const isTypingTarget = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function useCaptureShortcuts(): void {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.altKey) return;
      const key = e.key.toLowerCase();
      const ctrlK = (e.ctrlKey || e.metaKey) && key === 'k';
      const n = !e.ctrlKey && !e.metaKey && key === 'n';
      if (!ctrlK && !n) return;
      if (isTypingTarget(e.target) || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      useCaptureStore.getState().open();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Mount once (App): the capture sheet driven by `useCaptureStore`, plus desktop shortcuts. */
export function CaptureHost() {
  const isOpen = useCaptureStore((s) => s.isOpen);
  const defaultDate = useCaptureStore((s) => s.defaultDate);
  const close = useCaptureStore((s) => s.close);
  useCaptureShortcuts();
  return <CaptureBar open={isOpen} onClose={close} defaultDate={defaultDate} />;
}

/** The floating "+" (Layout `floating` slot). flushSync keeps the focus inside the tap, so iOS opens the keyboard. */
export function CaptureFab() {
  return (
    <Button
      variant="primary"
      size="lg"
      icon="plus"
      className="fab"
      aria-label="Capturar"
      aria-keyshortcuts="N Control+K"
      onClick={() => flushSync(() => useCaptureStore.getState().open())}
    />
  );
}

// ------------------------------------------------------------------ the bar

export interface CaptureBarProps { open: boolean; onClose(): void; defaultDate?: DayKey }

/** Capture in a sheet anchored to the top (phones) / centred (larger screens). */
export function CaptureBar({ open, onClose, defaultDate }: CaptureBarProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Capturar" placement="top">
      <CaptureForm defaultDate={defaultDate} autoFocus />
    </Sheet>
  );
}

const FEEDBACK_MS = 6000;

/**
 * A half-typed capture is kept here while the page is hidden, so an app reload (update) or the
 * phone killing the app in the background does not lose it. Restored once, by the next form.
 * Only the text: the tapped options are not kept.
 */
const DRAFT_KEY = 'life-rpg.capture.draft';

function readDraft(): string {
  try { return localStorage.getItem(DRAFT_KEY) ?? ''; } catch { return ''; }
}

function writeDraft(text: string): void {
  try {
    if (text.trim()) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  } catch { /* storage may be unavailable */ }
}

/** The status line after Salvar. */
function feedbackFor(items: Captured[], today: DayKey): string | undefined {
  if (items.length === 0) return undefined;
  if (items.length > 1) {
    return items.every(isCardDraft)
      ? `${items.length} rascunhos de card salvos. Complete na aba Estudo.`
      : `${items.length} tarefas capturadas.`;
  }
  const item = items[0]!;
  if (isCardDraft(item)) return 'Rascunho de card salvo. Complete na aba Estudo.';
  if (isMission(item)) {
    if (item.assessment && item.date) {
      // "Prova de Cálculo II em qui 03/12." · "… amanhã." (as AssessmentSheet says it)
      const when = formatDay(item.date, today);
      return when === 'hoje' || when === 'amanhã' ? `${item.title} ${when}.` : `${item.title} em ${when}.`;
    }
    return `Capturada: ${item.title}`;
  }
  return `Compromisso salvo: ${item.title} · ${formatDay(item.date, today)} ${item.start}`;
}

/** The field changes name and example with the type; "Capturar" stays the name of Tarefa's. */
const FIELD: Record<CaptureKind, { label: string; placeholder: string }> = {
  tarefa: { label: 'Capturar', placeholder: 'O que precisa fazer?' },
  compromisso: { label: 'O que é?', placeholder: 'O que é? Ex.: Dentista' },
  avaliacao: { label: 'Conteúdo (opcional)', placeholder: 'Conteúdo (opcional). Ex.: integrais por partes' },
  card: { label: 'Frente do card', placeholder: 'Frente do card. Ex.: O que é um índice composto?' },
};

const NO_DECKS: Deck[] = [];

export interface CaptureFormProps {
  defaultDate?: DayKey;
  autoFocus?: boolean;
  /** Esc inside the field (the sheet handles Esc itself; inline hosts such as the Painel use this). */
  onEscape?(): void;
}

/**
 * "Escrever e tocar": the type on top, the field (several lines = several items in Tarefa and Card),
 * one option row per choice with its panel inside the form. Only Salvar (or Enter in the field) writes.
 * Layout-agnostic so the Painel can render it inline.
 */
export function CaptureForm({ defaultDate, autoFocus, onEscape }: CaptureFormProps) {
  const today = useToday() ?? dayKeyOf(Date.now(), 4);
  const allAreas = useAreas();
  const journeys = useJourneys();
  const decks = useLiveQuery(
    async () => (await db.decks.orderBy('order').toArray()).filter((d) => !d.deleted && !d.archived),
  ) ?? NO_DECKS;
  const areas = useMemo(() => allAreas.filter((a) => !a.archived), [allAreas]);
  const ctx = useMemo<CaptureCtx>(
    () => ({ today, defaultDate, journeys, areas, decks }), [today, defaultDate, journeys, areas, decks],
  );
  const [state, setState] = useState<CaptureState>(() => initialState(readDraft()));
  const [openRow, setOpenRow] = useState<RowId>();
  const [alertText, setAlertText] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const ref = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(state.text);
  textRef.current = state.text;
  const view = useMemo(() => prefill(state, ctx), [state, ctx]);

  // The restored draft now lives in the field; back in the foreground, the field holds it again.
  useEffect(() => {
    writeDraft('');
    const onVisible = () => { if (document.visibilityState === 'visible') writeDraft(''); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  // Only a form with text writes (an empty inline form must not erase the sheet's draft).
  usePageHide(() => { if (textRef.current.trim()) writeDraft(textRef.current); });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [state.text]);

  useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(undefined), FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [feedback]);

  const update = (next: (s: CaptureState) => CaptureState) => {
    setState(next);
    setAlertText(undefined);
    setFeedback(undefined);
  };
  const changeText = (value: string) =>
    update((s) => ({ ...s, text: s.kindTouched && isSingleLineKind(s.kind) ? joinLines(value) : value }));
  const choose: ChooseFn = (section, field, value) => update((s) => chooseOption(s, section, field, value));
  const pickKind = (kind: CaptureKind) => {
    update((s) => chooseKind(s, kind));
    setOpenRow(undefined);
  };
  const toggleRow = (id: RowId) => setOpenRow((cur) => (cur === id ? undefined : id));

  const save = async () => {
    const problem = missing(state, ctx);
    if (problem) {
      setAlertText(problem);
      return;
    }
    const requests = buildRequests(state, ctx);
    const kept = state;
    setState(initialState());
    setOpenRow(undefined);
    ref.current?.focus();
    try {
      setFeedback(feedbackFor(await saveCaptureRequests(requests), today));
    } catch (e) {
      setState(kept);
      if (e instanceof FacultyValidationError) {
        setAlertText(e.message);
        return;
      }
      console.error('capture failed', e);
      useToast.getState().show('Não foi possível salvar. Tente de novo.');
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter breaks the line only where several lines make sense (Tarefa, Card).
    if (e.key === 'Enter' && (!e.shiftKey || isSingleLineKind(view.kind)) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape' && onEscape) {
      e.stopPropagation();
      onEscape();
    }
  };

  const many = view.lines.length > 1 && (view.kind === 'tarefa' || view.kind === 'card');
  const hint = many
    ? view.kind === 'card'
      ? `${view.lines.length} rascunhos de card serão criados, um por linha. As escolhas abaixo valem para todas.`
      : `${view.lines.length} tarefas serão criadas, uma por linha. As escolhas abaixo valem para todas.`
    : view.kind === 'card' ? 'Vira rascunho de card. Complete depois na aba Estudo.' : undefined;

  return (
    <form className="capture" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <CaptureKindPicker value={view.kind} onChange={pickKind} />
      <textarea
        ref={ref}
        className="capture__input"
        rows={1}
        aria-label={FIELD[view.kind].label}
        placeholder={FIELD[view.kind].placeholder}
        value={state.text}
        onChange={(e) => changeText(e.target.value)}
        onKeyDown={onKeyDown}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        enterKeyHint="done"
        autoComplete="off"
        autoCapitalize="sentences"
      />
      {hint && <p className="capture__hint">{hint}</p>}
      <CaptureOptions view={view} ctx={ctx} openRow={openRow} onToggleRow={toggleRow} choose={choose}
        onLeave={() => useCaptureStore.getState().close()} />
      {alertText && <p className="capture__alert" role="alert">{alertText}</p>}
      <div className="capture__actions">
        <Button type="submit" variant="primary" icon="check">Salvar</Button>
      </div>
      <p className="capture__feedback" role="status">{feedback}</p>
    </form>
  );
}
