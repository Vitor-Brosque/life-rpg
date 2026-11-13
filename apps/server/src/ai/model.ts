import Anthropic, {
  APIConnectionTimeoutError, APIError, AuthenticationError, PermissionDeniedError, RateLimitError,
} from '@anthropic-ai/sdk';
import type { AiFeature, AiServerError } from '@life/shared';

// The only file that imports the Anthropic SDK (spec §5.2). The rest of the server talks to
// AiModel, which tests replace with a fake: no test ever reaches the real API.

/** The model every AI aid uses (claude-api skill default; cost is bounded by the daily cap). */
export const AI_MODEL = 'claude-opus-5-5';
/** Server-side retry on another model after a policy refusal, chosen by the API ("default"). */
export const AI_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** One retry of 408/409/429/5xx and connection errors (the SDK default is 2). */
export const AI_MAX_RETRIES = 1;

export type AiEffort = 'low' | 'medium';

export interface AiCall {
  feature: AiFeature;
  system: string;
  /** Cache breakpoint after the system prompt. */
  cacheSystem: boolean;
  /** Text blocks of the single user message; `cache` puts a breakpoint after that block. */
  user: Array<{ text: string; cache?: boolean }>;
  effort: AiEffort;
  maxTokens: number;
  timeoutMs: number;
  /** JSON schema for structured output: the reply text is then JSON. */
  schema?: Record<string, unknown>;
}

export interface AiReply {
  text: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export class AiError extends Error {
  constructor(readonly code: AiServerError) {
    super(code);
    this.name = 'AiError';
  }
}

export interface AiModel {
  complete(call: AiCall): Promise<AiReply>;
}

const EPHEMERAL = { type: 'ephemeral' } as const;

/** SDK client with the key from the server config; no other credential source (nor ANTHROPIC_BASE_URL) is consulted. */
export function createAnthropic(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, baseURL: 'https://api.anthropic.com', logLevel: 'warn', maxRetries: AI_MAX_RETRIES });
}

export function anthropicModel(client: Anthropic): AiModel {
  return {
    async complete(call) {
      const res = await client.beta.messages
        .create(
          {
            model: AI_MODEL,
            max_tokens: call.maxTokens,
            betas: [AI_FALLBACK_BETA],
            fallbacks: 'default',
            system: [{ type: 'text', text: call.system, ...(call.cacheSystem ? { cache_control: EPHEMERAL } : {}) }],
            messages: [{
              role: 'user',
              content: call.user.map((b) => ({
                type: 'text' as const,
                text: b.text,
                ...(b.cache ? { cache_control: EPHEMERAL } : {}),
              })),
            }],
            output_config: {
              effort: call.effort,
              ...(call.schema ? { format: { type: 'json_schema' as const, schema: call.schema } } : {}),
            },
          },
          { timeout: call.timeoutMs },
        )
        .catch((e: unknown): never => { throw toAiError(e); });
      if (res.stop_reason === 'refusal') throw new AiError('refused');
      if (res.stop_reason === 'max_tokens') throw new AiError('incomplete');
      // Thinking and fallback blocks carry no answer text.
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return {
        text,
        usage: {
          input: res.usage.input_tokens,
          output: res.usage.output_tokens,
          cacheRead: res.usage.cache_read_input_tokens ?? 0,
          cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
        },
      };
    },
  };
}

/** SDK errors → app codes, most specific first (APIConnectionTimeoutError is an APIConnectionError, an APIError). */
export function toAiError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof APIConnectionTimeoutError) return new AiError('timeout');
  if (e instanceof RateLimitError) return new AiError('rate_limited');
  if (e instanceof AuthenticationError || e instanceof PermissionDeniedError) return new AiError('auth');
  if (e instanceof APIError && e.status === 402) return new AiError('billing');
  return new AiError('upstream');
}
