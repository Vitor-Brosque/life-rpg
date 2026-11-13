import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { AiOk, AiServerError, AiStatusResponse } from '@life/shared';
import { toAiError } from './model';
import { cardsBody, hintBody, weekBody } from './schemas';
import type { AiService } from './service';

export const AI_ERROR_STATUS: Record<AiServerError, number> = {
  ai_disabled: 404,
  invalid_body: 400,
  daily_limit: 429,
  busy: 429,
  timeout: 504,
  rate_limited: 503,
  refused: 422,
  incomplete: 502,
  auth: 502,
  billing: 502,
  upstream: 502,
  bad_output: 502,
};

/** The /ai/* routes; registered inside the authenticated '/api' plugin (spec §5.4). Never logs or returns content or the key. */
export function registerAiRoutes(app: FastifyInstance, ai: AiService | undefined): void {
  app.get('/ai/status', async (_request, reply) => {
    if (!ai) return { available: false } satisfies AiStatusResponse;
    try {
      return { available: true, ...ai.usage() } satisfies AiStatusResponse;
    } catch {
      return reply.code(AI_ERROR_STATUS.upstream).send({ error: 'upstream' }); // stable code only, never the message
    }
  });

  /** The usage line after a call that already happened (and was billed): never turn it into an error. */
  const usageOrNull = (svc: AiService): ReturnType<AiService['usage']> | null => {
    try { return svc.usage(); } catch { return null; }
  };

  function aid<S extends z.ZodType, R>(
    path: string, schema: S, run: (svc: AiService, body: z.infer<S>) => Promise<R>,
  ): void {
    app.post(path, async (request, reply) => {
      if (!ai) return reply.code(404).send({ error: 'ai_disabled' });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      try {
        const before = usageOrNull(ai);
        const result = await run(ai, parsed.data);
        const usage = usageOrNull(ai) ?? (before ? { used: before.used + 1, limit: before.limit } : { used: 0, limit: 0 });
        return { result, usage } satisfies AiOk<R>;
      } catch (e) {
        const err = toAiError(e);
        return reply.code(AI_ERROR_STATUS[err.code]).send({ error: err.code });
      }
    });
  }

  aid('/ai/hint', hintBody, (svc, body) => svc.hint(body));
  aid('/ai/cards', cardsBody, (svc, body) => svc.cards(body));
  aid('/ai/week', weekBody, (svc, body) => svc.week(body));
}
