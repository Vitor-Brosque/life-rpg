import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBackup } from '../src/backup';
import { RecordStore } from '../src/store';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'liferpg-bk-'));
  dirs.push(d);
  return d;
}

describe('runBackup', () => {
  it('creates a dated backup and is idempotent per day', () => {
    const dir = tmp();
    const store = new RecordStore(':memory:');
    const file = runBackup(store, dir, new Date(2026, 4, 3, 10));
    expect(file.endsWith('life-rpg-2026-05-03.sqlite')).toBe(true);
    expect(existsSync(file)).toBe(true);
    expect(runBackup(store, dir, new Date(2026, 4, 3, 22))).toBe(file);
  });

  it('keeps only the newest N backups', () => {
    const dir = tmp();
    const bdir = join(dir, 'backups');
    mkdirSync(bdir);
    for (let d = 1; d <= 16; d++) {
      writeFileSync(join(bdir, `life-rpg-2026-04-${String(d).padStart(2, '0')}.sqlite`), 'x');
    }
    const store = new RecordStore(':memory:');
    runBackup(store, dir, new Date(2026, 4, 3, 10), 14);
    const left = readdirSync(bdir).sort();
    expect(left).toHaveLength(14);
    expect(left).toContain('life-rpg-2026-05-03.sqlite');
    expect(left).not.toContain('life-rpg-2026-04-01.sqlite');
  });
});
