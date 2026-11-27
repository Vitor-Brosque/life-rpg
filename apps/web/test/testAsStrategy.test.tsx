import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRATEGY_TITLE_MAX } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { TestAsStrategy } from '../src/features/patterns/TestAsStrategy';
import { ToastHost } from '../src/ui/Toast';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

describe('TestAsStrategy', () => {
  it('a text longer than the title limit shows "Já está em teste" once tested', async () => {
    const user = userEvent.setup();
    const text = `Celular longe ${'do bloco '.repeat(40)}`.trim();
    expect(text.length).toBeGreaterThan(STRATEGY_TITLE_MAX);
    render(<><TestAsStrategy text={text} /><ToastHost /></>);
    await user.click(await screen.findByRole('button', { name: 'Testar como estratégia' }));
    expect(await screen.findByRole('button', { name: 'Já está em teste' })).toBeDisabled();
    expect(await db.strategies.count()).toBe(1);
  });
});
