import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HintRequest } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { AI_ERROR_COPY, askCards, askHint, refreshAiStatus } from '../src/ai/aiClient';
import { useAiStatus } from '../src/ai/aiStatus';
import { connectServer, fail, mockFetch, ok, resetAi } from './aiFixture';

const req: HintRequest = {
  step: 'plan', level: 1, title: 'T', problem: 'P', inputs: '', outputs: '', basics: [], plan: [],
  alternatives: '', decision: '', tests: [], language: 'python', code: '', previous: [],
};

beforeEach(async () => {
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  resetAi();
});
afterEach(() => { resetAi(); });

describe('askHint / askCards', () => {
  it('without a sync token nothing is sent', async () => {
    const { fn } = mockFetch(() => ok({ text: 'x' }));
    expect(await askHint(req)).toEqual({ ok: false, error: 'no_token' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('posts JSON with the token and keeps the usage', async () => {
    await connectServer('abc');
    const { requests } = mockFetch(() => ok({ text: 'Pista' }, { used: 3, limit: 30 }));
    expect(await askHint(req)).toEqual({ ok: true, data: { text: 'Pista' }, usage: { used: 3, limit: 30 } });
    expect(requests[0]).toMatchObject({
      url: '/api/ai/hint', method: 'POST', body: req,
      headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' },
    });
    expect(useAiStatus.getState().usage).toEqual({ used: 3, limit: 30 });
  });

  it('maps failures to codes', async () => {
    await connectServer();
    const cases: Array<[() => void, string]> = [
      [() => mockFetch(() => { throw new TypeError('Failed to fetch'); }), 'offline'],
      [() => mockFetch(() => { throw Object.assign(new Error('slow'), { name: 'TimeoutError' }); }), 'timeout'],
      [() => mockFetch(() => fail(401, 'unauthorized')), 'unauthorized'],
      [() => mockFetch(() => fail(429, 'daily_limit')), 'daily_limit'],
      [() => mockFetch(() => fail(429, 'busy')), 'busy'],
      [() => mockFetch(() => fail(502)), 'upstream'],
      [() => mockFetch(() => fail(500, 'weird_code')), 'upstream'],
      [() => mockFetch(() => ({ status: 200, json: { nope: 1 } })), 'upstream'],
    ];
    for (const [setup, code] of cases) {
      setup();
      expect(await askCards({ text: 'x', deckName: '' })).toEqual({ ok: false, error: code });
    }
  });

  it('ai_disabled marks the AI unavailable', async () => {
    await connectServer();
    useAiStatus.setState({ available: true, checked: true });
    mockFetch(() => fail(404, 'ai_disabled'));
    expect(await askHint(req)).toEqual({ ok: false, error: 'ai_disabled' });
    expect(useAiStatus.getState().available).toBe(false);
  });
});

describe('refreshAiStatus', () => {
  it('no token: unavailable, no request', async () => {
    useAiStatus.setState({ available: true });
    const { fn } = mockFetch(() => ok({}));
    await refreshAiStatus();
    expect(useAiStatus.getState().available).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('follows the server and remembers it on this device', async () => {
    await connectServer();
    mockFetch(() => ({ status: 200, json: { available: true, used: 2, limit: 30 } }));
    await refreshAiStatus();
    expect(useAiStatus.getState()).toMatchObject({ available: true, usage: { used: 2, limit: 30 }, checked: true });
    expect(localStorage.getItem('life-rpg-ai-available')).toBe('1');

    mockFetch(() => { throw new TypeError('offline'); });
    await refreshAiStatus();
    expect(useAiStatus.getState().available).toBe(true);

    mockFetch(() => fail(503));
    await refreshAiStatus();
    expect(useAiStatus.getState().available).toBe(true);

    mockFetch(() => fail(404));
    await refreshAiStatus();
    expect(useAiStatus.getState().available).toBe(false);
    expect(localStorage.getItem('life-rpg-ai-available')).toBe('0');
  });
});

describe('AI_ERROR_COPY', () => {
  it('a kind sentence for every code', () => {
    for (const text of Object.values(AI_ERROR_COPY)) {
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/falh|atrasad|deveria/i);
    }
    expect(AI_ERROR_COPY.daily_limit).toBe('Os pedidos de hoje acabaram. Amanhã tem mais, e o app segue funcionando sem a IA.');
  });
});
