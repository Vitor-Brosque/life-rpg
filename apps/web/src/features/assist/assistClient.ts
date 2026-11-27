import { getMeta } from '../../db/repo';

// Ajustes → Assistentes talks to the server with the app's access code (the same one of the sync). The assistant's own
// key never passes through here: the assistant logs in on the assistant port.

export interface AssistStatus {
  enabled: boolean;
  publicUrl: string;
  locked: boolean;
  clients: { id: string; name: string; connectedAt: number; lastUsedAt?: number }[];
}

export type AssistResult = { ok: true; status: AssistStatus } | { ok: false; reason: 'no-sync' | 'offline' | 'old-server' | 'invalid'; message?: string };

async function call(path: string, init: RequestInit = {}): Promise<AssistResult> {
  const token = await getMeta<string>('syncToken');
  if (!token) return { ok: false, reason: 'no-sync' };
  let res: Response;
  try {
    res = await fetch(`/api/assist${path}`, {
      ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, reason: 'offline' };
  }
  if (res.status === 404) return { ok: false, reason: 'old-server' };
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, reason: 'invalid', ...(body.message ? { message: body.message } : {}) };
  }
  if (!res.ok) return { ok: false, reason: 'offline' };
  const body = (await res.json().catch(() => undefined)) as Partial<AssistStatus> | undefined;
  // A server without this feature (or a proxy page) answers something else: treated as an older server.
  if (!body || typeof body.enabled !== 'boolean' || !Array.isArray(body.clients)) return { ok: false, reason: 'old-server' };
  return { ok: true, status: { enabled: body.enabled, publicUrl: typeof body.publicUrl === 'string' ? body.publicUrl : '', locked: body.locked === true, clients: body.clients } };
}

export const getAssist = (): Promise<AssistResult> => call('');
export const setAssist = (enabled: boolean, publicUrl?: string): Promise<AssistResult> =>
  call('', { method: 'PUT', body: JSON.stringify({ enabled, ...(publicUrl !== undefined ? { publicUrl } : {}) }) });
export const revokeAssistant = (id: string): Promise<AssistResult> =>
  call(`/clients/${encodeURIComponent(id)}`, { method: 'DELETE' });
