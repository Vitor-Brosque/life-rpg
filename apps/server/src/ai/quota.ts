import { dayKeyOf } from '@life/shared';
import type { RecordStore } from '../store';

/** Where the day's counter lives: the SQLite `meta` table in production, memory in tests. */
export interface QuotaStore {
  read(): string | undefined;
  write(value: string): void;
}

export const AI_USAGE_KEY = 'aiUsage';

/** Requests sent to the model today (server-local day), up to `limit`. */
export class AiQuota {
  constructor(
    readonly limit: number,
    private readonly store: QuotaStore,
    private readonly now: () => number = Date.now,
  ) {}

  private today(): string {
    return dayKeyOf(this.now(), 0);
  }

  used(): number {
    try {
      const v = JSON.parse(this.store.read() ?? 'null') as { day?: unknown; count?: unknown } | null;
      return v && v.day === this.today() && typeof v.count === 'number' && v.count >= 0 ? Math.floor(v.count) : 0;
    } catch {
      return 0;
    }
  }

  /** Counts one request; false, counting nothing, when today's limit is reached. */
  take(): boolean {
    const used = this.used();
    if (used >= this.limit) return false;
    this.store.write(JSON.stringify({ day: this.today(), count: used + 1 }));
    return true;
  }
}

export function memoryQuotaStore(): QuotaStore {
  let value: string | undefined;
  return { read: () => value, write: (v) => { value = v; } };
}

export function storeQuota(store: RecordStore): QuotaStore {
  return { read: () => store.getMeta(AI_USAGE_KEY), write: (v) => store.setMeta(AI_USAGE_KEY, v) };
}
