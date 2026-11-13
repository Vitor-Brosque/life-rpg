import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sketch, Stroke } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import * as actions from '../src/domain/sketchActions';
import { usePersistedSketch } from '../src/features/sketch/usePersistedSketch';
import { FAILURE_TOAST } from '../src/ui/safeRun';
import { useToast } from '../src/ui/Toast';

vi.mock('../src/domain/sketchActions', async (orig) => {
  const real = await orig<typeof import('../src/domain/sketchActions')>();
  return { ...real, saveSketchStrokes: vi.fn(real.saveSketchStrokes) };
});

const real = () => vi.importActual<typeof import('../src/domain/sketchActions')>('../src/domain/sketchActions');
const dot = (x: number): Stroke => ({ c: 0, w: 0, p: [x, x] });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
  vi.mocked(actions.saveSketchStrokes).mockClear();
});
afterEach(() => { vi.useRealTimers(); });

/** Writes a newer version "from another device". */
async function remote(id: string, strokes: Stroke[]): Promise<void> {
  vi.setSystemTime(Date.now() + 60_000);
  await (await real()).saveSketchStrokes(id, strokes);
}

describe('usePersistedSketch adoption guard', () => {
  it('does not adopt a remote version during a gesture, then adopts it when the gesture ends', async () => {
    const s = await actions.createSketch({ strokes: [dot(5)] });
    const { result } = renderHook(() => usePersistedSketch(s.id));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.onGestureChange(true));
    await remote(s.id, [dot(1), dot(2), dot(3)]);
    await waitFor(() => expect(result.current.sketch?.strokes).toHaveLength(3));
    expect(result.current.padKey).toBe(0);
    expect(result.current.initial).toEqual([dot(5)]);
    act(() => result.current.onGestureChange(false));
    await waitFor(() => expect(result.current.padKey).toBe(1));
    expect(result.current.initial).toEqual([dot(1), dot(2), dot(3)]);
  });

  it('does not adopt while a write is in flight, then adopts once it settles', async () => {
    const s = await actions.createSketch({ strokes: [dot(5)] });
    const { result } = renderHook(() => usePersistedSketch(s.id));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const impl = (await real()).saveSketchStrokes;
    vi.mocked(actions.saveSketchStrokes).mockImplementationOnce(async (id, strokes) => {
      await gate;
      return impl(id, strokes) as Promise<Sketch>;
    });
    act(() => result.current.onChange([dot(5), dot(9)]));
    await remote(s.id, [dot(1), dot(2), dot(3)]);
    await waitFor(() => expect(result.current.sketch?.strokes).toHaveLength(3));
    expect(result.current.padKey).toBe(0);
    await act(async () => { release(); await gate; });
    // the held write lands last and wins (last writer wins); no stale remote adoption happens in between
    await waitFor(async () => expect((await db.sketches.get(s.id))!.strokes).toEqual([dot(5), dot(9)]));
  });

  it('shows the failure toast when a save fails', async () => {
    const s = await actions.createSketch({ strokes: [dot(5)] });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const show = vi.spyOn(useToast.getState(), 'show');
    const { result } = renderHook(() => usePersistedSketch(s.id));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    vi.mocked(actions.saveSketchStrokes).mockRejectedValueOnce(new Error('boom'));
    act(() => result.current.onChange([dot(5), dot(9)]));
    await waitFor(() => expect(show).toHaveBeenCalledWith(FAILURE_TOAST));
    err.mockRestore(); show.mockRestore();
  });

  it('resets when the id changes', async () => {
    const a = await actions.createSketch({ strokes: [dot(1)] });
    const b = await actions.createSketch({ strokes: [dot(2), dot(3)] });
    const { result, rerender } = renderHook(({ id }) => usePersistedSketch(id), { initialProps: { id: a.id } });
    await waitFor(() => expect(result.current.initial).toEqual([dot(1)]));
    rerender({ id: b.id });
    await waitFor(() => expect(result.current.initial).toEqual([dot(2), dot(3)]));
    expect(result.current.sketch?.id).toBe(b.id);
  });
});
