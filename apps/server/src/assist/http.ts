import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ASSIST_LIMITS } from '@life/shared';
import { PROPOSAL_TOO_BIG, SCOPES, isAllowedRedirect, type AssistService } from './service';
import { SERVER_INSTRUCTIONS, TOOLS } from './tools';

// The assistant port (spec 2026-11-25 §4): only OAuth 2.1 (metadata, client registration, consent page, tokens) and
// the MCP endpoint over Streamable HTTP without sessions. Nothing of the app's API is reachable here. The protocol is
// implemented directly (JSON-RPC 2.0), without an extra dependency.

export const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
/**
 * The MCP endpoint parses bodies up to 4 times the proposal limit, so a proposal over 256 KB still gets an answer the
 * assistant can act on (`AssistService.propose`, `PROPOSAL_TOO_BIG`). A bigger body is refused before parsing (413),
 * with the same text. Every other route keeps `ASSIST_LIMITS.bodyBytes`.
 */
export const MCP_BODY_BYTES = 4 * ASSIST_LIMITS.bodyBytes;
const SERVER_INFO = { name: 'life-rpg', title: 'LIFE RPG', version: '1.0.0' };

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

type Params = Record<string, string>;
const params = (req: FastifyRequest): Params => {
  const src = (req.method === 'GET' ? req.query : req.body) as Record<string, unknown> | undefined;
  return Object.fromEntries(Object.entries(src ?? {}).map(([k, v]) => [k, str(v)]));
};

function page(title: string, body: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>
body{margin:0;background:#12141f;color:#ece6d6;font:16px/1.5 system-ui,sans-serif;display:flex;justify-content:center}
main{max-width:460px;padding:24px 16px}h1{color:#f2c14e;font-size:1.3rem;margin:0 0 12px}
.box{background:#2a2e45;border:3px solid #0b0c14;padding:16px;margin:12px 0}ul{padding-left:1.2em}
label{display:block;font-weight:600;margin:12px 0 4px}input{width:100%;box-sizing:border-box;padding:10px;font-size:1rem;background:#12141f;color:#ece6d6;border:2px solid #3b4063}
.row{display:flex;gap:8px;margin-top:16px}button{flex:1;min-height:44px;font-size:1rem;font-weight:700;border:3px solid #0b0c14;cursor:pointer}
.ok{background:#f2c14e;color:#2b1d12}.no{background:#3b4063;color:#ece6d6}.err{color:#f08a86;font-weight:600}.dim{color:#a9a3b8;font-size:.9rem}
</style></head><body><main>${body}</main></body></html>`;
}

function consentPage(svc: AssistService, client: { name: string }, p: Params, error?: string): string {
  const host = (() => { try { return new URL(p.redirect_uri!).host; } catch { return ''; } })();
  const fields = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'];
  const csrf = svc.consentToken(fields.map((f) => p[f] ?? ''));
  const hidden = fields.map((f) => `<input type="hidden" name="${f}" value="${esc(p[f] ?? '')}">`).join('');
  return page('Conectar ao LIFE RPG', `<h1>Conectar ao LIFE RPG</h1>
<div class="box"><p><strong>${esc(client.name)}</strong> quer se conectar ao seu LIFE RPG.</p>
<p>Depois de permitir, ele poderá:</p><ul>
<li>ler como o app está montado (áreas, rotina, compromissos, jornadas, objetivos, missões abertas, treino, disciplinas) e um resumo das últimas 4 semanas em números;</li>
<li>ler o estudo das disciplinas (caderno, apostilas, o texto dos PDFs das disciplinas, assuntos, provas e trabalhos e os cards dos baralhos ligados a elas) e o seu perfil de estudo;</li>
<li>enviar propostas, que você revisa e aplica no app.</li></ul>
<p class="dim">Ele nunca lê diário, sono, nutrição, check-ins, energia, estratégias, baralhos ou PDFs fora das disciplinas e nunca muda nada sem você. Depois do login, você volta para <strong>${esc(host)}</strong>. Dá para revogar a qualquer momento em Ajustes → Assistentes.</p></div>
<form method="post" action="/oauth/authorize">${hidden}<input type="hidden" name="csrf" value="${esc(csrf)}">
<label for="code">Código de acesso do LIFE RPG</label>
<input id="code" name="access_code" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<div class="row"><button class="ok" name="decision" value="allow" type="submit">Permitir</button>
<button class="no" name="decision" value="deny" type="submit" formnovalidate>Não permitir</button></div></form>`);
}

function sendPage(reply: FastifyReply, status: number, html: string, formTarget?: string): FastifyReply {
  const formAction = ["'self'", formTarget].filter(Boolean).join(' ');
  return reply.code(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('x-frame-options', 'DENY')
    .header('referrer-policy', 'no-referrer')
    .header('cache-control', 'no-store')
    .header('content-security-policy', `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`)
    .send(html);
}

const off = (reply: FastifyReply) => reply.code(403).send({ error: 'assistentes_desligados', error_description: 'Os assistentes estão desligados no LIFE RPG.' });

function redirectWith(reply: FastifyReply, redirectUri: string, values: Record<string, string>): FastifyReply {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(values)) if (v) url.searchParams.set(k, v);
  return reply.code(302).header('cache-control', 'no-store').redirect(url.toString());
}

export async function buildAssistApp(svc: AssistService, log: (line: string) => void = (l) => console.log(l)): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: ASSIST_LIMITS.bodyBytes });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });
  // A body over the MCP limit never reaches the handler (there is no id to answer): the 413 still says what to do.
  const defaultErrorHandler = app.errorHandler;
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE' && req.url.split('?')[0] === '/mcp') {
      log('[assist] /mcp · corpo grande demais, recusado');
      return reply.code(413).send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: PROPOSAL_TOO_BIG } });
    }
    return defaultErrorHandler.call(app, err, req, reply);
  });

  const authServer = () => ({
    issuer: svc.publicUrl,
    authorization_endpoint: `${svc.publicUrl}/oauth/authorize`,
    token_endpoint: `${svc.publicUrl}/oauth/token`,
    registration_endpoint: `${svc.publicUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...SCOPES],
  });
  const protectedResource = () => ({
    resource: svc.resource, authorization_servers: [svc.publicUrl], scopes_supported: [...SCOPES],
    bearer_methods_supported: ['header'], resource_name: 'LIFE RPG',
  });

  app.get('/.well-known/oauth-authorization-server', async (_req, reply) => (svc.ready ? authServer() : off(reply)));
  app.get('/.well-known/oauth-authorization-server/*', async (_req, reply) => (svc.ready ? authServer() : off(reply)));
  app.get('/.well-known/oauth-protected-resource', async (_req, reply) => (svc.ready ? protectedResource() : off(reply)));
  app.get('/.well-known/oauth-protected-resource/*', async (_req, reply) => (svc.ready ? protectedResource() : off(reply)));

  app.post('/oauth/register', async (req, reply) => {
    if (!svc.ready) return off(reply);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const r = svc.register(b.client_name, b.redirect_uris);
    if (!r.client) return reply.code(400).send({ error: 'invalid_client_metadata', error_description: r.error });
    log(`[assist] registro de cliente: "${r.client.name}"`);
    return reply.code(201).header('cache-control', 'no-store').send({
      client_id: r.client.id, client_name: r.client.name, redirect_uris: r.client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
      client_id_issued_at: Math.floor(r.client.createdAt / 1000),
    });
  });

  /** Checks an authorization request. `fatal` = do not redirect (unknown client or address); otherwise an OAuth error. */
  const checkRequest = (p: Params): { client?: ReturnType<AssistService['client']>; redirectUri?: string; fatal?: string; error?: string } => {
    const client = svc.client(p.client_id);
    if (!client) return { fatal: 'Assistente desconhecido. Adicione o conector de novo.' };
    const redirectUri = p.redirect_uri || (client.redirectUris.length === 1 ? client.redirectUris[0]! : '');
    if (!redirectUri || !client.redirectUris.includes(redirectUri) || !isAllowedRedirect(redirectUri)) {
      return { fatal: 'O endereço de retorno não é o que o assistente registrou.' };
    }
    if (p.response_type !== undefined && p.response_type !== 'code') return { client, redirectUri, error: 'unsupported_response_type' };
    if (!p.code_challenge || p.code_challenge_method !== 'S256') return { client, redirectUri, error: 'invalid_request' };
    if (p.resource && p.resource.replace(/\/+$/, '') !== svc.resource && p.resource.replace(/\/+$/, '') !== svc.publicUrl) {
      return { client, redirectUri, error: 'invalid_target' };
    }
    return { client, redirectUri };
  };

  app.get('/oauth/authorize', async (req, reply) => {
    if (!svc.ready) return sendPage(reply, 403, page('LIFE RPG', '<h1>LIFE RPG</h1><p>Os assistentes estão desligados no LIFE RPG. Ligue em Ajustes → Assistentes e tente de novo.</p>'));
    const p = params(req);
    const c = checkRequest(p);
    if (c.fatal) return sendPage(reply, 400, page('LIFE RPG', `<h1>LIFE RPG</h1><p class="err">${esc(c.fatal)}</p>`));
    if (c.error) return redirectWith(reply, c.redirectUri!, { error: c.error, state: p.state ?? '' });
    const target = (() => { try { return new URL(c.redirectUri!).origin; } catch { return ''; } })();
    return sendPage(reply, 200, consentPage(svc, c.client!, { ...p, redirect_uri: c.redirectUri! }), target);
  });

  app.post('/oauth/authorize', async (req, reply) => {
    if (!svc.ready) return off(reply);
    const p = params(req);
    const c = checkRequest(p);
    if (c.fatal) return sendPage(reply, 400, page('LIFE RPG', `<h1>LIFE RPG</h1><p class="err">${esc(c.fatal)}</p>`));
    const fields = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'].map((f) => p[f] ?? '');
    const target = new URL(c.redirectUri!).origin;
    if (!svc.checkConsentToken(p.csrf, fields)) {
      return sendPage(reply, 400, page('LIFE RPG', '<h1>LIFE RPG</h1><p class="err">A página expirou. Volte ao assistente e conecte de novo.</p>'));
    }
    if (c.error) return redirectWith(reply, c.redirectUri!, { error: c.error, state: p.state ?? '' });
    if (p.decision !== 'allow') return redirectWith(reply, c.redirectUri!, { error: 'access_denied', state: p.state ?? '', iss: svc.publicUrl ?? '' });
    const check = svc.checkAccessCode(p.access_code);
    if (check !== 'ok') {
      const msg = check === 'locked' ? 'Muitas tentativas erradas. O login fica bloqueado por 1 hora.'
        : check === 'slow-down' ? 'Muitas tentativas seguidas. Espere um minuto.' : 'Código de acesso errado.';
      log(`[assist] autorização recusada: ${check}`);
      return sendPage(reply, check === 'wrong' ? 401 : 429, consentPage(svc, c.client!, p, msg), target);
    }
    const code = svc.issueCode(c.client!.id, p.code_challenge!, c.redirectUri!, SCOPES.join(' '));
    log(`[assist] autorizado: "${c.client!.name}"`);
    return redirectWith(reply, c.redirectUri!, { code, state: p.state ?? '', iss: svc.publicUrl ?? '' });
  });

  app.post('/oauth/token', async (req, reply) => {
    reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
    if (!svc.ready) return off(reply);
    const b = Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).map(([k, v]) => [k, str(v)]));
    const r = b.grant_type === 'authorization_code' ? svc.exchangeCode(b.code, b.code_verifier, b.client_id, b.redirect_uri || undefined)
      : b.grant_type === 'refresh_token' ? svc.refresh(b.refresh_token, b.client_id || undefined)
        : 'unsupported_grant_type' as const;
    if (typeof r === 'string') return reply.code(400).send({ error: r });
    return r;
  });

  // ---------------------------------------------------------------- MCP (Streamable HTTP, no sessions)

  const unauthorized = (reply: FastifyReply, hadToken: boolean) => reply.code(401)
    .header('www-authenticate', `Bearer realm="LIFE RPG", resource_metadata="${svc.publicUrl}/.well-known/oauth-protected-resource"${hadToken ? ', error="invalid_token"' : ''}`)
    .send({ error: 'unauthorized' });

  app.post('/mcp', { bodyLimit: MCP_BODY_BYTES }, async (req, reply) => {
    if (!svc.ready) return off(reply);
    const origin = req.headers.origin;
    if (origin && origin !== new URL(svc.publicUrl!).origin) return reply.code(403).send({ error: 'origin' });
    const auth = req.headers.authorization;
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    const grant = svc.grantFor(bearer);
    if (!grant) return unauthorized(reply, bearer !== undefined);

    const body = req.body as unknown;
    const messages = Array.isArray(body) ? body : [body];
    const out: unknown[] = [];
    for (const m of messages) {
      if (typeof m !== 'object' || m === null) { out.push({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }); continue; }
      const msg = m as { id?: string | number | null; method?: string; params?: Record<string, unknown> };
      if (msg.method === undefined || msg.id === undefined) continue; // a notification or a response: nothing to answer
      const reply1 = (result: unknown) => out.push({ jsonrpc: '2.0', id: msg.id, result });
      const fail = (code: number, message: string) => out.push({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
      switch (msg.method) {
        case 'initialize': {
          const asked = str(msg.params?.protocolVersion);
          const version = (SUPPORTED_PROTOCOLS as readonly string[]).includes(asked) ? asked : SUPPORTED_PROTOCOLS[0];
          reply1({ protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: SERVER_INSTRUCTIONS });
          break;
        }
        case 'ping': reply1({}); break;
        case 'tools/list': reply1({ tools: TOOLS }); break;
        case 'tools/call': {
          const name = str(msg.params?.name);
          const started = Date.now();
          if (!svc.allowCall(grant.id)) {
            reply1({ isError: true, content: [{ type: 'text', text: `Limite de ${ASSIST_LIMITS.callsPerHour} chamadas por hora atingido. Tente mais tarde.` }] });
            log(`[assist] ${name} · "${grant.clientName}" · limite por hora`);
            break;
          }
          if (name === 'ler_contexto') {
            const ctx = svc.context();
            const text = JSON.stringify(ctx);
            reply1({ content: [{ type: 'text', text }], structuredContent: ctx });
            log(`[assist] ler_contexto · "${grant.clientName}" · ${Date.now() - started} ms · ${text.length} bytes`);
          } else if (name === 'ler_disciplina' || name === 'ler_apostila' || name === 'ler_material') {
            const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
            const r = name === 'ler_disciplina' ? svc.subjectContext(args.disciplina)
              : name === 'ler_apostila' ? svc.studyDoc(args.id) : svc.material(args);
            if (!r.ok) {
              reply1({ isError: true, content: [{ type: 'text', text: r.message }], ...('subjects' in r ? { structuredContent: { subjects: r.subjects } } : {}) });
              log(`[assist] ${name} · "${grant.clientName}" · ${Date.now() - started} ms · ${name === 'ler_material' ? 'recusado' : 'não encontrada'}`);
            } else {
              const value = 'context' in r ? r.context : 'doc' in r ? r.doc : r.material;
              const text = JSON.stringify(value);
              reply1({ content: [{ type: 'text', text }], structuredContent: value });
              log(`[assist] ${name} · "${grant.clientName}" · ${Date.now() - started} ms · ${text.length} bytes`);
            }
          } else if (name === 'enviar_proposta') {
            const r = svc.propose(grant, msg.params?.arguments ?? {});
            if (r.limited) {
              reply1({ isError: true, content: [{ type: 'text', text: 'Limite de propostas de hoje atingido. Tente amanhã.' }] });
            } else if (r.issues && r.issues.length > 0) {
              const lines = r.issues.map((i) => `- ${i.path || '(proposta)'}: ${i.message}`).join('\n');
              reply1({ isError: true, content: [{ type: 'text', text: `A proposta não foi gravada. Corrija e envie de novo:\n${lines}` }], structuredContent: { issues: r.issues } });
            } else {
              const message = 'Proposta enviada. Abra o LIFE RPG para revisar e aplicar o que quiser.';
              reply1({ content: [{ type: 'text', text: `${message} (${r.items} itens)` }], structuredContent: { id: r.id, items: r.items, message } });
            }
            log(`[assist] enviar_proposta · "${grant.clientName}" · ${Date.now() - started} ms · ${r.limited ? 'limite' : r.issues?.length ? `${r.issues.length} problemas` : `${r.items} itens`}`);
          } else {
            fail(-32602, `Ferramenta desconhecida: ${name}`);
          }
          break;
        }
        default: fail(-32601, `Método não suportado: ${msg.method}`);
      }
    }
    if (out.length === 0) return reply.code(202).send();
    return reply.header('content-type', 'application/json').send(Array.isArray(body) ? out : out[0]);
  });
  app.get('/mcp', async (_req, reply) => reply.code(405).header('allow', 'POST').send({ error: 'method_not_allowed' }));
  app.delete('/mcp', async (_req, reply) => reply.code(405).header('allow', 'POST').send({ error: 'method_not_allowed' }));

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));
  return app;
}
