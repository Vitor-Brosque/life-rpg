import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Deck } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { saveDeck, saveNote } from '../src/domain/studyActions';
import { DeckScreen } from '../src/features/study/DeckScreen';
import { NoteEditor } from '../src/features/study/NoteEditor';
import { StudyScreen } from '../src/features/study/StudyScreen';
import { ToastHost } from '../src/ui/Toast';
import { enableAi, fail, mockFetch, ok, resetAi } from './aiFixture';

let deck: Deck;
beforeEach(async () => {
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  resetAi();
  deck = await saveDeck({ name: 'SQL' });
});
afterEach(() => { resetAi(); });

const SUGGESTIONS = [
  { type: 'basic', front: 'O que é HAVING?', back: 'Filtro de grupos', extra: '' },
  { type: 'cloze', front: 'Uma PK não aceita {{1::nulos}}.', back: '', extra: '' },
];
const liveNotes = async () => (await db.notes.toArray()).filter((n) => !n.deleted);

async function openFromStudy() {
  render(<><StudyScreen /><ToastHost /></>);
  await userEvent.click(await screen.findByRole('button', { name: 'Sugerir cards' }));
  return screen.findByRole('dialog', { name: 'Sugerir cards' });
}
async function askWith(dialog: HTMLElement, text = 'HAVING filtra grupos.') {
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Texto de origem' }), text);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Pedir sugestões' }));
}

describe('entry points', () => {
  it('none without the aid', async () => {
    render(<StudyScreen />);
    await screen.findByRole('heading', { name: 'Baralhos' });
    expect(screen.queryByRole('button', { name: 'Sugerir cards' })).toBeNull();
  });

  it('deck screen and note editor', async () => {
    await enableAi({ cards: true });
    const { unmount } = render(<DeckScreen id={deck.id} />);
    expect(await screen.findByRole('button', { name: 'Sugerir cards' })).toBeInTheDocument();
    unmount();
    const note = await saveNote({ type: 'basic', front: 'Frente', back: 'Verso', deckId: deck.id });
    render(<NoteEditor id={note.id} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sugerir cards desta nota' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sugerir cards' });
    expect(within(dialog).getByRole('textbox', { name: 'Texto de origem' })).toHaveValue('Frente\n\nVerso');
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Rascunhos vão para' })).toHaveValue(deck.id));
  });
});

describe('the sheet', () => {
  it('asks with the text and deck name, accepts an edited card as a draft, no review cards', async () => {
    await enableAi({ cards: true });
    const { requests } = mockFetch(() => ok({ cards: SUGGESTIONS }));
    const dialog = await openFromStudy();
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Rascunhos vão para' })).toHaveValue(deck.id));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Texto de origem' }), 'HAVING filtra grupos.');
    expect(within(dialog).getByText('21 de 8.000 caracteres')).toBeInTheDocument();
    expect(dialog.querySelector('pre')!.textContent).toBe(
      'Baralho: SQL\n\n<texto>\nHAVING filtra grupos.\n</texto>\n\nProponha os cards.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pedir sugestões' }));

    const items = await within(dialog).findAllByRole('listitem');
    expect(requests[0]!.body).toEqual({ text: 'HAVING filtra grupos.', deckName: 'SQL' });
    expect(within(items[0]!).getByRole('heading', { name: 'Card 1 · Pergunta e resposta' })).toBeInTheDocument();
    expect(within(items[1]!).getByRole('heading', { name: 'Card 2 · Lacunas' })).toBeInTheDocument();

    const answer = within(items[0]!).getByRole('textbox', { name: 'Resposta' });
    await userEvent.clear(answer);
    await userEvent.type(answer, 'HAVING');
    await userEvent.click(within(items[0]!).getByRole('button', { name: 'Aceitar card 1 como rascunho' }));
    await within(dialog).findByRole('link', { name: 'Abrir rascunho do card 1' });
    expect(await liveNotes()).toEqual([
      expect.objectContaining({ type: 'basic', front: 'O que é HAVING?', back: 'HAVING', draft: true, deckId: deck.id }),
    ]);
    expect(await db.cards.count()).toBe(0);
    expect(await screen.findByText('Rascunho de card salvo')).toBeInTheDocument();
  });

  it('discard and undo; "Pronto" when nothing is pending', async () => {
    await enableAi({ cards: true });
    mockFetch(() => ok({ cards: SUGGESTIONS }));
    const dialog = await openFromStudy();
    await askWith(dialog);
    await within(dialog).findAllByRole('listitem');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar card 2' }));
    expect(within(dialog).getByText('Card 2 descartado.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Desfazer' }));
    expect(within(dialog).getByRole('button', { name: 'Aceitar card 2 como rascunho' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar card 1' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar card 2' }));
    expect(within(dialog).getByText('Pronto. Os rascunhos estão em Estudo → Rascunhos para completar.')).toBeInTheDocument();
  });

  it('validates before saving (basic without answer, cloze without a gap)', async () => {
    await enableAi({ cards: true });
    mockFetch(() => ok({ cards: SUGGESTIONS }));
    const dialog = await openFromStudy();
    await askWith(dialog);
    const items = await within(dialog).findAllByRole('listitem');
    await userEvent.clear(within(items[0]!).getByRole('textbox', { name: 'Resposta' }));
    await userEvent.click(within(items[0]!).getByRole('button', { name: 'Aceitar card 1 como rascunho' }));
    expect(within(items[0]!).getByText('Escreva a resposta.')).toBeInTheDocument();
    fireEvent.change(within(items[1]!).getByRole('textbox', { name: 'Texto com lacunas' }), { target: { value: 'Sem lacuna.' } });
    await userEvent.click(within(items[1]!).getByRole('button', { name: 'Aceitar card 2 como rascunho' }));
    expect(within(items[1]!).getByText('Marque ao menos uma lacuna.')).toBeInTheDocument();
    expect(await liveNotes()).toEqual([]);
  });

  it('too long a text cannot be sent', async () => {
    await enableAi({ cards: true });
    const dialog = await openFromStudy();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Texto de origem' }), { target: { value: 'x'.repeat(8001) } });
    expect(within(dialog).getByText('Texto longo demais: até 8.000 caracteres.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Pedir sugestões' })).toBeDisabled();
  });

  it('no good cards, and errors', async () => {
    await enableAi({ cards: true });
    mockFetch(() => ok({ cards: [] }));
    const dialog = await openFromStudy();
    await askWith(dialog);
    expect(await within(dialog).findByText('A IA não encontrou bons cards neste texto. Tente um trecho com mais conteúdo.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Voltar ao texto' }));
    expect(within(dialog).getByRole('textbox', { name: 'Texto de origem' })).toHaveValue('HAVING filtra grupos.');
    mockFetch(() => fail(504, 'timeout'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pedir sugestões' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A IA demorou demais para responder. Tente de novo daqui a pouco.');
  });

  it('accepted drafts show up in "Rascunhos para completar"', async () => {
    await enableAi({ cards: true });
    mockFetch(() => ok({ cards: SUGGESTIONS }));
    const dialog = await openFromStudy();
    await askWith(dialog);
    await within(dialog).findAllByRole('listitem');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aceitar card 2 como rascunho' }));
    await within(dialog).findByRole('link', { name: 'Abrir rascunho do card 2' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    expect(await screen.findByRole('heading', { name: 'Rascunhos para completar (1)' })).toBeInTheDocument();
    expect((await liveNotes())[0]).toMatchObject({ type: 'cloze', front: 'Uma PK não aceita {{1::nulos}}.', back: '', draft: true });
  });
});

describe('focus, ctrl+enter and edge cases', () => {
  it('focus never rests on body after accepting, discarding and going back', async () => {
    await enableAi({ cards: true });
    mockFetch(() => ok({ cards: SUGGESTIONS }));
    const dialog = await openFromStudy();
    await askWith(dialog);
    const items = await within(dialog).findAllByRole('listitem');
    expect(document.body).not.toHaveFocus();
    await userEvent.click(within(items[0]!).getByRole('button', { name: 'Aceitar card 1 como rascunho' }));
    await within(dialog).findByRole('link', { name: 'Abrir rascunho do card 1' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar card 2' }));
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Voltar ao texto' }));
    expect(within(dialog).getByRole('textbox', { name: 'Texto de origem' })).toHaveFocus();
  });

  it('focus returns to "Pedir sugestões" after a slow failed ask', async () => {
    await enableAi({ cards: true });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mockFetch(async () => { await gate; return fail(504, 'timeout'); });
    const dialog = await openFromStudy();
    await askWith(dialog);
    await within(dialog).findByRole('button', { name: 'Pensando…' });
    await new Promise((r) => setTimeout(r, 5200));
    release();
    const btn = await within(dialog).findByRole('button', { name: 'Pedir sugestões' });
    await waitFor(() => expect(btn).toHaveFocus());
  }, 30_000);

  it('Ctrl+Enter inside the sheet does not save the note form', async () => {
    await enableAi({ cards: true });
    const note = await saveNote({ type: 'basic', front: 'Frente', back: 'Verso', deckId: deck.id });
    render(<NoteEditor id={note.id} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sugerir cards desta nota' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sugerir cards' });
    expect(dialog.closest('form')).toBeNull();
    const box = within(dialog).getByRole('textbox', { name: 'Texto de origem' });
    await userEvent.click(box);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByRole('dialog', { name: 'Sugerir cards' })).toBeInTheDocument();
    expect((await db.notes.get(note.id))!.updatedAt).toBe(note.updatedAt);
  });

  it('archived deck screen offers no suggestions', async () => {
    await enableAi({ cards: true });
    mockFetch(() => ok({ cards: SUGGESTIONS }));
    const { setDeckArchived } = await import('../src/domain/studyActions');
    await setDeckArchived(deck.id, true);
    render(<DeckScreen id={deck.id} />);
    expect(screen.queryByRole('button', { name: 'Sugerir cards' })).toBeNull();
  });
});
