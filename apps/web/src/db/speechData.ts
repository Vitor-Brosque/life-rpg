import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKey, ID, RetentionItem, SpeechProgram, SpeechSession, SpeechSettings, SpeechSituation } from '@life/shared';
import { SPEECH_TOPIC_MAX, activeProgram, mediaRefs, normalizeSpeechSession, retentionCandidates, stripMedia } from '@life/shared';
import { db } from './db';
import { getMeta } from './repo';

// Comunicação oral: reading only (opening a screen never writes).

const byNewest = (a: SpeechSession, b: SpeechSession): number =>
  (a.day < b.day ? 1 : a.day > b.day ? -1 : b.createdAt - a.createdAt);

export function useSpeechSessions(): SpeechSession[] | undefined {
  return useLiveQuery(async () => (await db.speechSessions.toArray())
    .filter((s) => !s.deleted).map(normalizeSpeechSession).sort(byNewest));
}

export type SpeechDoc = { status: 'loading' } | { status: 'ready'; session?: SpeechSession };

/** One session, live; `session` absent while it does not exist yet (a new sheet) or after it was deleted. */
export function useSpeechSessionDoc(id: ID | undefined): SpeechDoc {
  const r = useLiveQuery(async () => ({ id, s: id ? ((await db.speechSessions.get(id)) ?? null) : null }), [id]);
  if (!r || r.id !== id) return { status: 'loading' };
  return r.s && !r.s.deleted ? { status: 'ready', session: normalizeSpeechSession(r.s) } : { status: 'ready' };
}

export function useSpeechSituations(): SpeechSituation[] | undefined {
  return useLiveQuery(async () => (await db.speechSituations.toArray())
    .filter((x) => !x.deleted).sort((a, b) => b.at - a.at));
}

/** The active program; null without one; undefined while loading. */
export function useSpeechProgram(): SpeechProgram | null | undefined {
  return useLiveQuery(async () => activeProgram(await db.speechPrograms.toArray()) ?? null);
}

export function useSpeechSettings(): SpeechSettings | undefined {
  return useLiveQuery(async () => (await db.settings.get('settings'))?.speech ?? {});
}

export interface TopicChoice { id: ID; title: string }
const TOPICS_MAX = 30;
const oneLine = (t: string): string => stripMedia(t).replace(/\s+/g, ' ').trim().slice(0, SPEECH_TOPIC_MAX).trim();

/** "Escolher de…": active journeys (subjects included) by order, and the newest Tópico cards (not drafts). */
export function useTopicChoices(): { journeys: TopicChoice[]; topics: TopicChoice[] } | undefined {
  return useLiveQuery(async () => {
    const journeys = (await db.journeys.toArray()).filter((j) => !j.deleted && j.status === 'active')
      .sort((a, b) => a.order - b.order).map((j) => ({ id: j.id, title: oneLine(j.title) }));
    const topics = (await db.notes.toArray()).filter((n) => !n.deleted && !n.draft && n.type === 'topic')
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, TOPICS_MAX)
      .map((n) => ({ id: n.id, title: oneLine(n.front) })).filter((x) => x.title !== '');
    return { journeys, topics };
  });
}

export type SpaceCandidate = RetentionItem & { size: number };
export interface SpeechSpace {
  onDevice: { count: number; bytes: number };   // speech recordings whose file is on this device
  candidates: SpaceCandidate[];                 // MAY leave this device once the server confirms it holds them (oldest first)
  waiting: number;                              // speech recordings still in the upload queue
  synced: boolean;                              // a sync token exists (the server is connected)
}

export function useSpeechSpace(today: DayKey | undefined): SpeechSpace | undefined {
  return useLiveQuery(async () => {
    if (!today) return undefined;
    const sessions = (await db.speechSessions.toArray()).filter((s) => !s.deleted).map(normalizeSpeechSession);
    const hashes = [...new Set(sessions.flatMap((s) => s.recordings.map((r) => r.hash)))];
    const here = new Map((await db.mediaInfo.bulkGet(hashes)).flatMap((i) => (i ? [[i.hash, i.size] as const] : [])));
    const queued = new Set((await db.mediaQueue.bulkGet(hashes)).flatMap((q) => (q ? [q.hash] : [])));
    const cards = new Set(mediaRefs((await db.notes.toArray()).filter((n) => !n.deleted).flatMap((n) => [n.front, n.back, n.extra])));
    const candidates = retentionCandidates(sessions, today)
      .flatMap((c) => (here.has(c.hash) && !queued.has(c.hash) && !cards.has(c.hash) ? [{ ...c, size: here.get(c.hash)! }] : []));
    return {
      onDevice: { count: here.size, bytes: [...here.values()].reduce((s, b) => s + b, 0) },
      candidates, waiting: queued.size, synced: !!(await getMeta<string>('syncToken')),
    };
  }, [today]);
}
