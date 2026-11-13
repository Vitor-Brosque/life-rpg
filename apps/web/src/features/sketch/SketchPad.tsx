import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { InkColor, InkWidth, Pt, SketchView, Stroke } from '@life/shared';
import {
  DEFAULT_VIEW, ERASER_PX, MIN_STEP_PX, STROKE_MAX_POINTS, canAddStroke, eraseAlong, finishStroke, fitView, panBy,
  pinchView, sketchBounds, toWorld, zoomAt,
} from '@life/shared';
import type { IconName } from '../../art/icons';
import { Button } from '../../ui/Button';
import { plural } from '../../ui/format';
import { drawScene, readInks, type Inks } from './render';
import './sketch.css';

export type SketchTool = 'pen' | 'eraser' | 'pan';
export const INK_NAMES = ['Branco', 'Azul', 'Verde', 'Amarelo'] as const;
export const FULL_MESSAGE = 'Esta lousa está cheia. Apague alguns traços ou comece outra lousa.';
const WIDTH_NAMES = ['Traço fino', 'Traço grosso'] as const;
const TOOLS: Array<{ tool: SketchTool; label: string; icon: IconName }> = [
  { tool: 'pen', label: 'Caneta', icon: 'pen' },
  { tool: 'eraser', label: 'Borracha', icon: 'eraser' },
  { tool: 'pan', label: 'Mover', icon: 'move' },
];
const HISTORY_MAX = 100;
/** A stroke this short when a second finger lands was the start of a pinch, not a line. */
const PINCH_DROP_POINTS = 8;

type Draw = { kind: 'draw'; id: number; c: InkColor; w: InkWidth; raw: number[]; zoom: number };
type Erase = { kind: 'erase'; id: number; last: Pt; before: Stroke[] };
type Gesture =
  | { kind: 'idle' }
  | Draw
  | Erase
  | { kind: 'pan'; id: number; last: Pt }
  | { kind: 'pinch'; ids: [number, number]; start: SketchView; a0: Pt; b0: Pt };

export interface SketchPadProps {
  /** Strokes when mounted. Later changes are ignored: remount with a new `key` to replace them. */
  initial: Stroke[];
  /** After every committed change (stroke, eraser pass, undo, redo, clear). */
  onChange(strokes: Stroke[]): void;
  /** Accessible name, e.g. "Lousa" or "Desenho da resposta". */
  label: string;
  /** true from the first pointer down until the last pointer leaves. */
  onGestureChange?(active: boolean): void;
  /** Wheel without Ctrl pans (default). false leaves it to the page (the pad sits in a scrolling screen). */
  wheelPans?: boolean;
  /** Extra controls at the end of the toolbar. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Reusable drawing surface (spec §5): pen, whole-stroke eraser, pan and zoom (wheel, Ctrl+wheel,
 * middle button, two-finger pinch), undo/redo, clear, fit. Knows nothing about storage.
 */
export function SketchPad({ initial, onChange, label, onGestureChange, wheelPans = true, actions, className }: SketchPadProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const inks = useRef<Inks | null>(null);
  const strokes = useRef<Stroke[]>(initial);
  const view = useRef<SketchView>(DEFAULT_VIEW);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<Gesture>({ kind: 'idle' });
  const past = useRef<Stroke[][]>([]);
  const future = useRef<Stroke[][]>([]);
  const active = useRef(false);
  const frame = useRef(0);
  const cb = useRef({ onChange, onGestureChange, wheelPans });
  cb.current = { onChange, onGestureChange, wheelPans };
  const [tool, setTool] = useState<SketchTool>('pen');
  const [color, setColor] = useState<InkColor>(0);
  const [width, setWidth] = useState<InkWidth>(0);
  const [message, setMessage] = useState<'full' | 'cleared' | null>(null);
  const [, setVersion] = useState(0);

  // ---------------------------------------------------------------- painting

  const paint = (): void => {
    const canvas = canvasRef.current;
    if (!canvas || !inks.current) return;
    ctxRef.current ??= canvas.getContext('2d');
    const ctx = ctxRef.current;
    if (!ctx) return; // jsdom: no canvas
    const g = gesture.current;
    drawScene(ctx, {
      strokes: strokes.current, view: view.current, ...size.current, inks: inks.current,
      current: g.kind === 'draw' ? { c: g.c, w: g.w, p: g.raw } : undefined,
    });
  };
  const schedule = (): void => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; paint(); });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useLayoutEffect(() => {
    const area = areaRef.current;
    const canvas = canvasRef.current;
    if (!area || !canvas) return;
    inks.current = readInks(area);
    const measure = (): void => {
      const w = area.clientWidth;
      const h = area.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      // First real size: open fitted to the content.
      if (size.current.w === 0 && w > 0 && h > 0) view.current = fitView(sketchBounds(strokes.current), w, h);
      size.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      paint();
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return; // jsdom
    const ro = new ResizeObserver(measure);
    ro.observe(area);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- history

  const setActive = (on: boolean): void => {
    if (active.current === on) return;
    active.current = on;
    cb.current.onGestureChange?.(on);
  };
  const show = (next: Stroke[]): void => {
    strokes.current = next;
    setVersion((v) => v + 1);
    schedule();
    cb.current.onChange(next);
  };
  const commit = (next: Stroke[], before: Stroke[] = strokes.current): void => {
    past.current = [...past.current, before].slice(-HISTORY_MAX);
    future.current = [];
    setMessage(null);
    show(next);
  };
  const commitStroke = (g: Draw): void => {
    const p = finishStroke(g.raw, g.zoom);
    if (p.length >= 2) commit([...strokes.current, { c: g.c, w: g.w, p }]);
  };
  const commitErase = (g: Erase): void => {
    if (strokes.current !== g.before) commit(strokes.current, g.before);
  };
  const idle = (): boolean => gesture.current.kind === 'idle';
  const undo = (): void => {
    const prev = past.current[past.current.length - 1];
    if (!prev || !idle()) return;
    past.current = past.current.slice(0, -1);
    future.current = [...future.current, strokes.current];
    setMessage(null);
    show(prev);
  };
  const redo = (): void => {
    const next = future.current[future.current.length - 1];
    if (!next || !idle()) return;
    future.current = future.current.slice(0, -1);
    past.current = [...past.current, strokes.current].slice(-HISTORY_MAX);
    setMessage(null);
    show(next);
  };
  const clear = (): void => {
    if (strokes.current.length === 0 || !idle()) return;
    commit([]);
    setMessage('cleared');
  };
  const fit = (): void => {
    view.current = fitView(sketchBounds(strokes.current), size.current.w, size.current.h);
    schedule();
  };
  const zoomCenter = (factor: number): void => {
    view.current = zoomAt(view.current, size.current.w / 2, size.current.h / 2, factor);
    schedule();
  };

  // ---------------------------------------------------------------- pointers

  const local = (e: PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const eraseTo = (w: Pt): void => {
    const g = gesture.current;
    if (g.kind !== 'erase') return;
    const next = eraseAlong(strokes.current, g.last, w, ERASER_PX / view.current.zoom);
    g.last = w;
    if (next !== strokes.current) { strokes.current = next; schedule(); }
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    areaRef.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture?.(e.pointerId); // missing in jsdom
    const pt = local(e);
    pointers.current.set(e.pointerId, pt);
    const g = gesture.current;
    if (e.pointerType === 'touch' && pointers.current.size === 2) {
      // Second finger: a pinch. A stroke just started was its first finger and is dropped.
      if (g.kind === 'draw' && g.raw.length / 2 >= PINCH_DROP_POINTS) commitStroke(g);
      if (g.kind === 'erase') commitErase(g);
      const [[ia, a], [ib, b]] = [...pointers.current.entries()] as [[number, Pt], [number, Pt]];
      gesture.current = { kind: 'pinch', ids: [ia, ib], start: view.current, a0: a, b0: b };
      setActive(true);
      schedule();
      return;
    }
    if (pointers.current.size !== 1 || g.kind !== 'idle') return;
    if (tool === 'pan' || (e.pointerType === 'mouse' && e.button === 1)) {
      e.preventDefault(); // no middle-click autoscroll
      gesture.current = { kind: 'pan', id: e.pointerId, last: pt };
      setActive(true);
      return;
    }
    const w = toWorld(view.current, pt.x, pt.y);
    if (tool === 'eraser') {
      gesture.current = { kind: 'erase', id: e.pointerId, last: w, before: strokes.current };
      setActive(true);
      eraseTo(w);
      return;
    }
    if (!canAddStroke(strokes.current)) { setMessage('full'); return; }
    gesture.current = { kind: 'draw', id: e.pointerId, c: color, w: width, raw: [w.x, w.y], zoom: view.current.zoom };
    setActive(true);
    schedule();
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>): void => {
    if (!pointers.current.has(e.pointerId)) return;
    const pt = local(e);
    pointers.current.set(e.pointerId, pt);
    const g = gesture.current;
    if (g.kind === 'pinch') {
      const a = pointers.current.get(g.ids[0]);
      const b = pointers.current.get(g.ids[1]);
      if (a && b) { view.current = pinchView(g.start, g.a0, g.b0, a, b); schedule(); }
      return;
    }
    if (g.kind === 'idle' || g.id !== e.pointerId) return;
    if (g.kind === 'pan') {
      view.current = panBy(view.current, pt.x - g.last.x, pt.y - g.last.y);
      g.last = pt;
      schedule();
      return;
    }
    const w = toWorld(view.current, pt.x, pt.y);
    if (g.kind === 'erase') { eraseTo(w); return; }
    const n = g.raw.length;
    if (Math.hypot(w.x - g.raw[n - 2]!, w.y - g.raw[n - 1]!) * view.current.zoom < MIN_STEP_PX) return;
    g.raw.push(w.x, w.y);
    if (g.raw.length / 2 >= STROKE_MAX_POINTS) {
      // A very long stroke goes on as a new one from the same point.
      commitStroke(g);
      if (canAddStroke(strokes.current)) gesture.current = { ...g, raw: [w.x, w.y] };
      else { gesture.current = { kind: 'idle' }; setMessage('full'); }
    }
    schedule();
  };

  const onPointerEnd = (e: PointerEvent<HTMLCanvasElement>, cancelled: boolean): void => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (g.kind === 'pinch') {
      // The finger left behind does nothing until it lifts too.
      if (g.ids.includes(e.pointerId)) gesture.current = { kind: 'idle' };
    } else if (g.kind !== 'idle' && g.id === e.pointerId) {
      if (g.kind === 'draw' && !cancelled) commitStroke(g);
      if (g.kind === 'erase') commitErase(g);
      gesture.current = { kind: 'idle' };
      schedule();
    }
    if (pointers.current.size === 0) setActive(false);
  };

  // ---------------------------------------------------------------- wheel and keys

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Native, non-passive listener: React's onWheel cannot preventDefault.
    const onWheel = (e: WheelEvent): void => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.current.h : 1;
      const r = canvas.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) { // Ctrl+wheel, or a trackpad pinch
        e.preventDefault();
        const d = Math.max(-50, Math.min(50, e.deltaY * unit));
        view.current = zoomAt(view.current, e.clientX - r.left, e.clientY - r.top, Math.exp(-d * 0.006));
        schedule();
        return;
      }
      if (!cb.current.wheelPans) return; // the page scrolls
      e.preventDefault();
      const sideways = e.shiftKey && e.deltaX === 0;
      view.current = panBy(view.current, -(sideways ? e.deltaY : e.deltaX) * unit, -(sideways ? 0 : e.deltaY) * unit);
      schedule();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && key === 'y') { e.preventDefault(); redo(); }
    else if (mod || e.altKey) return;
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomCenter(1.25); }
    else if (e.key === '-') { e.preventDefault(); zoomCenter(0.8); }
    else if (e.key === '0') { e.preventDefault(); fit(); }
  };

  // ---------------------------------------------------------------- markup

  const n = strokes.current.length;
  const pickInk = (c: InkColor): void => { setColor(c); setTool('pen'); };
  const pickWidth = (w: InkWidth): void => { setWidth(w); setTool('pen'); };
  return (
    <div className={['sketch', className].filter(Boolean).join(' ')} role="group" aria-label={label} onKeyDown={onKeyDown}>
      <div className="sketch__bar" role="toolbar" aria-label="Ferramentas da lousa">
        {TOOLS.map((t) => (
          <Button key={t.tool} size="sm" variant="ghost" icon={t.icon} aria-label={t.label} aria-pressed={tool === t.tool}
            onClick={() => setTool(t.tool)} />
        ))}
        <Button size="sm" variant="ghost" icon="undo" aria-label="Desfazer na lousa" aria-keyshortcuts="Control+Z"
          disabled={past.current.length === 0} onClick={undo} />
        <Button size="sm" variant="ghost" icon="redo" aria-label="Refazer na lousa" aria-keyshortcuts="Control+Shift+Z"
          disabled={future.current.length === 0} onClick={redo} />
        <Button size="sm" variant="ghost" icon="fit" aria-label="Ajustar à tela" aria-keyshortcuts="0" onClick={fit} />
        <Button size="sm" variant="ghost" icon="trash" aria-label="Limpar lousa" disabled={n === 0} onClick={clear} />
        <div className="sketch__inks" role="group" aria-label="Cor e espessura">
          {INK_NAMES.map((name, i) => (
            <button key={name} type="button" className={`sketch__swatch sketch__swatch--${i}`} aria-label={name}
              aria-pressed={tool === 'pen' && color === i} onClick={() => pickInk(i as InkColor)} />
          ))}
          {WIDTH_NAMES.map((name, i) => (
            <button key={name} type="button" className="sketch__width" aria-label={name}
              aria-pressed={tool === 'pen' && width === i} onClick={() => pickWidth(i as InkWidth)}>
              <span className={`sketch__line sketch__line--${i}`} />
            </button>
          ))}
        </div>
        {actions}
      </div>
      <div ref={areaRef} className={`sketch__area sketch__area--${tool}`} tabIndex={0}>
        <canvas
          ref={canvasRef} className="sketch__canvas" role="img" aria-label={`${label}: ${plural(n, 'traço', 'traços')}`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={(e) => onPointerEnd(e, false)} onPointerCancel={(e) => onPointerEnd(e, true)}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
      <p className="sketch__msg" role="status">
        {message === 'full' && FULL_MESSAGE}
        {message === 'cleared' && (
          <>Lousa limpa. <Button size="sm" variant="ghost" aria-label="Desfazer a limpeza" onClick={undo}>Desfazer</Button></>
        )}
      </p>
    </div>
  );
}
