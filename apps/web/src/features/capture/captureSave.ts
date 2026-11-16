import type { BaseRecord, Commitment, DayKey, ID, Mission, Note } from '@life/shared';
import { compactTitle, dayKeyToDate, parseCapture, ulid } from '@life/shared';
import { createAssessment } from '../../domain/facultyActions';
import { captureLines, createCommitment, createMission, resolveJourney } from '../../domain/missionActions';
import { captureCardDraft, isCardCapture, saveNote } from '../../domain/studyActions';
import { removeSpans, type CaptureRequest } from './captureModel';

export type Captured = Mission | Commitment | Note;
export const isMission = (r: Captured): r is Mission => 'status' in r;
/** A "? …" line became a card draft (Marco 3). */
export const isCardDraft = (r: Captured): r is Note => 'front' in r;

const pad2 = (n: number): string => String(n).padStart(2, '0');
/** A date token the parser understands ("20/11/2026"). */
function slashDate(day: DayKey): string {
  const d = dayKeyToDate(day);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Saves the requests of the "+" in order. A new journey is created here, once per name (only Salvar
 * writes). Missions and commitments get strictly increasing timestamps (and ulids), so pasted lines keep
 * their order in every list sorted by `createdAt`.
 */
export async function saveCaptureRequests(requests: readonly CaptureRequest[]): Promise<Captured[]> {
  const out: Captured[] = [];
  const newJourneys = new Map<string, ID>();
  let last = 0;
  const stamp = (): Pick<BaseRecord, 'id' | 'createdAt' | 'updatedAt'> => {
    const at = Math.max(Date.now(), last + 1);
    return { id: ulid(at), createdAt: at, updatedAt: at };
  };
  for (const r of requests) {
    if (r.type === 'mission') {
      let journeyId = r.fields.journeyId;
      if (r.newJourneyName !== undefined) {
        const key = compactTitle(r.newJourneyName);
        journeyId = newJourneys.get(key) ?? (await resolveJourney(r.newJourneyName)).id;
        newJourneys.set(key, journeyId);
      }
      const m = await createMission({ ...r.fields, ...(journeyId ? { journeyId } : {}), ...stamp() });
      last = m.createdAt;
      out.push(m);
    } else if (r.type === 'commitment') {
      const c = await createCommitment({ ...r.fields, ...stamp() });
      last = c.createdAt;
      out.push(c);
    } else if (r.type === 'assessment') {
      out.push(await createAssessment(r.input));
    } else {
      out.push(await saveNote({ type: 'basic', front: r.front, back: '', draft: true, ...(r.deckId ? { deckId: r.deckId } : {}) }));
    }
  }
  return out;
}

export interface SaveOptions {
  today: DayKey;
  /** The user switched a "time ⇒ commitment" line to a plain mission (single-line capture only). */
  asMission?: boolean;
  /** Day used when a line has no date of its own (e.g. "+ Missão neste dia"). */
  defaultDate?: DayKey;
}

/**
 * Saves every non-empty line of free text (kept for callers outside the "+"). Reuses `captureLines`
 * (journey/area resolution, events) and only adjusts the text per line: the time is dropped when the user
 * chose "Missão", and lines without a date get `defaultDate`. Lines whose title would be empty are skipped.
 */
export async function saveCapture(text: string, opts: SaveOptions): Promise<Captured[]> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const out: Captured[] = [];
  for (const line of lines) {
    if (isCardCapture(line)) {
      const note = await captureCardDraft(line);
      if (note) out.push(note);
      continue;
    }
    const p = parseCapture(line, opts.today);
    if (p.title === '') continue;
    // A recurrence gives the line its own first date (next occurrence), like a date token does.
    const hasDate = p.tokens.some((t) => t.type === 'date' || t.type === 'recurrence');
    let src = line;
    const extra: Partial<Mission> = {};
    if (p.kind === 'commitment' && opts.asMission && lines.length === 1) {
      src = removeSpans(line, p.tokens.filter((t) => t.type === 'time'));
      if (!hasDate) extra.date = opts.defaultDate ?? opts.today;
    } else if (!hasDate && opts.defaultDate) {
      if (p.kind === 'commitment') src = `${line} ${slashDate(opts.defaultDate)}`;
      else extra.date = opts.defaultDate;
    }
    out.push(...(await captureLines(src, extra)));
  }
  return out;
}
