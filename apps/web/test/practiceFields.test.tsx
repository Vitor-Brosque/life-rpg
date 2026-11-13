import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChecklistItem, Journey, PracticeScore, PracticeSession } from '@life/shared';
import { newPracticeFields } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { newRecord, put } from '../src/db/repo';
import { createMission } from '../src/domain/actions';
import { DraftText, JourneyMissionPicker, ListField, ScoreChoice } from '../src/features/practice/PracticeFields';
import { doneMeta, openMeta, practiceBack } from '../src/features/practice/practiceData';
import { FAILURE_TOAST } from '../src/ui/safeRun';
import { useToast } from '../src/ui/Toast';
import { useDraftField } from '../src/features/practice/useDraftField';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

function Draft({ saved, save }: { saved: string; save: (v: string) => Promise<unknown> }) {
  const d = useDraftField(saved, save);
  return (
    <>
      <input aria-label="Campo" value={d.value} onChange={(e) => d.onChange(e.target.value)} onFocus={d.onFocus} onBlur={d.onBlur} />
      <button type="button" onClick={d.reset}>Desfazer edição</button>
    </>
  );
}

interface Deferred { promise: Promise<void>; resolve(): void; reject(e: unknown): void }
function deferred(): Deferred {
  let resolve!: () => void; let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Hook tests: no Dexie, fake timers and an in-memory `save`, so every wait is an explicit advance. */
describe('useDraftField', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 13, 10, 0)); });
  afterEach(() => { useToast.getState().dismiss(); vi.restoreAllMocks(); vi.useRealTimers(); });

  const field = (): HTMLElement => screen.getByLabelText('Campo');
  const type = (v: string): void => { fireEvent.change(field(), { target: { value: v } }); };
  const focus = (): void => { act(() => { field().focus(); }); };
  const blur = (): void => { act(() => { field().blur(); }); };
  const advance = async (ms: number): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
  const settle = (): Promise<void> => advance(0);
  const quietConsole = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

  it('saves once, after the pause', async () => {
    const save = vi.fn(async () => undefined);
    render(<Draft saved="" save={save} />);
    type('a'); type('ab'); type('abc');
    await advance(599);
    expect(save).not.toHaveBeenCalled();
    await advance(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('abc');
    await advance(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves at once on blur and on unmount', async () => {
    const save = vi.fn(async () => undefined);
    const { unmount } = render(<Draft saved="" save={save} />);
    focus(); type('x'); blur();
    await settle();
    expect(save).toHaveBeenCalledWith('x');
    focus(); type('xy');
    unmount();
    await settle();
    expect(save).toHaveBeenLastCalledWith('xy');
  });

  it('follows the stored value when idle, never over what is being typed', async () => {
    const save = vi.fn(async () => undefined);
    const { rerender } = render(<Draft saved="antes" save={save} />);
    rerender(<Draft saved="de fora" save={save} />);
    expect(field()).toHaveValue('de fora');
    focus(); type('de fora!');
    rerender(<Draft saved="outra vez" save={save} />);
    expect(field()).toHaveValue('de fora!');
    blur();
    await settle();
    expect(save).toHaveBeenLastCalledWith('de fora!');
  });

  it('ignores a stored value that arrives while dirty but not focused', async () => {
    const save = vi.fn(async () => undefined);
    const { rerender } = render(<Draft saved="a" save={save} />);
    type('meu texto');
    rerender(<Draft saved="de fora" save={save} />);
    expect(field()).toHaveValue('meu texto');
    await advance(600);
    expect(save).toHaveBeenCalledWith('meu texto');
  });

  it('blur with no pending edit adopts the value stored meanwhile', async () => {
    const save = vi.fn(async () => undefined);
    const { rerender } = render(<Draft saved="a" save={save} />);
    focus();
    rerender(<Draft saved="de outro aparelho" save={save} />);
    expect(field()).toHaveValue('a');
    blur();
    expect(field()).toHaveValue('de outro aparelho');
    await advance(5000);
    expect(save).not.toHaveBeenCalled();
  });

  it('reset drops the pending edit', async () => {
    const save = vi.fn(async () => undefined);
    render(<Draft saved="guardado" save={save} />);
    type('rascunho');
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer edição' }));
    expect(field()).toHaveValue('guardado');
    await advance(5000);
    expect(save).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('flushes when the page is hidden or unloaded', async () => {
    const save = vi.fn(async () => undefined);
    render(<Draft saved="" save={save} />);
    type('um');
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    await settle();
    expect(save).toHaveBeenLastCalledWith('um');
    type('dois');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await settle();
    expect(save).toHaveBeenCalledTimes(1); // still visible: nothing to flush
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    state.mockRestore();
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('dois');
  });

  it('saves one after the other, in order, even when the first is slow', async () => {
    const first = deferred();
    const calls: string[] = [];
    const save = vi.fn((v: string) => { calls.push(v); return calls.length === 1 ? first.promise : Promise.resolve(); });
    render(<Draft saved="" save={save} />);
    focus(); type('a'); blur();
    await settle();
    focus(); type('ab'); blur();
    await advance(5000);
    expect(calls).toEqual(['a']); // the second waits for the first
    first.resolve();
    await settle();
    expect(calls).toEqual(['a', 'ab']);
  });

  it('does not snap back to a stored value that arrives while a save is in flight', async () => {
    const first = deferred();
    const second = deferred();
    const save = vi.fn((v: string) => (v === 'a' ? first.promise : second.promise));
    const { rerender } = render(<Draft saved="" save={save} />);
    focus(); type('a'); blur();
    await settle();
    focus(); type('ab'); blur();
    rerender(<Draft saved="a" save={save} />); // "a" is stored while it is still in flight
    expect(field()).toHaveValue('ab');
    first.resolve();
    await settle();
    expect(field()).toHaveValue('ab'); // "ab" is in flight now
    second.resolve();
    await settle();
    rerender(<Draft saved="ab" save={save} />);
    expect(field()).toHaveValue('ab');
  });

  it('follows the latest stored value once the queue drains', async () => {
    const first = deferred();
    const save = vi.fn(() => first.promise);
    const { rerender } = render(<Draft saved="" save={save} />);
    focus(); type('a'); blur();
    await settle();
    rerender(<Draft saved="de outro aparelho" save={save} />); // ignored: a save is in flight
    expect(field()).toHaveValue('a');
    first.resolve();
    await settle();
    expect(field()).toHaveValue('de outro aparelho');
  });

  it('a failed save keeps the text, shows the toast and the next blur retries it', async () => {
    const error = quietConsole();
    const save = vi.fn().mockRejectedValueOnce(new Error('disco cheio')).mockResolvedValue(undefined);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const { rerender } = render(<Draft saved="" save={save} />);
    focus(); type('meu texto'); blur();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    expect(useToast.getState().toast?.msg).toBe(FAILURE_TOAST);
    rerender(<Draft saved="" save={save} />);
    expect(field()).toHaveValue('meu texto');
    focus(); blur();
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('meu texto');
    await advance(5000);
    expect(save).toHaveBeenCalledTimes(2);
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('writes a draft with the save function of the moment of the edit', async () => {
    const oldSave = vi.fn(async () => undefined);
    const newSave = vi.fn(async () => undefined);
    const { rerender } = render(<Draft saved="" save={oldSave} />);
    type('do registro antigo');
    rerender(<Draft saved="" save={newSave} />);
    await advance(600);
    expect(oldSave).toHaveBeenCalledWith('do registro antigo');
    expect(newSave).not.toHaveBeenCalled();
  });

  it('after unmount: the pending text is saved once and no timer is left', async () => {
    const save = vi.fn(async () => undefined);
    const { unmount } = render(<Draft saved="" save={save} />);
    type('final');
    unmount();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('final');
    expect(vi.getTimerCount()).toBe(0);
    await advance(5000);
    expect(save).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('unmounting with nothing to save saves nothing', async () => {
    const save = vi.fn(async () => undefined);
    const { unmount } = render(<Draft saved="x" save={save} />);
    unmount();
    await advance(5000);
    expect(save).not.toHaveBeenCalled();
  });
});

function List({ initial = [], check = false }: { initial?: ChecklistItem[]; check?: boolean }) {
  const [items, setItems] = useState<ChecklistItem[]>(initial);
  return (
    <ListField legend="Passos" noun="passo" items={items} placeholder="ex.: normalizar a URL"
      onEdit={(fn) => setItems((xs) => fn(xs))} {...(check ? { checkLabel: (t: string) => `Passou: ${t}` } : {})} />
  );
}
const it3 = (n: number): ChecklistItem[] => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, text: `passo ${i + 1}`, done: false }));

describe('ListField', () => {
  it('Enter adds and keeps the focus; editing, Esc, blanking, Subir and Remover', async () => {
    const user = userEvent.setup();
    render(<List />);
    const fresh = screen.getByRole('textbox', { name: 'Novo passo' });
    expect(screen.getByRole('button', { name: 'Adicionar passo' })).toBeDisabled();
    await user.type(fresh, 'normalizar URL{Enter}gravar{Enter}');
    expect(fresh).toHaveFocus();
    expect(fresh).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Passo 1' })).toHaveValue('normalizar URL');
    expect(screen.getByRole('textbox', { name: 'Passo 2' })).toHaveValue('gravar');
    expect(screen.queryByRole('button', { name: 'Subir passo 1' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Subir passo 2' }));
    expect(screen.getByRole('textbox', { name: 'Passo 1' })).toHaveValue('gravar');
    const first = screen.getByRole('textbox', { name: 'Passo 1' });
    await user.type(first, ' no banco{Escape}');
    expect(first).toHaveValue('gravar');
    await user.type(first, ' no banco{Enter}');
    expect(screen.getByRole('textbox', { name: 'Passo 1' })).toHaveValue('gravar no banco');
    await user.clear(screen.getByRole('textbox', { name: 'Passo 2' }));
    await user.tab();
    expect(screen.queryByRole('textbox', { name: 'Passo 2' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remover passo 1' }));
    expect(screen.queryByRole('textbox', { name: 'Passo 1' })).toBeNull();
  });

  it('checkLabel adds a checkbox per item; 30 items hide the new-item field', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<List initial={[{ id: 'a', text: '[] → []', done: false }]} check />);
    await user.click(screen.getByRole('checkbox', { name: 'Passou: [] → []' }));
    expect(screen.getByRole('checkbox', { name: 'Passou: [] → []' })).toBeChecked();
    unmount();
    render(<List initial={it3(30)} />);
    expect(screen.queryByRole('textbox', { name: 'Novo passo' })).toBeNull();
    expect(screen.getByText('Limite de 30 itens.')).toBeInTheDocument();
  });
});

describe('ListField edit protection', () => {
  const items = (text: string): ChecklistItem[] => [{ id: 'a', text, done: false }];

  it('a row being edited keeps its text when the items change from outside', async () => {
    const user = userEvent.setup();
    const v = (xs: ChecklistItem[]) => <ListField legend="Passos" noun="passo" items={xs} onEdit={() => undefined} />;
    const { rerender } = render(v(items('original')));
    const row = screen.getByRole('textbox', { name: 'Passo 1' });
    await user.click(row);
    await user.type(row, ' meu');
    rerender(v(items('de fora')));
    expect(screen.getByRole('textbox', { name: 'Passo 1' })).toHaveValue('original meu');
  });

  it('a focused row with no change keeps its text too, and the outside change survives the blur', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const v = (xs: ChecklistItem[]) => <ListField legend="Passos" noun="passo" items={xs} onEdit={onEdit} />;
    const { rerender } = render(v(items('original')));
    await user.click(screen.getByRole('textbox', { name: 'Passo 1' }));
    rerender(v(items('de fora')));
    expect(screen.getByRole('textbox', { name: 'Passo 1' })).toHaveValue('original');
    await user.tab();
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Passo 1' })).toHaveValue('de fora');
  });

  it('trailing spaces disappear on blur even when the trimmed text equals the stored one', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<ListField legend="Passos" noun="passo" items={items('igual')} onEdit={onEdit} />);
    const row = screen.getByRole('textbox', { name: 'Passo 1' });
    await user.type(row, '   ');
    await user.tab();
    expect(row).toHaveValue('igual');
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('DraftText', () => {
  it('multiline renders a textarea described by its hint', () => {
    render(<DraftText label="Objetivo" saved="abc" onSave={async () => undefined} maxLength={100} multiline rows={4} hint="Uma frase basta." />);
    const area = screen.getByRole('textbox', { name: 'Objetivo' });
    expect(area.tagName).toBe('TEXTAREA');
    expect(area).toHaveAttribute('rows', '4');
    expect(area).toHaveValue('abc');
    expect(area).toHaveAccessibleDescription('Uma frase basta.');
  });

  it('single line without a hint has no description', () => {
    render(<DraftText label="Título" saved="" onSave={async () => undefined} maxLength={50} />);
    const input = screen.getByRole('textbox', { name: 'Título' });
    expect(input.tagName).toBe('INPUT');
    expect(input).not.toHaveAttribute('aria-describedby');
  });
});

describe('ScoreChoice and JourneyMissionPicker', () => {
  it('ScoreChoice: three radios, the change at once', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ScoreChoice name="delivered" legend="Entregue — A funcionalidade ficou pronta?" options={['Não', 'Parcial', 'Sim']}
      value={1 as PracticeScore} onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'Entregue — A funcionalidade ficou pronta?' });
    expect(within(group).getByRole('radio', { name: 'Parcial' })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: 'Sim' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('JourneyMissionPicker: active journeys, the open missions of the chosen one', async () => {
    const user = userEvent.setup();
    await put('journeys', newRecord<Journey>({ id: 'j-tech', title: 'Tech News', status: 'active', order: 0 }));
    await put('journeys', newRecord<Journey>({ id: 'j-old', title: 'Antiga', status: 'archived', order: 1 }));
    await createMission({ title: 'Segunda fonte', journeyId: 'j-tech' });
    await createMission({ title: 'Ágora', journeyId: 'j-tech' });
    await createMission({ title: 'Fora da jornada' });
    const onChange = vi.fn();
    const { rerender } = render(<JourneyMissionPicker onChange={onChange} />);
    await user.click(await screen.findByRole('button', { name: 'Tech News' }));
    expect(onChange).toHaveBeenLastCalledWith({ journeyId: 'j-tech' });
    expect(screen.queryByRole('button', { name: 'Antiga' })).toBeNull();
    expect(screen.queryByLabelText('Missão (opcional)')).toBeNull();
    rerender(<JourneyMissionPicker journeyId="j-tech" onChange={onChange} />);
    const select = await screen.findByLabelText('Missão (opcional)');
    await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Sem missão', 'Ágora', 'Segunda fonte']));
    await user.selectOptions(select, 'Segunda fonte');
    expect(onChange).toHaveBeenLastCalledWith({ journeyId: 'j-tech', missionId: expect.any(String) });
    await user.click(screen.getByRole('button', { name: 'Nenhuma' }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });
});

describe('practiceData', () => {
  it('meta lines and the safe back path', () => {
    const journeys = [{ id: 'j-tech', title: 'Tech News' } as Journey];
    const now = new Date(2026, 10, 13, 10, 0).getTime();
    const s = {
      id: 'p', createdAt: 1, deleted: false, ...newPracticeFields({ title: 'x', journeyId: 'j-tech' }),
      step: 'code', updatedAt: now - 2 * 86_400_000, endedAt: new Date(2026, 10, 13, 9, 0).getTime(),
    } as PracticeSession;
    expect(openMeta(s, journeys, now)).toBe('Tech News · há 2 dias · Passo: Implementar');
    expect(doneMeta(s, journeys)).toBe('13/11 · Tech News');
    expect(openMeta({ ...s, journeyId: undefined }, journeys, now)).toBe('há 2 dias · Passo: Implementar');
    expect(practiceBack('/')).toBe('/');
    expect(practiceBack('/\\evil.com')).toBe('/estudo/praticas');
    expect(practiceBack('//evil.com')).toBe('/estudo/praticas');
    expect(practiceBack(null)).toBe('/estudo/praticas');
  });
});
