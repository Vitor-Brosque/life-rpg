import type { HintLevel, HintStep, ID, PracticeFeedback, PracticeSession } from '@life/shared';
import { PRACTICE_LIMITS, normalizePractice, ulid } from '@life/shared';
import { db } from '../db/db';
import { mutate } from '../db/repo';

export type HintSave = 'saved' | 'full' | 'missing';

/**
 * Appends an AI hint to the session's Feedback (3d extension point), over the stored copy so other
 * edits are never overwritten. The cap of 20 entries holds: a full list stores nothing.
 */
export async function addAiHint(sessionId: ID, h: { step: HintStep; level: HintLevel; text: string }): Promise<HintSave> {
  const current = await db.practiceSessions.get(sessionId);
  if (!current || current.deleted) return 'missing';
  const entry: PracticeFeedback = {
    id: ulid(), at: Date.now(), source: 'ai',
    text: h.text.trim().slice(0, PRACTICE_LIMITS.feedbackText),
    hint: { step: h.step, level: h.level },
  };
  let result: HintSave = 'missing';
  try {
    await mutate<PracticeSession>('practiceSessions', sessionId, (s) => {
      if (s.deleted) return undefined;
      const feedback = normalizePractice(s).feedback;
      if (feedback.length >= PRACTICE_LIMITS.feedback) { result = 'full'; return undefined; }
      result = 'saved';
      return { feedback: [...feedback, entry] };
    });
  } catch (e) {
    // The session was removed for good between the read and the write.
    if (!(await db.practiceSessions.get(sessionId))) return 'missing';
    throw e;
  }
  return result;
}
