import type { Settings } from '@life/shared';
import { observationOf, observationState } from '@life/shared';
import { db } from '../db/db';
import { patch } from '../db/repo';
import { getToday, withLock } from './common';

// Observação de 14 dias: one observation at a time, in settings (synced). Two writes per observation; the end after
// 14 days is computed, never written. No XP, no notification.

const LOCK = 'settings:observation';

/** "Começar" / "Começar outra": a new observation from today (the previous one leaves the Diário). */
export async function startObservation(): Promise<void> {
  const today = await getToday();
  await withLock(LOCK, async () => {
    const s = await db.settings.get('settings');
    if (!s || s.deleted) return;
    await patch<Settings>('settings', 'settings', { observation: { startDay: today } });
  });
}

/** "Encerrar": the running observation ends today (nothing for none or one already over). */
export async function endObservation(): Promise<void> {
  const today = await getToday();
  await withLock(LOCK, async () => {
    const s = await db.settings.get('settings');
    const o = s && !s.deleted ? observationOf(s) : undefined;
    if (!o || observationState(o, today).kind !== 'active') return;
    await patch<Settings>('settings', 'settings', { observation: { startDay: o.startDay, endedDay: today } });
  });
}
