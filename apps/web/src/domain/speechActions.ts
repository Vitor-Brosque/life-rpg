import type {
  ID, Settings, SituationContext, SituationRepeats, SpeechPhase, SpeechProgram, SpeechRecording, SpeechScore, SpeechSession,
  SpeechSessionPatch, SpeechSituation,
} from '@life/shared';
import {
  SITUATION_NOTE_MAX, SPEECH_PHASE_NOTE_MAX, SPEECH_XP, activeProgram, clampWeek, earnsSpeechXp, mediaRefs, mergeSpeechPatch,
  normalizeSpeechSession, retentionCandidates, speechXpAllowed, speechXpId, withKeep, withRecording,
} from '@life/shared';
import { db } from '../db/db';
import { getMeta, mutate, newRecord, patch, put, softDelete } from '../db/repo';
import { mediaOnServer } from '../sync/media';
import { awardXp, getToday, hasLiveXp, withLock } from './common';

// Comunicação oral (2026-11-23). A session exists only after a recording, "Encerrar" or typed text kept on closing; every
// write changes only the touched fields on top of the stored record. Situations are append-only. Nothing here deletes a
// synced record by itself; freeSpeechRecordings only removes local copies of files already on the server.

const T = 'speechSessions' as const;
const P = 'speechPrograms' as const;
const SPEECH_AREA = 'area-intelecto';

export const SPEECH_EMPTY_TEXT = 'Grave ao menos uma vez ou marque “Fiz a atividade” para encerrar.';
export class SpeechEmptyError extends Error {
  constructor() { super('A speech session needs a recording or "done" to close'); }
}

async function stored(id: ID): Promise<SpeechSession | undefined> {
  const s = await db.speechSessions.get(id);
  return s && !s.deleted ? normalizeSpeechSession(s) : undefined;
}

/** `p` over the stored session (plus what `extra` adds from the merged one), or a new session of today. Call inside the session's lock. */
async function write(id: ID, p: SpeechSessionPatch, extra?: (cur: SpeechSession) => Partial<SpeechSession>): Promise<SpeechSession> {
  if (!(await stored(id))) {
    if (!p.kind) throw new Error('A new speech session needs a kind');
    const fresh = newRecord<SpeechSession>({ id, day: await getToday(), kind: p.kind, recordings: [], ratings: {} });
    const merged = { ...fresh, ...mergeSpeechPatch(fresh, p) };
    return put(T, { ...merged, ...(extra ? extra(merged) : {}) });
  }
  return mutate<SpeechSession>(T, id, (raw) => {
    const cur = normalizeSpeechSession(raw);
    const fields = mergeSpeechPatch(cur, p);
    const changes = { ...fields, ...(extra ? extra({ ...cur, ...fields }) : {}) };
    return Object.keys(changes).length > 0 ? changes : undefined;
  });
}

const sessionLock = <X>(id: ID, fn: () => Promise<X>): Promise<X> => withLock(`speech-${id}`, fn);

/** The sheet's changes (a new session needs `kind`). */
export const saveSpeechSession = (id: ID, p: SpeechSessionPatch): Promise<SpeechSession> => sessionLock(id, () => write(id, p));

/** A recording just kept on this device: added to the session (created with the touched fields when new). */
export const addSpeechRecording = (id: ID, rec: SpeechRecording, p: SpeechSessionPatch): Promise<SpeechSession> =>
  sessionLock(id, () => write(id, p, (cur) => ({ recordings: withRecording(cur.recordings, rec) })));

/** "Guardar": the recording is never offered to leave this device. */
export const setRecordingKeep = (id: ID, hash: string, keep: boolean): Promise<SpeechSession> =>
  sessionLock(id, () => mutate<SpeechSession>(T, id, (raw) => ({ recordings: withKeep(normalizeSpeechSession(raw).recordings, hash, keep) })));

/** "Encerrar sessão": needs a recording or "Fiz a atividade" (checked before writing); +8 XP once, at most 2 sessions a day. */
export const closeSpeechSession = (id: ID, p: SpeechSessionPatch): Promise<{ xp: number }> => withLock('speech-xp', () => sessionLock(id, async () => {
  const prev = await stored(id);
  const done = 'done' in p ? p.done === true : prev?.done === true;
  if (!earnsSpeechXp({ recordings: prev?.recordings ?? [], done })) throw new SpeechEmptyError();
  await write(id, p, (cur) => (cur.closedAt === undefined ? { closedAt: Date.now() } : {}));
  const today = await getToday();
  const xpId = speechXpId(id);
  if (await hasLiveXp(xpId)) return { xp: 0 };
  const todayIds = (await db.xpEvents.where('dayKey').equals(today).toArray())
    .filter((x) => !x.deleted && x.reason === 'speech').map((x) => x.id);
  if (!speechXpAllowed(todayIds, id)) return { xp: 0 };
  await awardXp(SPEECH_XP, 'speech', today, { id: xpId, areaId: SPEECH_AREA });
  return { xp: SPEECH_XP };
}));

// ------------------------------------------------------------------ real situations (append-only)

export interface SituationInput {
  context: SituationContext;
  repeats?: SituationRepeats;
  clarity?: SpeechScore;
  comfort?: SpeechScore;
  note?: string;
}

export async function logSituation(input: SituationInput): Promise<SpeechSituation> {
  const note = (input.note ?? '').replace(/\s+/g, ' ').trim().slice(0, SITUATION_NOTE_MAX).trim();
  return put('speechSituations', newRecord<SpeechSituation>({
    day: await getToday(), at: Date.now(), context: input.context,
    ...(input.repeats !== undefined ? { repeats: input.repeats } : {}),
    ...(input.clarity !== undefined ? { clarity: input.clarity } : {}),
    ...(input.comfort !== undefined ? { comfort: input.comfort } : {}),
    ...(note ? { note } : {}),
  }));
}

export const removeSituation = (id: ID): Promise<void> => softDelete('speechSituations', id);
export const restoreSituation = (id: ID): Promise<SpeechSituation> => patch<SpeechSituation>('speechSituations', id, { deleted: false });

// ------------------------------------------------------------------ the 12-week program

export const startSpeechProgram = (): Promise<SpeechProgram> => withLock('speech-program', async () => {
  const current = activeProgram(await db.speechPrograms.toArray());
  if (current) return current;
  return put(P, newRecord<SpeechProgram>({ startDay: await getToday(), week: 1, status: 'ativo', phaseNotes: {} }));
});

export const setProgramWeek = (id: ID, week: number): Promise<SpeechProgram> => patch<SpeechProgram>(P, id, { week: clampWeek(week) });

export const endSpeechProgram = async (id: ID): Promise<SpeechProgram> =>
  patch<SpeechProgram>(P, id, { status: 'encerrado', endedDay: await getToday() });

/** "Desfazer" right after ending. */
export const reopenSpeechProgram = (id: ID): Promise<SpeechProgram> => patch<SpeechProgram>(P, id, { status: 'ativo', endedDay: undefined });

/** "Fim da fase N": written only when the text changed; a blank text removes the answer. */
export async function savePhaseNote(id: ID, phase: SpeechPhase, text: string): Promise<SpeechProgram> {
  const day = await getToday();
  const clean = text.trim().slice(0, SPEECH_PHASE_NOTE_MAX).trim();
  return mutate<SpeechProgram>(P, id, (prev) => {
    const notes = { ...(prev.phaseNotes ?? {}) };
    if (clean === (notes[phase]?.text ?? '')) return undefined;
    if (clean) notes[phase] = { text: clean, day, answeredAt: Date.now() };
    else delete notes[phase];
    return { phaseNotes: notes };
  });
}

// ------------------------------------------------------------------ settings and space

export async function dismissSpeechNote(): Promise<void> {
  await db.transaction('rw', db.settings, db.outbox, async () => {
    const cur = await db.settings.get('settings');
    if (cur && !cur.deleted) await patch<Settings>('settings', 'settings', { speech: { ...(cur.speech ?? {}), noteDismissed: true } });
  });
}

export interface FreedSpace { count: number; bytes: number; unconfirmed: number }

/**
 * "Tirar deste aparelho": removes the local copy of each file that is, right now, a retention candidate (not queued for
 * upload, used by no live card, here) AND that the server confirms it holds. Without a sync token, offline, or on any
 * answer but "yes", the file stays and counts as `unconfirmed`. The sessions keep the reference.
 */
export async function freeSpeechRecordings(hashes: readonly string[]): Promise<FreedSpace> {
  const today = await getToday();
  const eligible = async (): Promise<Set<string>> => {
    const cards = new Set(mediaRefs((await db.notes.toArray()).filter((n) => !n.deleted).flatMap((n) => [n.front, n.back, n.extra])));
    const allowed = new Set(retentionCandidates(await db.speechSessions.toArray(), today).map((c) => c.hash));
    const out = new Set<string>();
    for (const h of new Set(hashes)) {
      if (allowed.has(h) && !cards.has(h) && !(await db.mediaQueue.get(h)) && (await db.mediaInfo.get(h))) out.add(h);
    }
    return out;
  };
  const candidates = [...(await eligible())];
  const token = await getMeta<string>('syncToken');
  const confirmed = new Set<string>();
  if (token) {
    for (const h of candidates) if (await mediaOnServer(h, token)) confirmed.add(h);
  }
  const out: FreedSpace = { count: 0, bytes: 0, unconfirmed: candidates.length - confirmed.size };
  if (confirmed.size === 0) return out;
  await db.transaction('rw', db.mediaInfo, db.mediaData, db.mediaQueue, db.notes, db.speechSessions, async () => {
    const still = await eligible();   // re-checked inside the transaction, from the current notes and sessions
    for (const h of confirmed) {
      if (!still.has(h)) { out.unconfirmed += 1; continue; }
      const info = await db.mediaInfo.get(h);
      if (!info) continue;
      await db.mediaInfo.delete(h);
      await db.mediaData.delete(h);
      out.count += 1;
      out.bytes += info.size;
    }
  });
  return out;
}
