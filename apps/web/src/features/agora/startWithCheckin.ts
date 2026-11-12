import { create } from 'zustand';
import type { DayKey, ID, Mission, Settings } from '@life/shared';
import { dayKeyOf, isOfBlock } from '@life/shared';
import { readCurrentBlock } from '../../db/dayPlan';
import { db } from '../../db/db';
import { startWithFeedback } from '../mission/missionFeedback';

// §6 "Card de início": every "Começar" (Agora card, mission sheet, Painel) goes through
// `startWithCheckin`, so an avoided mission gets the same optional card wherever it is started.

export interface CheckinRequest {
  mission: Mission;
  /** Runs once the mission was started from the card (e.g. the Agora opens the mission sheet). */
  onStarted?(): void;
}

interface CheckinCardStore {
  request?: CheckinRequest;
  /** Bumped on every open, so a reopened card starts empty. */
  seq: number;
  open(request: CheckinRequest): void;
  close(): void;
}

/** Global opener of the start card. Mount `CheckinCardHost` once. */
export const useCheckinCard = create<CheckinCardStore>((set) => ({
  request: undefined,
  seq: 0,
  open: (request) => set((s) => ({ request, seq: s.seq + 1 })),
  close: () => set({ request: undefined }),
}));

/** "Não mostrar de novo hoje": one localStorage key per logical day. */
export const CHECKIN_OFF_PREFIX = 'life-rpg:checkin-off:';

export function checkinOffToday(day: DayKey): boolean {
  try {
    return localStorage.getItem(CHECKIN_OFF_PREFIX + day) !== null;
  } catch {
    return false;
  }
}

/** Hides the card for `day` and forgets the keys of other days. */
export function hideCheckinToday(day: DayKey): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(CHECKIN_OFF_PREFIX) && key !== CHECKIN_OFF_PREFIX + day) localStorage.removeItem(key);
    }
    localStorage.setItem(CHECKIN_OFF_PREFIX + day, '1');
  } catch {
    /* private mode / quota: the card simply shows again next time */
  }
}

/** Postponed twice or heavy, the card is on (absent = on) and was not hidden today. */
export function wantsCheckin(m: Mission, settings: Settings | undefined, day: DayKey): boolean {
  if (settings?.checkinCard === false || m.deleted || m.status !== 'open') return false;
  if (m.postponeCount < 2 && m.energy !== 'heavy') return false;
  return !checkinOffToday(day);
}

/** "Começar": the start card for an avoided mission, otherwise start right away. */
export async function startWithCheckin(id: ID, onStarted?: () => void): Promise<void> {
  const [mission, settings] = await Promise.all([db.missions.get(id), db.settings.get('settings')]);
  if (mission && wantsCheckin(mission, settings, dayKeyOf(Date.now(), settings?.dayStartHour ?? 4))) {
    useCheckinCard.getState().open({ mission, onStarted });
    return;
  }
  await startWithFeedback(id);
  onStarted?.();
}

/** The current block, when the mission belongs to it (stored with the check-in or the escape). */
export async function currentBlockOf(mission: Mission | undefined): Promise<ID | undefined> {
  const current = await readCurrentBlock();
  if (!current) return undefined;
  return !mission || isOfBlock(mission, current.block) ? current.block.id : undefined;
}
