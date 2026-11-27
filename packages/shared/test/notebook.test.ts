import { describe, expect, it } from 'vitest';
import type { Deck, Journey, Mission, Note, StudyDoc, SubjectNotebook, SubjectTopic } from '../src/types';
import {
  ASSIST_CONTEXT_TABLES, ASSIST_LIMITS, ASSIST_RULES, PASTE_NOTEBOOK_RULE, buildAssistContext, notebookSectionOfKey, proposalItems,
  validateProposal,
} from '../src/assist';
import { PROPOSAL_SCHEMA } from '../src/assistSchema';
import { pasteRequestText } from '../src/assistPaste';
import {
  NOTEBOOK_LIMITS, bibKey, charsText, cutText, excerpt, httpsUrlIssue, mergeBib, notebookFilled, notebookId, openableBibUrl,
} from '../src/notebook';
import { STUDY_DOC_TABLES, SUBJECT_CONTEXT_TABLES, buildStudyDocView, buildSubjectContext } from '../src/subjectContext';
import { base } from './patternFixture';

// Caderno da disciplina, perfil de estudo e apostilas (spec 2026-11-26).

const TODAY = '2026-11-26';
const names = { areas: ['Estudo'], journeys: ['Banco de Dados', 'Cálculo I'], goals: [], subjects: ['Banco de Dados', 'Cálculo I'] };
const propose = (extra: Record<string, unknown>) => validateProposal({ title: 't', summary: 's', ...extra }, names, TODAY);
const study = (pkg: Record<string, unknown>, extra: Record<string, unknown> = {}) => propose({ study: [{ subject: 'Banco de Dados', ...pkg }], ...extra });
const elmasri = { title: 'Sistemas de Banco de Dados', authors: 'Elmasri e Navathe', kind: 'basica' };

describe('validateProposal: caderno, apostilas e perfil de estudo', () => {
  it('a package with only the notebook is valid; sections and books are kept as sent, trimmed', () => {
    const r = study({ notebook: {
      plan: '  # Ementa\nModelagem e SQL ', studied: 'Normalização até a 3FN', difficulties: 'Dependência transitiva',
      nextChat: 'Explique com exemplos de biblioteca.', bibliography: [{ ...elmasri, url: ' https://exemplo.test/livro ', note: 'Cap. 14 e 15' }],
    } });
    expect(r.issues).toEqual([]);
    expect(r.payload!.study![0]!.notebook).toEqual({
      plan: '# Ementa\nModelagem e SQL', studied: 'Normalização até a 3FN', difficulties: 'Dependência transitiva',
      nextChat: 'Explique com exemplos de biblioteca.',
      bibliography: [{ title: 'Sistemas de Banco de Dados', authors: 'Elmasri e Navathe', kind: 'basica', url: 'https://exemplo.test/livro', note: 'Cap. 14 e 15' }],
    });
  });

  it('a package with only docs is valid; an empty notebook alone is not', () => {
    const r = study({ docs: [{ title: 'Normalização passo a passo', markdown: '# 1FN\nValores atômicos.', why: 'Pedido na conversa.' }] });
    expect(r.issues).toEqual([]);
    expect(r.payload!.study![0]!.docs).toEqual([{ title: 'Normalização passo a passo', markdown: '# 1FN\nValores atômicos.', why: 'Pedido na conversa.' }]);
    expect(study({ notebook: {} }).issues).toEqual([{ path: 'study.0', message: expect.stringContaining('notebook') }]);
    expect(study({ topics: [{ name: 'Índices' }], notebook: {} }).issues).toEqual([
      { path: 'study.0.notebook', message: 'Mande pelo menos uma seção ou a bibliografia, ou deixe notebook de fora.' },
    ]);
    expect(study({ docs: [] }).issues[0]!.path).toBe('study.0');
    expect(study({ notebook: 'texto' }).issues[0]!.path).toBe('study.0.notebook');
  });

  it('limits of each section, the bibliography, the docs and the profile', () => {
    const path = (r: ReturnType<typeof propose>) => r.issues[0]?.path;
    expect(path(study({ notebook: { plan: 'x'.repeat(8000) } }))).toBeUndefined();
    expect(path(study({ notebook: { plan: 'x'.repeat(8001) } }))).toBe('study.0.notebook.plan');
    expect(path(study({ notebook: { studied: 'x'.repeat(4001) } }))).toBe('study.0.notebook.studied');
    expect(path(study({ notebook: { difficulties: 'x'.repeat(2001) } }))).toBe('study.0.notebook.difficulties');
    expect(path(study({ notebook: { nextChat: 'x'.repeat(4001) } }))).toBe('study.0.notebook.nextChat');
    expect(path(study({ notebook: { bibliography: Array.from({ length: 41 }, (_, i) => ({ title: `L${i}`, kind: 'outra' })) } }))).toBe('study.0.notebook.bibliography');
    expect(path(study({ notebook: { bibliography: [{ ...elmasri, title: 'x'.repeat(201) }] } }))).toBe('study.0.notebook.bibliography.0.title');
    expect(path(study({ notebook: { bibliography: [{ ...elmasri, authors: 'x'.repeat(201) }] } }))).toBe('study.0.notebook.bibliography.0.authors');
    expect(path(study({ notebook: { bibliography: [{ ...elmasri, note: 'x'.repeat(201) }] } }))).toBe('study.0.notebook.bibliography.0.note');
    expect(path(study({ docs: Array.from({ length: 4 }, (_, i) => ({ title: `A${i}`, markdown: 'm' })) }))).toBe('study.0.docs');
    expect(path(study({ docs: [{ title: 'x'.repeat(121), markdown: 'm' }] }))).toBe('study.0.docs.0.title');
    expect(path(study({ docs: [{ title: 'A', markdown: 'x'.repeat(40_000) }] }))).toBeUndefined();
    expect(path(study({ docs: [{ title: 'A', markdown: 'x'.repeat(40_001) }] }))).toBe('study.0.docs.0.markdown');
    expect(path(study({ docs: [{ title: 'A' }] }))).toBe('study.0.docs.0.markdown');
    expect(path(propose({ studyProfile: { text: 'x'.repeat(3000) } }))).toBeUndefined();
    expect(path(propose({ studyProfile: { text: 'x'.repeat(3001) } }))).toBe('studyProfile.text');
    expect(path(propose({ studyProfile: 'aprendo fazendo' }))).toBe('studyProfile');
  });

  it('a book needs a title and a kind (basica, complementar or outra); its link must be https://', () => {
    const book = (b: Record<string, unknown>) => study({ notebook: { bibliography: [{ ...elmasri, ...b }] } }).issues;
    expect(book({ kind: 'livro' })).toEqual([{ path: 'study.0.notebook.bibliography.0.kind', message: 'Tipo: basica, complementar ou outra.' }]);
    expect(book({ title: ' ' })[0]!.path).toBe('study.0.notebook.bibliography.0.title');
    expect(book({ url: 'http://exemplo.test/livro' })).toEqual([{ path: 'study.0.notebook.bibliography.0.url', message: 'O link precisa começar com https://.' }]);
    expect(book({ url: 'javascript:alert(1)' })[0]!.path).toBe('study.0.notebook.bibliography.0.url');
    expect(book({ url: `https://exemplo.test/${'x'.repeat(500)}` })[0]!.path).toBe('study.0.notebook.bibliography.0.url');
    expect(book({ kind: 'complementar', url: 'https://exemplo.test/l' })).toEqual([]);
    expect(book({ kind: 'outra', authors: undefined })).toEqual([]);
  });

  it('the profile alone is a proposal with one item; a profile with why keeps it', () => {
    const r = propose({ studyProfile: { text: ' Aprendo melhor com exemplos. ', why: 'Você contou na conversa.' } });
    expect(r.issues).toEqual([]);
    expect(r.payload!.studyProfile).toEqual({ text: 'Aprendo melhor com exemplos.', why: 'Você contou na conversa.' });
    expect(proposalItems(r.payload!)).toHaveLength(1);
  });

  it('notebook sections, books and docs count toward the 80 items', () => {
    const books = Array.from({ length: 40 }, (_, i) => ({ title: `Livro ${i}`, kind: 'outra' }));
    const r = propose({ study: [
      { subject: 'Banco de Dados', notebook: { plan: 'p', bibliography: books } },
      { subject: 'Cálculo I', notebook: { plan: 'p', bibliography: books } },
    ] });
    expect(r.issues[0]!.message).toMatch(/No máximo 80 itens por proposta \(esta tem 82\)/);
  });

  it('the schema mirrors the limits and the package rule; the body limit fits an apostila of 40 thousand characters', () => {
    const pkg = PROPOSAL_SCHEMA.properties.study.items;
    expect(pkg.minProperties).toBe(2);
    expect(pkg.description).toMatch(/pelo menos um de topics, cards, assessments, missions, notebook ou docs/);
    // An empty notebook is refused by both (minProperties: 1), without anyOf in the schema.
    expect(pkg.properties.notebook.minProperties).toBe(1);
    expect(JSON.stringify(PROPOSAL_SCHEMA)).not.toMatch(/anyOf|oneOf/);
    const nb = pkg.properties.notebook.properties;
    expect([nb.plan.maxLength, nb.studied.maxLength, nb.difficulties.maxLength, nb.nextChat.maxLength]).toEqual([8000, 4000, 2000, 4000]);
    expect(nb.bibliography.maxItems).toBe(40);
    expect(nb.bibliography.items.required).toEqual(['title', 'kind']);
    expect(nb.bibliography.items.properties.kind.enum).toEqual(['basica', 'complementar', 'outra']);
    expect(nb.bibliography.items.properties.url.pattern).toBe('^https://');
    expect(pkg.properties.docs.maxItems).toBe(3);
    expect(pkg.properties.docs.items.properties.markdown.maxLength).toBe(40_000);
    expect(pkg.properties.docs.items.properties.title.maxLength).toBe(120);
    expect(PROPOSAL_SCHEMA.properties.studyProfile.properties.text.maxLength).toBe(3000);
    expect(PROPOSAL_SCHEMA.properties.studyProfile.required).toEqual(['text']);
    expect(ASSIST_LIMITS.bodyBytes).toBe(256 * 1024);
    const doc = 'Normalização é a técnica de organização. Ação, função, lição! $x^2$\n'.repeat(600).slice(0, 40_000);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'enviar_proposta', arguments: {
      title: 't', summary: 's', study: [{ subject: 'Banco de Dados', docs: [{ title: 'Apostila', markdown: doc }], notebook: { plan: 'x'.repeat(8000) } }],
    } } });
    expect(new TextEncoder().encode(body).length).toBeLessThan(ASSIST_LIMITS.bodyBytes / 2);
  });
});

describe('proposalItems: caderno, bibliografia, apostilas e perfil', () => {
  const payload = validateProposal({
    title: 't', summary: 's',
    subjects: [{ title: 'Banco de Dados' }],
    studyProfile: { text: 'Aprendo melhor com exemplos concretos e exercícios curtos.' },
    study: [{
      subject: 'Banco de Dados',
      topics: [{ name: 'Normalização' }],
      notebook: {
        plan: 'Ementa: modelagem.', studied: 'Até a 3FN.', difficulties: 'x'.repeat(400), nextChat: 'Comece revisando a 2FN.',
        bibliography: [
          { title: 'Sistemas de Banco de Dados', authors: 'Elmasri e Navathe', kind: 'basica', url: 'https://exemplo.test/livro', note: 'Cap. 14' },
          { title: 'Apostila do professor', kind: 'outra' },
        ],
      },
      docs: [{ title: 'Normalização passo a passo', markdown: 'n'.repeat(12_000) }, { title: 'Lista curta', markdown: 'Exercício 1' }],
    }],
  }, names, TODAY).payload!;
  const items = proposalItems(payload);
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]));

  it('the profile opens the Estudo group, after the subjects; then each package in its order', () => {
    expect(items.map((i) => i.key)).toEqual([
      'subjects.0', 'studyProfile', 'study.0.topics.0', 'study.0.plan.0', 'study.0.studied.0', 'study.0.difficulties.0',
      'study.0.nextChat.0', 'study.0.bibliography.0', 'study.0.bibliography.1', 'study.0.docs.0', 'study.0.docs.1',
    ]);
    expect(items.filter((i) => i.key !== 'subjects.0').every((i) => i.group === 'study')).toBe(true);
  });

  it('the texts of the spec', () => {
    expect(byKey.studyProfile!.text).toBe('Perfil de estudo (substitui o atual)');
    expect(byKey['study.0.plan.0']!.text).toBe('Caderno · Banco de Dados: Plano de ensino (substitui o atual)');
    expect(byKey['study.0.studied.0']!.text).toBe('Caderno · Banco de Dados: O que já foi estudado (substitui o atual)');
    expect(byKey['study.0.difficulties.0']!.text).toBe('Caderno · Banco de Dados: Dificuldades (substitui o atual)');
    expect(byKey['study.0.nextChat.0']!.text).toBe('Caderno · Banco de Dados: Para o próximo chat (substitui o atual)');
    expect(byKey['study.0.bibliography.0']!.text).toBe('Bibliografia · Banco de Dados: Sistemas de Banco de Dados — Elmasri e Navathe (básica)');
    expect(byKey['study.0.bibliography.1']!.text).toBe('Bibliografia · Banco de Dados: Apostila do professor (outra)');
    expect(byKey['study.0.docs.0']!.text).toBe('Apostila · Banco de Dados: Normalização passo a passo · 12 mil caracteres');
    expect(byKey['study.0.docs.1']!.text).toBe('Apostila · Banco de Dados: Lista curta · 11 caracteres');
  });

  it('the detail shows the start of the text (up to 300 characters, with "…"), the link and the note of the book', () => {
    expect(byKey.studyProfile!.detail).toEqual(['Aprendo melhor com exemplos concretos e exercícios curtos.']);
    expect(byKey['study.0.plan.0']!.detail).toEqual(['Ementa: modelagem.']);
    const long = byKey['study.0.difficulties.0']!.detail![0]!;
    expect(long).toHaveLength(300);
    expect(long.endsWith('…')).toBe(true);
    expect(byKey['study.0.docs.0']!.detail![0]!).toHaveLength(300);
    expect(byKey['study.0.bibliography.0']!.detail).toEqual(['Link: https://exemplo.test/livro', 'Observação: Cap. 14']);
    expect(byKey['study.0.bibliography.1']!.detail).toBeUndefined();
  });

  it('notebookSectionOfKey tells a section item apart', () => {
    expect(notebookSectionOfKey('study.0.plan.0')).toBe('plan');
    expect(notebookSectionOfKey('study.2.nextChat.0')).toBe('nextChat');
    expect(notebookSectionOfKey('study.0.bibliography.0')).toBeUndefined();
    expect(notebookSectionOfKey('studyProfile')).toBeUndefined();
    expect(notebookSectionOfKey('missions.0')).toBeUndefined();
  });
});

describe('notebook helpers', () => {
  const list = [{ title: 'Sistemas de Banco de Dados', authors: 'Elmasri e Navathe', kind: 'basica' as const, url: 'https://exemplo.test/l' }];
  it('mergeBib: same title and fields already existed; other fields update; new books go last; 40 is full', () => {
    expect(mergeBib(list, { title: '  sistemas de banco  de DADOS ', authors: 'Elmasri e Navathe', kind: 'basica', url: 'https://exemplo.test/l' })).toEqual({ result: 'existed' });
    expect(mergeBib(list, { title: 'Sistemas de Banco de Dados', kind: 'complementar', note: 'Cap. 3' })).toEqual({
      result: 'applied', bibliography: [{ title: 'Sistemas de Banco de Dados', kind: 'complementar', note: 'Cap. 3' }],
    });
    expect(mergeBib(list, { title: 'Introdução a SQL', kind: 'outra' })).toEqual({ result: 'applied', bibliography: [...list, { title: 'Introdução a SQL', kind: 'outra' }] });
    const full = Array.from({ length: NOTEBOOK_LIMITS.bibliography }, (_, i) => ({ title: `L${i}`, kind: 'outra' as const }));
    expect(mergeBib(full, { title: 'Novo', kind: 'outra' })).toEqual({ result: 'full' });
    expect(mergeBib(full, { title: 'l3', kind: 'outra' })).toEqual({ result: 'existed' });
  });
  it('keys, texts and links', () => {
    expect(bibKey('  Normalização  Passo ')).toBe('normalizacao passo');
    expect(notebookId('j1')).toBe('notebook-j1');
    expect(charsText(1)).toBe('1 caractere');
    expect(charsText(850)).toBe('850 caracteres');
    expect(charsText(999)).toBe('999 caracteres');
    expect(charsText(1000)).toBe('mil caracteres');
    expect(charsText(1049)).toBe('mil caracteres');
    expect(charsText(1499)).toBe('1,5 mil caracteres');
    expect(charsText(9949)).toBe('9,9 mil caracteres');
    expect(charsText(9960)).toBe('10 mil caracteres');
    expect(charsText(12_345)).toBe('12 mil caracteres');
    expect(charsText(40_000)).toBe('40 mil caracteres');
    expect(cutText('abcdef', 4)).toBe('abc…');
    expect(cutText('abc', 4)).toBe('abc');
    expect(excerpt('linha 1\n\nlinha 2')).toBe('linha 1 linha 2');
    expect(httpsUrlIssue('https://exemplo.test', 500)).toBeUndefined();
    expect(httpsUrlIssue('', 500)).toBeUndefined();
    expect(httpsUrlIssue('ftp://x', 500)).toBe('O link precisa começar com https://.');
    expect(openableBibUrl({ url: 'https://exemplo.test/l' })).toBe('https://exemplo.test/l');
    expect(openableBibUrl({ url: 'http://exemplo.test/l' })).toBeUndefined();
    expect(openableBibUrl({})).toBeUndefined();
  });
  it('notebookFilled: some section or some book', () => {
    expect(notebookFilled(undefined)).toBe(false);
    expect(notebookFilled({ bibliography: [] })).toBe(false);
    expect(notebookFilled({ bibliography: [], plan: '  ' })).toBe(false);
    expect(notebookFilled({ bibliography: [], nextChat: 'x' })).toBe(true);
    expect(notebookFilled({ bibliography: [{ title: 'L', kind: 'outra' }] })).toBe(true);
  });
});

// ------------------------------------------------------------------ ler_disciplina and ler_apostila

const journey = (id: string, title: string, p: Partial<Journey> = {}): Journey => ({ ...base, id, title, status: 'active', order: 0, subject: true, ...p });
const note = (id: string, deckId: string | undefined, front: string, p: Partial<Note> = {}): Note => ({ ...base, id, deckId, type: 'basic', front, back: `verso de ${front}`, draft: false, ...p });
const mission = (p: Partial<Mission>): Mission => ({ ...base, id: 'm', title: 'x', status: 'open', checklist: [], important: false, shrunk: false, postponeCount: 0, ...p } as Mission);

const notebook: SubjectNotebook = {
  ...base, id: 'notebook-bd', journeyId: 'bd', plan: 'Ementa de BD', nextChat: 'Use exemplos de biblioteca.',
  bibliography: [{ title: 'Sistemas de Banco de Dados', authors: 'Elmasri e Navathe', kind: 'basica', url: 'https://exemplo.test/l' }],
};
const tables = {
  profile: [{ ...base, id: 'me', name: 'Lia', companionName: 'Brasa', onboarded: true, look: { skin: 0, hair: 0, hairColor: 0, outfit: 0 }, studyProfile: 'Aprendo com exemplos.' }],
  settings: [{ ...base, id: 'settings', dayStartHour: 4, dayEndHour: 23, pomodoro: { focusMin: 25, breakMin: 5 }, companionMuted: false, commitmentReminderMin: 10 }],
  journeys: [
    journey('bd', 'Banco de Dados', { order: 0 }), journey('calc', 'Cálculo I', { order: 1 }),
    journey('fis', 'Física I', { order: 2, status: 'archived' }), journey('proj', 'Projeto pessoal', { order: 3, subject: undefined }),
  ],
  commitments: [{ ...base, id: 'c1', title: 'Banco de Dados', date: '2026-08-05', start: '19:30', end: '22:30', weekdays: [3], remind: true }],
  missions: [
    mission({ id: 'a1', journeyId: 'bd', assessment: 'prova', date: '2026-12-10', deadline: '2026-12-10', notes: 'Normalização e SQL' }),
    mission({ id: 'a2', journeyId: 'bd', assessment: 'trabalho', date: '2026-11-20', deadline: '2026-11-20', status: 'done' }),
    mission({ id: 'a3', journeyId: 'bd', assessment: 'prova', date: '2026-11-10', deadline: '2026-11-10' }),
    mission({ id: 'a4', journeyId: 'bd', assessment: 'prova', date: '2026-12-01', deadline: '2026-12-01', status: 'dropped' }),
    mission({ id: 'a5', journeyId: 'calc', assessment: 'prova', date: '2026-12-02', deadline: '2026-12-02' }),
    mission({ id: 'm1', journeyId: 'bd', title: 'Missão comum com nota secreta', notes: 'nota da missão comum' }),
  ],
  subjectTopics: [
    { ...base, id: 't1', journeyId: 'bd', name: 'Normalização', marks: [{ at: 1, level: 'entendi' }] },
    { ...base, id: 't2', journeyId: 'bd', name: 'Índices', marks: [] },
    { ...base, id: 't3', journeyId: 'calc', name: 'Limites', marks: [] },
  ] as SubjectTopic[],
  subjectNotebooks: [notebook, { ...base, id: 'notebook-calc', journeyId: 'calc', plan: 'Ementa de cálculo secreta', bibliography: [] }],
  studyDocs: [
    { ...base, id: 'doc1', journeyId: 'bd', title: 'Normalização passo a passo', markdown: 'texto completo da apostila', source: 'ChatGPT', updatedAt: new Date(2026, 10, 25, 10).getTime() },
    { ...base, id: 'doc2', journeyId: 'bd', title: 'Apagada', markdown: 'x', source: 'ChatGPT', deleted: true },
    { ...base, id: 'doc3', journeyId: 'calc', title: 'Limites', markdown: 'apostila de cálculo', source: 'Você' },
  ] as StudyDoc[],
  decks: [
    { ...base, id: 'd1', name: 'BD', journeyId: 'bd', order: 0, archived: false },
    { ...base, id: 'd2', name: 'SQL antigo', journeyId: 'bd', order: 1, archived: true },
    { ...base, id: 'd3', name: 'Inglês', order: 2, archived: false },
    { ...base, id: 'd4', name: 'Cálculo', journeyId: 'calc', order: 3, archived: false },
  ] as Deck[],
  notes: [
    note('n1', 'd1', 'O que é a 3FN?', { updatedAt: 30 }),
    note('n2', 'd2', 'O que é um índice?', { updatedAt: 20 }),
    note('n3', 'd1', 'Rascunho', { draft: true, updatedAt: 40 }),
    note('n4', 'd1', 'Apagada', { deleted: true, updatedAt: 50 }),
    note('n5', 'd3', 'Frente do baralho de inglês', { updatedAt: 60 }),
    note('n6', 'd4', 'Frente do baralho de cálculo', { updatedAt: 70 }),
    note('n7', undefined, 'Rascunho da caixa de entrada', { draft: true }),
    note('n8', 'd1', 'L'.repeat(300), { type: 'topic', back: 'P'.repeat(300), updatedAt: 10 }),
  ],
  diaryEntries: [{ ...base, id: 'di1', text: 'texto do diário' }],
  sleepLogs: [{ ...base, id: 's1', night: '2026-10-02', quality: 2 }],
  checkins: [{ ...base, id: 'ck1', note: 'checkin secreto' }],
  strategies: [{ ...base, id: 'st1', title: 'estratégia secreta' }],
};

describe('buildSubjectContext (ler_disciplina)', () => {
  const r = buildSubjectContext(tables as never, '  banco de DADOS ', TODAY);
  const ctx = r.ok ? r.context : undefined;

  it('finds the subject by name (accents, case and spaces ignored) and brings the notebook and the profile', () => {
    expect(ctx).toBeDefined();
    expect(ctx!.subject).toBe('Banco de Dados');
    expect(ctx!.class).toBe('qua 19:30–22:30');
    expect(ctx!.studyProfile).toBe('Aprendo com exemplos.');
    expect(ctx!.notebook).toEqual({
      plan: 'Ementa de BD', studied: '', difficulties: '', nextChat: 'Use exemplos de biblioteca.',
      bibliography: [{ title: 'Sistemas de Banco de Dados', authors: 'Elmasri e Navathe', kind: 'basica', url: 'https://exemplo.test/l' }],
    });
    expect(ctx!.otherSubjects).toEqual(['Cálculo I']);
  });

  it('topics with the current level; avaliações by date with content and whether past or done (dropped ones left out)', () => {
    expect(ctx!.topics).toEqual([{ name: 'Índices', level: 'Ainda não' }, { name: 'Normalização', level: 'Entendi' }]);
    expect(ctx!.assessments).toEqual([
      { kind: 'prova', date: '2026-11-10', done: false, past: true },
      { kind: 'trabalho', date: '2026-11-20', done: true, past: true },
      { kind: 'prova', date: '2026-12-10', content: 'Normalização e SQL', done: false, past: false },
    ]);
  });

  it('apostilas without their text, with the day of the last change', () => {
    expect(ctx!.docs).toEqual([{ id: 'doc1', title: 'Normalização passo a passo', chars: 26, updated: '2026-11-25' }]);
    expect(JSON.stringify(ctx)).not.toContain('texto completo da apostila');
  });

  it('cards: only notes of decks linked to the subject, newest first, without drafts or deleted ones, each side cut at 240', () => {
    expect(ctx!.cards.total).toBe(3);
    expect(ctx!.cards.items.map((c) => c.front.slice(0, 20))).toEqual(['O que é a 3FN?', 'O que é um índice?', 'L'.repeat(20)]);
    const long = ctx!.cards.items[2]!;
    expect(long.type).toBe('topic');
    expect(long.front).toHaveLength(240);
    expect(long.front.endsWith('…')).toBe(true);
    expect(long.back).toHaveLength(240);
  });

  it('at most 150 notes, the newest', () => {
    const many = Array.from({ length: 160 }, (_, i) => note(`x${i}`, 'd1', `Frente ${i}`, { updatedAt: 100 + i }));
    const big = buildSubjectContext({ ...tables, notes: many } as never, 'Banco de Dados', TODAY);
    if (!big.ok) throw new Error('subject');
    expect(big.context.cards.total).toBe(160);
    expect(big.context.cards.items).toHaveLength(NOTEBOOK_LIMITS.cards);
    expect(big.context.cards.items[0]!.front).toBe('Frente 159');
  });

  it('nothing of the diary, sleep, check-ins, strategies, other subjects or decks outside the subjects', () => {
    const json = JSON.stringify(ctx);
    for (const secret of [
      'texto do diário', '2026-10-02', 'checkin secreto', 'estratégia secreta', 'Frente do baralho de inglês',
      'Frente do baralho de cálculo', 'Ementa de cálculo secreta', 'apostila de cálculo', 'Rascunho', 'nota da missão comum',
      'Lia', 'Brasa',
    ]) expect(json).not.toContain(secret);
    for (const t of ['diaryEntries', 'sleepLogs', 'checkins', 'energyLogs', 'strategies', 'foods', 'foodLogs', 'weighIns', 'cards', 'reviews']) {
      expect(SUBJECT_CONTEXT_TABLES as readonly string[]).not.toContain(t);
    }
    expect([...STUDY_DOC_TABLES]).toEqual(['journeys', 'studyDocs']);
  });

  it('a name that is not an active subject gets the list of subjects', () => {
    const unknown = buildSubjectContext(tables as never, 'Projeto pessoal', TODAY);
    expect(unknown).toEqual({ ok: false, subjects: ['Banco de Dados', 'Cálculo I'], message: 'Disciplina "Projeto pessoal" não existe. As disciplinas do app são: Banco de Dados, Cálculo I.' });
    expect(buildSubjectContext(tables as never, 'Física I', TODAY).ok).toBe(false);
    expect(buildSubjectContext({}, 'Banco de Dados', TODAY)).toMatchObject({ ok: false, message: 'Disciplina "Banco de Dados" não existe. O app ainda não tem disciplinas.' });
    expect(buildSubjectContext(tables as never, '  ', TODAY)).toEqual({ ok: false, subjects: ['Banco de Dados', 'Cálculo I'], message: 'Informe o nome de uma disciplina: Banco de Dados, Cálculo I.' });
    expect(buildSubjectContext({}, '', TODAY)).toMatchObject({ ok: false, message: 'Informe o nome de uma disciplina. O app ainda não tem disciplinas.' });
  });

  it('a subject without notebook, profile or cards has empty sections and lists', () => {
    const empty = buildSubjectContext({ journeys: [journey('bd', 'Banco de Dados')] }, 'Banco de Dados', TODAY);
    expect(empty).toEqual({ ok: true, context: {
      subject: 'Banco de Dados', studyProfile: '', notebook: { plan: '', studied: '', difficulties: '', nextChat: '', bibliography: [] },
      topics: [], assessments: [], docs: [], files: [], cards: { total: 0, items: [] }, otherSubjects: [],
    } });
  });
});

describe('buildStudyDocView (ler_apostila)', () => {
  it('the title, the subject and the whole Markdown of a live apostila', () => {
    expect(buildStudyDocView(tables as never, 'doc1')).toEqual({ ok: true, doc: { id: 'doc1', title: 'Normalização passo a passo', subject: 'Banco de Dados', markdown: 'texto completo da apostila' } });
  });
  it('an unknown or deleted id, or an apostila outside a subject, is an error', () => {
    expect(buildStudyDocView(tables as never, 'doc2')).toEqual({ ok: false, message: 'Apostila "doc2" não existe. Use o id que ler_disciplina mostra em docs.' });
    expect(buildStudyDocView(tables as never, 'nada').ok).toBe(false);
    const outside = { ...tables, studyDocs: [{ ...base, id: 'doc9', journeyId: 'proj', title: 'X', markdown: 'y', source: 'Você' }] };
    expect(buildStudyDocView(outside as never, 'doc9').ok).toBe(false);
  });
});

describe('ler_contexto with the caderno', () => {
  it('each subject says whether its notebook has something and how many apostilas it has, never their contents', () => {
    expect(ASSIST_CONTEXT_TABLES as readonly string[]).toEqual(expect.arrayContaining(['subjectNotebooks', 'studyDocs']));
    for (const t of ['notes', 'decks', 'cards']) expect(ASSIST_CONTEXT_TABLES as readonly string[]).not.toContain(t);
    const ctx = buildAssistContext(tables as never, TODAY);
    expect(ctx.subjects.map((s) => [s.title, s.notebook, s.docs])).toEqual([['Banco de Dados', true, 1], ['Cálculo I', true, 1]]);
    const none = buildAssistContext({ journeys: [journey('bd', 'Banco de Dados')], subjectNotebooks: [{ ...base, id: 'notebook-bd', journeyId: 'bd', bibliography: [] }] }, TODAY);
    expect(none.subjects[0]).toMatchObject({ notebook: false, docs: 0 });
    const json = JSON.stringify(ctx);
    for (const secret of ['Ementa de BD', 'texto completo da apostila', 'Aprendo com exemplos', 'Elmasri']) expect(json).not.toContain(secret);
  });

  it('the rules: notebook says to call ler_disciplina first; privacy says what is read and what never is', () => {
    expect(ASSIST_RULES.notebook).toMatch(/chame ler_disciplina/);
    expect(ASSIST_RULES.notebook).toMatch(/nextChat/);
    expect(ASSIST_RULES.notebook).toMatch(/substitui o antigo/);
    expect(ASSIST_RULES.notebook).toMatch(/40 mil caracteres/);
    expect(ASSIST_RULES.privacy).toMatch(/estudo das disciplinas/);
    expect(ASSIST_RULES.privacy).toMatch(/perfil de estudo/);
    for (const never of ['diário', 'sono', 'nutrição', 'check-ins', 'energia', 'estratégias', 'baralhos fora das disciplinas']) {
      expect(ASSIST_RULES.privacy).toContain(never);
    }
    expect(PASTE_NOTEBOOK_RULE).not.toMatch(/ler_disciplina/);
  });
});

describe('pasteRequestText with the subject memory', () => {
  const r = buildSubjectContext(tables as never, 'Banco de Dados', TODAY);
  if (!r.ok) throw new Error('subject');
  const ctx = buildAssistContext(tables as never, TODAY);
  const text = pasteRequestText(ctx, TODAY, 'Banco de Dados', r.context);

  it('carries the same content as ler_disciplina at the end', () => {
    expect(text).toContain(JSON.stringify(r.context));
    expect(text.indexOf(JSON.stringify(r.context))).toBeGreaterThan(text.indexOf('Como o LIFE RPG está montado agora:'));
    expect(text).toContain('A memória da disciplina "Banco de Dados" no LIFE RPG');
    expect(text.split('\n\n')[0]).toContain('notebook');
  });

  it('never names a tool, and keeps the private tables out', () => {
    expect(text).not.toContain('chame ler_disciplina');
    expect(text).not.toContain('enviar_proposta');
    expect(text).toContain(PASTE_NOTEBOOK_RULE);
    for (const secret of ['texto do diário', 'checkin secreto', 'Frente do baralho de inglês']) expect(text).not.toContain(secret);
  });

  it('without the memory, the request has no subject memory part', () => {
    expect(pasteRequestText(ctx, TODAY, 'Banco de Dados')).not.toContain('A memória da disciplina');
  });

  it('the same content except the cards: only the 60 newest, and the header says of how many (ler_disciplina keeps 150)', () => {
    expect([NOTEBOOK_LIMITS.cards, NOTEBOOK_LIMITS.pasteCards]).toEqual([150, 60]);
    const many = Array.from({ length: 160 }, (_, i) => note(`x${i}`, 'd1', `Frente ${i}`, { updatedAt: 100 + i }));
    const big = buildSubjectContext({ ...tables, notes: many } as never, 'Banco de Dados', TODAY);
    if (!big.ok) throw new Error('subject');
    expect(big.context.cards.items).toHaveLength(150);
    const pasted = pasteRequestText(ctx, TODAY, 'Banco de Dados', big.context);
    expect(pasted).toContain('(caderno, perfil de estudo, assuntos, provas e trabalhos, apostilas, PDFs da aula e os 60 cards mais recentes de 160). Continue de onde o último chat parou:');
    const memory = JSON.parse(pasted.slice(pasted.lastIndexOf('\n') + 1)) as typeof big.context;
    expect(memory.cards.total).toBe(160);
    expect(memory.cards.items).toHaveLength(60);
    expect(memory.cards.items[0]!.front).toBe('Frente 159');
    expect(memory.cards.items[59]!.front).toBe('Frente 100');
    expect({ ...memory, cards: null }).toEqual({ ...big.context, cards: null });
    expect(text).toContain('apostilas, PDFs da aula e cards). Continue de onde o último chat parou:');
  });
});
