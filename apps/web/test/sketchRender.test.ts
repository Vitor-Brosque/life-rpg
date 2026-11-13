import { describe, expect, it } from 'vitest';
import type { Stroke } from '@life/shared';
import { drawScene, traceStroke, type Inks } from '../src/features/sketch/render';

type Call = [string, ...number[]];

/** A context that records the path calls (jsdom has no canvas). */
function fakeCtx() {
  const calls: Call[] = [];
  const styles: string[] = [];
  const rec = (name: string) => (...args: number[]) => { calls.push([name, ...args]); };
  const ctx = {
    calls, styles,
    beginPath: rec('beginPath'), moveTo: rec('moveTo'), lineTo: rec('lineTo'), quadraticCurveTo: rec('quadraticCurveTo'),
    arc: rec('arc'), fill: rec('fill'), stroke: rec('stroke'), setTransform: rec('setTransform'), clearRect: rec('clearRect'),
    fillRect: rec('fillRect'), lineCap: '', lineJoin: '', lineWidth: 0, fillStyle: '',
    set strokeStyle(v: string) { styles.push(v); },
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[]; styles: string[] };
}

const inks: Inks = { colors: ['#c0', '#c1', '#c2', '#c3'], grid: '#grid' };
const pathOf = (calls: Call[]) => calls.filter(([n]) => !['setTransform', 'clearRect', 'fillRect'].includes(n));

describe('traceStroke', () => {
  it('one point is a dot (a circle of half the width)', () => {
    const ctx = fakeCtx();
    expect(traceStroke(ctx, { c: 0, w: 1, p: [5, 6] })).toBe('dot');
    expect(ctx.calls).toEqual([['beginPath'], ['arc', 5, 6, 3, 0, Math.PI * 2]]);
  });
  it('two points are a segment', () => {
    const ctx = fakeCtx();
    expect(traceStroke(ctx, { c: 0, w: 0, p: [0, 0, 10, 0] })).toBe('line');
    expect(ctx.calls).toEqual([['beginPath'], ['moveTo', 0, 0], ['lineTo', 10, 0]]);
  });
  it('more points are quadratic curves through the midpoints', () => {
    const ctx = fakeCtx();
    traceStroke(ctx, { c: 0, w: 0, p: [0, 0, 10, 0, 20, 10, 30, 10] });
    expect(ctx.calls).toEqual([
      ['beginPath'], ['moveTo', 0, 0], ['quadraticCurveTo', 10, 0, 15, 5], ['quadraticCurveTo', 20, 10, 25, 10], ['lineTo', 30, 10],
    ]);
  });
});

describe('drawScene', () => {
  const view = { x: 0, y: 0, zoom: 1 };
  it('draws only the strokes that cross the view, in their ink, plus the one being drawn', () => {
    const ctx = fakeCtx();
    const near: Stroke = { c: 2, w: 0, p: [10, 10, 20, 20] };
    const far: Stroke = { c: 1, w: 0, p: [5000, 5000, 5010, 5010] };
    drawScene(ctx, { strokes: [near, far], current: { c: 3, w: 1, p: [50, 50, 60, 60] }, view, w: 300, h: 200, dpr: 2, inks });
    expect(pathOf(ctx.calls).filter(([n]) => n === 'moveTo')).toEqual([['moveTo', 10, 10], ['moveTo', 50, 50]]);
    expect(ctx.styles).toEqual(['#c2', '#c3']);
    expect(ctx.calls[0]).toEqual(['setTransform', 2, 0, 0, 2, 0, 0]);
  });
  it('draws a dot grid every 24 units at zoom 1 (117 dots in 300 × 200)', () => {
    const ctx = fakeCtx();
    drawScene(ctx, { strokes: [], view, w: 300, h: 200, dpr: 1, inks });
    expect(ctx.calls.filter(([n]) => n === 'fillRect')).toHaveLength(13 * 9);
  });
  it('spreads the grid to 96 units when 24 would be under 12 px', () => {
    const ctx = fakeCtx();
    drawScene(ctx, { strokes: [], view: { x: 0, y: 0, zoom: 0.25 }, w: 300, h: 200, dpr: 1, inks });
    // world 1200 × 800 → x 0..1152 (13), y 0..768 (9)
    expect(ctx.calls.filter(([n]) => n === 'fillRect')).toHaveLength(13 * 9);
  });
});
