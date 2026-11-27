import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechSession } from '@life/shared';
import { SPEECH_WPM_NOTE, sha256Hex } from '@life/shared';
import { db } from '../src/db/db';
import { MediaInputError, saveMediaBlob } from '../src/db/media';
import { ensureSeed } from '../src/db/seed';
import { newRecord, put } from '../src/db/repo';
import { SPEECH_EMPTY_TEXT, addSpeechRecording, saveSpeechSession, startSpeechProgram } from '../src/domain/speechActions';
import { useRecorder } from '../src/features/media/useRecorder';
import { SpeechScreen } from '../src/features/speech/SpeechScreen';
import { KEEP_FAILED, KEEP_HINT, SAVE_FAILED } from '../src/features/speech/SpeechSessionSheet';
import { StudyScreen } from '../src/features/study/StudyScreen';
import { resetMediaSyncState } from '../src/sync/media';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at } from './blockFixture';
import { WEBM_BYTES, installFakeMic } from './fakeMedia';

vi.mock('../src/db/media', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/db/media')>();
  return { ...m, saveMediaBlob: vi.fn(m.saveMediaBlob) };
});
vi.mock('../src/domain/speechActions', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/domain/speechActions')>();
  return { ...m, saveSpeechSession: vi.fn(m.saveSpeechSession), addSpeechRecording: vi.fn(m.addSpeechRecording) };
});

const SND = sha256Hex(WEBM_BYTES);
let mic: ReturnType<typeof installFakeMic>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(23, 10));
  await db.delete();
  await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
  resetMediaSyncState();
  mic = installFakeMic();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rec/1');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  mic.uninstall();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.pushState({}, '', '/');
});

const renderFala = () => {
  window.history.pushState({}, '', '/estudo/fala');
  return render(<><SpeechScreen /><ToastHost /></>);
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const sessions = () => db.speechSessions.toArray();
const dialogNamed = (name: string) => screen.findByRole('dialog', { name });
const noDialog = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

/** Nova sessão → the activity chip; returns the dialog. */
async function newSession(user: ReturnType<typeof userEvent.setup>, kind: string): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: 'Nova sessão' }));
  const dialog = await dialogNamed('Nova sessão de fala');
  await user.click(within(dialog).getByRole('button', { name: kind }));
  return dialog;
}

async function record(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement): Promise<void> {
  await user.click(within(dialog).getByRole('button', { name: 'Gravar' }));
  await flush();
  await within(dialog).findByText('Gravando · 0:00 / 3:00');
}

describe('Fala screen and the session sheet', () => {
  it('opening writes nothing; free suggestions; the activity comes first', async () => {
    const user = userEvent.setup();
    renderFala();
    await screen.findByRole('heading', { level: 1, name: 'Fala' });
    expect(screen.getByText('Sugestões livres, todas opcionais.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Começar: 5 min, Leitura de referência · A feira de sábado' })).toBeInTheDocument();
    expect(screen.getByText('Nenhuma sessão ainda. Escolha uma sugestão acima ou toque em Nova sessão.')).toBeInTheDocument();
    const outbox = await db.outbox.count();
    const opener = screen.getByRole('button', { name: 'Nova sessão' });
    await user.click(opener);
    const dialog = await dialogNamed('Nova sessão de fala');
    expect(within(dialog).getByText('Escolha a atividade para continuar.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Gravar' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Encerrar sessão' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    await noDialog();
    expect(document.activeElement).toBe(opener);
    expect(await db.outbox.count()).toBe(outbox);
    expect(await db.speechSessions.count()).toBe(0);
  });

  it('a suggested reading: records, keeps it on Parar, shows the speed; Encerrar gives +8 XP', async () => {
    const user = userEvent.setup();
    renderFala();
    await user.click(await screen.findByRole('button', { name: 'Começar: 5 min, Leitura de referência · A feira de sábado' }));
    const dialog = await dialogNamed('Nova sessão de fala');
    expect(within(dialog).getByRole('button', { name: 'Leitura de referência' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByRole('button', { name: '5 min' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByText('Texto de referência do app (original) · 132 palavras')).toBeInTheDocument();
    await record(user, dialog);
    vi.setSystemTime(at(23, 10) + 60_000);
    await user.click(within(dialog).getByRole('button', { name: 'Parar a gravação' }));
    await within(dialog).findByText('Gravação guardada.');
    const [s] = await sessions();
    expect(s).toMatchObject({ kind: 'leitura', passage: 'feira', size: 5, recordings: [{ hash: SND, durationMs: 60_000, at: at(23, 10) + 60_000 }] });
    expect(s!.recordings[0]!.capped).toBeUndefined();
    expect(await within(dialog).findByText('Velocidade na leitura de referência: 132 palavras por minuto')).toBeInTheDocument();
    expect(within(dialog).getByText('Referência · sempre guardada')).toBeInTheDocument();
    expect(within(dialog).getByText(SPEECH_WPM_NOTE)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Encerrar sessão' }));
    expect(await screen.findByText('Sessão de fala encerrada · +8 XP')).toBeInTheDocument();
    await noDialog();
    const list = screen.getByRole('list', { name: 'Sessões de fala' });
    expect(await within(list).findByText('23/11 · Leitura de referência · A feira de sábado')).toBeInTheDocument();
    expect(within(list).getByText('5 min · 1 gravação · Encerrada')).toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('a recording stopped at the 3-minute limit is kept with capped: true and gets no speed', async () => {
    const user = userEvent.setup();
    renderFala();
    await user.click(await screen.findByRole('button', { name: 'Começar: 5 min, Leitura de referência · A feira de sábado' }));
    const dialog = await dialogNamed('Nova sessão de fala');
    await record(user, dialog);
    vi.setSystemTime(at(23, 10) + 180_000);
    expect(await within(dialog).findByText('Gravação guardada. Ela parou no limite de 3 minutos.', {}, { timeout: 3000 })).toBeInTheDocument();
    const [s] = await sessions();
    expect(s!.recordings).toEqual([{ hash: SND, durationMs: 180_000, at: at(23, 10) + 180_000, capped: true }]);
    expect(await within(dialog).findByText('Sem velocidade: gravação com menos de 10 segundos ou parada no limite de 3 minutos.')).toBeInTheDocument();
    expect(within(dialog).queryByText(SPEECH_WPM_NOTE)).toBeNull();
  });

  it('a refused save: its own message, the recording stays, "Tentar guardar de novo" keeps it', async () => {
    vi.mocked(saveMediaBlob).mockRejectedValueOnce(new MediaInputError('Sem espaço neste aparelho para guardar a mídia.'));
    const user = userEvent.setup();
    renderFala();
    const dialog = await newSession(user, 'Explicação espontânea');
    await record(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Parar a gravação' }));
    expect(await within(dialog).findByText('Sem espaço neste aparelho para guardar a mídia.')).toBeInTheDocument();
    expect(await db.speechSessions.count()).toBe(0);
    expect(within(dialog).getByRole('button', { name: 'Encerrar sessão' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Tentar guardar de novo' }));
    expect(await within(dialog).findByText('Gravação guardada.')).toBeInTheDocument();
    const all = await sessions();
    expect(all).toHaveLength(1);
    expect(all[0]!.recordings.map((r) => r.hash)).toEqual([SND]);
    expect(within(dialog).getByRole('button', { name: 'Encerrar sessão' })).toBeEnabled();
  });

  it('an unexpected save error shows the calm keep message and retrying works', async () => {
    vi.mocked(saveMediaBlob).mockRejectedValueOnce(new Error('disk'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    renderFala();
    const dialog = await newSession(user, 'Simulação');
    await record(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Parar a gravação' }));
    expect(await within(dialog).findByText(KEEP_FAILED)).toBeInTheDocument();
    expect(err).toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Tentar guardar de novo' }));
    expect(await within(dialog).findByText('Gravação guardada.')).toBeInTheDocument();
    expect((await sessions())[0]).toMatchObject({ kind: 'simulacao' });
  });

  it('closing while recording stops, keeps the recording and only then closes', async () => {
    const user = userEvent.setup();
    renderFala();
    const opener = await screen.findByRole('button', { name: 'Nova sessão' });
    const dialog = await newSession(user, 'Explicação espontânea');
    await record(user, dialog);
    await user.keyboard('{Escape}');
    await noDialog();
    const all = await sessions();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: 'explicacao', recordings: [{ hash: SND }] });
    expect(all[0]!.closedAt).toBeUndefined();
    expect(mic.track.stop).toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('closing while recording when the save is refused: the sheet stays open with the message and the recording', async () => {
    vi.mocked(saveMediaBlob).mockRejectedValueOnce(new MediaInputError('Sem espaço neste aparelho para guardar a mídia.'));
    const user = userEvent.setup();
    renderFala();
    const dialog = await newSession(user, 'Exercício');
    await record(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    expect(await within(dialog).findByText('Sem espaço neste aparelho para guardar a mídia.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Nova sessão de fala' })).toBeInTheDocument();
    expect(await db.speechSessions.count()).toBe(0);
    await user.click(within(dialog).getByRole('button', { name: 'Tentar guardar de novo' }));
    expect(await within(dialog).findByText('Gravação guardada.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    await noDialog();
    expect((await sessions())[0]!.recordings).toHaveLength(1);
  });

  it('typed text survives closing; chips alone create nothing; reopening writes only what was touched', async () => {
    const user = userEvent.setup();
    renderFala();
    let dialog = await newSession(user, 'Exercício');
    await user.click(within(dialog).getByRole('button', { name: 'Pausas' }));
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    await noDialog();
    expect(await db.speechSessions.count()).toBe(0);

    dialog = await newSession(user, 'Explicação espontânea');
    await user.type(within(dialog).getByLabelText('Tema (opcional)'), 'explicar um JOIN');
    await user.keyboard('{Escape}');
    expect(await screen.findByText('Sessão guardada em aberto.')).toBeInTheDocument();
    await noDialog();
    const [first] = await sessions();
    expect(first).toMatchObject({ kind: 'explicacao', topic: 'explicar um JOIN' });
    expect(first!.closedAt).toBeUndefined();
    const list = await screen.findByRole('list', { name: 'Sessões de fala' });
    expect(await within(list).findByText('Em aberto')).toBeInTheDocument();

    vi.setSystemTime(at(23, 10) + 5_000);
    const outbox = await db.outbox.count();
    const row = within(list).getByRole('button', { name: /23\/11 · Explicação espontânea · explicar um JOIN/ });
    await user.click(row);
    dialog = await dialogNamed('Sessão de fala');
    await within(dialog).findByDisplayValue('explicar um JOIN');
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    await noDialog();
    expect(document.activeElement).toBe(row);
    expect(await db.outbox.count()).toBe(outbox);

    await user.click(row);
    dialog = await dialogNamed('Sessão de fala');
    await within(dialog).findByDisplayValue('explicar um JOIN');
    await user.click(within(dialog).getByRole('button', { name: 'Clareza percebida: 4 de 5' }));
    await user.keyboard('{Escape}');
    expect(await screen.findByText('Alterações guardadas.')).toBeInTheDocument();
    await noDialog();
    const [again] = await sessions();
    expect(again).toMatchObject({ kind: 'explicacao', topic: 'explicar um JOIN', ratings: { clareza: 4 } });
    expect(again!.updatedAt).toBeGreaterThan(first!.updatedAt);
  });

  it('a failed save on closing keeps the sheet open with the text and the message', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(saveSpeechSession).mockRejectedValueOnce(new Error('db'));
    const user = userEvent.setup();
    renderFala();
    const dialog = await newSession(user, 'Explicação espontânea');
    await user.type(within(dialog).getByLabelText('Notas (opcional)'), 'travei no meio');
    await user.keyboard('{Escape}');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(SAVE_FAILED);
    expect(err).toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Nova sessão de fala' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Notas (opcional)')).toHaveValue('travei no meio');
    expect(await db.speechSessions.count()).toBe(0);
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    expect(await screen.findByText('Sessão guardada em aberto.')).toBeInTheDocument();
    await noDialog();
    expect((await sessions())[0]).toMatchObject({ notes: 'travei no meio' });
  });

  it('Encerrar without a recording or done: the notice and nothing written; with "Fiz a atividade": +8 XP', async () => {
    const user = userEvent.setup();
    renderFala();
    const dialog = await newSession(user, 'Exercício');
    await user.click(within(dialog).getByRole('button', { name: 'Encerrar sessão' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(SPEECH_EMPTY_TEXT);
    expect(await db.speechSessions.count()).toBe(0);
    await user.click(within(dialog).getByRole('button', { name: 'Fiz a atividade (sem gravar)' }));
    await user.click(within(dialog).getByRole('button', { name: 'Encerrar sessão' }));
    expect(await screen.findByText('Sessão de fala encerrada · +8 XP')).toBeInTheDocument();
    await noDialog();
    const [s] = await sessions();
    expect(s).toMatchObject({ kind: 'exercicio', done: true });
    expect(s!.exercise).toBeUndefined();
    expect(s!.closedAt).toBeDefined();
  });

  it('a closed session shows when it ended and "Salvar" writes only what changed', async () => {
    const user = userEvent.setup();
    renderFala();
    const dialog = await newSession(user, 'Exercício');
    await user.click(within(dialog).getByRole('button', { name: 'Fiz a atividade (sem gravar)' }));
    await user.click(within(dialog).getByRole('button', { name: 'Encerrar sessão' }));
    await screen.findByText('Sessão de fala encerrada · +8 XP');
    await noDialog();
    const list = screen.getByRole('list', { name: 'Sessões de fala' });
    await user.click(await within(list).findByRole('button', { name: /23\/11 · Exercício/ }));
    const again = await dialogNamed('Sessão de fala');
    expect(await within(again).findByText('Encerrada em 23/11.')).toBeInTheDocument();
    expect(within(again).queryByRole('button', { name: 'Encerrar sessão' })).toBeNull();
    const save = within(again).getByRole('button', { name: 'Salvar' });
    expect(save).toBeDisabled();
    await user.click(within(again).getByRole('button', { name: 'Conforto vocal: 5 de 5' }));
    expect(save).toBeEnabled();
    await user.click(save);
    expect(await screen.findByText('Alterações guardadas.')).toBeInTheDocument();
    await noDialog();
    expect((await sessions())[0]).toMatchObject({ ratings: { conforto: 5 }, done: true });
    expect((await db.xpEvents.toArray()).filter((x) => x.reason === 'speech')).toHaveLength(1);
  });

  it('an interrupted track (a call on the iPhone) ends the recording and keeps it', async () => {
    const user = userEvent.setup();
    renderFala();
    const dialog = await newSession(user, 'Explicação espontânea');
    await record(user, dialog);
    act(() => { (mic.track as unknown as { onended: () => void }).onended(); });
    expect(await within(dialog).findByText('Gravação guardada.')).toBeInTheDocument();
    expect((await sessions())[0]!.recordings).toHaveLength(1);
    expect(await within(dialog).findByRole('button', { name: 'Guardar gravação 1' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(dialog).getByText(KEEP_HINT)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Guardar gravação 1' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Guardar gravação 1' })).toHaveAttribute('aria-pressed', 'true'));
    expect((await sessions())[0]!.recordings[0]!.keep).toBe(true);
  });

  it('with a program, Hoje shows its week; more than 10 sessions: "Mostrar todas"; no "0 gravações"', async () => {
    await startSpeechProgram();
    for (let i = 0; i < 11; i++) {
      await put('speechSessions', newRecord<SpeechSession>({ id: `s${String(i).padStart(2, '0')}`, day: '2026-11-20', kind: 'explicacao', recordings: [], ratings: {}, topic: `tema ${i}` }));
    }
    const user = userEvent.setup();
    renderFala();
    expect(await screen.findByText('Semana 1 · Gravar as primeiras referências, sem tentar mudar nada.')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Sessões de fala' });
    expect(within(list).getAllByRole('button')).toHaveLength(10);
    expect(within(list).queryByText(/0 gravações/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mostrar todas (11)' }));
    expect(within(list).getAllByRole('button')).toHaveLength(11);
    expect(document.activeElement).toBe(within(list).getAllByRole('button')[10]);
  });

  it('Estudo shows the Fala panel', async () => {
    render(<StudyScreen />);
    expect(await screen.findByRole('link', { name: 'Abrir Fala' })).toHaveAttribute('href', '/estudo/fala');
  });
});

/** A distinct audio/webm file per n. */
const webm = (n: number): Uint8Array<ArrayBuffer> => new Uint8Array([...WEBM_BYTES.slice(0, 12), 7, 7, 7, n]);
const setVisibility = (state: DocumentVisibilityState) =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
const stored = async (id: string) => (await db.speechSessions.get(id))!;
const seedSession = (p: Partial<SpeechSession> = {}) =>
  put('speechSessions', newRecord<SpeechSession>({ id: 'sx', day: '2026-11-23', kind: 'explicacao', recordings: [], ratings: {}, topic: 'tema guardado', ...p }));
async function openRow(user: ReturnType<typeof userEvent.setup>, name: RegExp): Promise<HTMLElement> {
  const list = await screen.findByRole('list', { name: 'Sessões de fala' });
  await user.click(await within(list).findByRole('button', { name }));
  const dialog = await dialogNamed('Sessão de fala');
  await within(dialog).findByRole('button', { name: 'Gravar' });
  return dialog;
}

describe('the session sheet never loses a recording or typed text', () => {
  afterEach(() => { delete (document as { visibilityState?: unknown }).visibilityState; });

  it('Salvar on a closed session waits for the recording to be stored', async () => {
    await seedSession({ done: true, closedAt: at(23, 9) });
    const user = userEvent.setup();
    renderFala();
    const dialog = await openRow(user, /tema guardado/);
    await within(dialog).findByText('Encerrada em 23/11.');
    await user.click(within(dialog).getByRole('button', { name: 'Clareza percebida: 3 de 5' }));
    const save = within(dialog).getByRole('button', { name: 'Salvar' });
    expect(save).toBeEnabled();
    await record(user, dialog);
    expect(save).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Parar a gravação' }));
    await within(dialog).findByText('Gravação guardada.');
    expect(await stored('sx')).toMatchObject({ recordings: [{ hash: SND }], ratings: { clareza: 3 } });
    await user.click(within(dialog).getByRole('button', { name: 'Ritmo: 4 de 5' }));
    expect(save).toBeEnabled();
    await user.click(save);
    expect(await screen.findByText('Alterações guardadas.')).toBeInTheDocument();
    expect(await stored('sx')).toMatchObject({ recordings: [{ hash: SND }], ratings: { clareza: 3, ritmo: 4 } });
  });

  it('a recorder error while closing keeps the sheet open with its message; closing again closes and saves the text', async () => {
    mic.uninstall();
    mic = installFakeMic({ empty: true });
    const user = userEvent.setup();
    renderFala();
    const dialog = await newSession(user, 'Explicação espontânea');
    await user.type(within(dialog).getByLabelText('Tema (opcional)'), 'filas');
    await record(user, dialog);
    await user.keyboard('{Escape}');
    expect(await within(dialog).findByText('A gravação ficou vazia. Tente de novo.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Nova sessão de fala' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    expect(await screen.findByText('Sessão guardada em aberto.')).toBeInTheDocument();
    await noDialog();
    expect((await sessions())[0]).toMatchObject({ topic: 'filas', recordings: [] });
  });

  it('an untouched kind is never written: a change from another device survives a rating and a recording', async () => {
    await seedSession();
    const user = userEvent.setup();
    renderFala();
    let dialog = await openRow(user, /tema guardado/);
    await act(async () => { await db.speechSessions.update('sx', { kind: 'simulacao' }); });
    await user.click(within(dialog).getByRole('button', { name: 'Clareza percebida: 2 de 5' }));
    await user.keyboard('{Escape}');
    await screen.findByText('Alterações guardadas.');
    await noDialog();
    expect(await stored('sx')).toMatchObject({ kind: 'simulacao', ratings: { clareza: 2 } });

    await act(async () => { await db.speechSessions.update('sx', { kind: 'exercicio' }); });
    dialog = await openRow(user, /tema guardado|Exercício/);
    await act(async () => { await db.speechSessions.update('sx', { kind: 'leitura' }); });
    await record(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Parar a gravação' }));
    await within(dialog).findByText('Gravação guardada.');
    expect(await stored('sx')).toMatchObject({ kind: 'leitura', recordings: [{ hash: SND }] });
  });

  it('a focused control that becomes disabled gives focus back inside the sheet', async () => {
    mic.getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>(() => {}));
    const user = userEvent.setup();
    renderFala();
    const dialog = await newSession(user, 'Exercício');
    const gravar = within(dialog).getByRole('button', { name: 'Gravar' });
    await user.click(gravar);
    expect(gravar).toBeDisabled();
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(within(dialog).getByRole('status')).toHaveTextContent('Aguardando o microfone…');
  });

  it('the status line says what is happening while recording', async () => {
    const user = userEvent.setup();
    renderFala();
    const dialog = await newSession(user, 'Exercício');
    await record(user, dialog);
    expect(within(dialog).getByRole('status')).toHaveTextContent('Gravando. Toque em Parar quando terminar.');
  });

  it('two recordings in one sheet are both stored; the same bytes twice stay one entry', async () => {
    const user = userEvent.setup();
    renderFala();
    const dialog = await newSession(user, 'Explicação espontânea');
    for (const n of [1, 2, 2]) {
      mic.uninstall();
      mic = installFakeMic({ bytes: webm(n) });
      await record(user, dialog);
      await user.click(within(dialog).getByRole('button', { name: 'Parar a gravação' }));
      await within(dialog).findByText('Gravação guardada.');
      await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Gravar' })).toBeEnabled());
    }
    expect((await sessions())[0]!.recordings.map((r) => r.hash)).toEqual([sha256Hex(webm(1)), sha256Hex(webm(2))]);
    expect(await within(dialog).findByRole('button', { name: 'Guardar gravação 2' })).toBeInTheDocument();
  });

  it('Encerrar waits while a save on closing is running', async () => {
    let release: () => void = () => {};
    const real = vi.mocked(saveSpeechSession).getMockImplementation()!;
    vi.mocked(saveSpeechSession).mockImplementationOnce(async (id, p) => {
      await new Promise<void>((r) => { release = r; });
      return real(id, p);
    });
    const user = userEvent.setup();
    renderFala();
    const dialog = await newSession(user, 'Explicação espontânea');
    await user.type(within(dialog).getByLabelText('Notas (opcional)'), 'nota');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Encerrar sessão' })).toBeDisabled());
    await act(async () => { release(); });
    expect(await screen.findByText('Sessão guardada em aberto.')).toBeInTheDocument();
    await noDialog();
  });

  it('leaving the screen saves typed text of a new session; chips alone still create nothing', async () => {
    const user = userEvent.setup();
    let view = renderFala();
    let dialog = await newSession(user, 'Exercício');
    await user.click(within(dialog).getByRole('button', { name: 'Pausas' }));
    view.unmount();
    await flush();
    expect(await db.speechSessions.count()).toBe(0);

    view = renderFala();
    dialog = await newSession(user, 'Explicação espontânea');
    await user.type(within(dialog).getByLabelText('Notas (opcional)'), 'saí no meio');
    view.unmount();
    await waitFor(async () => expect((await sessions())[0]).toMatchObject({ kind: 'explicacao', notes: 'saí no meio' }));
  });

  it('the page going to the background saves only what changed, and the sheet stays as it was', async () => {
    await seedSession({ notes: 'antes' });
    const user = userEvent.setup();
    renderFala();
    const dialog = await openRow(user, /tema guardado/);
    const notes = within(dialog).getByLabelText('Notas (opcional)');
    await user.type(notes, ' e depois');
    setVisibility('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(async () => expect((await stored('sx')).notes).toBe('antes e depois'));
    expect(screen.getByRole('dialog', { name: 'Sessão de fala' })).toBeInTheDocument();
    expect(notes).toHaveFocus();
    setVisibility('visible');
    await user.type(notes, '!');
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    await waitFor(async () => expect((await stored('sx')).notes).toBe('antes e depois!'));
    expect((await stored('sx')).topic).toBe('tema guardado');
  });

  it('hidden and pagehide in a row (the iPhone sends both) write the changes once; leaving afterwards writes nothing more', async () => {
    await seedSession({ notes: 'antes' });
    const user = userEvent.setup();
    const view = renderFala();
    const dialog = await openRow(user, /tema guardado/);
    await user.type(within(dialog).getByLabelText('Notas (opcional)'), ' e depois');
    vi.mocked(saveSpeechSession).mockClear();
    setVisibility('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
    });
    await waitFor(async () => expect((await stored('sx')).notes).toBe('antes e depois'));
    view.unmount();
    await flush();
    setVisibility('visible');
    expect(saveSpeechSession).toHaveBeenCalledTimes(1);
  });

  it('text typed while a quiet save is in flight is written once after it', async () => {
    await seedSession({ notes: 'antes' });
    const user = userEvent.setup();
    renderFala();
    const dialog = await openRow(user, /tema guardado/);
    const notes = within(dialog).getByLabelText('Notas (opcional)');
    await user.type(notes, ' 1');
    vi.mocked(saveSpeechSession).mockClear();
    let release!: () => void;
    const real = vi.mocked(saveSpeechSession).getMockImplementation()!;
    vi.mocked(saveSpeechSession).mockImplementationOnce(async (...a) => {
      await new Promise<void>((r) => { release = r; });
      return real(...a);
    });
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    await user.type(notes, ' 2');
    act(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pagehide')); });
    expect(saveSpeechSession).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    await waitFor(async () => expect((await stored('sx')).notes).toBe('antes 1 2'));
    expect(saveSpeechSession).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveSpeechSession).mock.calls[1]![1]).toEqual({ notes: 'antes 1 2' });
  });

  it('leaving with a recording not stored yet and typed text: the text is written once, the recording after it', async () => {
    vi.mocked(saveMediaBlob).mockRejectedValueOnce(new MediaInputError('Sem espaço neste aparelho para guardar a mídia.'));
    await seedSession({ notes: 'antes' });
    const user = userEvent.setup();
    const view = renderFala();
    const dialog = await openRow(user, /tema guardado/);
    await record(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Parar a gravação' }));
    await within(dialog).findByText('Sem espaço neste aparelho para guardar a mídia.');
    await user.type(within(dialog).getByLabelText('Notas (opcional)'), ' e depois');
    vi.mocked(saveSpeechSession).mockClear();
    vi.mocked(addSpeechRecording).mockClear();
    view.unmount();
    await waitFor(async () => expect(await stored('sx')).toMatchObject({ notes: 'antes e depois', recordings: [{ hash: SND }] }));
    expect(saveSpeechSession).toHaveBeenCalledTimes(1);
    expect(addSpeechRecording).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addSpeechRecording).mock.calls[0]![2]).toEqual({});
  });

  it('leaving the screen while recording stops the microphone and keeps the recording', async () => {
    const user = userEvent.setup();
    const view = renderFala();
    const dialog = await newSession(user, 'Simulação');
    await record(user, dialog);
    view.unmount();
    await waitFor(async () => expect((await sessions())[0]).toMatchObject({ kind: 'simulacao', recordings: [{ hash: SND }] }));
    expect(mic.track.stop).toHaveBeenCalled();
  });

  it('leaving the screen with a recording that could not be stored yet stores it', async () => {
    vi.mocked(saveMediaBlob).mockRejectedValueOnce(new MediaInputError('Sem espaço neste aparelho para guardar a mídia.'));
    const user = userEvent.setup();
    const view = renderFala();
    const dialog = await newSession(user, 'Simulação');
    await record(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Parar a gravação' }));
    await within(dialog).findByText('Sem espaço neste aparelho para guardar a mídia.');
    view.unmount();
    await waitFor(async () => expect((await sessions())[0]).toMatchObject({ recordings: [{ hash: SND }] }));
  });
});

describe('useRecorder hand-over (speech only)', () => {
  it('without the option nothing changes: Parar and leaving in the same tick frees the mic at once and makes no recording', async () => {
    const { result, unmount } = renderHook(() => useRecorder());
    act(() => result.current.start());
    await flush();
    act(() => result.current.stop());
    unmount();
    expect(mic.track.stop).toHaveBeenCalled();
    expect(mic.instances[0]!.onstop).toBeNull();
    await flush();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('with onUnmount, Parar and leaving in the same tick hands the stopped recording over', async () => {
    const handed = vi.fn();
    const { result, unmount } = renderHook(() => useRecorder(180_000, { onUnmount: handed }));
    act(() => result.current.start());
    await flush();
    vi.setSystemTime(at(23, 10) + 20_000);
    act(() => result.current.stop());
    unmount();
    await flush();
    expect(handed).toHaveBeenCalledTimes(1);
    expect(handed.mock.calls[0]![0]).toMatchObject({ durationMs: 20_000, capped: false });
    expect((handed.mock.calls[0]![0] as { blob: Blob }).blob.size).toBe(16);
    expect(mic.track.stop).toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('with onUnmount, a recording in progress is finished and handed over', async () => {
    const handed = vi.fn();
    const { result, unmount } = renderHook(() => useRecorder(180_000, { onUnmount: handed }));
    act(() => result.current.start());
    await flush();
    vi.setSystemTime(at(23, 10) + 30_000);
    unmount();
    await flush();
    expect(handed).toHaveBeenCalledTimes(1);
    expect(handed.mock.calls[0]![0]).toMatchObject({ durationMs: 30_000, capped: false });
    expect((handed.mock.calls[0]![0] as { blob: Blob }).blob.size).toBe(16);
    expect(mic.track.stop).toHaveBeenCalled();
  });
});
