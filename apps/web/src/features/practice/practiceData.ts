import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKey, FeedbackSource, Journey, PracticeSession } from '@life/shared';
import { normalizePractice, stepLabel } from '@life/shared';
import { db } from '../../db/db';
import { relativeTime } from '../../ui/format';

/** Live sessions (not deleted), normalized, most recently edited first; undefined while loading. */
export function usePracticeSessions(): PracticeSession[] | undefined {
  return useLiveQuery(async () => (await db.practiceSessions.orderBy('updatedAt').reverse().toArray())
    .filter((s) => !s.deleted)
    .map(normalizePractice));
}

export interface PracticeDoc { status: 'loading' | 'missing' | 'ready'; session?: PracticeSession }

/** One session, live and normalized. Tagged with the id: right after `id` changes, the old result is ignored. */
export function usePracticeSession(id: string): PracticeDoc {
  const r = useLiveQuery(async () => ({ id, s: (await db.practiceSessions.get(id)) ?? null }), [id]);
  const raw = r && r.id === id ? r.s : undefined;
  const session = useMemo(() => (raw && !raw.deleted ? normalizePractice(raw) : undefined), [raw]);
  if (!r || r.id !== id) return { status: 'loading' };
  return session ? { status: 'ready', session } : { status: 'missing' };
}

/** `?voltar=` only when it is an internal path ("/…", not "//…", no backslash or control characters); else the list. */
export function practiceBack(v: string | null): string {
  return v && v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') && !/[\u0000-\u001f\u007f]/.test(v) ? v : '/estudo/praticas';
}

/** The current step's title: where focus goes when the button that was used disappears. */
export const focusStepTitle = (): HTMLElement | null => document.getElementById('practice-step-title');

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function dayMonth(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

const journeyTitle = (s: PracticeSession, journeys: readonly Journey[]): string | undefined =>
  (s.journeyId ? journeys.find((j) => j.id === s.journeyId && !j.deleted)?.title : undefined);

/** "16/11" from a logical day. */
export const dayKeyMonth = (day: DayKey): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** A retest's meta (P2): "Reconstrução · 16/11" before its day, "Reconstrução · hoje" on it or after. */
export function retestMeta(s: Pick<PracticeSession, 'retestOf' | 'availableFrom'>, today?: DayKey): string | undefined {
  if (!s.retestOf) return undefined;
  return s.availableFrom && (!today || s.availableFrom > today) ? `Reconstrução · ${dayKeyMonth(s.availableFrom)}` : 'Reconstrução · hoje';
}

/** "Reconstrução · hoje · Tech News · há 2 dias · Passo: Implementar". */
export function openMeta(s: PracticeSession, journeys: readonly Journey[], now: number, today?: DayKey): string {
  return [retestMeta(s, today), journeyTitle(s, journeys), relativeTime(s.updatedAt, now), `Passo: ${stepLabel(s.step)}`]
    .filter(Boolean).join(' · ');
}

/** "13/11 · Tech News". */
export function doneMeta(s: PracticeSession, journeys: readonly Journey[]): string {
  return [dayMonth(s.endedAt ?? s.updatedAt), journeyTitle(s, journeys)].filter(Boolean).join(' · ');
}

export const SOURCE_LABEL: Record<FeedbackSource, string> = { person: 'Pessoa', ai: 'IA', tool: 'Ferramenta' };
