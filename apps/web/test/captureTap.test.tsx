import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Journey } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { CaptureBar } from '../src/features/capture/CaptureBar';

beforeEach(async () => {
  // setImmediate stays real: fake-indexeddb schedules transaction work with it.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 10, 0)); // quarta-feira
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  await put('journeys', newRecord<Journey>({ id: 'j-tech', title: 'Tech News', status: 'active', order: 0 }));
});
afterEach(() => { vi.useRealTimers(); });

const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
const live = async <T extends { deleted: boolean }>(rows: Promise<T[]>): Promise<T[]> => (await rows).filter((r) => !r.deleted);
const missions = () => live(db.missions.toArray());
const open = async () => {
  render(<CaptureBar open onClose={() => {}} />);
  return screen.findByRole('textbox', { name: 'Capturar' });
};
const row = (name: string) => screen.getByRole('button', { name });

describe('Capturar: Tarefa por toques', () => {
  it('linhas com nome acessível = rótulo + valor, painel dentro da folha, um por vez', async () => {
    await open();
    for (const name of ['Quando: Sem data', 'Repetir: Não repete', 'Jornada: Nenhuma', 'Área: Nenhuma', 'Duração: —', 'Energia: —']) {
      expect(row(name)).toHaveAttribute('aria-expanded', 'false');
    }
    expect(screen.getByRole('switch', { name: 'Importante' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Tarefa' })).toHaveAttribute('aria-pressed', 'true');

    const user = setup();
    await user.click(row('Quando: Sem data'));
    expect(row('Quando: Sem data')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Quando' })).toBeInTheDocument();
    await user.click(row('Duração: —'));
    expect(screen.queryByRole('group', { name: 'Quando' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Duração' })).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('tarefa com amanhã, repetir seg e qui, jornada e 30 min só com toques', async () => {
    const user = setup();
    const input = await open();
    await user.type(input, 'Revisar o coletor');
    await user.click(row('Quando: Sem data'));
    await user.click(screen.getByRole('button', { name: 'Amanhã' }));
    await user.click(row('Repetir: Não repete'));
    await user.click(screen.getByRole('button', { name: 'Semanal' })); // começa no dia de Quando (qui)
    await user.click(screen.getByRole('button', { name: 'segunda' }));
    await user.click(row('Jornada: Nenhuma'));
    await user.click(await screen.findByRole('button', { name: 'Tech News' }));
    await user.click(row('Duração: —'));
    await user.click(screen.getByRole('button', { name: '30 min' }));
    for (const name of ['Quando: amanhã', 'Repetir: toda seg, qui', 'Jornada: Tech News', 'Duração: 30 min']) {
      expect(row(name)).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => {
      const [m] = await missions();
      expect(m).toMatchObject({
        title: 'Revisar o coletor', date: '2026-11-12', recurrence: { kind: 'weekly', weekdays: [1, 4] },
        journeyId: 'j-tech', durationMin: 30,
      });
    });
    expect(await screen.findByText('Capturada: Revisar o coletor')).toBeInTheDocument();
  });

  it('10 linhas coladas + Jornada → tarefas na jornada, na ordem', async () => {
    const user = setup();
    const input = await open();
    const titles = Array.from({ length: 10 }, (_, i) => `Passo ${i + 1} do coletor`);
    await user.click(input);
    await user.paste(titles.join('\n'));
    expect(screen.getByText('10 tarefas serão criadas, uma por linha. As escolhas abaixo valem para todas.')).toBeInTheDocument();
    await user.click(row('Jornada: Nenhuma'));
    await user.click(await screen.findByRole('button', { name: 'Tech News' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect(await missions()).toHaveLength(10));
    const saved = (await missions()).sort((a, b) => a.createdAt - b.createdAt);
    expect(saved.map((m) => m.title)).toEqual(titles);
    expect(saved.every((m) => m.journeyId === 'j-tech')).toBe(true);
    expect(await screen.findByText('10 tarefas capturadas.')).toBeInTheDocument();
  });

  it('nada é gravado antes de Salvar, nem a jornada nova; Salvar cria a jornada uma vez', async () => {
    const counts = async () => Promise.all([
      db.missions.count(), db.commitments.count(), db.journeys.count(), db.notes.count(), db.outbox.count(), db.events.count(),
    ]);
    const before = await counts();
    const user = setup();
    const input = await open();
    await user.type(input, 'ler 20min{Shift>}{Enter}{/Shift}escrever');
    await user.click(row('Jornada: Nenhuma'));
    await user.click(screen.getByRole('button', { name: 'Nova jornada…' }));
    await user.type(screen.getByRole('textbox', { name: 'Nome da nova jornada' }), 'Leituras{Enter}');
    expect(row('Jornada: Nova jornada: Leituras')).toBeInTheDocument();
    await user.click(row('Duração: —'));
    await user.click(screen.getByRole('button', { name: '15 min' }));
    await user.click(screen.getByRole('switch', { name: 'Importante' }));
    expect(await counts()).toEqual(before);

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect(await missions()).toHaveLength(2));
    const leituras = (await live(db.journeys.toArray())).filter((j) => j.title === 'Leituras');
    expect(leituras).toHaveLength(1);
    expect((await missions()).every((m) => m.journeyId === leituras[0]!.id && m.durationMin === 15 && m.important)).toBe(true);
  });

  it('Salvar sem texto avisa e não grava; depois de salvar, volta a Tarefa vazia com o foco no campo', async () => {
    const user = setup();
    const input = await open();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Escreva o que precisa fazer.');
    expect(await db.missions.count()).toBe(0);
    await user.type(input, 'dentista 15h');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compromisso' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect(await db.commitments.count()).toBe(1));
    const field = screen.getByRole('textbox', { name: 'Capturar' });
    expect(field).toHaveFocus();
    expect(field).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Tarefa' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Compromisso salvo: dentista · hoje 15:00');
  });

  it('o dia com que o "+" foi aberto continua depois de salvar', async () => {
    const user = setup();
    render(<CaptureBar open onClose={() => {}} defaultDate="2026-11-20" />);
    const input = await screen.findByRole('textbox', { name: 'Capturar' });
    expect(row('Quando: sex 20/11')).toBeInTheDocument();
    await user.type(input, 'comprar pão{Enter}');
    await waitFor(async () => expect((await missions())[0]?.date).toBe('2026-11-20'));
    expect(row('Quando: sex 20/11')).toBeInTheDocument();
  });

  it('nenhuma tela ensina sintaxe', async () => {
    const user = setup();
    const input = await open();
    expect(document.body.textContent).not.toMatch(/Experimente|#jornada|@área/);
    await user.type(input, 'ler #tech @trab !');
    expect(screen.queryByRole('group', { name: 'Entendido' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Experimente|#jornada|@área/);
    // The rows follow the text and the live lists (journeys and areas may arrive after the first keys).
    expect(await screen.findByRole('button', { name: 'Jornada: Tech News' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Área: Trabalho' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Importante' })).toHaveAttribute('aria-checked', 'true');
  });
});
