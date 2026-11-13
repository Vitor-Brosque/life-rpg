import { vi } from 'vitest';
import type { AiSettings, AiUsage, Settings } from '@life/shared';
import { DEFAULT_AI } from '@life/shared';
import { patch, setMeta } from '../src/db/repo';
import { useAiStatus } from '../src/ai/aiStatus';

export async function connectServer(token = 't'): Promise<void> {
  await setMeta('syncToken', token);
}

/** The server has AI and these aids are on. Call after ensureSeed (settings must exist). */
export async function enableAi(features: Partial<AiSettings>, usage: AiUsage = { used: 0, limit: 30 }): Promise<void> {
  await connectServer();
  await patch<Settings>('settings', 'settings', { ai: { ...DEFAULT_AI, ...features } });
  useAiStatus.setState({ available: true, usage, checked: true });
}

export function resetAi(): void {
  useAiStatus.setState({ available: false, usage: undefined, checked: false });
  vi.unstubAllGlobals();
}

export interface FakeReply { status: number; json?: unknown }
export interface AiRequest { url: string; method: string; body: unknown; headers: Record<string, string> }

/** Replaces the global fetch; every call is recorded. A handler that throws simulates a network error. */
export function mockFetch(handler: (req: AiRequest) => FakeReply | Promise<FakeReply>) {
  const requests: AiRequest[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req: AiRequest = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    requests.push(req);
    const r = await handler(req);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => {
        if (r.json === undefined) throw new SyntaxError('Unexpected end of JSON input');
        return r.json;
      },
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { fn, requests };
}

export const ok = (result: unknown, usage: AiUsage = { used: 1, limit: 30 }): FakeReply =>
  ({ status: 200, json: { result, usage } });
export const fail = (status: number, error?: string): FakeReply =>
  ({ status, json: error ? { error } : undefined });
