import { z } from 'zod';
import { AI_LIMITS, HINT_STEPS, PRACTICE_LIMITS, type CardsRequest, type HintRequest, type WeekRequest } from '@life/shared';
import { AiError } from './model';

// Request bodies of the AI aids (spec §5.4). Sizes follow the 3d limits, so a valid session always
// fits. Anything over a limit is REJECTED (invalid_body), never truncated: what the "O que é
// enviado" preview shows must be exactly what is sent.

const text = (max: number) => z.string().max(max);
const level = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const item = z.object({ text: text(PRACTICE_LIMITS.item), done: z.boolean() });

export const hintBody = z
  .object({
    step: z.enum(HINT_STEPS),
    level,
    title: text(PRACTICE_LIMITS.title),
    problem: text(PRACTICE_LIMITS.text),
    inputs: text(PRACTICE_LIMITS.text),
    outputs: text(PRACTICE_LIMITS.text),
    basics: z.array(text(PRACTICE_LIMITS.item)).max(PRACTICE_LIMITS.items),
    plan: z.array(item).max(PRACTICE_LIMITS.items),
    alternatives: text(PRACTICE_LIMITS.text),
    decision: text(PRACTICE_LIMITS.text),
    tests: z.array(item).max(PRACTICE_LIMITS.items),
    language: z.enum(['python', 'sql', 'javascript', 'bash', 'text']),
    code: text(PRACTICE_LIMITS.code),
    previous: z.array(z.object({ level, text: text(AI_LIMITS.hintText) })).max(2),
  })
  .refine((b) => b.previous.every((p) => p.level < b.level), { path: ['previous'] });

export const cardsBody = z.object({
  text: z.string().max(AI_LIMITS.cardsSource).refine((t) => t.trim() !== ''),
  deckName: text(AI_LIMITS.deckName),
});

const reading = text(AI_LIMITS.weekReading);

export const weekBody = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  facts: z
    .array(z.object({
      label: z.string().max(AI_LIMITS.weekFactField).refine((t) => t.trim() !== ''),
      value: text(AI_LIMITS.weekFactField),
    }))
    .max(AI_LIMITS.weekFacts),
  reading: z.object({ worked: reading, obstacle: reading, adjustment: reading }).optional(),
});

const invalid = (): never => { throw new AiError('invalid_body'); };

/** Steps in which the student's code is part of what the aid may see. */
const CODE_STEPS: readonly string[] = ['code', 'test', 'rebuild'];

/** Validates a hint request; outside code/test/rebuild the code is dropped, so the model never gets an implementation there. */
export function parseHintRequest(body: unknown): HintRequest {
  const r = hintBody.safeParse(body);
  if (!r.success) return invalid();
  const req = r.data as HintRequest;
  return CODE_STEPS.includes(req.step) ? req : { ...req, code: '' };
}

export function parseCardsRequest(body: unknown): CardsRequest {
  const r = cardsBody.safeParse(body);
  return r.success ? r.data : invalid();
}

export function parseWeekRequest(body: unknown): WeekRequest {
  const r = weekBody.safeParse(body);
  return r.success ? r.data : invalid();
}
