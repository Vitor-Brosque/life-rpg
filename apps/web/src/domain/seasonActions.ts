import type { ID, Season, SeasonAnswers, SeasonDraft } from '@life/shared';
import { SEASON_ISSUE_TEXT, activeSeason, seasonChanges, seasonFields, seasonIssue, seasonReviewOf } from '@life/shared';
import { db } from '../db/db';
import { mutate, newRecord, put } from '../db/repo';
import { getToday, withLock } from './common';

// Temporadas: every write. Nothing here gives XP or notifies. One active season at a time.

const LOCK = 'seasons';
export const SEASON_ACTIVE_TEXT = 'Já há uma temporada em andamento.';

/** A save refused by the rules of the sheet (the message says why). */
export class SeasonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeasonError';
  }
}

async function check(draft: SeasonDraft): Promise<void> {
  const issue = seasonIssue(draft, await getToday());
  if (issue) throw new SeasonError(SEASON_ISSUE_TEXT[issue]);
}

/** "Começar temporada": a new active season, in its stored form (refused while another one is active). */
export const startSeason = (draft: SeasonDraft): Promise<Season> => withLock(LOCK, async () => {
  await check(draft);
  if (activeSeason(await db.seasons.toArray())) throw new SeasonError(SEASON_ACTIVE_TEXT);
  return put('seasons', newRecord<Season>({ ...seasonFields(draft), status: 'ativa' }));
});

/** "Salvar": only what differs from `initial`, on the stored record. False when nothing changed or the season is gone. */
export const updateSeason = (id: ID, initial: SeasonDraft, draft: SeasonDraft): Promise<boolean> => withLock(LOCK, async () => {
  await check(draft);
  const changes = seasonChanges(initial, draft);
  const stored = await db.seasons.get(id);
  if (Object.keys(changes).length === 0 || !stored || stored.deleted) return false;
  await mutate<Season>('seasons', id, (prev) => (prev.deleted ? undefined : changes));
  return true;
});

/**
 * What "Encerrar temporada" came to: `ended` (ended now), `gone` (not there any more), `kept` (it had been ended on another
 * device without a written review: only his review was written), `already` (ended elsewhere, he wrote nothing: nothing
 * written) or `conflict` (ended elsewhere with a written review and he wrote one too: nothing written).
 */
export type SeasonEnd = 'ended' | 'gone' | 'kept' | 'already' | 'conflict';

/** "Encerrar temporada": ended today, with his answers when he wrote some; an already ended season is never ended again. */
export const endSeasonReview = (id: ID, answers: SeasonAnswers): Promise<SeasonEnd> => withLock(LOCK, async () => {
  const s = await db.seasons.get(id);
  if (!s || s.deleted) return 'gone';
  const review = seasonReviewOf(answers, Date.now());
  if (s.status === 'encerrada') {
    if (!review) return 'already';
    if (s.review) return 'conflict';
    await mutate<Season>('seasons', id, (prev) => (prev.deleted || prev.review ? undefined : { review }));
    return 'kept';
  }
  const endedDay = await getToday();
  await mutate<Season>('seasons', id, () => ({ status: 'encerrada', endedDay, ...(review ? { review } : {}) }));
  return 'ended';
});

/** True when the season was ended now (false when it is not active). */
export const endSeason = async (id: ID, answers: SeasonAnswers): Promise<boolean> => {
  const s = await db.seasons.get(id);
  if (!s || s.deleted || s.status !== 'ativa') return false;
  return (await endSeasonReview(id, answers)) === 'ended';
};
