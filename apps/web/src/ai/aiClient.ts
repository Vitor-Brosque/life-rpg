import type {
  AiOk, AiServerError, AiStatusResponse, AiUsage, CardsRequest, CardsResult, HintRequest, HintResult,
  WeekRequest, WeekSummary,
} from '@life/shared';
import { isAiServerError } from '@life/shared';
import { getMeta } from '../db/repo';
import { TOKEN_EVENT } from '../sync/client';
import { setAiStatus, setAiUsage } from './aiStatus';

// The browser side of /api/ai (spec §6.1, §6.6). Never throws: every failure is a code with a kind sentence.

export type AiErrorCode = AiServerError | 'no_token' | 'offline' | 'unauthorized';
export type AiResult<T> = { ok: true; data: T; usage: AiUsage } | { ok: false; error: AiErrorCode };

/** Two server attempts of up to 80 s each, plus slack. */
export const AI_CLIENT_TIMEOUT_MS = 180_000;

export const AI_ERROR_COPY: Record<AiErrorCode, string> = {
  no_token: 'Conecte o servidor em Ajustes → Sincronização para usar a IA.',
  offline: 'Sem conexão com o servidor. A IA precisa de internet; o resto do app funciona normalmente.',
  unauthorized: 'Código de acesso inválido. Confira em Ajustes → Sincronização.',
  ai_disabled: 'A IA não está configurada no servidor.',
  invalid_body: 'Esse pedido ficou grande demais ou veio incompleto.',
  daily_limit: 'Os pedidos de hoje acabaram. Amanhã tem mais, e o app segue funcionando sem a IA.',
  busy: 'A IA ainda está respondendo outro pedido. Tente de novo em instantes.',
  timeout: 'A IA demorou demais para responder. Tente de novo daqui a pouco.',
  rate_limited: 'A IA está recebendo pedidos demais agora. Tente de novo daqui a pouco.',
  refused: 'A IA não respondeu a este pedido. Tente reformular.',
  incomplete: 'A resposta veio cortada. Tente de novo.',
  auth: 'A chave da IA no servidor foi recusada. Confira a configuração do servidor.',
  billing: 'A conta da API está sem crédito. O app segue funcionando sem a IA.',
  upstream: 'A IA não respondeu agora. Tente de novo mais tarde.',
  bad_output: 'A IA respondeu num formato inesperado. Tente de novo.',
};

const timeoutSignal = (): AbortSignal | undefined =>
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(AI_CLIENT_TIMEOUT_MS)
    : undefined;

async function readJson(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return undefined; }
}

async function postAi<T>(path: 'hint' | 'cards' | 'week', body: unknown): Promise<AiResult<T>> {
  const token = await getMeta<string>('syncToken');
  if (!token) return { ok: false, error: 'no_token' };
  let res: Response;
  try {
    res = await fetch(`/api/ai/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: timeoutSignal(),
    });
  } catch (e) {
    return { ok: false, error: (e as { name?: unknown } | null)?.name === 'TimeoutError' ? 'timeout' : 'offline' };
  }
  const json = await readJson(res);
  if (res.ok) {
    const answer = json as Partial<AiOk<T>> | null | undefined;
    if (!answer || typeof answer !== 'object' || answer.result === undefined || !answer.usage) {
      return { ok: false, error: 'upstream' };
    }
    setAiUsage(answer.usage);
    return { ok: true, data: answer.result, usage: answer.usage };
  }
  if (res.status === 401) return { ok: false, error: 'unauthorized' };
  const code = (json as { error?: unknown } | null | undefined)?.error;
  const error: AiErrorCode = isAiServerError(code) ? code : 'upstream';
  if (error === 'ai_disabled') setAiStatus({ available: false });
  return { ok: false, error };
}

export const askHint = (r: HintRequest): Promise<AiResult<HintResult>> => postAi<HintResult>('hint', r);
export const askCards = (r: CardsRequest): Promise<AiResult<CardsResult>> => postAi<CardsResult>('cards', r);
export const askWeek = (r: WeekRequest): Promise<AiResult<WeekSummary>> => postAi<WeekSummary>('week', r);

function parseStatus(v: unknown): AiStatusResponse | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (o.available === false) return { available: false };
  if (o.available === true && typeof o.used === 'number' && typeof o.limit === 'number') {
    return { available: true, used: o.used, limit: o.limit };
  }
  return undefined;
}

/** Asks the server whether it has AI; offline or a 5xx keeps the last known answer. */
export async function refreshAiStatus(): Promise<void> {
  const token = await getMeta<string>('syncToken');
  if (!token) { setAiStatus({ available: false }); return; }
  let res: Response;
  try {
    res = await fetch('/api/ai/status', { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return;
  }
  // 404: a server from before Marco 7.
  if (res.status === 401 || res.status === 404) { setAiStatus({ available: false }); return; }
  if (!res.ok) return;
  const status = parseStatus(await readJson(res));
  if (status) setAiStatus(status);
}

/** On app start, when the sync token changes and when the network comes back. */
export function startAiStatus(): () => void {
  if (typeof window === 'undefined') return () => {};
  const refresh = (): void => { refreshAiStatus().catch((e: unknown) => console.error('ai status failed', e)); };
  refresh();
  window.addEventListener(TOKEN_EVENT, refresh);
  window.addEventListener('online', refresh);
  return () => {
    window.removeEventListener(TOKEN_EVENT, refresh);
    window.removeEventListener('online', refresh);
  };
}
