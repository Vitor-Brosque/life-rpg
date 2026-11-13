import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { ServerConfig } from '../src/config';
import { RecordStore } from '../src/store';
import { AiError, type AiModel } from '../src/ai/model';
import { AiQuota, memoryQuotaStore } from '../src/ai/quota';
import { AiService } from '../src/ai/service';

const cfg: ServerConfig = { port: 0, host: '127.0.0.1', dataDir: '.', token: 't', dbPath: ':memory:' };
const auth = { authorization: 'Bearer t' };
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };

function aiWith(complete: AiModel['complete'], limit = 2): AiService {
  return new AiService({ model: { complete }, quota: new AiQuota(limit, memoryQuotaStore()), log: () => {} });
}
const replying = (text: string) => aiWith(async () => ({ text, usage }));
const make = (ai?: AiService, cfgAi?: ServerConfig['ai']) =>
  buildApp({ ...cfg, ai: cfgAi }, { store: new RecordStore(':memory:'), ai });

const hint = {
  step: 'plan', level: 1, title: 'T', problem: 'P', inputs: '', outputs: '', basics: [], plan: [],
  alternatives: '', decision: '', tests: [], language: 'python', code: '', previous: [],
};
const post = (app: Awaited<ReturnType<typeof make>>, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: auth, payload: payload as object });

describe('AI routes', () => {
  it('require the access token', async () => {
    const app = await make(replying('x'));
    expect((await app.inject({ url: '/api/ai/status' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/ai/hint', payload: hint })).statusCode).toBe(401);
  });

  it('without a key: status says unavailable and every aid is ai_disabled', async () => {
    const app = await make();
    const status = await app.inject({ url: '/api/ai/status', headers: auth });
    expect(status.json()).toEqual({ available: false });
    for (const url of ['/api/ai/hint', '/api/ai/cards', '/api/ai/week']) {
      const res = await post(app, url, {});
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'ai_disabled' });
    }
  });

  it('with cfg.ai the real service is wired (status only, no model call)', async () => {
    const app = await make(undefined, { apiKey: 'sk-test-wiring', dailyLimit: 7 });
    const res = await app.inject({ url: '/api/ai/status', headers: auth });
    expect(res.json()).toEqual({ available: true, used: 0, limit: 7 });
    expect(res.body).not.toContain('sk-test');
  });

  it('hint: result and usage', async () => {
    const app = await make(replying('  Pense no que entra.  '));
    const res = await post(app, '/api/ai/hint', hint);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: { text: 'Pense no que entra.' }, usage: { used: 1, limit: 2 } });
    expect((await app.inject({ url: '/api/ai/status', headers: auth })).json()).toEqual({ available: true, used: 1, limit: 2 });
  });

  it('invalid bodies are 400 and not counted', async () => {
    const app = await make(replying('x'));
    const bad = [
      { ...hint, level: 4 },
      { ...hint, step: 'feedback' },
      { ...hint, level: 2, previous: [{ level: 2, text: 'a' }] },
      { ...hint, code: 'x'.repeat(20_001) },
      { ...hint, language: 'cobol' },
      { step: 'plan', level: 1 },
    ];
    for (const body of bad) {
      const res = await post(app, '/api/ai/hint', body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_body' });
    }
    expect((await post(app, '/api/ai/cards', { text: '   ', deckName: '' })).statusCode).toBe(400);
    expect((await post(app, '/api/ai/cards', { text: 'x'.repeat(8001), deckName: '' })).statusCode).toBe(400);
    expect((await post(app, '/api/ai/week', { weekStart: '13/11/2026', facts: [] })).statusCode).toBe(400);
    expect((await post(app, '/api/ai/week', { weekStart: '2026-11-09', facts: [{ label: ' ', value: '1' }] })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/ai/status', headers: auth })).json()).toMatchObject({ used: 0 });
  });

  it('cards and week', async () => {
    const cards = await make(replying('{"cards":[{"type":"cloze","front":"PK sem {{nulos}}","back":"","extra":""}]}'));
    const c = await post(cards, '/api/ai/cards', { text: 'Uma PK não aceita nulos.', deckName: 'BD' });
    expect(c.json()).toEqual({
      result: { cards: [{ type: 'cloze', front: 'PK sem {{1::nulos}}', back: '', extra: '' }] },
      usage: { used: 1, limit: 2 },
    });
    const week = await make(replying('{"observed":"Duas retomadas.","hypothesis":"","suggestion":""}'));
    const w = await post(week, '/api/ai/week', {
      weekStart: '2026-11-09', facts: [{ label: 'Retomadas', value: '2' }],
      reading: { worked: 'manhãs', obstacle: '', adjustment: '' },
    });
    expect(w.statusCode).toBe(200);
    expect(w.json().result).toEqual({ observed: 'Duas retomadas.', hypothesis: '', suggestion: '' });
  });

  it.each([
    ['timeout', 504], ['rate_limited', 503], ['refused', 422], ['incomplete', 502],
    ['auth', 502], ['billing', 502], ['upstream', 502], ['bad_output', 502],
  ] as const)('model error %s → HTTP %i', async (code, status) => {
    const app = await make(aiWith(async () => { throw new AiError(code); }));
    const res = await post(app, '/api/ai/hint', hint);
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error: code });
  });

  it('an unknown error is upstream (502) and its message never reaches the response', async () => {
    const app = await make(aiWith(async () => { throw new Error('secret upstream text'); }));
    const res = await post(app, '/api/ai/hint', hint);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'upstream' });
    expect(res.body).not.toContain('secret upstream text');
  });

  it('a second request while one is running → 429 busy', async () => {
    let release!: () => void;
    const app = await make(aiWith(() => new Promise((resolve) => { release = () => resolve({ text: 'ok', usage }); }), 5));
    const first = post(app, '/api/ai/hint', hint);
    await new Promise((r) => setTimeout(r, 20));
    const second = await post(app, '/api/ai/hint', hint);
    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({ error: 'busy' });
    release();
    expect((await first).statusCode).toBe(200);
  });

  it('daily limit → 429', async () => {
    const app = await make(aiWith(async () => ({ text: 'ok', usage }), 1));
    expect((await post(app, '/api/ai/hint', hint)).statusCode).toBe(200);
    const res = await post(app, '/api/ai/hint', hint);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'daily_limit' });
  });

  it('never echoes the key', async () => {
    const app = await make(replying('ok'), { apiKey: 'sk-secret-123', dailyLimit: 2 });
    for (const res of [
      await app.inject({ url: '/api/ai/status', headers: auth }),
      await post(app, '/api/ai/hint', hint),
      await post(app, '/api/ai/hint', { bad: true }),
    ]) expect(res.body).not.toContain('sk-secret');
  });
});
