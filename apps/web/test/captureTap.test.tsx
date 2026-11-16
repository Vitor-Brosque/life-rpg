import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deck, Journey } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { CaptureBar, CaptureHost, useCaptureStore } from '../src/features/capture/CaptureBar';

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

describe('Capturar: Compromisso, Prova ou trabalho e Card', () => {
  it('compromisso: Dia, Início, Fim, Toda semana, Até e Lembrar', async () => {
    const user = setup();
    const input = await open();
    await user.click(screen.getByRole('button', { name: 'Compromisso' }));
    expect(screen.getByRole('textbox', { name: 'O que é?' })).toBe(input);
    await user.type(input, 'Aula de inglês');
    expect(row('Dia: hoje')).toBeInTheDocument();
    expect(row('Fim: —')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Lembrar antes' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha o dia e o início.');

    await user.click(row('Dia: hoje'));
    await user.click(screen.getByRole('button', { name: 'Amanhã' }));
    await user.click(row('Início: —'));
    fireEvent.change(screen.getByLabelText('Início', { selector: 'input' }), { target: { value: '18:00' } });
    expect(row('Fim: 19:00')).toBeInTheDocument();
    await user.click(row('Fim: 19:00'));
    fireEvent.change(screen.getByLabelText('Fim', { selector: 'input' }), { target: { value: '19:30' } });
    expect(screen.queryByRole('button', { name: /^Até/ })).not.toBeInTheDocument();
    await user.click(row('Toda semana: Não'));
    await user.click(screen.getByRole('button', { name: 'terça' }));
    await user.click(screen.getByRole('button', { name: 'quinta' }));
    expect(row('Até (opcional): —')).toBeInTheDocument();
    await user.click(row('Até (opcional): —'));
    fireEvent.change(screen.getByLabelText('Até (opcional)', { selector: 'input' }), { target: { value: '2026-12-17' } });
    await user.click(screen.getByRole('switch', { name: 'Lembrar antes' }));
    expect(row('Toda semana: ter, qui')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => {
      const [c] = await live(db.commitments.toArray());
      expect(c).toMatchObject({
        title: 'Aula de inglês', date: '2026-11-12', start: '18:00', end: '19:30', weekdays: [2, 4],
        untilDate: '2026-12-17', remind: false,
      });
    });
  });

  it('"dentista amanhã 15h" acende Compromisso, Dia e Início; um toque em Dia vence', async () => {
    const user = setup();
    const input = await open();
    await user.type(input, 'dentista amanhã 15h');
    expect(screen.getByRole('button', { name: 'Compromisso' })).toHaveAttribute('aria-pressed', 'true');
    expect(row('Dia: amanhã')).toBeInTheDocument();
    expect(row('Início: 15:00')).toBeInTheDocument();
    expect(row('Fim: 16:00')).toBeInTheDocument();
    await user.click(row('Dia: amanhã'));
    await user.click(screen.getByRole('button', { name: 'Hoje' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => {
      const [c] = await live(db.commitments.toArray());
      expect(c).toMatchObject({ title: 'dentista', date: '2026-11-11', start: '15:00', end: '16:00' });
    });
    expect(await missions()).toHaveLength(0);
  });

  it('prova sem disciplina: aviso, link para Matérias e nada gravado', async () => {
    const user = setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Prova ou trabalho' }));
    expect(screen.getByRole('textbox', { name: 'Conteúdo (opcional)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha a matéria e a data.');
    await user.click(row('Matéria: —'));
    expect(screen.getByText(/Nenhuma disciplina ainda\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cadastrar em Matérias' })).toHaveAttribute('href', '/estudo/materias');
    expect(await db.missions.count()).toBe(0);
  });

  it('prova completa: "Prova de Cálculo II" com date = deadline e o conteúdo nas notas', async () => {
    await put('journeys', newRecord<Journey>({
      id: 'j-calc', title: 'Cálculo II', status: 'active', order: 1, areaId: 'area-facul', subject: true,
    }));
    const user = setup();
    const input = await open();
    await user.click(screen.getByRole('button', { name: 'Prova ou trabalho' }));
    expect(screen.getByRole('button', { name: 'Prova' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(row('Matéria: —'));
    await user.click(await screen.findByRole('button', { name: 'Cálculo II' }));
    await user.click(row('Data: —'));
    fireEvent.change(screen.getByLabelText('Escolher dia'), { target: { value: '2026-12-03' } });
    await user.type(input, 'integrais por partes');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => {
      const [m] = await missions();
      expect(m).toMatchObject({
        title: 'Prova de Cálculo II', assessment: 'prova', date: '2026-12-03', deadline: '2026-12-03',
        notes: 'integrais por partes', journeyId: 'j-calc',
      });
    });
    expect(await screen.findByText('Prova de Cálculo II em qui 03/12.')).toBeInTheDocument();
  });

  it('card com baralho vira rascunho nesse baralho', async () => {
    await put('decks', newRecord<Deck>({ id: 'd-sql', name: 'SQL', order: 0, archived: false }));
    const user = setup();
    const input = await open();
    await user.click(screen.getByRole('button', { name: 'Card' }));
    expect(screen.getByText('Vira rascunho de card. Complete depois na aba Estudo.')).toBeInTheDocument();
    await user.type(input, 'O que é um índice composto?');
    await user.click(row('Baralho: Caixa de entrada'));
    await user.click(await screen.findByRole('button', { name: 'SQL' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => {
      const [n] = await live(db.notes.toArray());
      expect(n).toMatchObject({ front: 'O que é um índice composto?', draft: true, deckId: 'd-sql', type: 'basic' });
    });
    expect(await screen.findByText('Rascunho de card salvo. Complete na aba Estudo.')).toBeInTheDocument();
  });

  it('trocar de tipo mantém o texto e o foco fica no chip tocado, sem remontar os chips', async () => {
    const user = setup();
    const input = await open();
    await user.type(input, 'Dentista{Shift>}{Enter}{/Shift}com a Ana');
    await user.click(screen.getByRole('button', { name: 'Compromisso' }));
    expect(input).toHaveValue('Dentista com a Ana');
    expect(screen.getByRole('button', { name: 'Compromisso' })).toHaveFocus();
    expect(document.body).not.toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Card' }));
    expect(input).toHaveValue('Dentista\ncom a Ana'); // as linhas originais voltam
    expect(screen.getByRole('button', { name: 'Card' })).toHaveFocus();
    expect(document.body).not.toHaveFocus();
    expect(within(screen.getByRole('group', { name: 'Tipo' })).getByRole('button', { name: 'Card' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('um tipo lido do texto fica fixado ao tocar numa linha: apagar o texto não o desfaz', async () => {
    const user = setup();
    const input = await open();
    await user.type(input, 'dentista 15h');
    expect(screen.getByRole('button', { name: 'Compromisso' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(row('Início: 15:00'));
    fireEvent.change(screen.getByLabelText('Início', { selector: 'input' }), { target: { value: '16:00' } });
    await user.clear(input);
    await user.type(input, 'dentista');
    expect(screen.getByRole('button', { name: 'Compromisso' })).toHaveAttribute('aria-pressed', 'true');
    expect(row('Início: 16:00')).toBeInTheDocument();
  });

  it('prova lida do texto fica fixada ao tocar em Data, mesmo sem a data no texto', async () => {
    await put('journeys', newRecord<Journey>({
      id: 'j-calc', title: 'Cálculo II', status: 'active', order: 1, areaId: 'area-facul', subject: true,
    }));
    const user = setup();
    const input = await open();
    await user.type(input, 'prova #calculo 3/12');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prova ou trabalho' })).toHaveAttribute('aria-pressed', 'true'));
    await user.click(row('Data: qui 03/12'));
    await user.click(screen.getByRole('button', { name: 'Amanhã' }));
    await user.clear(input);
    await user.type(input, 'integrais');
    expect(screen.getByRole('button', { name: 'Prova ou trabalho' })).toHaveAttribute('aria-pressed', 'true');
    expect(row('Data: amanhã')).toBeInTheDocument();
  });

  it('colar 3 linhas, Compromisso (uma linha), Tarefa: as 3 linhas voltam', async () => {
    const user = setup();
    const input = await open();
    await user.click(input);
    await user.paste('um\ndois\ntrês');
    await user.click(screen.getByRole('button', { name: 'Compromisso' }));
    expect(input).toHaveValue('um dois três');
    await user.click(screen.getByRole('button', { name: 'Tarefa' }));
    expect(input).toHaveValue('um\ndois\ntrês');
  });

  it('Nova jornada: Enter e "Usar este nome" devolvem o foco ao chip, nunca ao body', async () => {
    const user = setup();
    await open();
    await user.click(row('Jornada: Nenhuma'));
    await user.click(screen.getByRole('button', { name: 'Nova jornada…' }));
    await user.type(screen.getByLabelText('Nome da nova jornada'), 'Leituras{Enter}');
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'Nova jornada…' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Nova jornada…' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Nova jornada…' }));
    const field = screen.getByLabelText('Nome da nova jornada');
    await user.clear(field);
    await user.type(field, 'Outra');
    await user.click(screen.getByRole('button', { name: 'Usar este nome' }));
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'Nova jornada…' })).toHaveFocus();
  });

  it('o campo da nova jornada fecha ao tocar outra jornada ou Nenhuma', async () => {
    const user = setup();
    await open();
    await user.click(row('Jornada: Nenhuma'));
    await user.click(screen.getByRole('button', { name: 'Nova jornada…' }));
    expect(screen.getByLabelText('Nome da nova jornada')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tech News' }));
    expect(screen.queryByLabelText('Nome da nova jornada')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nova jornada…' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Nova jornada…' }));
    await user.click(screen.getByRole('button', { name: 'Nenhuma' }));
    expect(screen.queryByLabelText('Nome da nova jornada')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nova jornada…' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('o painel que abre rola para dentro da vista', async () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    try {
      const user = setup();
      await open();
      await user.click(row('Duração: —'));
      expect(spy).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('"Cadastrar em Matérias" fecha o "+" e vai para /estudo/materias', async () => {
    const user = setup();
    useCaptureStore.getState().open();
    render(<CaptureHost />);
    await user.click(await screen.findByRole('button', { name: 'Prova ou trabalho' }));
    await user.click(row('Matéria: —'));
    await user.click(screen.getByRole('link', { name: 'Cadastrar em Matérias' }));
    expect(useCaptureStore.getState().isOpen).toBe(false);
    await waitFor(() => expect(window.location.pathname).toBe('/estudo/materias'));
  });

  it('desmarcar o último dia da semana tira também o Até', async () => {
    const user = setup();
    const input = await open();
    await user.click(screen.getByRole('button', { name: 'Compromisso' }));
    await user.type(input, 'Aula');
    await user.click(row('Toda semana: Não'));
    await user.click(screen.getByRole('button', { name: 'terça' }));
    await user.click(row('Até (opcional): —'));
    fireEvent.change(screen.getByLabelText('Até (opcional)', { selector: 'input' }), { target: { value: '2026-12-17' } });
    await user.click(row('Toda semana: ter'));
    await user.click(screen.getByRole('button', { name: 'terça' }));
    expect(screen.queryByRole('button', { name: /^Até/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'terça' }));
    expect(row('Até (opcional): —')).toBeInTheDocument();
  });
});
