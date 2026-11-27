import type {
  ChecklistItem, ID, ItemOutcome, ItemResult, Journey, Mission, Proposal, ProposalItem, ProposedMission, ProposedStudy,
  ProposalStatus, Settings,
} from '@life/shared';
import {
  ASSIST_CONTEXT_TABLES, ASSIST_LIMITS, CLASS_END, CLASS_START, SEASON_FOCUS_MAX, SUBJECT_CONTEXT_TABLES, activeSeason,
  assessmentDay, buildAssistContext, buildSubjectContext, journeyByTitle, nameKey, parsePastedProposal, pasteRequestText,
  proposalItems, proposalNamesOf, topicLevelOf, ulid, validateProposal,
} from '@life/shared';
import type { AssistTables, ProposalIssue, SubjectTables, SyncTable } from '@life/shared';
import { db, tableOf } from '../db/db';
import { mutate, newRecord, patch, putAll } from '../db/repo';
import { createArea, renameArea } from './areaActions';
import { archiveBlock, saveBlock } from './blockActions';
import { getToday, withLock } from './common';
import { addTopic, createAssessment, createSubject, setTopicLevel } from './facultyActions';
import { createGoal } from './goalActions';
import { createJourney } from './journeyActions';
import { createCommitment, createMission } from './missionActions';
import { startSeason } from './seasonActions';
import { mergeBook, saveStudyDoc, setNotebookSection, setStudyProfile } from './notebookActions';
import { saveNote, subjectDeck } from './studyActions';
import { saveTrainingPlan } from './trainingActions';

// Assistentes pelo MCP (spec 2026-11-25 §7.3): applying a proposal item by item, with the actions the app already
// uses. What already exists with the same name is reused (never duplicated); what no longer fits is skipped with the
// reason; nothing gives XP. Each item runs on its own: one failure never undoes the others.

export class ProposalError extends Error {}
/** An item that cannot be applied now; the message is the reason the review shows. */
class Skip extends Error {}

export interface ApplyResult { status: ProposalStatus; applied: number; existed: number; skipped: number; unchecked: number }

const live = <T extends { deleted: boolean }>(xs: T[]): T[] => xs.filter((x) => !x.deleted);
const same = (a: string, b: string): boolean => nameKey(a) === nameKey(b);

async function findArea(name?: string) {
  if (!name) return undefined;
  return live(await db.areas.toArray()).find((a) => !a.archived && same(a.name, name));
}
async function findGoal(title?: string) {
  if (!title) return undefined;
  return live(await db.goals.toArray()).find((g) => (g.status === 'ativo' || g.status === 'pausado') && same(g.title, title));
}
async function findJourney(title: string) {
  return live(await db.journeys.toArray()).find((j) => j.status === 'active' && same(j.title, title));
}
async function findSubject(title: string) {
  return live(await db.journeys.toArray()).find((j) => j.status === 'active' && j.subject === true && same(j.title, title));
}

/** One item of a study package (`study.<package>.<kind>.<index>`), in its subject. `source`: who sent the proposal. */
async function applyStudyItem(
  study: ProposedStudy, kind: string, k: number, today: string, createdSubjects: readonly string[], source: string,
): Promise<ItemResult> {
  let subject = await findSubject(study.subject);
  if (!subject && createdSubjects.some((t) => same(t, study.subject))) {
    // Created (or reused) by this proposal's `subjects` item through the looser title match of `createSubject`.
    const near = journeyByTitle(live(await db.journeys.toArray()), study.subject);
    if (near?.subject === true) subject = near;
  }
  if (!subject) throw new Skip(`a disciplina ${study.subject} não existe`);
  switch (kind) {
    case 'topics': {
      const t = study.topics![k]!;
      const existing = live(await db.subjectTopics.where('journeyId').equals(subject.id).toArray()).find((x) => same(x.name, t.name));
      if (existing) {
        if (t.seen && topicLevelOf(existing) === 'nenhum') await setTopicLevel(existing.id, 'vi');
        return 'existed';
      }
      const topic = await addTopic(subject.id, t.name);
      if (t.seen) await setTopicLevel(topic.id, 'vi');
      return 'applied';
    }
    case 'cards': {
      const c = study.cards![k]!;
      const deck = await subjectDeck(subject);
      if (live(await db.notes.where('deckId').equals(deck.id).toArray()).some((n) => same(n.front, c.front))) return 'existed';
      await saveNote({ type: c.type, front: c.front, back: c.back, draft: true, deckId: deck.id });
      return 'applied';
    }
    case 'assessments': {
      const a = study.assessments![k]!;
      const own = live(await db.missions.where('journeyId').equals(subject.id).toArray());
      if (own.some((m) => m.assessment === a.kind && m.status !== 'dropped' && assessmentDay(m) === a.date)) return 'existed';
      if (a.date < today) throw new Skip('a data já passou');
      await createAssessment({ kind: a.kind, journeyId: subject.id, date: a.date, ...(a.content ? { content: a.content } : {}) });
      return 'applied';
    }
    case 'missions': {
      const m = study.missions![k]!;
      const own = live(await db.missions.where('journeyId').equals(subject.id).toArray());
      if (own.some((x) => (x.status === 'open' || x.status === 'doing') && same(x.title, m.title))) return 'existed';
      const order = own.reduce((mx, x) => Math.max(mx, (x.journeyOrder ?? 0) + 1), 0);
      await createMission({ ...missionFields(m, today), journeyId: subject.id, ...(subject.areaId ? { areaId: subject.areaId } : {}), journeyOrder: order });
      return 'applied';
    }
    // Caderno da disciplina (spec 2026-11-26 §3.4): a section replaces the current one, books merge by title.
    case 'plan': case 'studied': case 'difficulties': case 'nextChat': {
      const text = study.notebook?.[kind];
      if (!text) throw new Skip('item desconhecido');
      return setNotebookSection(subject.id, kind, text);
    }
    case 'bibliography': {
      const r = await mergeBook(subject.id, study.notebook!.bibliography![k]!);
      if (r === 'full') throw new Skip('a bibliografia já tem 40 livros');
      return r;
    }
    case 'docs': {
      const d = study.docs![k]!;
      return saveStudyDoc(subject.id, d.title, d.markdown, source);
    }
    default:
      throw new Skip('item desconhecido');
  }
}

function missionFields(m: ProposedMission, today: string): Partial<Mission> & { title: string } {
  return {
    title: m.title,
    ...(m.durationMin ? { durationMin: m.durationMin } : {}),
    ...(m.energy ? { energy: m.energy } : {}),
    ...(m.important ? { important: true } : {}),
    ...(m.date && m.date >= today ? { date: m.date } : {}),
    ...(m.firstStep ? { firstStep: m.firstStep } : {}),
  };
}

async function applyItem(p: Proposal, item: ProposalItem, state: { routineCleared: boolean; today: string }): Promise<ItemResult> {
  const payload = p.payload;
  const [kind, a, b, c] = item.key.split('.');
  const i = Number(kind === 'routine' ? b : a);
  switch (kind) {
    case 'study': return applyStudyItem(payload.study![i]!, b!, Number(c), state.today, (payload.subjects ?? []).map((x) => x.title), p.source);
    case 'studyProfile': return setStudyProfile(payload.studyProfile!.text);
    case 'preferences': {
      const pr = payload.preferences!;
      await patch<Settings>('settings', 'settings', {
        ...(pr.dayStartHour !== undefined ? { dayStartHour: pr.dayStartHour } : {}),
        ...(pr.dayEndHour !== undefined ? { dayEndHour: pr.dayEndHour } : {}),
      });
      return 'applied';
    }
    case 'renameAreas': {
      const r = payload.renameAreas![i]!;
      const area = await findArea(r.from);
      if (!area) throw new Skip('a área não existe mais');
      if (same(area.name, r.to)) return 'existed';
      if (await findArea(r.to)) throw new Skip(`já existe uma área chamada ${r.to}`);
      await renameArea(area.id, r.to);
      return 'applied';
    }
    case 'areas': {
      const ar = payload.areas![i]!;
      if (await findArea(ar.name)) return 'existed';
      await createArea(ar.name, ar.attribute);
      return 'applied';
    }
    case 'goals': {
      const g = payload.goals![i]!;
      if (await findGoal(g.title)) return 'existed';
      await createGoal({ title: g.title, why: g.why ?? '', horizon: g.horizon ?? '', status: 'ativo' });
      return 'applied';
    }
    case 'season': {
      const s = payload.season!;
      if (activeSeason(await db.seasons.toArray())) throw new Skip('já há uma temporada ativa');
      const focus = [...s.focus.map((text) => ({ text })), ...Array.from({ length: SEASON_FOCUS_MAX }, () => ({ text: '' }))].slice(0, SEASON_FOCUS_MAX);
      await startSeason({ title: s.title, focus, startDay: state.today, plannedWeeks: s.weeks });
      return 'applied';
    }
    case 'journeys': {
      const j = payload.journeys![i]!;
      let journey = await findJourney(j.title);
      const created = !journey;
      if (!journey) {
        const area = await findArea(j.area);
        const goal = await findGoal(j.goal);
        journey = await createJourney({ title: j.title, ...(j.outcome ? { outcome: j.outcome } : {}), ...(goal ? { goalId: goal.id } : {}), ...(area ? { areaId: area.id } : {}) });
      }
      const own = live(await db.missions.where('journeyId').equals(journey.id).toArray());
      let order = own.reduce((mx, m) => Math.max(mx, (m.journeyOrder ?? 0) + 1), 0);
      let added = 0;
      for (const m of j.missions) {
        if (own.some((x) => (x.status === 'open' || x.status === 'doing') && same(x.title, m.title))) continue;
        await createMission({ ...missionFields(m, state.today), journeyId: journey.id, journeyOrder: order });
        order += 1;
        added += 1;
      }
      return created || added > 0 ? 'applied' : 'existed';
    }
    case 'missions': {
      const m = payload.missions![i]!;
      const open = live(await db.missions.toArray()).filter((x) => (x.status === 'open' || x.status === 'doing') && !x.journeyId);
      if (open.some((x) => same(x.title, m.title))) return 'existed';
      const area = await findArea(m.area);
      await createMission({ ...missionFields(m, state.today), ...(area ? { areaId: area.id } : {}) });
      return 'applied';
    }
    case 'routine': {
      const r = payload.routine!;
      const blk = r.blocks[i]!;
      if (r.mode === 'replace' && !state.routineCleared) {
        for (const old of live(await db.blocks.toArray()).filter((x) => !x.archived)) await archiveBlock(old.id);
        state.routineCleared = true;
      }
      const blocks = live(await db.blocks.toArray()).filter((x) => !x.archived);
      if (blocks.some((x) => same(x.name, blk.name) && x.targetStart === blk.start && x.weekdays.join() === blk.weekdays.join())) return 'existed';
      const area = await findArea(blk.area);
      const journey = blk.journey ? await findJourney(blk.journey) : undefined;
      const checklist: ChecklistItem[] = (blk.checklist ?? []).map((text) => ({ id: ulid(), text, done: false }));
      await saveBlock({
        name: blk.name, weekdays: blk.weekdays, targetStart: blk.start, durationMin: blk.durationMin, minimumMin: blk.minimumMin,
        kind: blk.kind, protected: blk.protected ?? false, checklist,
        ...(journey ? { journeyId: journey.id } : area ? { areaId: area.id } : {}),
      });
      return 'applied';
    }
    case 'commitments': {
      const c = payload.commitments![i]!;
      const existing = live(await db.commitments.toArray()).find((x) => x.weekdays?.length && same(x.title, c.title) && x.start === c.start
        && (x.untilDate === undefined || x.untilDate >= state.today));
      if (existing) return 'existed';
      await createCommitment({ title: c.title, date: state.today, start: c.start, end: c.end, weekdays: c.weekdays, remind: true });
      return 'applied';
    }
    case 'training': {
      const t = payload.training!;
      await saveTrainingPlan(t.days, t.block);
      return 'applied';
    }
    case 'subjects': {
      const s = payload.subjects![i]!;
      const before = journeyByTitle(live(await db.journeys.toArray()), s.title);
      await createSubject({ title: s.title, weekdays: s.weekday !== undefined ? [s.weekday] : [], start: s.start ?? CLASS_START, end: s.end ?? CLASS_END });
      return before?.subject ? 'existed' : 'applied';
    }
    default:
      throw new Skip('item desconhecido');
  }
}

/**
 * "Aplicar selecionados": every item of `keys` in the order of the review; the others are recorded as unchecked. The
 * proposal ends 'applied' when every item was applied or already existed, 'partial' otherwise.
 */
export const applyProposal = (id: ID, keys: readonly string[]): Promise<ApplyResult> => withLock('proposal', async () => {
  const p = await db.proposals.get(id);
  if (!p || p.deleted || p.status !== 'pending') throw new ProposalError('Esta proposta já foi decidida.');
  const selected = new Set(keys);
  const state = { routineCleared: false, today: await getToday() };
  const outcome: ItemOutcome[] = [];
  for (const item of proposalItems(p.payload)) {
    if (!selected.has(item.key)) { outcome.push({ key: item.key, result: 'unchecked' }); continue; }
    try {
      outcome.push({ key: item.key, result: await applyItem(p, item, state) });
    } catch (err) {
      if (!(err instanceof Skip)) console.error('proposal item failed', item.key, err);
      outcome.push({ key: item.key, result: 'skipped', reason: err instanceof Skip ? err.message : 'não deu para aplicar' });
    }
  }
  const count = (r: ItemResult) => outcome.filter((o) => o.result === r).length;
  const status: ProposalStatus = count('skipped') + count('unchecked') === 0 ? 'applied' : 'partial';
  await mutate<Proposal>('proposals', p.id, () => ({ status, decidedAt: Date.now(), outcome }));
  return { status, applied: count('applied'), existed: count('existed'), skipped: count('skipped'), unchecked: count('unchecked') };
});

/** "Recusar": only the proposal's state changes. */
export const rejectProposal = (id: ID): Promise<void> => withLock('proposal', async () => {
  const p = await db.proposals.get(id);
  if (!p || p.deleted || p.status !== 'pending') throw new ProposalError('Esta proposta já foi decidida.');
  await mutate<Proposal>('proposals', p.id, () => ({ status: 'rejected', decidedAt: Date.now() }));
});

/** "12 itens aplicados, 2 já existiam, 1 pulado." */
export function applyResultText(r: ApplyResult): string {
  const part = (n: number, one: string, many: string) => (n > 0 ? `${n} ${n === 1 ? one : many}` : '');
  const parts = [
    part(r.applied, 'item aplicado', 'itens aplicados'), part(r.existed, 'já existia', 'já existiam'), part(r.skipped, 'pulado', 'pulados'),
  ].filter(Boolean);
  return parts.length > 0 ? `${parts.join(', ')}.` : 'Nada foi aplicado.';
}

// ------------------------------------------------------------------ "Sem conector": copy and paste

export const PASTE_SOURCE = 'Colada de um chat';

/** Only the named tables, straight from Dexie (the same ones the server reads for the same view). */
async function readTables(names: readonly SyncTable[]): Promise<Record<string, unknown[]>> {
  const entries = await Promise.all(names.map(async (t) => [t, await tableOf(t).toArray()] as const));
  return Object.fromEntries(entries);
}

/**
 * The tables an assistant may read for `ler_contexto`. The apostilas come whole although only counted: IndexedDB
 * returns whole records, and `deleted` is not indexed, so a key-only count would include the deleted ones.
 */
const contextTables = async (): Promise<AssistTables> => (await readTables(ASSIST_CONTEXT_TABLES)) as AssistTables;
/** The tables `proposalNamesOf` reads: a pasted proposal is checked against these names only. */
const NAME_TABLES = ['areas', 'journeys', 'goals'] as const;

/**
 * The request text the person pastes into any chat; with `subject`, the study request of that subject's page, which
 * also carries the subject's memory (the same view as `ler_disciplina`, with only the newest
 * `NOTEBOOK_LIMITS.pasteCards` cards: `pasteRequestText` cuts them).
 */
export async function buildPasteRequest(subject?: string): Promise<string> {
  const tables = await contextTables();
  const today = await getToday();
  let memory;
  if (subject) {
    const r = buildSubjectContext((await readTables(SUBJECT_CONTEXT_TABLES)) as SubjectTables, subject, today);
    if (r.ok) memory = r.context;
  }
  return pasteRequestText(buildAssistContext(tables, today), today, subject, memory);
}

export type PasteResult =
  | { id: string }
  | { issues: ProposalIssue[] }
  | { error: 'empty' | 'too-big' | 'not-json' };

/** One issue as the MCP tool shows it to an assistant; the paste sheet shows the same line. */
export const issueText = (i: ProposalIssue): string => `${i.path || '(proposta)'}: ${i.message}`;

/** Validates what a chat answered and stores it as a pending proposal (same checks and limits as the connector). */
export async function addPastedProposal(text: string, today: string): Promise<PasteResult> {
  const parsed = parsePastedProposal(text);
  if (!parsed.ok) return { error: parsed.reason };
  const tables = (await readTables(NAME_TABLES)) as Pick<AssistTables, (typeof NAME_TABLES)[number]>;
  const { payload, issues } = validateProposal(parsed.value, proposalNamesOf(tables), today);
  if (!payload) return { issues };
  return withLock('proposals:paste', async () => {
    const record = newRecord<Proposal>({ source: PASTE_SOURCE, payload, status: 'pending' });
    const pending = (await db.proposals.toArray()).filter((p) => !p.deleted && p.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
    const replaced = pending.slice(0, Math.max(0, pending.length - (ASSIST_LIMITS.pendingMax - 1)));
    await putAll([
      ...replaced.map((p) => ({ table: 'proposals' as const, record: { ...p, status: 'replaced' as const } })),
      { table: 'proposals' as const, record },
    ]);
    return { id: record.id };
  });
}
