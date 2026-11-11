import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { RecordStore } from './store';

const NAME = /^life-rpg-\d{4}-\d{2}-\d{2}\.sqlite$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function runBackup(store: RecordStore, dataDir: string, now: Date, keep = 14): string {
  const dir = join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `life-rpg-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.sqlite`);
  if (!existsSync(file)) store.backupTo(file);
  const all = readdirSync(dir).filter((f) => NAME.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) {
    rmSync(join(dir, old), { force: true });
  }
  return file;
}

export function scheduleDailyBackup(store: RecordStore, dataDir: string, hour = 3): () => void {
  let lastDay = '';
  const check = () => {
    const now = new Date();
    const day = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (now.getHours() < hour || day === lastDay) return;
    try {
      runBackup(store, dataDir, now);
      lastDay = day;
    } catch (err) {
      console.warn('backup failed:', (err as Error).message);
    }
  };
  check();
  const timer = setInterval(check, 10 * 60 * 1000);
  return () => clearInterval(timer);
}
