import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { useNow, useToday } from '../src/db/hooks';
import { ensureSeed } from '../src/db/seed';

function TodayProbe({ id = 'today' }: { id?: string }) {
  const today = useToday();
  return <p data-testid={id}>{today ?? '…'}</p>;
}

function NowProbe() {
  useNow();
  return null;
}

const setVisibility = (state: DocumentVisibilityState) =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });

beforeEach(async () => {
  // Only Date is faked: fake-indexeddb needs the real setImmediate/setTimeout.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 23, 50));
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

// The day starts at 04:00 (seed): 05:00 on the 12th is already logical day 2026-11-12.
const nextMorning = () => vi.setSystemTime(new Date(2026, 10, 12, 5, 0));

describe('shared clock (useNow)', () => {
  it('useToday moves to the new day as soon as the app becomes visible again', async () => {
    render(<TodayProbe />);
    expect(await screen.findByText('2026-11-11')).toBeInTheDocument();
    nextMorning();
    setVisibility('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.getByTestId('today')).toHaveTextContent('2026-11-12');
  });

  it('also refreshes on pageshow and focus', async () => {
    render(<TodayProbe />);
    expect(await screen.findByText('2026-11-11')).toBeInTheDocument();
    nextMorning();
    act(() => { window.dispatchEvent(new Event('pageshow')); });
    expect(screen.getByTestId('today')).toHaveTextContent('2026-11-12');

    vi.setSystemTime(new Date(2026, 10, 13, 5, 0));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(screen.getByTestId('today')).toHaveTextContent('2026-11-13');
  });

  it('a hidden page does not refresh, and every consumer reads the same clock', async () => {
    render(<><TodayProbe id="a" /><TodayProbe id="b" /></>);
    expect(await screen.findAllByText('2026-11-11')).toHaveLength(2);
    nextMorning();
    setVisibility('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.getByTestId('a')).toHaveTextContent('2026-11-11');
    setVisibility('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.getByTestId('a')).toHaveTextContent('2026-11-12');
    expect(screen.getByTestId('b')).toHaveTextContent('2026-11-12');
  });

  it('runs a single 30 s interval no matter how many components use it', () => {
    const spy = vi.spyOn(window, 'setInterval');
    const { unmount } = render(<><NowProbe /><NowProbe /><NowProbe /></>);
    expect(spy.mock.calls.filter(([, ms]) => ms === 30_000)).toHaveLength(1);
    unmount();
  });
});
