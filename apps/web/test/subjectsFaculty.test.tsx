import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEMESTER_GRADE } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import {
  addTopic, createAssessment, saveProblemSet, setTopicLevel, setupSemester,
} from '../src/domain/facultyActions';
import { ProblemSetSheetHost } from '../src/features/faculty/ProblemSetSheet';
import { useSemesterCard } from '../src/features/faculty/SemesterCard';
import { SubjectDetailScreen } from '../src/features/faculty/SubjectDetailScreen';
import { SubjectsScreen } from '../src/features/study/SubjectsScreen';
import { ToastHost } from '../src/ui/Toast';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  useSemesterCard.setState({ hidden: false });
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); window.history.pushState({}, '', '/'); });

const counts = async () => [
  await db.journeys.count(), await db.commitments.count(), await db.areas.count(), await db.outbox.count(),
];
const subjectId = async (title: string): Promise<string> =>
  (await db.journeys.toArray()).find((j) => j.title === title)!.id;

describe('Matérias · grade do semestre', () => {
  it('lista a grade sem gravar; "Confirmar" cadastra e o card some', async () => {
    const before = await counts();
    render(<><SubjectsScreen /><ToastHost /></>);
    const card = await screen.findByRole('region', { name: 'Cadastrar a grade do semestre?' });
    expect(within(card).getByText('seg · Estruturas de Dados · 19:30–22:30')).toBeInTheDocument();
    expect(within(card).getByText('sex · Engenharia de Software · 19:30–22:30')).toBeInTheDocument();
    expect(await counts()).toEqual(before);

    await userEvent.click(within(card).getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Grade cadastrada: 5 disciplinas.')).toBeInTheDocument();
    expect((await db.journeys.toArray()).filter((j) => j.subject === true)).toHaveLength(5);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Cadastrar a grade do semestre?' })).toBeNull());
    expect(await screen.findByRole('button', { name: 'Nova prova ou trabalho' })).toBeInTheDocument();
  });

  it('"Agora não" esconde o card sem gravar', async () => {
    const before = await counts();
    render(<SubjectsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Agora não' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Cadastrar a grade do semestre?' })).toBeNull());
    expect(await counts()).toEqual(before);
    expect(screen.getByRole('button', { name: 'Nova disciplina' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nova prova ou trabalho' })).toBeNull();
  });

  it('"Editar antes": troca o nome da 1ª linha e confirma', async () => {
    render(<SubjectsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar antes' }));
    const name = screen.getByLabelText('Nome da disciplina 1');
    await userEvent.clear(name);
    await userEvent.type(name, 'Algoritmos e Estruturas II');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(async () => {
      expect((await db.journeys.toArray()).some((j) => j.title === 'Algoritmos e Estruturas II' && j.subject === true)).toBe(true);
    });
  });

  it('"Nova disciplina" cria a disciplina e a aula', async () => {
    render(<><SubjectsScreen /><ToastHost /></>);
    await userEvent.click(await screen.findByRole('button', { name: 'Nova disciplina' }));
    await userEvent.type(screen.getByLabelText('Nome'), 'Física');
    await userEvent.click(screen.getByRole('button', { name: 'qua' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Disciplina “Física” criada.')).toBeInTheDocument();
    const c = (await db.commitments.toArray()).find((x) => x.title === 'Física');
    expect(c).toMatchObject({ weekdays: [3], start: '19:30', end: '22:30' });
  });

  it('sem nome, a folha mostra o erro', async () => {
    render(<SubjectsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Nova disciplina' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Dê um nome à disciplina.');
  });
});

describe('Matérias · card da disciplina', () => {
  it('mostra aula, próxima avaliação, exercícios e assuntos', async () => {
    await setupSemester([...SEMESTER_GRADE]);
    const calc = await subjectId('Matemática Discreta');
    await createAssessment({ kind: 'prova', journeyId: calc, date: '2026-12-03' });
    await saveProblemSet({ journeyId: calc, day: '2026-11-13', title: 'Lista 4', done: 8, total: 10, unaided: 5 });
    const t = await addTopic(calc, 'Integrais');
    await setTopicLevel(t.id, 'resolvo');
    await addTopic(calc, 'Limites');

    render(<SubjectsScreen />);
    const card = await screen.findByRole('article', { name: 'Matemática Discreta' });
    expect(within(card).getByText('Aula: ter · 19:30–22:30')).toBeInTheDocument();
    expect(within(card).getByText('Próxima avaliação: Prova de Matemática Discreta · 03/12 · em 20 dias')).toBeInTheDocument();
    expect(within(card).getByText('Lista 4 · 8 de 10 · 5 sem ajuda')).toBeInTheDocument();
    expect(within(card).getByText('Assuntos: 1 resolvo sem ajuda · 1 ainda não')).toBeInTheDocument();
    expect(within(card).queryByText(/Próxima entrega/)).toBeNull();
    expect(within(card).queryByText(/min de revisão/)).toBeNull();
    expect(within(card).getByRole('link', { name: 'Abrir disciplina Matemática Discreta' })).toHaveAttribute('href', `/estudo/materias/${calc}`);
    expect(within(card).getByRole('button', { name: 'Registrar exercícios de Matemática Discreta' })).toBeInTheDocument();
  });

  it('sem nenhum contato desde a criação: "Sem contato há 6 dias de estudo"', async () => {
    vi.setSystemTime(new Date(2026, 10, 4, 10, 0));
    await setupSemester([...SEMESTER_GRADE]);
    vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
    render(<SubjectsScreen />);
    const card = await screen.findByRole('article', { name: 'Matemática Discreta' });
    expect(within(card).getByText('Sem contato há 6 dias de estudo')).toBeInTheDocument();
  });

  it('"Registrar exercícios" grava e avisa', async () => {
    await setupSemester([...SEMESTER_GRADE]);
    render(<><SubjectsScreen /><ProblemSetSheetHost /><ToastHost /></>);
    const card = await screen.findByRole('article', { name: 'Matemática Discreta' });
    await userEvent.click(within(card).getByRole('button', { name: 'Registrar exercícios de Matemática Discreta' }));
    await userEvent.type(screen.getByLabelText('Lista ou assunto'), 'Lista 1');
    await userEvent.type(screen.getByLabelText('Feitos'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Exercícios registrados: Lista 1 · 3 feitos.')).toBeInTheDocument();
  });
});

describe('SubjectDetailScreen', () => {
  it('assunto novo, nível com marca acrescentada, apagar exercício com Desfazer', async () => {
    await setupSemester([...SEMESTER_GRADE]);
    const calc = await subjectId('Matemática Discreta');
    const p = await saveProblemSet({ journeyId: calc, day: '2026-11-13', title: 'Lista 4', done: 8, total: 10 });
    render(<><SubjectDetailScreen id={calc} /><ToastHost /></>);
    expect(await screen.findByRole('heading', { level: 1, name: 'Matemática Discreta' })).toBeInTheDocument();
    expect(screen.getByText('Nenhuma prova ou trabalho cadastrado.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Novo assunto'), 'Integrais');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    const group = await screen.findByRole('radiogroup', { name: 'Integrais' });
    await userEvent.click(within(group).getByRole('radio', { name: 'Entendi' }));
    await waitFor(async () => {
      const t = (await db.subjectTopics.toArray())[0];
      expect(t?.marks.map((m) => m.level)).toEqual(['entendi']);
    });
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'Entendi' })).toBeChecked());
    expect(within(group).getByText('Entendi em 13/11')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Apagar Lista 4 de 13/11' }));
    expect(await screen.findByText('Registro apagado.')).toBeInTheDocument();
    expect((await db.problemSets.get(p.id))?.deleted).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    await waitFor(async () => expect((await db.problemSets.get(p.id))?.deleted).toBe(false));
    expect(await screen.findByRole('button', { name: 'Editar Lista 4 de 13/11' })).toBeInTheDocument();
  });

  it('abrir a tela não grava nada; id que não é disciplina mostra o aviso', async () => {
    await setupSemester([...SEMESTER_GRADE]);
    const calc = await subjectId('Matemática Discreta');
    const before = await counts();
    const topics = await db.subjectTopics.count();
    const { unmount } = render(<SubjectDetailScreen id={calc} />);
    await screen.findByRole('heading', { level: 1, name: 'Matemática Discreta' });
    expect(await counts()).toEqual(before);
    expect(await db.subjectTopics.count()).toBe(topics);
    unmount();
    render(<SubjectDetailScreen id="nada" />);
    expect(await screen.findByText('Disciplina não encontrada.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Matérias' })).toHaveAttribute('href', '/estudo/materias');
  });
});
