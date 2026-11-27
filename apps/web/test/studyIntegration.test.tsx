import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block, BlockOccurrence } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { saveDeck, saveNote } from '../src/domain/studyActions';
import { CaptureForm } from '../src/features/capture/CaptureBar';
import { saveCapture } from '../src/features/capture/captureSave';
import { draftOf, fieldsOf } from '../src/features/routine/blockForm';
import { ReviewPrompt } from '../src/features/study/ReviewPrompt';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 12, 10, 0)); // Thursday
  await db.delete(); await db.open();
  await ensureSeed();
  localStorage.clear();
});
afterEach(() => { vi.useRealTimers(); });

const block = (over: Partial<Block> = {}): Block => ({
  id: 'b1', createdAt: 1, updatedAt: 1, deleted: false, name: 'Complementos', weekdays: [1, 2, 3, 4, 5], order: 0,
  targetStart: '16:50', durationMin: 30, minimumMin: 10, kind: 'light', protected: false, checklist: [], archived: false, ...over,
});
const occ = (over: Partial<Block> = {}) => ({ block: block(over) }) as unknown as BlockOccurrence;

async function withCards(): Promise<void> {
  const d = await saveDeck({ name: 'SQL' });
  for (let i = 0; i < 3; i++) await saveNote({ deckId: d.id, type: 'basic', front: `p${i}`, back: 'r' });
}

describe('capture "? "', () => {
  it('saves a card draft, not a mission', async () => {
    const items = await saveCapture('? o que é idempotência', { today: '2026-11-12' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ front: 'o que é idempotência', draft: true });
    expect((await db.missions.toArray()).filter((m) => !m.deleted)).toHaveLength(0);
  });

  it('the capture form shows the card hint instead of chips and confirms', async () => {
    const user = userEvent.setup();
    render(<CaptureForm />);
    await user.type(screen.getByRole('textbox', { name: 'Capturar' }), '? o que é idempotência');
    expect(screen.getByText(/Vira rascunho de card/)).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/Rascunho de card salvo/)).toBeInTheDocument();
  });
});

describe('ReviewPrompt', () => {
  it('a card inside a light block, a line outside blocks', async () => {
    await withCards();
    const { unmount } = render(<ReviewPrompt mode="normal" current={occ()} />);
    expect(await screen.findByRole('heading', { name: 'Revisão espaçada' })).toBeInTheDocument();
    expect(screen.getByText('3 cards · ~2 min')).toBeInTheDocument();
    unmount();
    render(<ReviewPrompt mode="normal" />);
    expect(await screen.findByRole('link', { name: '3 cards para revisar · ~2 min' })).toHaveAttribute('href', '/estudo/revisar');
  });

  it('goes away in a focus block and on a recovery day', async () => {
    await withCards();
    const { rerender } = render(<ReviewPrompt mode="normal" current={occ()} />);
    expect(await screen.findByRole('heading', { name: 'Revisão espaçada' })).toBeInTheDocument();
    rerender(<ReviewPrompt mode="normal" current={occ({ kind: 'focus' })} />);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Revisão espaçada' })).toBeNull());
    rerender(<ReviewPrompt mode="normal" current={occ({ kind: 'focus', reviews: true })} />);
    expect(await screen.findByRole('heading', { name: 'Revisão espaçada' })).toBeInTheDocument();
    rerender(<ReviewPrompt mode="recovery" />);
    await waitFor(() => expect(screen.queryByRole('link')).toBeNull());
  });
});

describe('block reviews switch', () => {
  it('defaults on for light blocks (field absent), off otherwise; fieldsOf saves it', () => {
    expect(draftOf(block(), 1).reviews).toBe(true);
    expect(draftOf(block({ kind: 'study' }), 1).reviews).toBe(false);
    expect(draftOf(block({ kind: 'study', reviews: true }), 1).reviews).toBe(true);
    expect(draftOf(undefined, 1).reviews).toBe(false);
    expect(fieldsOf({ ...draftOf(block(), 1), reviews: false }).reviews).toBe(false);
  });
});
