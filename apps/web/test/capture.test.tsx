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

  it('a time suggests a commitment; tapping Tarefa creates a task instead', async () => {
    const user = setup();
    render(<CaptureBar open onClose={() => {}} />);
    const input = await screen.findByRole('textbox', { name: 'Capturar' });
    await user.type(input, 'dentista 15h');
    const commitment = await screen.findByRole('button', { name: 'Compromisso' });
    expect(commitment).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Tarefa' }));
    expect(screen.getByRole('button', { name: 'Tarefa' })).toHaveAttribute('aria-pressed', 'true');
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

  it('Duração e Energia tocadas antes de salvar vão para a tarefa', async () => {
    const user = setup();
    render(<CaptureBar open onClose={() => {}} />);
    const input = await screen.findByRole('textbox', { name: 'Capturar' });
    await user.type(input, 'arrumar a mesa');
    await user.click(screen.getByRole('button', { name: 'Duração: —' }));
    await user.click(screen.getByRole('button', { name: '15 min' }));
    await user.click(screen.getByRole('button', { name: 'Energia: —' }));
    await user.click(screen.getByRole('button', { name: 'pesada' }));
    expect(await liveMissions()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => {
      const [m] = await liveMissions();
      expect(m).toMatchObject({ title: 'arrumar a mesa', durationMin: 15, energy: 'heavy' });
    });
    expect(screen.queryByRole('group', { name: 'Detalhes rápidos' })).not.toBeInTheDocument();
  });

  it('defaultDate applies to captures without a date', async () => {
    const user = setup();
    render(<CaptureBar open onClose={() => {}} defaultDate="2026-11-20" />);
    const input = await screen.findByRole('textbox', { name: 'Capturar' });
    await user.type(input, 'comprar pão{Enter}');
    await waitFor(async () => expect((await liveMissions())[0]?.date).toBe('2026-11-20'));
  });

  it('um toque em Quando vence a data escrita (o texto não muda)', async () => {
    const user = setup();
    render(<CaptureBar open onClose={() => {}} />);
    const input = await screen.findByRole('textbox', { name: 'Capturar' });
    await user.type(input, 'ler 20min amanhã');
    await user.click(screen.getByRole('button', { name: 'Quando: amanhã' }));
    await user.click(screen.getByRole('button', { name: 'Hoje' }));
    expect(screen.getByRole('button', { name: 'Quando: hoje' })).toBeInTheDocument();
    expect(input).toHaveValue('ler 20min amanhã');
    await user.click(input);
    await user.keyboard('{Enter}');
    await waitFor(async () => {
      expect((await liveMissions())[0]).toMatchObject({ title: 'ler', durationMin: 20, date: '2026-11-11' });
    });
  });

  it('"toda seg" acende Repetir e salva a missão recorrente na próxima segunda', async () => {
    const user = setup();
    render(<CaptureBar open onClose={() => {}} />);
    const input = await screen.findByRole('textbox', { name: 'Capturar' });
    await user.type(input, 'lavar roupa toda seg');
    expect(await screen.findByRole('button', { name: 'Repetir: toda seg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quando: seg 16/11' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(async () => {
      const ms = await liveMissions();
      expect(ms).toHaveLength(1);
      expect(ms[0]).toMatchObject({
        title: 'lavar roupa', recurrence: { kind: 'weekly', weekdays: [1] }, date: '2026-11-16',
      });
    });
  });

  it('"todo dia 5" acende Repetir e salva a repetição mensal', async () => {
    const user = setup();
    render(<CaptureBar open onClose={() => {}} />);
    const input = await screen.findByRole('textbox', { name: 'Capturar' });
    await user.type(input, 'pagar aluguel todo dia 5');
    expect(await screen.findByRole('button', { name: 'Repetir: todo dia 5' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(async () => {
      const [m] = await liveMissions();
      expect(m).toMatchObject({ title: 'pagar aluguel', recurrence: { kind: 'monthly', day: 5 }, date: '2026-12-05' });
    });
  });

  it('"aula 19h toda ter e qui" vira um compromisso com os dias da semana', async () => {
    const user = setup();
    render(<CaptureBar open onClose={() => {}} />);
    const input = await screen.findByRole('textbox', { name: 'Capturar' });
    await user.type(input, 'aula 19h toda ter e qui{Enter}');
    await waitFor(async () => {
      const cs = (await db.commitments.toArray()).filter((c) => !c.deleted);
      expect(cs).toHaveLength(1);
      expect(cs[0]).toMatchObject({ title: 'aula', start: '19:00', weekdays: [2, 4], date: '2026-11-12' });
    });
    expect(await liveMissions()).toHaveLength(0);
  });

  it('um compromisso recorrente trocado para Tarefa mantém a repetição', async () => {
    const user = setup();
    render(<CaptureBar open onClose={() => {}} />);
    const input = await screen.findByRole('textbox', { name: 'Capturar' });
    await user.type(input, 'aula 19h toda ter e qui');
    await user.click(await screen.findByRole('button', { name: 'Tarefa' }));
    await user.click(input);
    await user.keyboard('{Enter}');
    await waitFor(async () => {
      const [m] = await liveMissions();
      expect(m).toMatchObject({ title: 'aula', recurrence: { kind: 'weekly', weekdays: [2, 4] }, date: '2026-11-12' });
    });
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
