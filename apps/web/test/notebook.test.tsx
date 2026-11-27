import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Proposal, ProposalPayload, StudyDoc, SubjectNotebook } from '@life/shared';
import { notebookId, proposalItems } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { createSubject } from '../src/domain/facultyActions';
import {
  NotebookValidationError, addBook, removeBook, restoreBook, saveStudyDoc, setNotebookSection, setStudyProfile,
} from '../src/domain/notebookActions';
import { applyProposal } from '../src/domain/proposalActions';
import { saveDeck, saveNote } from '../src/domain/studyActions';
import { ProposalScreen } from '../src/features/assist/ProposalScreen';
import { SubjectDetailScreen } from '../src/features/faculty/SubjectDetailScreen';
import { StudyDocScreen } from '../src/features/study/StudyDocScreen';
import { SubjectsScreen } from '../src/features/study/SubjectsScreen';
import { ToastHost, useToast } from '../src/ui/Toast';

// Caderno da disciplina, perfil de estudo e apostilas (spec 2026-11-26 §3–§5).

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 26, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
});
afterEach(() => { vi.useRealTimers(); });

const bd = () => createSubject({ title: 'Banco de Dados', weekdays: [3], start: '19:30', end: '22:30' });
const notebookOf = async (journeyId: string) => db.subjectNotebooks.get(notebookId(journeyId));
const liveDocs = async (journeyId: string) => (await db.studyDocs.where('journeyId').equals(journeyId).toArray()).filter((d) => !d.deleted);
const proposal = (payload: ProposalPayload, source = 'ChatGPT') => put('proposals', newRecord<Proposal>({ id: 'p1', source, status: 'pending', payload }));
const studyProposal = (study: ProposalPayload['study'], extra: Partial<ProposalPayload> = {}, source?: string) =>
  proposal({ title: 'Do chat de BD', summary: 'O que vimos.', study, ...extra }, source);
const allKeys = async () => proposalItems((await db.proposals.get('p1'))!.payload).map((i) => i.key);
const outcomeOf = async (key: string) => (await db.proposals.get('p1'))!.outcome!.find((o) => o.key === key);
const elmasri = { title: 'Sistemas de Banco de Dados', authors: 'Elmasri e Navathe', kind: 'basica' as const, url: 'https://exemplo.test/elmasri' };

function renderAt(path: string, ui: React.ReactNode) {
  const loc = memoryLocation({ path, record: true });
  render(<Router hook={loc.hook} searchHook={loc.searchHook}>{ui}<ToastHost /></Router>);
  return { get path() { return loc.history![loc.history!.length - 1]!; } };
}

/** The selectors of a list, split at the commas outside parentheses. */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** [classes + attributes + pseudo-classes, elements]; `:is()`, `:not()` and `:has()` count their most specific argument. */
function specificity(sel: string): [number, number] {
  let b = 0;
  let c = 0;
  let rest = sel.replace(/:(is|not|has|where)\(([^()]*)\)/g, (_all, fn: string, args: string) => {
    if (fn !== 'where') {
      const best = splitSelectors(args).map(specificity).sort((x, y) => compareSpecificity(y, x))[0]!;
      b += best[0];
      c += best[1];
    }
    return ' ';
  });
  b += (rest.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  rest = rest.replace(/\.[\w-]+|\[[^\]]*\]|::?[\w-]+/g, ' ');
  c += (rest.match(/[a-zA-Z][\w-]*/g) ?? []).length;
  return [b, c];
}
const compareSpecificity = (x: [number, number], y: [number, number]): number => x[0] - y[0] || x[1] - y[1];

/** The inside of the `{ … }` block that opens after `at`. */
function blockAfter(css: string, at: number): string {
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return css.slice(open + 1);
}

describe('applyProposal: caderno, bibliografia, apostilas e perfil', () => {
  it('sections: the text sent replaces the current one; the same text "já existia"; the notebook is created when missing', async () => {
    const subject = await bd();
    await studyProposal([{ subject: 'banco de dados', notebook: { plan: '# Ementa\nModelagem e SQL', studied: 'Até a 2FN.' } }]);
    expect(await applyProposal('p1', await allKeys())).toMatchObject({ status: 'applied', applied: 2, existed: 0 });
    expect(await notebookOf(subject.id)).toMatchObject({ journeyId: subject.id, plan: '# Ementa\nModelagem e SQL', studied: 'Até a 2FN.', bibliography: [] });

    await db.proposals.clear();
    await studyProposal([{ subject: 'Banco de Dados', notebook: { plan: '# Ementa\nModelagem e SQL', studied: 'Até a 3FN.', nextChat: 'Use exemplos de biblioteca.' } }]);
    expect(await applyProposal('p1', await allKeys())).toMatchObject({ status: 'applied', applied: 2, existed: 1 });
    expect(await outcomeOf('study.0.plan.0')).toEqual({ key: 'study.0.plan.0', result: 'existed' });
    expect(await notebookOf(subject.id)).toMatchObject({ plan: '# Ementa\nModelagem e SQL', studied: 'Até a 3FN.', nextChat: 'Use exemplos de biblioteca.' });
    expect(await db.xpEvents.count()).toBe(0);
  });

  it('bibliography: merged by title; the same fields "já existia", others are updated, a new book goes last; with 40 books a new one is skipped', async () => {
    const subject = await bd();
    await addBook(subject.id, elmasri);
    await studyProposal([{ subject: 'Banco de Dados', notebook: { bibliography: [
      { ...elmasri, title: 'sistemas de banco de dados' },
      { title: 'Introdução a Sistemas de Bancos de Dados', authors: 'Date', kind: 'complementar' },
    ] } }]);
    expect(await applyProposal('p1', await allKeys())).toMatchObject({ applied: 1, existed: 1 });
    expect((await notebookOf(subject.id))!.bibliography.map((b) => b.title)).toEqual(['Sistemas de Banco de Dados', 'Introdução a Sistemas de Bancos de Dados']);

    await db.proposals.clear();
    await studyProposal([{ subject: 'Banco de Dados', notebook: { bibliography: [{ title: 'Sistemas de Banco de Dados', kind: 'basica', note: 'Cap. 14 e 15' }] } }]);
    expect(await applyProposal('p1', await allKeys())).toMatchObject({ applied: 1 });
    expect((await notebookOf(subject.id))!.bibliography[0]).toEqual({ title: 'Sistemas de Banco de Dados', kind: 'basica', note: 'Cap. 14 e 15' });

    for (let i = 0; i < 38; i++) await addBook(subject.id, { title: `Livro ${i}`, kind: 'outra' });
    await db.proposals.clear();
    await studyProposal([{ subject: 'Banco de Dados', notebook: { bibliography: [{ title: 'Livro novo', kind: 'outra' }, { title: 'livro 3', kind: 'basica' }] } }]);
    expect(await applyProposal('p1', await allKeys())).toMatchObject({ status: 'partial', applied: 1, skipped: 1 });
    expect(await outcomeOf('study.0.bibliography.0')).toEqual({ key: 'study.0.bibliography.0', result: 'skipped', reason: 'a bibliografia já tem 40 livros' });
    const books = (await notebookOf(subject.id))!.bibliography;
    expect(books).toHaveLength(40);
    expect(books.find((b) => b.title === 'Livro 3')!.kind).toBe('basica');
  });

  it('apostilas: a new one takes the proposal source; the same title with the same text "já existia"; another text replaces it', async () => {
    const subject = await bd();
    const doc = { title: 'Normalização passo a passo', markdown: '# 1FN\nValores atômicos.' };
    await studyProposal([{ subject: 'Banco de Dados', docs: [doc] }], {}, 'Claude');
    expect(await applyProposal('p1', await allKeys())).toMatchObject({ applied: 1 });
    const [created] = await liveDocs(subject.id);
    expect(created).toMatchObject({ journeyId: subject.id, title: 'Normalização passo a passo', markdown: '# 1FN\nValores atômicos.', source: 'Claude' });

    await db.proposals.clear();
    await studyProposal([{ subject: 'Banco de Dados', docs: [{ ...doc, title: 'NORMALIZAÇÃO  passo a passo' }, { title: 'Lista de SQL', markdown: '1. SELECT' }] }], {}, 'Colada de um chat');
    expect(await applyProposal('p1', await allKeys())).toMatchObject({ applied: 1, existed: 1 });
    expect((await liveDocs(subject.id)).map((d) => [d.title, d.source]).sort()).toEqual([['Lista de SQL', 'Colada de um chat'], ['Normalização passo a passo', 'Claude']]);

    await db.proposals.clear();
    await studyProposal([{ subject: 'Banco de Dados', docs: [{ ...doc, markdown: '# 1FN\nValores atômicos, sem grupos repetidos.' }] }]);
    expect(await applyProposal('p1', await allKeys())).toMatchObject({ applied: 1 });
    const updated = (await liveDocs(subject.id)).find((d) => d.id === created!.id)!;
    expect(updated.markdown).toBe('# 1FN\nValores atômicos, sem grupos repetidos.');
    expect(await liveDocs(subject.id)).toHaveLength(2);
    expect(await db.xpEvents.count()).toBe(0);
  });

  it('the study profile: replaced; the same text "já existia"', async () => {
    await proposal({ title: 'Perfil', summary: 's', studyProfile: { text: 'Aprendo com exemplos.' } });
    expect(await applyProposal('p1', ['studyProfile'])).toMatchObject({ status: 'applied', applied: 1 });
    expect((await db.profile.get('me'))!.studyProfile).toBe('Aprendo com exemplos.');
    await db.proposals.clear();
    await proposal({ title: 'Perfil', summary: 's', studyProfile: { text: 'Aprendo com exemplos.' } });
    expect(await applyProposal('p1', ['studyProfile'])).toMatchObject({ existed: 1 });
  });

  it('a subject created in the same proposal gets its notebook and apostila; without it they are skipped', async () => {
    await studyProposal([{ subject: 'Cálculo I', notebook: { plan: 'Limites e derivadas' }, docs: [{ title: 'Limites', markdown: '$\\lim_{x \\to 0}$' }] }], {
      subjects: [{ title: 'Cálculo I' }],
    });
    expect(await applyProposal('p1', ['study.0.plan.0'])).toMatchObject({ skipped: 1 });
    expect(await outcomeOf('study.0.plan.0')).toEqual({ key: 'study.0.plan.0', result: 'skipped', reason: 'a disciplina Cálculo I não existe' });

    await db.proposals.clear();
    await studyProposal([{ subject: 'Cálculo I', notebook: { plan: 'Limites e derivadas' }, docs: [{ title: 'Limites', markdown: 'x' }] }], { subjects: [{ title: 'Cálculo I' }] });
    expect(await applyProposal('p1', await allKeys())).toMatchObject({ status: 'applied', applied: 3 });
    const subject = (await db.journeys.toArray()).find((j) => j.title === 'Cálculo I')!;
    expect((await notebookOf(subject.id))!.plan).toBe('Limites e derivadas');
    expect(await liveDocs(subject.id)).toHaveLength(1);
  });

  it('the review: notebook items in Estudo; "Hoje está vazio." under an empty section and the empty profile only', async () => {
    const subject = await bd();
    await setNotebookSection(subject.id, 'studied', 'Até a 2FN.');
    await studyProposal([{ subject: 'Banco de Dados', notebook: {
      plan: 'Ementa nova', studied: 'Até a 3FN.', bibliography: [{ ...elmasri, note: 'Cap. 14' }],
    }, docs: [{ title: 'Normalização passo a passo', markdown: 'n'.repeat(12_000) }] }], { studyProfile: { text: 'Aprendo com exemplos.' } });
    renderAt('/propostas/p1', <ProposalScreen id="p1" />);
    const group = await screen.findByRole('region', { name: 'Estudo' });
    const item = (name: string) => within(group).getByRole('checkbox', { name }).closest('li')!;
    await waitFor(() => expect(item('Caderno · Banco de Dados: Plano de ensino (substitui o atual)')).toHaveTextContent('Hoje está vazio.'));
    expect(item('Caderno · Banco de Dados: Plano de ensino (substitui o atual)')).toHaveTextContent('Ementa nova');
    expect(item('Caderno · Banco de Dados: O que já foi estudado (substitui o atual)')).not.toHaveTextContent('Hoje está vazio.');
    expect(item('Perfil de estudo (substitui o atual)')).toHaveTextContent('Hoje está vazio.');
    const book = item('Bibliografia · Banco de Dados: Sistemas de Banco de Dados — Elmasri e Navathe (básica)');
    expect(book).toHaveTextContent('Link: https://exemplo.test/elmasri');
    expect(book).toHaveTextContent('Observação: Cap. 14');
    expect(item('Apostila · Banco de Dados: Normalização passo a passo · 12 mil caracteres')).toHaveTextContent('nnn…');
  });

  it('the review says, before applying, when an apostila will replace the text of one with the same title', async () => {
    const subject = await bd();
    await saveStudyDoc(subject.id, 'Normalização passo a passo', 'texto longo antigo', 'ChatGPT');
    await saveStudyDoc(subject.id, 'Lista de SQL', '1. SELECT', 'ChatGPT');
    await studyProposal([{ subject: 'Banco de Dados', docs: [
      { title: 'normalização  passo a passo', markdown: 'texto curto novo' },
      { title: 'Lista de SQL', markdown: '1. SELECT' },
      { title: 'Índices', markdown: 'B-tree' },
    ] }]);
    renderAt('/propostas/p1', <ProposalScreen id="p1" />);
    const group = await screen.findByRole('region', { name: 'Estudo' });
    const item = (name: RegExp) => within(group).getByRole('checkbox', { name }).closest('li')!;
    await waitFor(() => expect(item(/normalização passo a passo/)).toHaveTextContent('Já existe uma apostila com este título: o texto será substituído.'));
    expect(item(/Lista de SQL/)).toHaveTextContent('Já existe, será reaproveitado.');
    expect(item(/Lista de SQL/)).not.toHaveTextContent('substituído');
    expect(item(/Índices/)).not.toHaveTextContent('Já existe');
  });
});

describe('notebook actions', () => {
  it('limits and inputs the person can fix', async () => {
    const subject = await bd();
    await expect(setNotebookSection(subject.id, 'difficulties', 'x'.repeat(2001))).rejects.toThrow(new NotebookValidationError('Dificuldades pode ter até 2.000 caracteres.'));
    await expect(addBook(subject.id, { title: ' ', kind: 'basica' })).rejects.toThrow('Dê o título do livro.');
    await expect(addBook(subject.id, { title: 'L', kind: 'basica', url: 'http://exemplo.test' })).rejects.toThrow('O link precisa começar com https://.');
    await expect(setStudyProfile('x'.repeat(3001))).rejects.toThrow('O perfil de estudo pode ter até 3.000 caracteres.');
    expect(await notebookOf(subject.id)).toBeUndefined();
    expect(await saveStudyDoc(subject.id, 'A', 'texto', 'Você')).toBe('applied');
    expect(await saveStudyDoc(subject.id, 'a', 'texto', 'Você')).toBe('existed');
    await expect(saveStudyDoc(subject.id, 'B', '  \n ', 'Você')).rejects.toThrow(new NotebookValidationError('A apostila está vazia.'));
    await expect(saveStudyDoc(subject.id, 'B', 'x'.repeat(40_001), 'Você')).rejects.toThrow('A apostila pode ter até 40.000 caracteres.');
  });

  it('Desfazer of a deleted book never makes the bibliography pass 40', async () => {
    const subject = await bd();
    const books = Array.from({ length: 40 }, (_, i) => ({ title: `Livro ${i}`, kind: 'outra' as const }));
    await put('subjectNotebooks', newRecord<SubjectNotebook>({ id: notebookId(subject.id), journeyId: subject.id, bibliography: books }));
    const removed = (await removeBook(subject.id, 'Livro 3'))!;
    expect(await restoreBook(subject.id, removed.book, removed.index)).toBe('restored');
    expect((await notebookOf(subject.id))!.bibliography[3]!.title).toBe('Livro 3');
    const again = (await removeBook(subject.id, 'Livro 3'))!;
    await addBook(subject.id, { title: 'Livro novo', kind: 'basica' });
    expect(await restoreBook(subject.id, again.book, again.index)).toBe('full');
    const titles = (await notebookOf(subject.id))!.bibliography.map((b) => b.title);
    expect(titles).toHaveLength(40);
    expect(titles).not.toContain('Livro 3');
    expect(await restoreBook(subject.id, { title: 'livro 0', kind: 'outra' }, 0)).toBe('existed');
  });
});

describe('Caderno na página da disciplina', () => {
  it('each section starts empty; Editar and Salvar write it, rendered without HTML; Cancelar keeps it; an empty text empties it', async () => {
    const subject = await bd();
    const user = userEvent.setup();
    renderAt(`/estudo/materias/${subject.id}`, <SubjectDetailScreen id={subject.id} />);
    const panel = (await screen.findByRole('heading', { name: 'Caderno', level: 2 })).parentElement!;
    for (const title of ['Plano de ensino', 'O que já foi estudado', 'Dificuldades', 'Para o próximo chat', 'Bibliografia']) {
      expect(within(panel).getByRole('heading', { name: title, level: 3 })).toBeInTheDocument();
    }
    expect(within(panel).getAllByText('Vazio. Peça ao chat da matéria para preencher.')).toHaveLength(4);

    await user.click(within(panel).getByRole('button', { name: 'Editar Plano de ensino' }));
    const box = within(panel).getByLabelText('Texto de Plano de ensino');
    await user.click(box);
    await user.paste('# Ementa\n**SQL** e <img src=x onerror="alert(1)"> [ver](javascript:alert(1)) [site](https://exemplo.test/ementa)');
    await user.click(within(panel).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Caderno salvo.')).toBeInTheDocument();
    expect((await notebookOf(subject.id))!.plan).toContain('# Ementa');
    const plan = within(panel).getByRole('region', { name: 'Plano de ensino' });
    expect(within(plan).getByRole('heading', { name: 'Ementa', level: 4 })).toBeInTheDocument();
    expect(within(plan).getByText('SQL').tagName).toBe('STRONG');
    expect(plan.querySelector('img')).toBeNull();
    expect(plan).toHaveTextContent('<img src=x onerror="alert(1)">');
    expect(within(plan).getAllByRole('link')).toHaveLength(1);
    expect(within(plan).getByRole('link', { name: 'site' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(plan).getByRole('link', { name: 'site' })).toHaveAttribute('target', '_blank');

    await user.click(within(panel).getByRole('button', { name: 'Editar Plano de ensino' }));
    await user.clear(within(panel).getByLabelText('Texto de Plano de ensino'));
    await user.click(within(panel).getByRole('button', { name: 'Cancelar' }));
    expect((await notebookOf(subject.id))!.plan).toContain('# Ementa');
    expect(within(panel).getAllByText('Vazio. Peça ao chat da matéria para preencher.')).toHaveLength(3);

    await user.click(within(panel).getByRole('button', { name: 'Editar Plano de ensino' }));
    await user.clear(within(panel).getByLabelText('Texto de Plano de ensino'));
    await user.click(within(panel).getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect((await notebookOf(subject.id))!.plan).toBeUndefined());
    expect(await within(panel).findAllByText('Vazio. Peça ao chat da matéria para preencher.')).toHaveLength(4);
  });

  it('a long text shows cut with "Ver tudo"; a text over the limit shows the error and saves nothing', async () => {
    const subject = await bd();
    await setNotebookSection(subject.id, 'studied', Array.from({ length: 30 }, (_, i) => `- Assunto ${i}`).join('\n'));
    const user = userEvent.setup();
    renderAt(`/estudo/materias/${subject.id}`, <SubjectDetailScreen id={subject.id} />);
    const more = await screen.findByRole('button', { name: 'Ver tudo: O que já foi estudado' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(more.getAttribute('aria-controls')!)).toHaveClass('notebook__text--cut');
    await user.click(more);
    const less = screen.getByRole('button', { name: 'Ver menos: O que já foi estudado' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(less.getAttribute('aria-controls')!)).not.toHaveClass('notebook__text--cut');

    const hard = screen.getByRole('region', { name: 'Dificuldades' });
    await user.click(within(hard).getByRole('button', { name: 'Editar Dificuldades' }));
    const box = within(hard).getByLabelText('Texto de Dificuldades');
    await user.click(box);
    await user.paste('x'.repeat(2001));
    await user.click(within(hard).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('O texto pode ter até 2.000 caracteres.');
    expect((await notebookOf(subject.id))!.difficulties).toBeUndefined();
  });
});

describe('Bibliografia', () => {
  it('adds a book, opens only https links in a new tab, deletes it and undoes', async () => {
    const subject = await bd();
    const user = userEvent.setup();
    renderAt(`/estudo/materias/${subject.id}`, <SubjectDetailScreen id={subject.id} />);
    const bib = await screen.findByRole('region', { name: 'Bibliografia' });
    expect(within(bib).getByText('Nenhum livro ainda.')).toBeInTheDocument();

    await user.click(within(bib).getByRole('button', { name: 'Adicionar livro' }));
    await user.type(within(bib).getByLabelText('Título'), 'Sistemas de Banco de Dados');
    await user.type(within(bib).getByLabelText('Autores'), 'Elmasri e Navathe');
    await user.click(within(bib).getByRole('radio', { name: 'complementar' }));
    await user.type(within(bib).getByLabelText('Link (opcional)'), 'http://exemplo.test/livro');
    await user.click(within(bib).getByRole('button', { name: 'Salvar livro' }));
    expect(await within(bib).findByRole('alert')).toHaveTextContent('O link precisa começar com https://.');
    await user.clear(within(bib).getByLabelText('Link (opcional)'));
    await user.type(within(bib).getByLabelText('Link (opcional)'), 'https://exemplo.test/livro');
    await user.click(within(bib).getByRole('button', { name: 'Salvar livro' }));
    expect(await screen.findByText('Livro adicionado.')).toBeInTheDocument();
    const open = await within(bib).findByRole('link', { name: 'Abrir Sistemas de Banco de Dados' });
    expect(open).toHaveAttribute('href', 'https://exemplo.test/livro');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(bib).toHaveTextContent('Sistemas de Banco de Dados · Elmasri e Navathe · complementar');
    expect((await notebookOf(subject.id))!.bibliography).toEqual([
      { title: 'Sistemas de Banco de Dados', authors: 'Elmasri e Navathe', kind: 'complementar', url: 'https://exemplo.test/livro' },
    ]);

    await user.click(within(bib).getByRole('button', { name: 'Adicionar livro' }));
    await user.type(within(bib).getByLabelText('Título'), 'Apostila do professor');
    await user.click(within(bib).getByRole('button', { name: 'Salvar livro' }));
    await within(bib).findByText('Apostila do professor');
    expect(within(bib).queryByRole('link', { name: 'Abrir Apostila do professor' })).toBeNull();

    await user.click(within(bib).getByRole('button', { name: 'Apagar Sistemas de Banco de Dados' }));
    expect(await screen.findByText('Livro apagado.')).toBeInTheDocument();
    await waitFor(() => expect(within(bib).queryByText('Sistemas de Banco de Dados')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    await within(bib).findByText('Sistemas de Banco de Dados');
    expect((await notebookOf(subject.id))!.bibliography.map((b) => b.title)).toEqual(['Sistemas de Banco de Dados', 'Apostila do professor']);

    await user.click(within(bib).getByRole('button', { name: 'Adicionar livro' }));
    await user.type(within(bib).getByLabelText('Título'), 'sistemas de banco de dados');
    await user.click(within(bib).getByRole('button', { name: 'Salvar livro' }));
    expect(await within(bib).findByRole('alert')).toHaveTextContent('Esse livro já está na bibliografia.');
  });

  it('Desfazer when a proposal filled the bibliography meanwhile says it has 40 books and restores nothing', async () => {
    const subject = await bd();
    const books = Array.from({ length: 40 }, (_, i) => ({ title: `Livro ${i}`, kind: 'outra' as const }));
    await put('subjectNotebooks', newRecord<SubjectNotebook>({ id: notebookId(subject.id), journeyId: subject.id, bibliography: books }));
    const user = userEvent.setup();
    renderAt(`/estudo/materias/${subject.id}`, <SubjectDetailScreen id={subject.id} />);
    const bib = await screen.findByRole('region', { name: 'Bibliografia' });
    await user.click(await within(bib).findByRole('button', { name: 'Apagar Livro 7' }));
    expect(await screen.findByText('Livro apagado.')).toBeInTheDocument();
    await addBook(subject.id, { title: 'Livro da proposta', kind: 'basica' });
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(await screen.findByText('A bibliografia já tem 40 livros.')).toBeInTheDocument();
    const titles = (await notebookOf(subject.id))!.bibliography.map((b) => b.title);
    expect(titles).toHaveLength(40);
    expect(titles).not.toContain('Livro 7');
  });

  it('a stored link that is not https:// is never offered', async () => {
    const subject = await bd();
    await put('subjectNotebooks', newRecord<SubjectNotebook>({ id: notebookId(subject.id), journeyId: subject.id, bibliography: [
      { title: 'Livro estranho', kind: 'outra', url: 'javascript:alert(1)' },
    ] }));
    renderAt(`/estudo/materias/${subject.id}`, <SubjectDetailScreen id={subject.id} />);
    const bib = await screen.findByRole('region', { name: 'Bibliografia' });
    await within(bib).findByText('Livro estranho');
    expect(within(bib).queryByRole('link')).toBeNull();
  });
});

describe('Apostilas', () => {
  it('the list shows title, day and source, newest first; empty text; a tap opens the apostila', async () => {
    const subject = await bd();
    const user = userEvent.setup();
    const first = renderAt(`/estudo/materias/${subject.id}`, <SubjectDetailScreen id={subject.id} />);
    expect(await screen.findByText('Nenhuma apostila ainda. Peça ao chat da matéria uma apostila e para mandar ao LIFE RPG.')).toBeInTheDocument();
    await saveStudyDoc(subject.id, 'Lista de SQL', '1. SELECT', 'Colada de um chat');
    vi.setSystemTime(new Date(2026, 10, 27, 9, 0));
    await saveStudyDoc(subject.id, 'Normalização passo a passo', '# 1FN', 'ChatGPT');
    const panel = (await screen.findByRole('heading', { name: 'Apostilas', level: 2 })).parentElement!;
    await waitFor(() => expect(within(panel).getAllByRole('link').map((l) => l.textContent))
      .toEqual(['Normalização passo a passo · 27/11 · ChatGPT', 'Lista de SQL · 26/11 · Colada de um chat']));
    await user.click(within(panel).getAllByRole('link')[0]!);
    const [doc] = (await liveDocs(subject.id)).filter((d) => d.title === 'Normalização passo a passo');
    expect(first.path).toBe(`/estudo/apostila/${doc!.id}`);
  });

  it('the apostila screen: back to the subject, title, source and day, the rendered text, Salvar como PDF, Apagar with Desfazer', async () => {
    const subject = await bd();
    await saveStudyDoc(subject.id, 'Normalização passo a passo', [
      '# Primeira forma normal', 'Valores **atômicos**.', '', '```sql', 'SELECT * FROM aluno;', '```', '', '[Referência](https://exemplo.test/ref) e [mau](javascript:alert(1))',
    ].join('\n'), 'ChatGPT');
    const [doc] = await liveDocs(subject.id);
    const print = vi.fn();
    vi.stubGlobal('print', print);
    try {
      const user = userEvent.setup();
      const location = renderAt(`/estudo/apostila/${doc!.id}`, <StudyDocScreen id={doc!.id} />);
      expect(await screen.findByRole('heading', { name: 'Normalização passo a passo', level: 1 })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: '← Disciplina' })).toHaveAttribute('href', `/estudo/materias/${subject.id}`);
      expect(screen.getByText('ChatGPT · 26/11')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Primeira forma normal', level: 2 })).toBeInTheDocument();
      expect(screen.getByText('atômicos').tagName).toBe('STRONG');
      expect(screen.getByText('SELECT', { exact: false }).closest('pre')).not.toBeNull();
      const article = screen.getByRole('article');
      expect(within(article).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['https://exemplo.test/ref']);
      expect(within(article).getByRole('link', { name: 'Referência' })).toHaveAttribute('rel', 'noopener noreferrer');

      await user.click(screen.getByRole('button', { name: 'Salvar como PDF' }));
      expect(print).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: 'Apagar apostila' }));
      await waitFor(() => expect(location.path).toBe(`/estudo/materias/${subject.id}`));
      expect(await screen.findByText('Apostila apagada.')).toBeInTheDocument();
      expect((await db.studyDocs.get(doc!.id))!.deleted).toBe(true);
      await user.click(screen.getByRole('button', { name: 'Desfazer' }));
      await waitFor(async () => expect((await db.studyDocs.get(doc!.id))!.deleted).toBe(false));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the print sheet prints the headings and the other light texts dark, outranking the screen colours in any stylesheet order', () => {
    // jsdom does not apply @media print, so this compares the rules themselves: base.css loads before study.css, so
    // each print colour must beat its screen rule by specificity, never by order.
    const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .flatMap((m) => splitSelectors(m[1]!.trim()).map((sel) => ({ sel, body: m[2]! })));
    const base = read('src/styles/base.css');
    const start = base.indexOf('@media print');
    expect(start).toBeGreaterThan(-1);
    const printRules = rules(blockAfter(base, start)).filter((r) => /(^|[;\s])color:\s*#000/.test(r.body));
    const screenRules = rules(read('src/features/study/study.css')).filter((r) => /(^|[;\s])color:/.test(r.body));
    for (const [screenClass, printClass] of [['.rich__h', 'rich__h'], ['.rich__link', 'rich__link'], ['.tok--', 'tok'], ['.cloze', 'cloze']] as const) {
      const screenSel = screenRules.filter((r) => r.sel.includes(screenClass)).map((r) => r.sel);
      expect(screenSel.length).toBeGreaterThan(0);
      const printSel = printRules.map((r) => r.sel).filter((s) => new RegExp(`\\.${printClass}(?![\\w-])`).test(s) && s.includes('.studydoc'));
      expect(printSel.length).toBeGreaterThan(0);
      for (const sc of screenSel) {
        expect(printSel.some((ps) => compareSpecificity(specificity(ps), specificity(sc)) > 0), `${printClass} vs ${sc}`).toBe(true);
      }
    }
  });

  it('an unknown or deleted apostila says so', async () => {
    const subject = await bd();
    await put('studyDocs', newRecord<StudyDoc>({ id: 'gone', journeyId: subject.id, title: 'X', markdown: 'y', source: 'Você', deleted: true }));
    renderAt('/estudo/apostila/gone', <StudyDocScreen id="gone" />);
    expect(await screen.findByRole('heading', { name: 'Apostila não encontrada.' })).toBeInTheDocument();
  });
});

describe('Perfil de estudo em Matérias', () => {
  it('sits at the top with its line; Editar and Salvar write the profile', async () => {
    const user = userEvent.setup();
    renderAt('/estudo/materias', <SubjectsScreen />);
    const heading = await screen.findByRole('heading', { name: 'Perfil de estudo', level: 2 });
    expect(screen.getAllByRole('heading', { level: 2 })[0]).toBe(heading);
    expect(screen.getByText('Os chats de todas as matérias leem este perfil.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Editar Perfil de estudo' }));
    await user.click(screen.getByLabelText('Texto de Perfil de estudo'));
    await user.paste('Aprendo melhor com **exemplos** e exercícios curtos.');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Perfil de estudo salvo.')).toBeInTheDocument();
    expect((await db.profile.get('me'))!.studyProfile).toBe('Aprendo melhor com **exemplos** e exercícios curtos.');
    expect((await screen.findByText('exemplos')).tagName).toBe('STRONG');
  });
});

describe('Copiar pedido de estudo carries the subject memory', () => {
  it('the notebook, the profile and the cards of the subject decks only', async () => {
    const subject = await bd();
    await setNotebookSection(subject.id, 'nextChat', 'Use exemplos de biblioteca.');
    await setStudyProfile('Aprendo com exemplos.');
    const deck = await saveDeck({ name: 'BD', journeyId: subject.id });
    await saveNote({ deckId: deck.id, type: 'basic', front: 'O que é a 3FN?', back: 'Sem dependência transitiva.' });
    const other = await saveDeck({ name: 'Inglês' });
    await saveNote({ deckId: other.id, type: 'basic', front: 'Frente do baralho de inglês', back: 'b' });
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAt(`/estudo/materias/${subject.id}`, <SubjectDetailScreen id={subject.id} />);
    await user.click(await screen.findByRole('button', { name: 'Copiar pedido de estudo' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = String((writeText.mock.calls[0] as unknown[])[0]);
    expect(text).toContain('A memória da disciplina "Banco de Dados" no LIFE RPG');
    expect(text).toContain('Use exemplos de biblioteca.');
    expect(text).toContain('Aprendo com exemplos.');
    expect(text).toContain('O que é a 3FN?');
    expect(text).not.toContain('Frente do baralho de inglês');
  });
});
