import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { saveDeck, saveNote } from '../src/domain/studyActions';
import { DeckScreen } from '../src/features/study/DeckScreen';
import { NoteEditor } from '../src/features/study/NoteEditor';
import { noteStatus, noteTitle } from '../src/features/study/noteDraft';
import { ToastHost } from '../src/ui/Toast';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); window.history.pushState({}, '', '/'); });

const go = (path: string) => window.history.pushState({}, '', path);
const liveNotes = async () => (await db.notes.toArray()).filter((n) => !n.deleted);

describe('noteDraft helpers', () => {
  it('noteTitle: first meaningful line, answers in place of clozes', () => {
    expect(noteTitle('```sql\nSELECT 1\n```')).toBe('SELECT 1');
    expect(noteTitle('- O {{1::INNER}} JOIN **junta**')).toBe('O INNER JOIN junta');
    expect(noteTitle('   ')).toBe('(sem texto)');
  });
  it('noteStatus', () => {
    const note = { draft: false } as Note;
    const card = (over: object) => ({ suspended: false, state: 'review', due: new Date(2026, 10, 14, 4).getTime(), ...over }) as never;
    expect(noteStatus({ draft: true } as Note, [], '2026-11-12', 4)).toBe('rascunho');
    expect(noteStatus(note, [card({ suspended: true })], '2026-11-12', 4)).toBe('suspenso');
    expect(noteStatus(note, [card({ state: 'new' })], '2026-11-12', 4)).toBe('novo');
    expect(noteStatus(note, [card({})], '2026-11-12', 4)).toBe('em 2 dias');
    expect(noteStatus(note, [card({ due: new Date(2026, 10, 13, 4).getTime() })], '2026-11-12', 4)).toBe('amanhã');
    expect(noteStatus(note, [card({ due: new Date(2026, 10, 1, 4).getTime() })], '2026-11-12', 4)).toBe('para hoje');
  });
});

describe('NoteEditor', () => {
  it('Salvar e próximo (Ctrl+Enter) keeps type and deck and clears the fields', async () => {
    const user = userEvent.setup();
    const d = await saveDeck({ name: 'SQL' });
    go(`/estudo/nota/nova?baralho=${d.id}`);
    render(<NoteEditor />);
    await user.type(await screen.findByLabelText('Frente'), 'O que faz o JOIN?');
    await user.type(screen.getByLabelText('Verso'), 'Junta tabelas');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByText('Salvo. Próximo card.')).toBeInTheDocument();
    expect(screen.getByLabelText('Frente')).toHaveValue('');
    expect(screen.getByLabelText('Baralho')).toHaveValue(d.id);
    expect(screen.getByLabelText('Frente')).toHaveFocus();
    expect((await liveNotes()).map((n) => [n.front, n.back, n.deckId])).toEqual([['O que faz o JOIN?', 'Junta tabelas', d.id]]);
  });

  it('shows field errors instead of saving', async () => {
    const user = userEvent.setup();
    await saveDeck({ name: 'SQL' });
    go('/estudo/nota/nova');
    render(<NoteEditor />);
    await user.click(await screen.findByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Escreva a frente.')).toBeInTheDocument();
    expect(screen.getByText('Escreva o verso.')).toBeInTheDocument();
    expect(await liveNotes()).toEqual([]);
  });

  it('cloze: Ctrl+Shift+L wraps the selection and the preview hides it', async () => {
    const user = userEvent.setup();
    const d = await saveDeck({ name: 'SQL' });
    go(`/estudo/nota/nova?baralho=${d.id}&tipo=cloze`);
    render(<NoteEditor />);
    const text = (await screen.findByLabelText('Texto com lacunas')) as HTMLTextAreaElement;
    await user.type(text, 'soma de a e b');
    text.setSelectionRange(8, 9);
    await user.keyboard('{Control>}{Shift>}L{/Shift}{/Control}');
    // If user-event resets the selection set above, dispatch the shortcut with fireEvent.keyDown(text, { key: 'L', ctrlKey: true, shiftKey: true }).
    expect(text).toHaveValue('soma de {{1::a}} e b');
    const preview = screen.getByRole('region', { name: 'Pré-visualização' });
    expect(within(preview).getAllByText('[…]').length).toBeGreaterThan(0);
  });

  it('topic: key points, validation and the preview list; "Por quê?" field', async () => {
    const user = userEvent.setup();
    const d = await saveDeck({ name: 'BD' });
    go(`/estudo/nota/nova?baralho=${d.id}&tipo=topic`);
    render(<NoteEditor />);
    await user.type(await screen.findByLabelText('Tópico a explicar'), 'Explique as formas normais');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Liste ao menos um ponto-chave.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Pontos-chave (um por linha)'), '- 1FN{enter}- 2FN');
    const preview = screen.getByRole('region', { name: 'Pré-visualização' });
    expect(within(preview).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1FN', '2FN']);
    await user.type(screen.getByLabelText('Pontos-chave (um por linha)'), '{enter}- área $a^2$');
    expect(within(preview).getAllByRole('listitem')[2]!.querySelector('.rich__math, .rich__math-src')).not.toBeNull();
    expect(screen.getByLabelText('Por quê? (opcional)')).toBeInTheDocument();
  });

  it('code: language and a code editor for the solution', async () => {
    const d = await saveDeck({ name: 'Py' });
    go(`/estudo/nota/nova?baralho=${d.id}&tipo=code`);
    render(<NoteEditor />);
    expect(await screen.findByLabelText('Enunciado')).toBeInTheDocument();
    expect(screen.getByLabelText('Linguagem')).toHaveValue('python');
    expect(screen.getByLabelText('Solução')).toHaveClass('code-editor__input');
  });

  it('Salvar goes back to the session keeping the deck filter', async () => {
    const user = userEvent.setup();
    const d = await saveDeck({ name: 'SQL' });
    const n = await saveNote({ deckId: d.id, type: 'basic', front: 'q', back: 'a' });
    go(`/estudo/nota/${n.id}?voltar=sessao&baralho=${d.id}`);
    render(<NoteEditor id={n.id} />);
    await screen.findByLabelText('Frente');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await vi.waitFor(() => expect(window.location.pathname + window.location.search).toBe(`/estudo/revisar?baralho=${d.id}`));
  });

  it('completing a draft: pick the deck, write the back, save', async () => {
    const user = userEvent.setup();
    const d = await saveDeck({ name: 'SQL' });
    const draft = await saveNote({ type: 'basic', front: 'o que é idempotência', back: '', draft: true });
    go(`/estudo/nota/${draft.id}`);
    render(<NoteEditor id={draft.id} />);
    expect(await screen.findByText(/Rascunho capturado/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Baralho'), d.id);
    await user.type(screen.getByLabelText('Verso'), 'repetir não muda o resultado');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await vi.waitFor(async () => expect(await db.notes.get(draft.id)).toMatchObject({ draft: false, deckId: d.id }));
    await vi.waitFor(() => expect(window.location.pathname).toBe(`/estudo/baralho/${d.id}`));
  });

  it('delete with undo', async () => {
    const user = userEvent.setup();
    const d = await saveDeck({ name: 'SQL' });
    const n = await saveNote({ deckId: d.id, type: 'basic', front: 'f', back: 'b' });
    go(`/estudo/nota/${n.id}`);
    render(<><NoteEditor id={n.id} /><ToastHost /></>);
    await user.click(await screen.findByRole('button', { name: 'Apagar' }));
    await vi.waitFor(async () => expect((await db.notes.get(n.id))!.deleted).toBe(true));
    await user.click(await screen.findByRole('button', { name: 'Desfazer' }));
    await vi.waitFor(async () => expect((await db.notes.get(n.id))!.deleted).toBe(false));
  });
});

describe('DeckScreen', () => {
  it('lists notes with type and status, filters by search and archives', async () => {
    const user = userEvent.setup();
    const d = await saveDeck({ name: 'SQL' });
    await saveNote({ deckId: d.id, type: 'basic', front: 'O que é JOIN?', back: 'b' });
    await saveNote({ deckId: d.id, type: 'cloze', front: 'O {{1::índice}} acelera', back: '' });
    render(<DeckScreen id={d.id} />);
    expect(await screen.findByRole('heading', { name: 'SQL' })).toBeInTheDocument();
    const join = screen.getByRole('link', { name: /O que é JOIN\?/ });
    expect(join).toHaveTextContent('Pergunta e resposta');
    expect(join).toHaveTextContent('novo');
    await user.type(screen.getByLabelText('Buscar'), 'indice');
    expect(screen.queryByRole('link', { name: /JOIN/ })).toBeNull();
    expect(screen.getByRole('link', { name: /O índice acelera/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Arquivar' }));
    await vi.waitFor(async () => expect((await db.decks.get(d.id))!.archived).toBe(true));
    expect(await screen.findByRole('button', { name: 'Desarquivar' })).toBeInTheDocument();
  });
});
