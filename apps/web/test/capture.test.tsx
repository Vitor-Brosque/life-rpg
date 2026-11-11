import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { CaptureBar } from '../src/features/capture/CaptureBar';
import { formatDay, formatDuration } from '../src/ui/format';

beforeEach(async () => {
  // setImmediate stays real: fake-indexeddb schedules transaction work with it.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 10, 0));
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => {
  vi.useRealTimers();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
const liveMissions = async () => (await db.missions.toArray()).filter((m) => !m.deleted);

describe('format helpers', () => {
  it('formats durations as chips', () => {
    expect(formatDuration(20)).toBe('20 min');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h30');
    expect(formatDuration(65)).toBe('1h05');
  });

  it('formats days relative to today', () => {
    expect(formatDay('2026-11-11', '2026-11-11')).toBe('hoje');
    expect(formatDay('2026-11-12', '2026-11-11')).toBe('amanhã');
    expect(formatDay('2026-11-17', '2026-11-11')).toBe('ter 17/11');
  });
});

describe('CaptureBar', () => {
  it('shows live chips and Enter saves a mission with duration and date', async () => {
    const user = setup();
    render(<CaptureBar open onClose={() => {}} />);
    const input = await screen.findByRole('textbox', { name: 'Capturar' });
    expect(input).toHaveFocus();
    await user.type(input, 'ler 20min amanhã');
    expect(await screen.findByText('20 min')).toBeInTheDocument();
    expect(screen.getByText('amanhã')).toBeInTheDocument();

    await user.keyboard('{Enter}');
    await waitFor(async () => {
      const ms = await liveMissions();
      expect(ms).toHaveLength(1);
      expect(ms[0]).toMatchObject({ title: 'ler', durationMin: 20, date: '2026-11-12' });
    });
    expect(input).toHaveValue('');
    expect(await screen.findByText(/Capturada/)).toBeInTheDocument();
  });

  it('Shift+Enter adds a new line instead of saving', async () => {
    const user = setup();
    render(<CaptureBar open onClose={() => {}} />);
    const input = await screen.findByRole('textbox', { name: 'Capturar' });
    await user.type(input, 'um{Shift>}{Enter}{/Shift}dois');
    expect(input).toHaveValue('um\ndois');
    expect(await liveMissions()).toHaveLength(0);
    await user.keyboard('{Enter}');
    await waitFor(async () => expect((await liveMissions()).map((m) => m.title).sort()).toEqual(['dois', 'um']));
  });

  it('a time suggests a commitment; toggling to Missão creates a mission instead', async () => {
    const user = setup();
    render(<CaptureBar open onClose={() => {}} />);
    const input = await screen.findByRole('textbox', { name: 'Capturar' });
    await user.type(input, 'dentista 15h');
    const commitment = await screen.findByRole('button', { name: 'Compromisso' });
    expect(commitment).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Missão' }));
    expect(screen.getByRole('button', { name: 'Missão' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(input);
    await user.keyboard('{Enter}');
    await waitFor(async () => {
      const ms = await liveMissions();
      expect(ms).toHaveLength(1);
      expect(ms[0]).toMatchObject({ title: 'dentista', date: '2026-11-11' });
    });
    expect(await db.commitments.count()).toBe(0);
  });

  it('keeps the commitment when not toggled', async () => {
    const user = setup();
    render(<CaptureBar open onClose={() => {}} />);
    const input = await screen.findByRole('textbox', { name: 'Capturar' });
    await user.type(input, 'dentista 15h{Enter}');
    await waitFor(async () => expect(await db.commitments.count()).toBe(1));
    expect(await liveMissions()).toHaveLength(0);
  });

  it('quick details after saving update the created mission', async () => {
    const user = setup();
    render(<CaptureBar open onClose={() => {}} />);
    const input = await screen.findByRole('textbox', { name: 'Capturar' });
    await user.type(input, 'arrumar a mesa{Enter}');
    const quick = await screen.findByRole('group', { name: 'Detalhes rápidos' });
    await user.click(await screen.findByRole('button', { name: '15 min' }));
    await user.click(screen.getByRole('button', { name: 'pesada' }));
    await waitFor(async () => {
      const [m] = await liveMissions();
      expect(m).toMatchObject({ durationMin: 15, energy: 'heavy' });
    });
    expect(quick).toBeInTheDocument();
  });

  it('defaultDate applies to captures without a date', async () => {
    const user = setup();
    render(<CaptureBar open onClose={() => {}} defaultDate="2026-11-20" />);
    const input = await screen.findByRole('textbox', { name: 'Capturar' });
    await user.type(input, 'comprar pão{Enter}');
    await waitFor(async () => expect((await liveMissions())[0]?.date).toBe('2026-11-20'));
  });

  it('removing a chip removes its token from the text', async () => {
    const user = setup();
    render(<CaptureBar open onClose={() => {}} />);
    const input = await screen.findByRole('textbox', { name: 'Capturar' });
    await user.type(input, 'ler 20min amanhã');
    await user.click(await screen.findByRole('button', { name: 'Remover amanhã' }));
    expect(input).toHaveValue('ler 20min');
  });

  it('a half-typed capture survives the page being unloaded (saved when the page hides)', async () => {
    const user = setup();
    const first = render(<CaptureBar open onClose={() => {}} />);
    await user.type(await screen.findByRole('textbox', { name: 'Capturar' }), 'ligar para a Ana');
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    first.unmount(); // the page goes away (e.g. reloaded by an app update)

    const second = render(<CaptureBar open onClose={() => {}} />);
    expect(await screen.findByRole('textbox', { name: 'Capturar' })).toHaveValue('ligar para a Ana');
    second.unmount();
    // Restored once: the next capture starts empty.
    render(<CaptureBar open onClose={() => {}} />);
    expect(await screen.findByRole('textbox', { name: 'Capturar' })).toHaveValue('');
    expect(await liveMissions()).toHaveLength(0);
  });

  it('coming back to the page keeps the draft in the field only', async () => {
    const user = setup();
    const first = render(<CaptureBar open onClose={() => {}} />);
    await user.type(await screen.findByRole('textbox', { name: 'Capturar' }), 'pagar a luz');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.getByRole('textbox', { name: 'Capturar' })).toHaveValue('pagar a luz');
    first.unmount(); // closed on purpose: nothing comes back next time
    render(<CaptureBar open onClose={() => {}} />);
    expect(await screen.findByRole('textbox', { name: 'Capturar' })).toHaveValue('');
  });
});
