import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as webpush from 'web-push';
import type { RecordStore } from './store';

export interface PushSubscriptionJSON {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

export interface ScheduledPush {
  tag: string;
  at: number;
  title: string;
  body: string;
}

export interface PushSender {
  /** gone = the push service answered 404/410, so the subscription must be deleted. */
  send(sub: PushSubscriptionJSON, payload: string): Promise<{ gone: boolean }>;
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

function loadVapid(dataDir: string): VapidKeys {
  const file = join(dataDir, 'vapid.json');
  if (existsSync(file)) {
    try {
      const k = JSON.parse(readFileSync(file, 'utf8')) as VapidKeys;
      if (k.publicKey && k.privateKey) return k;
    } catch {
      // fall through and regenerate
    }
  }
  const keys = webpush.generateVAPIDKeys();
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}

/** VAPID "subject" (a contact URL the push services may use); LIFE_RPG_VAPID_SUBJECT overrides it. */
export function vapidSubject(env: NodeJS.ProcessEnv = process.env): string {
  return env.LIFE_RPG_VAPID_SUBJECT || 'mailto:life-rpg@example.com';
}

/** A push that is this late (e.g. the server was down) is dropped instead of arriving out of context. */
const MAX_LATE_MS = 10 * 60_000;

function defaultSender(vapid: VapidKeys): PushSender {
  webpush.setVapidDetails(vapidSubject(), vapid.publicKey, vapid.privateKey);
  return {
    async send(sub, payload) {
      try {
        await webpush.sendNotification(sub, payload);
        return { gone: false };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return { gone: true };
        console.warn('push send failed:', (err as Error).message);
        return { gone: false };
      }
    },
  };
}

export class PushService {
  private vapid?: VapidKeys;
  private sender?: PushSender;

  constructor(
    private store: RecordStore,
    private dataDir: string,
    sender?: PushSender,
    private now: () => number = Date.now,
  ) {
    this.sender = sender;
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS push_subs (
        endpoint TEXT PRIMARY KEY, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS push_queue (
        tag TEXT PRIMARY KEY, at INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL
      );
    `);
  }

  private keys(): VapidKeys {
    return (this.vapid ??= loadVapid(this.dataDir));
  }

  publicKey(): string {
    return this.keys().publicKey;
  }

  subscribe(sub: PushSubscriptionJSON): void {
    this.store.db
      .prepare('INSERT OR REPLACE INTO push_subs (endpoint, data) VALUES (?, ?)')
      .run(sub.endpoint, JSON.stringify(sub));
  }

  schedule(p: ScheduledPush): void {
    this.store.db
      .prepare('INSERT OR REPLACE INTO push_queue (tag, at, title, body) VALUES (?, ?, ?, ?)')
      .run(p.tag, p.at, p.title, p.body);
  }

  cancel(tag: string): void {
    this.store.db.prepare('DELETE FROM push_queue WHERE tag = ?').run(tag);
  }

  /** Sends the due pushes; resolves with how many were sent (stale ones are dropped unsent). */
  async tick(): Promise<number> {
    const db = this.store.db;
    const now = this.now();
    db.prepare('DELETE FROM push_queue WHERE at < ?').run(now - MAX_LATE_MS);
    const due = db
      .prepare('SELECT tag, at, title, body FROM push_queue WHERE at <= ? ORDER BY at')
      .all(now) as unknown as ScheduledPush[];
    if (due.length === 0) return 0;
    const sender = (this.sender ??= defaultSender(this.keys()));
    const take = db.prepare('DELETE FROM push_queue WHERE tag = ? AND at = ?');
    let sent = 0;
    for (const p of due) {
      // Drop before sending so a failing send never retries forever. Matching `at` too keeps a tag
      // that was rescheduled (or cancelled) while earlier pushes were being sent: skip this one then.
      if (Number(take.run(p.tag, p.at).changes) === 0) continue;
      sent += 1;
      const payload = JSON.stringify({ title: p.title, body: p.body, tag: p.tag });
      const subs = db.prepare('SELECT data FROM push_subs').all() as unknown as { data: string }[];
      for (const row of subs) {
        const sub = JSON.parse(row.data) as PushSubscriptionJSON;
        try {
          const { gone } = await sender.send(sub, payload);
          if (gone) db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(sub.endpoint);
        } catch (err) {
          console.warn('push send failed:', (err as Error).message);
        }
      }
    }
    return sent;
  }

  start(intervalMs = 5000): () => void {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      this.tick()
        .catch((err) => console.warn('push tick failed:', (err as Error).message))
        .finally(() => (running = false));
    }, intervalMs);
    return () => clearInterval(timer);
  }
}
