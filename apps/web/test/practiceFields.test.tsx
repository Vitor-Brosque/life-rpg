import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChecklistItem, Journey, PracticeScore, PracticeSession } from '@life/shared';
import { newPracticeFields } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { newRecord, put } from '../src/db/repo';
import { createMission } from '../src/domain/actions';
import { JourneyMissionPicker, ListField, ScoreChoice } from '../src/features/practice/PracticeFields';
import { doneMeta, openMeta, practiceBack } from '../src/features/practice/practiceData';
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

describe('useDraftField', () => {
  it('saves once, after the pause', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => undefined);
    render(<Draft saved="" save={save} />);
    await user.type(screen.getByLabelText('Campo'), 'abc');
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(save).toHaveBeenCalledWith('abc'));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves at once on blur and on unmount', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => undefined);
    const { unmount } = render(<Draft saved="" save={save} />);
    await user.type(screen.getByLabelText('Campo'), 'x');
    await user.tab();
    await waitFor(() => expect(save).toHaveBeenCalledWith('x'));
    await user.click(screen.getByLabelText('Campo'));
    await user.type(screen.getByLabelText('Campo'), 'y');
    unmount();
    await waitFor(() => expect(save).toHaveBeenLastCalledWith('xy'));
  });

  it('follows the stored value when idle, never over what is being typed', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => undefined);
    const { rerender } = render(<Draft saved="antes" save={save} />);
    rerender(<Draft saved="de fora" save={save} />);
    expect(screen.getByLabelText('Campo')).toHaveValue('de fora');
    await user.click(screen.getByLabelText('Campo'));
    await user.type(screen.getByLabelText('Campo'), '!');
    rerender(<Draft saved="outra vez" save={save} />);
    expect(screen.getByLabelText('Campo')).toHaveValue('de fora!');
    await user.tab();
    await waitFor(() => expect(save).toHaveBeenLastCalledWith('de fora!'));
  });

  it('reset drops the pending edit', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => undefined);
    render(<Draft saved="guardado" save={save} />);
    fireEvent.change(screen.getByLabelText('Campo'), { target: { value: 'rascunho' } });
    await user.click(screen.getByRole('button', { name: 'Desfazer edição' }));
    expect(screen.getByLabelText('Campo')).toHaveValue('guardado');
    await new Promise((r) => setTimeout(r, 700));
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
    await createMission({ title: 'Fora da jornada' });
    const onChange = vi.fn();
    const { rerender } = render(<JourneyMissionPicker onChange={onChange} />);
    await user.click(await screen.findByRole('button', { name: 'Tech News' }));
    expect(onChange).toHaveBeenLastCalledWith({ journeyId: 'j-tech' });
    expect(screen.queryByRole('button', { name: 'Antiga' })).toBeNull();
    expect(screen.queryByLabelText('Missão (opcional)')).toBeNull();
    rerender(<JourneyMissionPicker journeyId="j-tech" onChange={onChange} />);
    const select = await screen.findByLabelText('Missão (opcional)');
    await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Sem missão', 'Segunda fonte']));
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
    expect(practiceBack('//evil.com')).toBe('/estudo/praticas');
    expect(practiceBack(null)).toBe('/estudo/praticas');
  });
});
