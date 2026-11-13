import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'life-cfg-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('loadConfig host', () => {
  it('listens on every interface by default (Docker)', () => {
    expect(loadConfig({ LIFE_RPG_DATA_DIR: tempDir(), LIFE_RPG_TOKEN: 't' }).host).toBe('0.0.0.0');
  });

  it('honours LIFE_RPG_HOST (local-only use on the notebook)', () => {
    const cfg = loadConfig({ LIFE_RPG_DATA_DIR: tempDir(), LIFE_RPG_TOKEN: 't', LIFE_RPG_HOST: '127.0.0.1' });
    expect(cfg.host).toBe('127.0.0.1');
  });
});

describe('loadConfig ai', () => {
  const base = () => ({ LIFE_RPG_DATA_DIR: tempDir(), LIFE_RPG_TOKEN: 't' });

  it('is off without a key, or with a blank one', () => {
    expect(loadConfig(base()).ai).toBeUndefined();
    expect(loadConfig({ ...base(), ANTHROPIC_API_KEY: '   ' }).ai).toBeUndefined();
  });

  it('is on with a key, 30 requests a day by default', () => {
    expect(loadConfig({ ...base(), ANTHROPIC_API_KEY: ' sk-test ' }).ai).toEqual({ apiKey: 'sk-test', dailyLimit: 30 });
  });

  it('honours LIFE_RPG_AI_DAILY_LIMIT from 1 to 1000', () => {
    const limit = (v: string) => loadConfig({ ...base(), ANTHROPIC_API_KEY: 'k', LIFE_RPG_AI_DAILY_LIMIT: v }).ai?.dailyLimit;
    expect(limit('50')).toBe(50);
    expect(limit('1')).toBe(1);
    expect(limit('1000')).toBe(1000);
    for (const bad of ['0', '1.5', 'abc', '2000', '']) expect(limit(bad)).toBe(30);
  });
});
