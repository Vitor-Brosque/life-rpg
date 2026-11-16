import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { create } from 'zustand';
import type { CaptureToken, DayKey, Mission } from '@life/shared';
import { dayKeyOf, parseCapture } from '@life/shared';
import { useAreas, useToday } from '../../db/hooks';
import { isCardCapture } from '../../domain/studyActions';
import { Button } from '../../ui/Button';
import { formatDay, plural } from '../../ui/format';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { usePageHide } from '../../ui/usePageHide';
import { CaptureChips, QuickDetails } from './CaptureChips';
import { removeSpans } from './captureModel';
import { isCardDraft, isMission, saveCapture, type Captured } from './captureSave';
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

const QUICK_DETAILS_MS = 6000;

/**
 * A half-typed capture is kept here while the page is hidden, so an app reload (update) or the
 * phone killing the app in the background does not lose it. Restored once, by the next form.
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

interface Feedback { key: number; message: string; mission?: Mission }

function feedbackFor(items: Captured[], today: DayKey): Omit<Feedback, 'key'> | undefined {
  if (items.length === 0) return undefined;
  if (items.length > 1) return { message: `${plural(items.length, 'item capturado', 'itens capturados')}.` };
  const item = items[0]!;
  if (isCardDraft(item)) return { message: 'Rascunho de card salvo. Complete na aba Estudo.' };
  if (isMission(item)) return { message: `Capturada: ${item.title}`, mission: item };
  return { message: `Compromisso salvo: ${item.title} · ${formatDay(item.date, today)} ${item.start}` };
}

export interface CaptureFormProps {
  defaultDate?: DayKey;
  autoFocus?: boolean;
  /** Esc inside the field (the sheet handles Esc itself; inline hosts such as the Painel use this). */
  onEscape?(): void;
}

/**
 * One-line capture: auto-growing textarea (multi-line paste creates one item per line), live
 * chips, Enter saves (Shift+Enter = new line), then optional quick details for 6 s.
 * Layout-agnostic so the Painel can render it inline.
 */
export function CaptureForm({ defaultDate, autoFocus, onEscape }: CaptureFormProps) {
  const today = useToday() ?? dayKeyOf(Date.now(), 4);
  const areas = useAreas().filter((a) => !a.archived);
  const [text, setText] = useState(readDraft);
  const [asMission, setAsMission] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const [activity, setActivity] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  textRef.current = text;

  // The restored draft now lives in the field; back in the foreground, the field holds it again.
  useEffect(() => {
    writeDraft('');
    const onVisible = () => { if (document.visibilityState === 'visible') writeDraft(''); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  // Only a form with text writes (an empty inline form must not erase the sheet's draft).
  usePageHide(() => { if (textRef.current.trim()) writeDraft(textRef.current); });

  const lines = useMemo(() => text.split(/\r?\n/).filter((l) => l.trim() !== ''), [text]);
  const cardLine = lines.length === 1 && isCardCapture(lines[0]!);
  const single = useMemo(
    () => (lines.length === 1 && !isCardCapture(lines[0]!) ? parseCapture(lines[0]!, today) : undefined),
    [lines, today],
  );
  const canSave = lines.length > 1 || cardLine || (single !== undefined && single.title !== '');

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(undefined), QUICK_DETAILS_MS);
    return () => clearTimeout(id);
  }, [feedback, activity]);

  const change = (value: string) => {
    setText(value);
    if (value.trim() === '') setAsMission(false);
    else setFeedback(undefined);
  };

  const save = async () => {
    if (!canSave) return;
    const draft = text;
    setText('');
    setAsMission(false);
    ref.current?.focus();
    try {
      const items = await saveCapture(draft, { today, asMission, defaultDate });
      const fb = feedbackFor(items, today);
      setFeedback(fb ? { ...fb, key: Date.now() } : undefined);
    } catch (e) {
      console.error('capture failed', e);
      setText(draft);
      useToast.getState().show('Não foi possível salvar. Tente de novo.');
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape' && onEscape) {
      e.stopPropagation();
      onEscape();
    }
  };

  // Token offsets refer to the single non-empty line (the text may carry blank lines around it).
  const removeToken = (t: CaptureToken) => change(removeSpans(lines[0] ?? '', [t]));

  return (
    <form className="capture" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="capture__row">
        <textarea
          ref={ref}
          className="capture__input"
          rows={1}
          aria-label="Capturar"
          placeholder="O que está na sua cabeça?"
          value={text}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="sentences"
        />
        <Button type="submit" variant="primary" icon="check" aria-label="Salvar" disabled={!canSave} />
      </div>
      {defaultDate && <p className="capture__hint">Para {formatDay(defaultDate, today)}</p>}
      {cardLine ? (
        <p className="capture__hint">Vira rascunho de card. Complete depois na aba Estudo.</p>
      ) : single ? (
        <CaptureChips
          parsed={single}
          today={today}
          areas={areas}
          asMission={asMission}
          onToggleKind={setAsMission}
          onRemoveToken={removeToken}
        />
      ) : lines.length > 1 ? (
        <p className="capture__hint">{lines.length} itens serão criados, um por linha.</p>
      ) : !feedback ? (
        <p className="capture__hint">Experimente: amanhã · 15h · 20min · #jornada · @área · !</p>
      ) : null}
      <p className="capture__feedback" role="status">{feedback?.message}</p>
      {feedback?.mission && (
        <QuickDetails
          key={feedback.key}
          mission={feedback.mission}
          areas={areas}
          onActivity={() => setActivity((n) => n + 1)}
        />
      )}
    </form>
  );
}
