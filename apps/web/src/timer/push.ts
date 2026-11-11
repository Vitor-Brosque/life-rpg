import { getMeta } from '../db/repo';

// Server push (§14): the client schedules notifications on the server so they arrive even with
// the app closed. Every call needs the sync token and silently does nothing without it or offline.

export const TIMER_PUSH_TAG = 'timer';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** fetch with the Bearer token; undefined when there is no token or the request fails. */
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response | undefined> {
  try {
    const token = await getMeta<string>('syncToken');
    if (!token) return undefined;
    return await fetch(path, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
    });
  } catch {
    return undefined;
  }
}

/** Schedules (or replaces) the push with this tag. Resolves true when the server accepted it. */
export async function schedulePush(tag: string, at: number, title: string, body: string): Promise<boolean> {
  const res = await apiFetch('/api/push/schedule', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ tag, at: Math.round(at), title, body }),
  });
  return res?.ok ?? false;
}

/** Cancels the push with this tag. Resolves true when the server answered OK. */
export async function cancelPush(tag: string): Promise<boolean> {
  const res = await apiFetch(`/api/push/schedule/${encodeURIComponent(tag)}`, { method: 'DELETE' });
  return res?.ok ?? false;
}

// Timer pushes run one after the other, so a quick start → pause can never reach the
// server in the wrong order (which would leave a stale notification scheduled).
let timerQueue: Promise<unknown> = Promise.resolve();
function queued(task: () => Promise<unknown>): Promise<void> {
  const next = timerQueue.then(task, task);
  timerQueue = next.catch(() => undefined);
  return next.then(() => undefined, () => undefined);
}

export function scheduleTimerPush(atMs: number, title: string, body: string): Promise<void> {
  return queued(() => schedulePush(TIMER_PUSH_TAG, atMs, title, body));
}

export function cancelTimerPush(): Promise<void> {
  return queued(() => cancelPush(TIMER_PUSH_TAG));
}

/** Setup problem the Settings screen can show as is (`error.message` is PT-BR). */
export class PushSetupError extends Error {}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const view = new Uint8Array(a);
  return view.every((v, i) => v === b[i]);
}

async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  // No registration yet (e.g. the PWA worker is still installing): wait briefly for one.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4000)),
  ]);
}

/**
 * "Ativar notificações" (must run from a tap: iOS only shows the prompt inside the gesture).
 * Asks permission, subscribes through the service worker with the server key and sends the
 * subscription to the server. Throws PushSetupError when sync is not set up or the server fails.
 */
export async function enablePushNotifications(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)
    || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  // First await of the function, so it stays inside the user's tap.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const reg = await serviceWorkerRegistration();
  if (!reg) return 'unsupported';
  if (!(await getMeta<string>('syncToken'))) {
    throw new PushSetupError('Conecte a sincronização com o servidor antes de ativar as notificações.');
  }
  const keyRes = await apiFetch('/api/push/key');
  if (!keyRes?.ok) throw new PushSetupError('Não foi possível falar com o servidor. Tente de novo.');
  const { key } = (await keyRes.json()) as { key: string };
  const serverKey = urlBase64ToUint8Array(key);

  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, serverKey)) {
    await sub.unsubscribe(); // the server key changed: the old subscription can no longer be used
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });

  const res = await apiFetch('/api/push/subscribe', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(sub),
  });
  if (!res?.ok) throw new PushSetupError('Não foi possível falar com o servidor. Tente de novo.');
  return 'granted';
}
