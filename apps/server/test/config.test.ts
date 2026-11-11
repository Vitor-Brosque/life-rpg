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
