import {
  type AiFeature, type AiUsage, type CardsRequest, type CardsResult, type HintRequest, type HintResult,
  type WeekRequest, type WeekSummary,
  cardsPrompt, cleanHint, cleanSuggestions, cleanWeekSummary, hintPrompt, HINT_CODE_OMITTED, weekPrompt,
} from '@life/shared';
import { AiError, toAiError, type AiCall, type AiModel } from './model';
import { AI_CALLS, CARDS_SCHEMA, CARDS_SYSTEM, HINT_SYSTEM, WEEK_SCHEMA, WEEK_SYSTEM } from './prompts';
import type { AiQuota } from './quota';
import { parseCardsRequest, parseHintRequest, parseWeekRequest } from './schemas';

export interface AiServiceDeps {
  model: AiModel;
  quota: AiQuota;
  /** One line per request, never with content (default: console.log). */
  log?: (line: string) => void;
  now?: () => number;
}

/** The three AI aids behind one door: one request at a time, a daily cap, cleaned replies. */
export class AiService {
  private inFlight = false;

  constructor(private readonly deps: AiServiceDeps) {}

  usage(): AiUsage {
    return { used: this.deps.quota.used(), limit: this.deps.quota.limit };
  }

  async hint(req: HintRequest): Promise<HintResult> {
    const { context, ask } = hintPrompt(parseHintRequest(req));
    const text = cleanHint(await this.run('hints', HINT_SYSTEM, [{ text: context, cache: true }, { text: ask }]));
    if (!text || text === HINT_CODE_OMITTED) throw new AiError('bad_output');
    return { text };
  }

  async cards(req: CardsRequest): Promise<CardsResult> {
    const reply = await this.run('cards', CARDS_SYSTEM, [{ text: cardsPrompt(parseCardsRequest(req)) }], CARDS_SCHEMA);
    return { cards: cleanSuggestions(parseJson(reply)) };
  }

  async week(req: WeekRequest): Promise<WeekSummary> {
    const reply = await this.run('weekly', WEEK_SYSTEM, [{ text: weekPrompt(parseWeekRequest(req)) }], WEEK_SCHEMA);
    const summary = cleanWeekSummary(parseJson(reply));
    if (!summary) throw new AiError('bad_output');
    return summary;
  }

  /** Busy check and daily cap run synchronously, before any await; the cap counts even a failed call. */
  private async run(
    feature: AiFeature, system: string, user: AiCall['user'], schema?: Record<string, unknown>,
  ): Promise<string> {
    if (this.inFlight) throw new AiError('busy');
    if (!this.deps.quota.take()) throw new AiError('daily_limit');
    this.inFlight = true;
    const now = this.deps.now ?? Date.now;
    const log = this.deps.log ?? ((line: string) => console.log(line));
    const cfg = AI_CALLS[feature];
    const started = now();
    try {
      const reply = await this.deps.model.complete({
        feature, system, cacheSystem: cfg.cacheSystem, user,
        effort: cfg.effort, maxTokens: cfg.maxTokens, timeoutMs: cfg.timeoutMs,
        ...(schema ? { schema } : {}),
      });
      const u = reply.usage;
      log(`[ai] ${feature} ok ${now() - started}ms in=${u.input} out=${u.output} cacheRead=${u.cacheRead} cacheWrite=${u.cacheWrite}`);
      return reply.text;
    } catch (e) {
      const err = toAiError(e);
      log(`[ai] ${feature} ${err.code} ${now() - started}ms`);
      throw err;
    } finally {
      this.inFlight = false;
    }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('bad_output');
  }
}
