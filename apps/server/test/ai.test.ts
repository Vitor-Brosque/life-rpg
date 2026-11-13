import { describe, expect, it, vi } from 'vitest';
import Anthropic, {
  APIConnectionError, APIConnectionTimeoutError, APIError, AuthenticationError, InternalServerError,
  PermissionDeniedError, RateLimitError,
} from '@anthropic-ai/sdk';
import { AI_LIMITS, HINT_CODE_OMITTED, PRACTICE_LIMITS, cardsPrompt, hintPrompt, weekPrompt, type HintRequest } from '@life/shared';
import { AiError, anthropicModel, toAiError, type AiCall, type AiModel, type AiReply } from '../src/ai/model';
import { AI_CALLS, CARDS_SCHEMA, CARDS_SYSTEM, HINT_SYSTEM, WEEK_SCHEMA, WEEK_SYSTEM } from '../src/ai/prompts';
import { AiQuota, memoryQuotaStore, storeQuota } from '../src/ai/quota';
import { AiService } from '../src/ai/service';
import { RecordStore } from '../src/store';

const sdkError = (cls: { prototype: object }, status?: number): unknown =>
  Object.assign(Object.create(cls.prototype) as object, { status });

const message = (over: Record<string, unknown> = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
  content: [
    { type: 'thinking', thinking: '', signature: 'sig' },
    { type: 'text', text: 'Olá, ' },
    { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
    { type: 'text', text: 'mundo' },
  ],
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null, cache_creation_input_tokens: 7 },
  ...over,
});

function fakeClient(impl: () => Promise<unknown>) {
  const create = vi.fn((_params: unknown, _opts: unknown) => impl());
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

const call: AiCall = {
  feature: 'hints', system: 'SYS', cacheSystem: true,
  user: [{ text: 'ctx', cache: true }, { text: 'ask' }],
  effort: 'low', maxTokens: 8000, timeoutMs: 40_000,
};

describe('anthropicModel (fake client)', () => {
  it('sends exactly the documented parameters', async () => {
    const { client, create } = fakeClient(async () => message());
    const reply = await anthropicModel(client).complete(call);
    expect(reply).toEqual({ text: 'Olá, mundo', usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 7 } });
    const [params, opts] = create.mock.calls[0]!;
    expect(params).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'ctx', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'ask' },
      ] }],
      output_config: { effort: 'low' },
    });
    expect(opts).toEqual({ timeout: 40_000 });
    expect(Object.keys(params as object)).not.toContain('thinking');
    expect(Object.keys(params as object)).not.toContain('temperature');
  });

  it('structured output and no system cache', async () => {
    const { client, create } = fakeClient(async () => message());
    await anthropicModel(client).complete({ ...call, cacheSystem: false, effort: 'medium', schema: { type: 'object' } });
    const params = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(params.system).toEqual([{ type: 'text', text: 'SYS' }]);
    expect(params.output_config).toEqual({ effort: 'medium', format: { type: 'json_schema', schema: { type: 'object' } } });
  });

  it('refusal and max_tokens become app errors', async () => {
    const refused = fakeClient(async () => message({ stop_reason: 'refusal', content: [] }));
    await expect(anthropicModel(refused.client).complete(call)).rejects.toMatchObject({ code: 'refused' });
    const cut = fakeClient(async () => message({ stop_reason: 'max_tokens' }));
    await expect(anthropicModel(cut.client).complete(call)).rejects.toMatchObject({ code: 'incomplete' });
  });

  it('maps SDK errors', async () => {
    const limited = fakeClient(async () => { throw sdkError(RateLimitError, 429); });
    await expect(anthropicModel(limited.client).complete(call)).rejects.toMatchObject({ code: 'rate_limited' });
    expect(toAiError(sdkError(APIConnectionTimeoutError)).code).toBe('timeout');
    expect(toAiError(sdkError(AuthenticationError, 401)).code).toBe('auth');
    expect(toAiError(sdkError(PermissionDeniedError, 403)).code).toBe('auth');
    expect(toAiError(sdkError(APIError, 402)).code).toBe('billing');
    expect(toAiError(sdkError(InternalServerError, 529)).code).toBe('upstream');
    expect(toAiError(sdkError(APIConnectionError)).code).toBe('upstream');
    expect(toAiError(new Error('boom')).code).toBe('upstream');
    const own = new AiError('busy');
    expect(toAiError(own)).toBe(own);
  });
});

describe('AiQuota', () => {
  const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime();

  it('counts up to the limit and starts over the next day', () => {
    let now = at(13, 10);
    const q = new AiQuota(2, memoryQuotaStore(), () => now);
    expect(q.used()).toBe(0);
    expect(q.take()).toBe(true);
    expect(q.take()).toBe(true);
    expect(q.take()).toBe(false);
    expect(q.used()).toBe(2);
    now = at(14, 0);
    expect(q.used()).toBe(0);
    expect(q.take()).toBe(true);
  });

  it('a broken stored value counts as zero', () => {
    for (const v of ['x', '{"day":"2026-11-13","count":-1}', '{"count":3}']) {
      const q = new AiQuota(5, { read: () => v, write: () => {} }, () => at(13, 10));
      expect(q.used()).toBe(0);
    }
  });

  it('persists in the SQLite meta table', () => {
    const store = new RecordStore(':memory:');
    new AiQuota(5, storeQuota(store), () => at(13, 10)).take();
    expect(new AiQuota(5, storeQuota(store), () => at(13, 10)).used()).toBe(1);
    expect(store.currentRev()).toBe(0);
    store.close();
  });
});

const usage = { input: 100, output: 20, cacheRead: 80, cacheWrite: 0 };
function fakeModel(reply: string | (() => Promise<AiReply>)) {
  const complete = vi.fn(typeof reply === 'string' ? async () => ({ text: reply, usage }) : reply);
  return { model: { complete } as AiModel, complete };
}
function service(model: AiModel, limit = 5) {
  const log = vi.fn();
  return { svc: new AiService({ model, quota: new AiQuota(limit, memoryQuotaStore()), log, now: () => 1000 }), log };
}
const hintReq: HintRequest = {
  step: 'plan', level: 1, title: 'T', problem: 'Problema secreto', inputs: '', outputs: '', basics: [], plan: [],
  alternatives: '', decision: '', tests: [], language: 'python', code: '', previous: [],
};

describe('AiService', () => {
  it('hint: cached context, cleaned text, a content-free log line', async () => {
    const { model, complete } = fakeModel('  Pense no que entra.  ');
    const { svc, log } = service(model);
    expect(await svc.hint(hintReq)).toEqual({ text: 'Pense no que entra.' });
    const p = hintPrompt(hintReq);
    expect(complete).toHaveBeenCalledWith({
      feature: 'hints', system: HINT_SYSTEM, cacheSystem: true,
      user: [{ text: p.context, cache: true }, { text: p.ask }],
      effort: 'low', maxTokens: 8000, timeoutMs: 40_000,
    });
    expect(log).toHaveBeenCalledWith('[ai] hints ok 0ms in=100 out=20 cacheRead=80 cacheWrite=0');
    expect(log.mock.calls.flat().join('\n')).not.toContain('Problema secreto');
    expect(svc.usage()).toEqual({ used: 1, limit: 5 });
  });

  it('hint: a long code block is omitted; an empty reply is bad_output', async () => {
    const code = fakeModel('Assim:\n```python\na = 1\nb = 2\nc = 3\n```');
    expect((await service(code.model).svc.hint(hintReq)).text).toBe(`Assim:\n${HINT_CODE_OMITTED}`);
    await expect(service(fakeModel('   ').model).svc.hint(hintReq)).rejects.toMatchObject({ code: 'bad_output' });
  });

  it('cards: schema, medium effort, cleaned list', async () => {
    const req = { text: 'HAVING filtra grupos.', deckName: 'SQL' };
    const { model, complete } = fakeModel('{"cards":[{"type":"basic","front":" Q ","back":"A","extra":""}]}');
    expect(await service(model).svc.cards(req)).toEqual({ cards: [{ type: 'basic', front: 'Q', back: 'A', extra: '' }] });
    expect(complete).toHaveBeenCalledWith({
      feature: 'cards', system: CARDS_SYSTEM, cacheSystem: true, user: [{ text: cardsPrompt(req) }],
      effort: 'medium', maxTokens: 16_000, timeoutMs: 80_000, schema: CARDS_SCHEMA,
    });
    expect(await service(fakeModel('{"cards":[]}').model).svc.cards(req)).toEqual({ cards: [] });
    await expect(service(fakeModel('nope').model).svc.cards(req)).rejects.toMatchObject({ code: 'bad_output' });
  });

  it('week: schema without cache; no observed is bad_output', async () => {
    const req = { weekStart: '2026-11-09', facts: [{ label: 'Retomadas', value: '2' }] };
    const { model, complete } = fakeModel('{"observed":"Duas retomadas.","hypothesis":"","suggestion":"Teste X."}');
    expect(await service(model).svc.week(req)).toEqual({ observed: 'Duas retomadas.', hypothesis: '', suggestion: 'Teste X.' });
    expect(complete).toHaveBeenCalledWith({
      feature: 'weekly', system: WEEK_SYSTEM, cacheSystem: false, user: [{ text: weekPrompt(req) }],
      effort: 'low', maxTokens: 8000, timeoutMs: 40_000, schema: WEEK_SCHEMA,
    });
    await expect(service(fakeModel('{"observed":"","hypothesis":"","suggestion":""}').model).svc.week(req))
      .rejects.toMatchObject({ code: 'bad_output' });
  });

  it('daily limit: the second request is refused before reaching the model', async () => {
    const { model, complete } = fakeModel('ok');
    const { svc } = service(model, 1);
    await svc.hint(hintReq);
    await expect(svc.hint(hintReq)).rejects.toMatchObject({ code: 'daily_limit' });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(svc.usage()).toEqual({ used: 1, limit: 1 });
  });

  it('busy: a second request while one runs is refused and not counted', async () => {
    let release!: () => void;
    const { model } = fakeModel(() => new Promise<AiReply>((resolve) => { release = () => resolve({ text: 'ok', usage }); }));
    const { svc } = service(model);
    const first = svc.hint(hintReq);
    await expect(svc.hint(hintReq)).rejects.toMatchObject({ code: 'busy' });
    release();
    await first;
    expect(svc.usage().used).toBe(1);
    const third = svc.hint(hintReq);
    release();
    await expect(third).resolves.toEqual({ text: 'ok' });
  });

  it('a model error passes through, counted and logged', async () => {
    const { model } = fakeModel(async () => { throw new AiError('timeout'); });
    const { svc, log } = service(model);
    await expect(svc.hint(hintReq)).rejects.toMatchObject({ code: 'timeout' });
    expect(svc.usage().used).toBe(1);
    expect(log).toHaveBeenCalledWith('[ai] hints timeout 0ms');
    const odd = fakeModel(async () => { throw new Error('boom'); });
    await expect(service(odd.model).svc.hint(hintReq)).rejects.toMatchObject({ code: 'upstream' });
  });
});

describe('AiService validation', () => {
  const over = (n: number) => 'x'.repeat(n + 1);
  const rejected = async (run: (svc: AiService) => Promise<unknown>) => {
    const { model, complete } = fakeModel('{"cards":[]}');
    const { svc } = service(model);
    await expect(run(svc)).rejects.toMatchObject({ code: 'invalid_body' });
    expect(complete).not.toHaveBeenCalled();
    expect(svc.usage().used).toBe(0);
  };

  it('hint: any field over its limit is rejected, never truncated', async () => {
    const bad: Array<Partial<HintRequest>> = [
      { title: over(PRACTICE_LIMITS.title) },
      { problem: over(PRACTICE_LIMITS.text) },
      { inputs: over(PRACTICE_LIMITS.text) },
      { outputs: over(PRACTICE_LIMITS.text) },
      { alternatives: over(PRACTICE_LIMITS.text) },
      { decision: over(PRACTICE_LIMITS.text) },
      { step: 'code', code: over(PRACTICE_LIMITS.code) },
      { basics: ['x'.repeat(PRACTICE_LIMITS.item + 1)] },
      { basics: Array(PRACTICE_LIMITS.items + 1).fill('a') },
      { plan: [{ text: over(PRACTICE_LIMITS.item), done: false }] },
      { tests: Array(PRACTICE_LIMITS.items + 1).fill({ text: 'a', done: false }) },
      { level: 2, previous: [{ level: 1, text: over(AI_LIMITS.hintText) }] },
      { level: 1, previous: [{ level: 1, text: 'a' }] },
    ];
    for (const b of bad) await rejected((svc) => svc.hint({ ...hintReq, ...b }));
  });

  it('hint: the code is dropped outside code, test and rebuild', async () => {
    const withCode = { ...hintReq, code: 'def solucao(): return 42' };
    for (const step of ['problem', 'basics', 'plan', 'design'] as const) {
      const { model, complete } = fakeModel('ok');
      await service(model).svc.hint({ ...withCode, step });
      const sent = JSON.stringify(complete.mock.calls[0]);
      expect(sent).not.toContain('solucao');
    }
    for (const step of ['code', 'test', 'rebuild'] as const) {
      const { model, complete } = fakeModel('ok');
      await service(model).svc.hint({ ...withCode, step });
      expect(JSON.stringify(complete.mock.calls[0])).toContain('solucao');
    }
  });

  it('cards: text and deck name over the limit, or blank text, are rejected', async () => {
    await rejected((svc) => svc.cards({ text: over(AI_LIMITS.cardsSource), deckName: 'SQL' }));
    await rejected((svc) => svc.cards({ text: 'ok', deckName: over(AI_LIMITS.deckName) }));
    await rejected((svc) => svc.cards({ text: '   ', deckName: 'SQL' }));
    const { model, complete } = fakeModel('{"cards":[]}');
    await service(model).svc.cards({ text: 'x'.repeat(AI_LIMITS.cardsSource), deckName: 'x'.repeat(AI_LIMITS.deckName) });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('week: facts, fact fields and reading over the limit are rejected', async () => {
    const week = { weekStart: '2026-11-09', facts: [{ label: 'A', value: '1' }] };
    await rejected((svc) => svc.week({ ...week, facts: Array(AI_LIMITS.weekFacts + 1).fill({ label: 'A', value: '1' }) }));
    await rejected((svc) => svc.week({ ...week, facts: [{ label: over(AI_LIMITS.weekFactField), value: '1' }] }));
    await rejected((svc) => svc.week({ ...week, facts: [{ label: 'A', value: over(AI_LIMITS.weekFactField) }] }));
    await rejected((svc) => svc.week({ ...week, reading: { worked: over(AI_LIMITS.weekReading), obstacle: '', adjustment: '' } }));
    await rejected((svc) => svc.week({ ...week, reading: { worked: '', obstacle: over(AI_LIMITS.weekReading), adjustment: '' } }));
    await rejected((svc) => svc.week({ ...week, reading: { worked: '', obstacle: '', adjustment: over(AI_LIMITS.weekReading) } }));
  });
});

describe('prompts', () => {
  it('schemas are closed and have no size constraints', () => {
    expect(CARDS_SCHEMA).toMatchObject({ required: ['cards'], additionalProperties: false });
    const items = (CARDS_SCHEMA.properties as { cards: { items: Record<string, unknown> } }).cards.items;
    expect(items).toMatchObject({ required: ['type', 'front', 'back', 'extra'], additionalProperties: false });
    expect(WEEK_SCHEMA).toMatchObject({ required: ['observed', 'hypothesis', 'suggestion'], additionalProperties: false });
    expect(JSON.stringify([CARDS_SCHEMA, WEEK_SCHEMA])).not.toMatch(/min|max/i);
  });

  it('cached system prompts are long enough to be cached (heuristic for ≥ 512 tokens)', () => {
    expect(HINT_SYSTEM.length).toBeGreaterThan(2200);
    expect(CARDS_SYSTEM.length).toBeGreaterThan(2200);
    expect(HINT_SYSTEM).toContain('Nunca entregue a solução');
    expect(AI_CALLS.weekly.cacheSystem).toBe(false);
  });
});
