import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { saveDeck, saveNote } from '../src/domain/studyActions';
import { DeckSheet } from '../src/features/study/DeckSheet';
import { NoteEditor } from '../src/features/study/NoteEditor';
import { ReviewSession } from '../src/features/study/ReviewSession';
import { useSession } from '../src/features/study/sessionStore';
import { resetMediaSyncState } from '../src/sync/media';
import { installFakeMic, installFakeSpeech } from './fakeMedia';

let mic: ReturnType<typeof installFakeMic> | undefined;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
  resetMediaSyncState();
  useSession.getState().reset();
  localStorage.clear();
  window.history.pushState({}, '', '/estudo/revisar');
});
afterEach(() => {
  mic?.uninstall(); mic = undefined;
  vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks();
  window.history.pushState({}, '', '/');
});

async function deck(speechLang?: string) {
  const d = await saveDeck({ name: 'Inglês', speechLang });
  vi.setSystemTime(new Date(2026, 10, 13, 9, 0));
  await saveNote({ deckId: d.id, type: 'basic', front: 'apple', back: 'maçã' });
  vi.setSystemTime(new Date(2026, 10, 13, 9, 1));
  await saveNote({ deckId: d.id, type: 'basic', front: 'pear', back: 'pera' });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  return d;
}
const liveReviews = async () => (await db.reviews.toArray()).filter((r) => !r.deleted);

describe('"Ouvir"', () => {
  it('reads the question and the answer in the deck language; the next card stops the reading', async () => {
    const user = userEvent.setup();
    const tts = installFakeSpeech([{ lang: 'en-US', localService: true, name: 'Samantha' }]);
    await deck('en-US');
    render(<ReviewSession />);
    await screen.findByText('apple');
    await user.click(screen.getByRole('button', { name: 'Ouvir a pergunta' }));
    expect(tts.current()).toMatchObject({ text: 'apple', lang: 'en-US', voice: { name: 'Samantha' } });
    expect(screen.getByRole('button', { name: 'Parar a leitura' })).toBeInTheDocument();
    act(() => tts.finish());
    expect(screen.getByRole('button', { name: 'Ouvir a pergunta' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mostrar resposta' }));
    await user.click(await screen.findByRole('button', { name: 'Ouvir a resposta' }));
    expect(tts.current()).toMatchObject({ text: 'maçã', lang: 'en-US' });
    await user.keyboard('3');
    await screen.findByText('pear');
    expect(tts.synth.cancel).toHaveBeenCalled();
    expect(tts.current()).toBeUndefined();
  });

  it('is absent without a deck language and without the API', async () => {
    installFakeSpeech();
    await deck();
    const first = render(<ReviewSession />);
    await screen.findByText('apple');
    expect(screen.queryByRole('button', { name: 'Ouvir a pergunta' })).toBeNull();
    first.unmount();
    vi.unstubAllGlobals();
    await db.decks.toCollection().modify({ speechLang: 'en-US' });
    useSession.getState().reset();
    render(<ReviewSession />);
    await screen.findByText('apple');
    expect(screen.queryByRole('button', { name: 'Ouvir a pergunta' })).toBeNull();
  });

  it('the deck sheet saves the language; the editor preview offers "Ouvir"', async () => {
    const user = userEvent.setup();
    const d = await saveDeck({ name: 'Inglês' });
    const sheet = render(<DeckSheet open onClose={() => {}} deck={(await db.decks.get(d.id))!} />);
    expect(screen.getByText('Este navegador não lê em voz alta; a escolha vale nos outros aparelhos.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Ouvir em voz alta'), 'Inglês (EUA)');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect((await db.decks.get(d.id))!.speechLang).toBe('en-US'));
    sheet.unmount();
    installFakeSpeech();
    window.history.pushState({}, '', `/estudo/nota/nova?baralho=${d.id}`);
    render(<NoteEditor />);
    await user.type(await screen.findByLabelText('Frente'), 'apple');
    await user.type(screen.getByLabelText('Verso'), 'maçã');
    expect(screen.getByRole('button', { name: 'Ouvir a frente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ouvir o verso' })).toBeInTheDocument();
  });
});

describe('"Responder falando"', () => {
  it('records, keeps the recording through the reveal, saves spoke and drops it on the next card', async () => {
    const user = userEvent.setup();
    mic = installFakeMic();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:resp/1');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    await deck();
    render(<ReviewSession />);
    await screen.findByText('apple');
    await user.click(screen.getByRole('button', { name: 'Responder falando' }));
    expect(screen.getByRole('button', { name: 'Responder falando' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('life-rpg.study.speakFirst')).toBe('1');
    expect(mic.getUserMedia).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Gravar resposta' }));
    expect(await screen.findByText('Gravando · 0:00 / 2:00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mostrar resposta' })); // still recording: it stops and is kept
    expect(await screen.findByRole('button', { name: 'Ouvir minha resposta' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Sua resposta falada' })).toBeInTheDocument();
    expect(mic.track.stop).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^Bom/ }));
    await screen.findByText('pear');
    expect((await liveReviews())[0]!.spoke).toBe(true);
    expect(revoke).toHaveBeenCalledWith('blob:resp/1');
    expect(screen.getByRole('button', { name: 'Gravar resposta' })).toBeInTheDocument();
  });

  it('is hidden where the browser cannot record; without a recording there is no spoke', async () => {
    const user = userEvent.setup();
    await deck();
    const first = render(<ReviewSession />);
    await screen.findByText('apple');
    expect(screen.queryByRole('button', { name: 'Responder falando' })).toBeNull();
    first.unmount();
    mic = installFakeMic();
    localStorage.setItem('life-rpg.study.speakFirst', '1');
    useSession.getState().reset();
    render(<ReviewSession />);
    await screen.findByText('apple');
    expect(screen.getByRole('button', { name: 'Gravar resposta' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mostrar resposta' }));
    await user.click(await screen.findByRole('button', { name: /^Bom/ }));
    await screen.findByText('pear');
    expect('spoke' in (await liveReviews())[0]!).toBe(false);
  });
});
