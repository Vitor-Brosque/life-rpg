import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { concludePractice, createPracticeSession, setPracticeRating, updatePractice } from '../src/domain/practiceActions';
import { PracticeScreen } from '../src/features/practice/PracticeScreen';
import { SpeechScreen } from '../src/features/speech/SpeechScreen';
import { resetMediaSyncState } from '../src/sync/media';
import { ToastHost, useToast } from '../src/ui/Toast';
import { installFakeMic } from './fakeMedia';

let mic: ReturnType<typeof installFakeMic>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  await db.delete(); await db.open();
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

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const ADDRESS = '/estudo/fala?explicar=explicar%20um%20JOIN';
const openBridge = async () => {
  window.history.pushState({}, '', ADDRESS);
  render(<><SpeechScreen /><ToastHost /></>);
  const dialog = await screen.findByRole('dialog', { name: 'Nova sessão de fala' });
  expect(within(dialog).getByRole('button', { name: 'Explicação espontânea' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(dialog).getByDisplayValue('explicar um JOIN')).toBeInTheDocument();
  return dialog;
};
const noDialog = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

describe('Explicar em voz alta', () => {
  it('the closed practice step links to a speech session with its topic', async () => {
    const s = await createPracticeSession({ title: 'Dedup' });
    await updatePractice(s.id, { step: 'close' });
    for (const k of ['delivered', 'understood', 'autonomous'] as const) await setPracticeRating(s.id, k, 2);
    await concludePractice(s.id);
    window.history.pushState({}, '', `/pratica/${s.id}`);
    render(<PracticeScreen id={s.id} />);
    await screen.findByText('Sessão encerrada em 13/11.');
    expect(screen.getByRole('link', { name: 'Explicar em voz alta' })).toHaveAttribute('href', '/estudo/fala?explicar=Dedup');
  });

  it('opens the sheet prefilled, cleans the address and writes nothing; closing untouched keeps nothing', async () => {
    const user = userEvent.setup();
    const before = await db.outbox.count();
    const dialog = await openBridge();
    expect(window.location.search).toBe('');
    expect(await db.outbox.count()).toBe(before);
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    await noDialog();
    await flush();
    expect(await db.speechSessions.count()).toBe(0);
    expect(screen.queryByText('Sessão guardada em aberto.')).toBeNull();
    expect(await db.outbox.count()).toBe(before);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Fala' })).toHaveFocus());
  });

  it('clearing the prefilled topic and closing writes nothing and shows no toast', async () => {
    const user = userEvent.setup();
    const before = await db.outbox.count();
    const dialog = await openBridge();
    await user.clear(within(dialog).getByDisplayValue('explicar um JOIN'));
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    await noDialog();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Fala' })).toHaveFocus());
    await flush();
    expect(await db.speechSessions.count()).toBe(0);
    expect(await db.outbox.count()).toBe(before);
    expect(screen.queryByText('Sessão guardada em aberto.')).toBeNull();
    expect(screen.queryByText('Alterações guardadas.')).toBeNull();
  });

  it('an empty topic in the address does not open the sheet; the address is still cleaned', async () => {
    const before = await db.outbox.count();
    window.history.pushState({}, '', '/estudo/fala?explicar=');
    render(<><SpeechScreen /><ToastHost /></>);
    await screen.findByRole('button', { name: 'Nova sessão' });
    await waitFor(() => expect(window.location.search).toBe(''));
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await db.outbox.count()).toBe(before);
  });

  it('a topic with %, &, # and accents opens as written', async () => {
    const topic = 'Índices & ordenação: 100% do #1';
    expect(`?explicar=${encodeURIComponent(topic)}`).toContain('%25');
    window.history.pushState({}, '', `/estudo/fala?explicar=${encodeURIComponent(topic)}`);
    render(<><SpeechScreen /><ToastHost /></>);
    const dialog = await screen.findByRole('dialog', { name: 'Nova sessão de fala' });
    expect(within(dialog).getByDisplayValue(topic)).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('a long topic in several lines opens in one line, cut at 120 characters', async () => {
    const topic = `linha um
linha dois ${'x'.repeat(140)}`;
    window.history.pushState({}, '', `/estudo/fala?explicar=${encodeURIComponent(topic)}`);
    render(<><SpeechScreen /><ToastHost /></>);
    const dialog = await screen.findByRole('dialog', { name: 'Nova sessão de fala' });
    const expected = `linha um linha dois ${'x'.repeat(140)}`.slice(0, 120);
    expect(expected).toHaveLength(120);
    expect(within(dialog).getByDisplayValue(expected)).toBeInTheDocument();
  });

  it('under StrictMode (double mount) one sheet opens and nothing is written', async () => {
    const user = userEvent.setup();
    const before = await db.outbox.count();
    window.history.pushState({}, '', ADDRESS);
    render(<StrictMode><SpeechScreen /><ToastHost /></StrictMode>);
    const dialog = await screen.findByRole('dialog', { name: 'Nova sessão de fala' });
    expect(within(dialog).getByDisplayValue('explicar um JOIN')).toBeInTheDocument();
    await flush();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(await db.outbox.count()).toBe(before);
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    await noDialog();
    await flush();
    expect(await db.speechSessions.count()).toBe(0);
    expect(await db.outbox.count()).toBe(before);
  });

  it('unmounting an untouched prefilled sheet writes nothing', async () => {
    const before = await db.outbox.count();
    await openBridge();
    await flush();
    window.dispatchEvent(new Event('pagehide'));
    cleanup();
    await flush();
    expect(await db.speechSessions.count()).toBe(0);
    expect(await db.outbox.count()).toBe(before);
  });

  it('typing one more word keeps the session open with what he typed', async () => {
    const user = userEvent.setup();
    const dialog = await openBridge();
    await user.type(within(dialog).getByDisplayValue('explicar um JOIN'), 's');
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    expect(await screen.findByText('Sessão guardada em aberto.')).toBeInTheDocument();
    const all = await db.speechSessions.toArray();
    expect(all).toHaveLength(1);
    expect(all[0]!.topic).toBe('explicar um JOINs');
  });

  it('recording creates the session with the prefilled topic and the recording', async () => {
    const user = userEvent.setup();
    const dialog = await openBridge();
    await user.click(within(dialog).getByRole('button', { name: 'Gravar' }));
    await flush();
    await within(dialog).findByText('Gravando · 0:00 / 3:00');
    await user.click(within(dialog).getByRole('button', { name: 'Parar a gravação' }));
    await screen.findByText('Gravação guardada.');
    const all = await db.speechSessions.toArray();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: 'explicacao', topic: 'explicar um JOIN' });
    expect(all[0]!.recordings).toHaveLength(1);
  });
});
