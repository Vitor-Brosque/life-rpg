import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYNC_TABLES } from '@life/shared';
import { Sheet } from '../src/ui/Sheet';
import { ToastHost, useToast } from '../src/ui/Toast';
import { ProgressBar } from '../src/ui/ProgressBar';
import { Chip } from '../src/ui/Chip';
import { safeRun } from '../src/ui/safeRun';
import { collectExport, downloadExport, exportFileName, requestPersistentStorage } from '../src/db/exportData';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { EditableField } from '../src/features/mission/EditableField';

/** Sets (or, with undefined, removes) an own property on navigator for one test. */
function stubNavigator(key: string, value: unknown) {
  if (value === undefined) delete (navigator as unknown as Record<string, unknown>)[key];
  else Object.defineProperty(navigator, key, { configurable: true, value });
}

const setVisibility = (state: DocumentVisibilityState) =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });

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

  it('gives focus back to the opener even when the content has an autoFocus field', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Novo</button>
          <Sheet open={open} onClose={() => setOpen(false)} title="Novo item">
            <input type="text" aria-label="Título" autoFocus />
            <button type="button" onClick={() => setOpen(false)}>Criar</button>
          </Sheet>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Novo' }));
    expect(screen.getByRole('textbox', { name: 'Título' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Criar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Novo' })).toHaveFocus();
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

  it('a tap on the message closes it at once; a new toast shown by the action survives the action tap', async () => {
    const user = userEvent.setup();
    render(<ToastHost />);
    act(() => useToast.getState().show('Missão concluída · +10 XP', { label: 'Desfazer', run: () => {} }));
    await user.click(screen.getByText('Missão concluída · +10 XP'));
    expect(screen.queryByText('Missão concluída · +10 XP')).not.toBeInTheDocument();

    act(() => useToast.getState().show('Missão concluída', { label: 'Desfazer', run: () => useToast.getState().show('Desfeito') }));
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(screen.getByText('Desfeito')).toBeInTheDocument();
  });
});

describe('Toast action focus', () => {
  afterEach(() => { act(() => useToast.getState().dismiss()); });

  it('after the action the focus is on the page heading, never on <body>', async () => {
    const user = userEvent.setup();
    render(<><h1 tabIndex={-1} data-focus-target="page">Tela</h1><ToastHost /></>);
    act(() => useToast.getState().show('Feito', { label: 'Desfazer', run: () => {} }));
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tela' })).toHaveFocus());
  });

  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const page = () => render(<><h1 tabIndex={-1} data-focus-target="page">Tela</h1><input aria-label="Campo" /><ToastHost /></>);

  it('an action that moves focus to an element keeps it there (the heading does not take it)', async () => {
    const user = userEvent.setup();
    page();
    const field = screen.getByRole('textbox', { name: 'Campo' });
    act(() => useToast.getState().show('Feito', { label: 'Desfazer', run: () => field.focus() }));
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull());
    await settle();
    expect(field).toHaveFocus();
  });

  it('an action whose screen moves focus a moment later (a microtask) keeps it there', async () => {
    const user = userEvent.setup();
    page();
    const field = screen.getByRole('textbox', { name: 'Campo' });
    act(() => useToast.getState().show('Feito', { label: 'Abrir', run: () => queueMicrotask(() => field.focus()) }));
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Abrir' })).toBeNull());
    await settle();
    expect(field).toHaveFocus();
  });

  it('focus he moved elsewhere before the toast leaves is not stolen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      page();
      act(() => useToast.getState().show('Feito', { label: 'Desfazer', run: () => {} }));
      await user.tab();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Desfazer' })).toHaveFocus();
      await user.click(screen.getByRole('textbox', { name: 'Campo' }));
      act(() => { vi.advanceTimersByTime(4100); });
      expect(screen.queryByText('Feito')).toBeNull();
      await settle();
      expect(screen.getByRole('textbox', { name: 'Campo' })).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
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

  describe('downloadExport', () => {
    afterEach(() => {
      stubNavigator('canShare', undefined);
      stubNavigator('share', undefined);
      vi.restoreAllMocks();
    });

    it('uses the share sheet when the device can share files (iPhone Home Screen app)', async () => {
      await db.delete();
      await db.open();
      await ensureSeed();
      const share = vi.fn(async (_data: ShareData) => {});
      stubNavigator('canShare', vi.fn((data: ShareData) => (data.files?.length ?? 0) > 0));
      stubNavigator('share', share);
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      await downloadExport();
      expect(share).toHaveBeenCalledTimes(1);
      const arg = share.mock.calls[0]![0];
      expect(arg.title).toBe('LIFE RPG — backup');
      const file = arg.files![0]!;
      expect(file.name).toBe(exportFileName());
      expect(file.type).toBe('application/json');
      expect(Object.keys(JSON.parse(await file.text()))).toContain('missions');
      expect(click).not.toHaveBeenCalled();
    });

    it('closing the share sheet is not an error', async () => {
      stubNavigator('canShare', () => true);
      stubNavigator('share', vi.fn(async () => { throw new DOMException('cancelado', 'AbortError'); }));
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      await expect(downloadExport()).resolves.toBeUndefined();
      expect(click).not.toHaveBeenCalled();
    });

    it('falls back to the download link when sharing files is not possible', async () => {
      stubNavigator('canShare', () => false);
      URL.createObjectURL = vi.fn(() => 'blob:life');
      URL.revokeObjectURL = vi.fn();
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      await downloadExport();
      expect(click).toHaveBeenCalledTimes(1);
    });
  });

  describe('requestPersistentStorage', () => {
    afterEach(() => { stubNavigator('storage', undefined); });

    it('asks the browser to keep the data once, ignoring failures', async () => {
      const persist = vi.fn(async () => { throw new Error('no'); });
      stubNavigator('storage', { persist });
      requestPersistentStorage();
      expect(persist).toHaveBeenCalledTimes(1);
      await new Promise((r) => setTimeout(r, 0)); // the rejection is swallowed (no unhandled rejection)
      stubNavigator('storage', undefined);
      expect(() => requestPersistentStorage()).not.toThrow();
    });
  });
});

describe('stacking order', () => {
  it('toasts sit above open sheets', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    const z = (name: string) => Number(new RegExp(`--z-${name}:\\s*(\\d+)`).exec(css)?.[1]);
    expect(z('toast')).toBeGreaterThan(z('sheet'));
  });
});

describe('safeRun', () => {
  afterEach(() => { act(() => useToast.getState().dismiss()); vi.restoreAllMocks(); });

  it('reports a failed write with a toast and console.error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ToastHost />);
    const boom = new Error('boom');
    act(() => safeRun(Promise.reject(boom)));
    expect(await screen.findByText('Algo não funcionou. Tente de novo.')).toBeInTheDocument();
    expect(error).toHaveBeenCalledWith(expect.any(String), boom);
  });

  it('takes a function too, including one that throws before returning a promise', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ToastHost />);
    act(() => safeRun(() => { throw new Error('sync'); }));
    expect(await screen.findByText('Algo não funcionou. Tente de novo.')).toBeInTheDocument();
    act(() => useToast.getState().dismiss());
    act(() => safeRun(async () => { throw new Error('async'); }));
    expect(await screen.findByText('Algo não funcionou. Tente de novo.')).toBeInTheDocument();
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('stays quiet when the write works', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ToastHost />);
    const fn = vi.fn(async () => {});
    act(() => safeRun(fn));
    await new Promise((r) => setTimeout(r, 0));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Algo não funcionou. Tente de novo.')).not.toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('EditableField drafts', () => {
  afterEach(() => { delete (document as { visibilityState?: unknown }).visibilityState; });

  it('saves the draft when the page goes to the background or is unloaded', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EditableField label="Notas" value="" onSave={onSave} />);
    const field = screen.getByRole('textbox', { name: 'Notas' });
    await user.type(field, 'comprar pão');
    setVisibility('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(onSave).toHaveBeenLastCalledWith('comprar pão');

    setVisibility('visible');
    await user.type(field, ' e leite');
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(onSave).toHaveBeenLastCalledWith('comprar pão e leite');
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(field).toHaveFocus(); // nothing else changed for the user
  });
});
