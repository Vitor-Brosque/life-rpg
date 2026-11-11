import { SYNC_TABLES, type SyncTable } from '@life/shared';
import { tableOf } from './db';

export type ExportData = { exportedAt: number } & Record<SyncTable, unknown[]>;

/** Every record of every synced table (soft-deleted included), keyed by table name. */
export async function collectExport(): Promise<ExportData> {
  const data = { exportedAt: Date.now() } as ExportData;
  for (const table of SYNC_TABLES) data[table] = await tableOf(table).toArray();
  return data;
}

/** `life-rpg-YYYY-MM-DD.json` in local time. */
export function exportFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `life-rpg-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/** Downloads the full export as a JSON file via a Blob URL. */
export async function downloadExport(): Promise<void> {
  const data = await collectExport();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
