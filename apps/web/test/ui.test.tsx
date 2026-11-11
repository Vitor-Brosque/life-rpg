import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYNC_TABLES } from '@life/shared';
import { Sheet } from '../src/ui/Sheet';
import { ToastHost, useToast } from '../src/ui/Toast';
import { ProgressBar } from '../src/ui/ProgressBar';
import { Chip } from '../src/ui/Chip';
import { collectExport, exportFileName } from '../src/db/exportData';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';

function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Abrir</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Detalhes">
        <input aria-label="Título" />
        <button type="button">Salvar</button>
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('is a labelled modal dialog that traps focus, closes on Esc and restores focus', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Detalhes' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);

    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes from the close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} title="X">conteúdo</Sheet>);
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Toast', () => {
  afterEach(() => { vi.useRealTimers(); act(() => useToast.getState().dismiss()); });

  it('shows a message with an action in a polite live region and hides after the timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const run = vi.fn();
    render(<ToastHost />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');

    act(() => useToast.getState().show('Missão concluída', { label: 'Desfazer', run }, 6000));
    expect(region).toHaveTextContent('Missão concluída');
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Missão concluída')).not.toBeInTheDocument();

    act(() => useToast.getState().show('Salvo'));
    expect(region).toHaveTextContent('Salvo');
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.queryByText('Salvo')).not.toBeInTheDocument();
  });
});

describe('ProgressBar and Chip', () => {
  it('exposes progress semantics', () => {
    render(<ProgressBar value={12} max={40} label="12 / 40 XP" />);
    const bar = screen.getByRole('progressbar', { name: '12 / 40 XP' });
    expect(bar).toHaveAttribute('aria-valuenow', '12');
    expect(bar).toHaveAttribute('aria-valuemax', '40');
  });

  it('chip toggles and removes', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render(<Chip selected onClick={onClick} onRemove={onRemove}>amanhã</Chip>);
    const chip = screen.getByRole('button', { name: 'amanhã' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip);
    await user.click(screen.getByRole('button', { name: 'Remover amanhã' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('data export', () => {
  it('collects every synced table and names the file by date', async () => {
    await db.delete();
    await db.open();
    await ensureSeed();
    const data = await collectExport();
    for (const t of SYNC_TABLES) expect(Array.isArray(data[t])).toBe(true);
    expect(data.areas).toHaveLength(6);
    expect(data.profile[0]).toMatchObject({ id: 'me' });
    expect(exportFileName(new Date(2026, 10, 5, 23, 30))).toBe('life-rpg-2026-11-05.json');
  });
});
