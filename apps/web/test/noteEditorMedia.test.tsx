import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '@life/shared';
import { db } from '../src/db/db';
import { MediaInputError } from '../src/db/media';
import { ensureSeed } from '../src/db/seed';
import { saveDeck } from '../src/domain/studyActions';
import { compressImage } from '../src/features/media/imageCompress';
import { NoteEditor } from '../src/features/study/NoteEditor';
import { resetMediaSyncState } from '../src/sync/media';
import { ToastHost } from '../src/ui/Toast';
import { PNG_BYTES } from './fakeMedia';

vi.mock('../src/features/media/imageCompress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/features/media/imageCompress')>()),
  compressImage: vi.fn(async (f: Blob) => f),
}));
vi.mock('../src/features/media/drawingImage', () => ({
  drawingToImage: vi.fn(async () => new Blob([PNG_BYTES], { type: 'image/png' })),
}));

const IMG = sha256Hex(PNG_BYTES);
const pngFile = () => new File([PNG_BYTES], 'print.png', { type: 'image/png' });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
  resetMediaSyncState();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:t/1');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); window.history.pushState({}, '', '/'); });

async function openEditor(): Promise<HTMLTextAreaElement> {
  const d = await saveDeck({ name: 'Cálculo' });
  window.history.pushState({}, '', `/estudo/nota/nova?baralho=${d.id}`);
  render(<><NoteEditor /><ToastHost /></>);
  return (await screen.findByLabelText('Verso')) as HTMLTextAreaElement;
}

describe('images in the note editor', () => {
  it('pasting an image inserts its reference at the cursor, label selected, and the preview shows it', async () => {
    const user = userEvent.setup();
    const back = await openEditor();
    await user.type(back, 'Gráfico:');
    fireEvent.paste(back, { clipboardData: { files: [pngFile()], types: ['Files'] } });
    await waitFor(() => expect(back).toHaveValue(`Gráfico: ![imagem](media:${IMG})`));
    await waitFor(() => expect(back.selectionStart).toBe('Gráfico: !['.length));
    expect(back.selectionEnd).toBe('Gráfico: ![imagem'.length);
    expect(screen.getByText('Imagem adicionada.')).toBeInTheDocument();
    expect(await db.mediaQueue.get(IMG)).toBeTruthy();
    // the preview's image (the waiting box has the same name for one tick, so assert inside waitFor)
    await waitFor(() => expect(screen.getByRole('img', { name: 'imagem' })).toHaveAttribute('src', 'blob:t/1'));
  });

  it('text paste is left alone; the picker and drag-and-drop insert too', async () => {
    const user = userEvent.setup();
    const back = await openEditor();
    fireEvent.paste(back, { clipboardData: { files: [], types: ['text/plain'] } });
    expect(back).toHaveValue('');
    await user.upload(screen.getByLabelText('Arquivo de imagem para Frente'), pngFile());
    await waitFor(() => expect(screen.getByLabelText('Frente')).toHaveValue(`![imagem](media:${IMG})`));
    fireEvent.drop(back, { dataTransfer: { files: [pngFile()], types: ['Files'] } });
    await waitFor(() => expect(back).toHaveValue(`![imagem](media:${IMG})`));
    expect(await db.mediaInfo.count()).toBe(1);
  });

  it('errors become a toast and leave the text alone', async () => {
    const back = await openEditor();
    vi.mocked(compressImage).mockRejectedValueOnce(new MediaInputError('Esse arquivo não é uma imagem.'));
    fireEvent.paste(back, { clipboardData: { files: [pngFile()], types: ['Files'] } });
    expect(await screen.findByText('Esse arquivo não é uma imagem.')).toBeInTheDocument();
    expect(back).toHaveValue('');
    fireEvent.drop(back, { dataTransfer: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })], types: ['Files'] } });
    expect(await screen.findByText('Arraste uma imagem ou um áudio.')).toBeInTheDocument();
  });

  it('Desenho turns a drawing into an image reference', async () => {
    const user = userEvent.setup();
    const back = await openEditor();
    await user.click(screen.getByRole('button', { name: 'Inserir desenho em Verso' }));
    const pad = await screen.findByRole('img', { name: 'Desenho do card: 0 traços' });
    expect(screen.getByRole('button', { name: 'Inserir no card' })).toBeDisabled();
    fireEvent.pointerDown(pad, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(pad, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 20, clientY: 20 });
    await user.click(screen.getByRole('button', { name: 'Inserir no card' }));
    await waitFor(() => expect(back).toHaveValue(`![desenho](media:${IMG})`));
    expect(screen.getByText('Desenho adicionado.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Desenho' })).toBeNull();
  });
});
