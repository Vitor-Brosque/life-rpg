import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Proposal } from '@life/shared';
import { encodePdfText } from '@life/shared';
import { buildApp } from '../src/app';
import { MCP_BODY_BYTES, buildAssistApp } from '../src/assist/http';
import { AssistService } from '../src/assist/service';
import type { ServerConfig } from '../src/config';
import { Hub } from '../src/hub';
import { MediaStore } from '../src/media';
import { RecordStore } from '../src/store';

const TOKEN = 'codigo-de-acesso-de-teste-0123456';
const PUBLIC = 'https://exemplo.test:8443';
const REDIRECT = 'https://assistente.test/oauth/callback';
const cfg: ServerConfig = { port: 0, host: '127.0.0.1', dataDir: '.', token: TOKEN, dbPath: ':memory:' };
const verifier = 'v'.repeat(50);
const challenge = createHash('sha256').update(verifier).digest('base64url');

async function setup(opts: { enable?: boolean; media?: MediaStore } = {}) {
  let now = Date.UTC(2026, 10, 25, 12);
  const store = new RecordStore(':memory:');
  const hub = new Hub();
  const published: number[] = [];
  hub.subscribe((rev) => published.push(rev));
  const svc = new AssistService(store, hub, TOKEN, () => now, opts.media);
  const assist = await buildAssistApp(svc, () => {});
  const main = await buildApp(cfg, { store, hub, assist: svc });
  if (opts.enable !== false) expect(svc.configure(true, PUBLIC)).toBeUndefined();
  return { store, svc, assist, main, published, tick: (ms: number) => { now += ms; } };
}

const form = (fields: Record<string, string>) => ({
  headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(fields).toString(),
});

/** Registers a client and walks the consent page; returns the code (or the response of the POST). */
async function authorize(assist: FastifyInstance, accessCode = TOKEN, decision = 'allow', existing?: string) {
  let clientId = existing;
  if (!clientId) {
    const reg = await assist.inject({ method: 'POST', url: '/oauth/register', payload: { client_name: 'Assistente de Teste', redirect_uris: [REDIRECT] } });
    expect(reg.statusCode).toBe(201);
    clientId = reg.json().client_id as string;
  }
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'st8', scope: 'contexto:ler propostas:enviar', resource: `${PUBLIC}/mcp` });
  const page = await assist.inject({ url: `/oauth/authorize?${q}` });
  expect(page.statusCode).toBe(200);
  expect(page.body).toContain('Assistente de Teste');
  expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  const csrf = /name="csrf" value="([^"]+)"/.exec(page.body)![1]!;
  const post = await assist.inject({ method: 'POST', url: '/oauth/authorize', ...form({
    client_id: clientId, redirect_uri: REDIRECT, state: 'st8', code_challenge: challenge, code_challenge_method: 'S256',
    scope: 'contexto:ler propostas:enviar', resource: `${PUBLIC}/mcp`, csrf, access_code: accessCode, decision,
  }) });
  return { clientId, post };
}

async function tokens(assist: FastifyInstance) {
  const { clientId, post } = await authorize(assist);
  expect(post.statusCode).toBe(302);
  const loc = new URL(post.headers.location as string);
  expect(loc.origin + loc.pathname).toBe(REDIRECT);
  expect(loc.searchParams.get('state')).toBe('st8');
  expect(loc.searchParams.get('iss')).toBe(PUBLIC);
  const code = loc.searchParams.get('code')!;
  const t = await assist.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT }) });
  expect(t.statusCode).toBe(200);
  return { clientId, code, ...(t.json() as { access_token: string; refresh_token: string; expires_in: number; scope: string }) };
}

const rpc = (assist: FastifyInstance, token: string | undefined, body: unknown, headers: Record<string, string> = {}) =>
  assist.inject({ method: 'POST', url: '/mcp', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, payload: body as object });

describe('assistant port: off by default', () => {
  it('answers 403 everywhere until it is on with an https address', async () => {
    const { svc, assist } = await setup({ enable: false });
    expect((await assist.inject({ url: '/.well-known/oauth-authorization-server' })).statusCode).toBe(403);
    expect((await rpc(assist, 'x', { jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode).toBe(403);
    expect((await assist.inject({ url: '/oauth/authorize' })).body).toContain('Os assistentes estão desligados');
    expect(svc.configure(true)).toBe('Cole o endereço público antes de ligar.');
    expect(svc.configure(true, 'http://exemplo.test')).toMatch(/https:\/\//);
    expect(svc.configure(true, 'https://exemplo.test/caminho')).toMatch(/https:\/\//);
    expect(svc.configure(true, `${PUBLIC}/`)).toBeUndefined();
    expect(svc.publicUrl).toBe(PUBLIC);
  });
  it('serves only its own routes: nothing of the app API', async () => {
    const { assist } = await setup();
    expect((await assist.inject({ url: '/api/health' })).statusCode).toBe(404);
    expect((await assist.inject({ method: 'POST', url: '/api/sync', payload: {} })).statusCode).toBe(404);
  });
});

describe('OAuth', () => {
  it('publishes the metadata ChatGPT and Claude look for', async () => {
    const { assist } = await setup();
    const as = (await assist.inject({ url: '/.well-known/oauth-authorization-server' })).json();
    expect(as).toMatchObject({ issuer: PUBLIC, token_endpoint: `${PUBLIC}/oauth/token`, registration_endpoint: `${PUBLIC}/oauth/register`, code_challenge_methods_supported: ['S256'] });
    const pr = (await assist.inject({ url: '/.well-known/oauth-protected-resource/mcp' })).json();
    expect(pr).toMatchObject({ resource: `${PUBLIC}/mcp`, authorization_servers: [PUBLIC] });
  });
  it('refuses registration without an https (or local) return address', async () => {
    const { assist } = await setup();
    const r = await assist.inject({ method: 'POST', url: '/oauth/register', payload: { client_name: 'x', redirect_uris: ['http://exemplo.test/cb'] } });
    expect(r.statusCode).toBe(400);
    expect((await assist.inject({ method: 'POST', url: '/oauth/register', payload: { redirect_uris: ['http://localhost:3000/cb'] } })).statusCode).toBe(201);
  });
  it('wrong access code: the page says so and no code is issued; deny goes back with access_denied', async () => {
    const { assist } = await setup();
    const wrong = await authorize(assist, 'errado');
    expect(wrong.post.statusCode).toBe(401);
    expect(wrong.post.body).toContain('Código de acesso errado.');
    const deny = await authorize(assist, '', 'deny');
    expect(new URL(deny.post.headers.location as string).searchParams.get('error')).toBe('access_denied');
  });
  it('slows down after 5 tries a minute and locks for an hour after 20 failures', async () => {
    const { assist, svc, tick } = await setup();
    const { clientId } = await authorize(assist, 'errado');
    for (let i = 0; i < 4; i++) await authorize(assist, 'errado', 'allow', clientId);
    expect((await authorize(assist, TOKEN, 'allow', clientId)).post.body).toContain('Espere um minuto');
    for (let i = 0; i < 3; i++) { tick(61_000); for (let k = 0; k < 5; k++) await authorize(assist, 'errado', 'allow', clientId); }
    expect(svc.lockedUntil()).toBeDefined();
    tick(61_000);
    expect((await authorize(assist, TOKEN, 'allow', clientId)).post.body).toContain('bloqueado por 1 hora');
  });
  it('a forged or expired consent form is refused', async () => {
    const { assist } = await setup();
    const reg = (await assist.inject({ method: 'POST', url: '/oauth/register', payload: { client_name: 'x', redirect_uris: [REDIRECT] } })).json();
    const r = await assist.inject({ method: 'POST', url: '/oauth/authorize', ...form({ client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', csrf: '1.x', access_code: TOKEN, decision: 'allow' }) });
    expect(r.statusCode).toBe(400);
    expect(r.body).toContain('A página expirou');
  });
  it('code → tokens with PKCE, single use; refresh rotates; reusing an old refresh key revokes the grant', async () => {
    const { assist } = await setup();
    const t = await tokens(assist);
    expect(t.access_token).toMatch(/^lra_/);
    expect(t.expires_in).toBe(3600);
    const again = await assist.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'authorization_code', code: t.code, code_verifier: verifier, client_id: t.clientId }) });
    expect(again.json()).toEqual({ error: 'invalid_grant' });
    const r1 = (await assist.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: t.refresh_token }) })).json();
    expect(r1.access_token).not.toBe(t.access_token);
    expect((await rpc(assist, r1.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode).toBe(200);
    expect((await rpc(assist, t.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode).toBe(401);
    const reuse = await assist.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: t.refresh_token }) });
    expect(reuse.json()).toEqual({ error: 'invalid_grant' });
    expect((await rpc(assist, r1.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode).toBe(401);
  });
  it('a wrong PKCE verifier gets nothing', async () => {
    const { assist } = await setup();
    const { clientId, post } = await authorize(assist);
    const code = new URL(post.headers.location as string).searchParams.get('code')!;
    const r = await assist.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'authorization_code', code, code_verifier: 'w'.repeat(50), client_id: clientId }) });
    expect(r.json()).toEqual({ error: 'invalid_grant' });
  });
});

describe('MCP', () => {
  it('401 with the metadata pointer without a key; 403 for another origin', async () => {
    const { assist } = await setup();
    const r = await rpc(assist, undefined, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(r.statusCode).toBe(401);
    expect(r.headers['www-authenticate']).toContain(`resource_metadata="${PUBLIC}/.well-known/oauth-protected-resource"`);
    const { access_token } = await tokens(assist);
    expect((await rpc(assist, access_token, { jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://outro.test' })).statusCode).toBe(403);
    expect((await assist.inject({ url: '/mcp' })).statusCode).toBe(405);
  });
  it('initialize, tools/list, notifications', async () => {
    const { assist } = await setup();
    const { access_token } = await tokens(assist);
    const init = (await rpc(assist, access_token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })).json();
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'life-rpg' } });
    expect((await rpc(assist, access_token, { jsonrpc: '2.0', id: 9, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).json().result.protocolVersion).toBe('2025-11-25');
    expect((await rpc(assist, access_token, { jsonrpc: '2.0', method: 'notifications/initialized' })).statusCode).toBe(202);
    const list = (await rpc(assist, access_token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['ler_contexto', 'ler_disciplina', 'ler_apostila', 'ler_material', 'enviar_proposta']);
    expect(list.result.tools[0].annotations.readOnlyHint).toBe(true);
    expect((await rpc(assist, access_token, { jsonrpc: '2.0', id: 3, method: 'resources/list' })).json().error.code).toBe(-32601);
  });
  it('ler_contexto reads the synced records; enviar_proposta validates, stores and notifies devices', async () => {
    const { assist, store, published } = await setup();
    store.apply([
      { table: 'areas', record: { id: 'a1', createdAt: 1, updatedAt: 1, deleted: false, name: 'Estudo', attribute: 'Intelecto', color: '#fff', icon: 'book', order: 0, archived: false } },
      { table: 'diaryEntries', record: { id: 'd1', createdAt: 1, updatedAt: 1, deleted: false, text: 'nada daqui sai' } },
    ]);
    const { access_token } = await tokens(assist);
    const ctx = (await rpc(assist, access_token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ler_contexto', arguments: {} } })).json();
    expect(ctx.result.structuredContent.areas).toEqual([{ name: 'Estudo', attribute: 'Intelecto', archived: false }]);
    expect(ctx.result.content[0].text).not.toContain('nada daqui sai');

    const bad = (await rpc(assist, access_token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'enviar_proposta', arguments: { title: 'x', summary: 'y', missions: [{ title: 'm', area: 'Música' }] } } })).json();
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toContain('missions.0.area');
    expect(store.list('proposals')).toHaveLength(0);

    const before = published.length;
    const ok = (await rpc(assist, access_token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'enviar_proposta', arguments: { title: 'Semana', summary: 'Duas missões.', missions: [{ title: 'Ler um capítulo', area: 'estudo', durationMin: 30 }, { title: 'Arrumar a mesa' }] } } })).json();
    expect(ok.result.isError).toBeUndefined();
    expect(ok.result.structuredContent).toMatchObject({ items: 2 });
    const [p] = store.list<Proposal>('proposals');
    expect(p).toMatchObject({ source: 'Assistente de Teste', status: 'pending', payload: { title: 'Semana' } });
    expect(published.length).toBe(before + 1);
  });
  it('study: ler_contexto brings each subject with its topics (never the chat link); enviar_proposta accepts a study package', async () => {
    const { assist, store } = await setup();
    const rec = { createdAt: 1, updatedAt: 1, deleted: false };
    store.apply([
      { table: 'journeys', record: { ...rec, id: 'bd', title: 'Banco de Dados', status: 'active', order: 0, subject: true, chatUrl: 'https://chat.exemplo.test/c/link-privado' } },
      { table: 'subjectTopics', record: { ...rec, id: 't1', journeyId: 'bd', name: 'Normalização', marks: [] } },
      { table: 'missions', record: { ...rec, id: 'm1', title: 'Prova de Banco de Dados', status: 'open', checklist: [], important: false, shrunk: false, postponeCount: 0, journeyId: 'bd', assessment: 'prova', date: '2026-12-10', deadline: '2026-12-10' } },
      { table: 'notes', record: { ...rec, id: 'n1', deckId: 'd1', type: 'basic', front: 'Frente que não sai daqui', back: 'b', draft: false } },
    ] as never);
    const { access_token } = await tokens(assist);
    const list = (await rpc(assist, access_token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json();
    const send = list.result.tools.find((t: { name: string }) => t.name === 'enviar_proposta');
    expect(send.description).toContain('use study com a disciplina dela');
    expect(send.inputSchema.properties.study.items.required).toEqual(['subject']);

    const ctx = (await rpc(assist, access_token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ler_contexto', arguments: {} } })).json();
    expect(ctx.result.structuredContent.subjects).toEqual([{ title: 'Banco de Dados', topics: ['Normalização'], assessments: [{ kind: 'prova', date: '2026-12-10' }], notebook: false, docs: 0 }]);
    expect(ctx.result.content[0].text).not.toContain('link-privado');
    expect(ctx.result.content[0].text).not.toContain('Frente que não sai daqui');

    const bad = (await rpc(assist, access_token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'enviar_proposta', arguments: { title: 'x', summary: 'y', study: [{ subject: 'Cálculo I', topics: [{ name: 'Limites' }] }] } } })).json();
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toContain('study.0.subject');

    const ok = (await rpc(assist, access_token, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'enviar_proposta', arguments: {
      title: 'Aula de normalização', summary: 'O que vimos hoje.',
      study: [{ subject: 'banco de dados', topics: [{ name: 'Formas normais', seen: true }], cards: [{ type: 'basic', front: 'O que é a 3FN?', back: 'Sem dependência transitiva.' }], assessments: [{ kind: 'trabalho', date: '2026-12-15' }], missions: [{ title: 'Fazer a lista 3' }] }],
    } } })).json();
    expect(ok.result.isError).toBeUndefined();
    expect(ok.result.structuredContent).toMatchObject({ items: 4 });
    const [p] = store.list<Proposal>('proposals');
    expect(p!.payload.study![0]).toMatchObject({ subject: 'banco de dados', topics: [{ name: 'Formas normais', seen: true }] });
  });
  it('keeps at most 3 pending proposals (the oldest becomes replaced) and limits proposals per day', async () => {
    const { assist, store, tick } = await setup();
    const { access_token } = await tokens(assist);
    const send = (n: number) => rpc(assist, access_token, { jsonrpc: '2.0', id: n, method: 'tools/call', params: { name: 'enviar_proposta', arguments: { title: `P${n}`, summary: 's', missions: [{ title: 'm' }] } } });
    for (let n = 1; n <= 4; n++) { await send(n); tick(1000); }
    const byTitle = Object.fromEntries(store.list<Proposal>('proposals').map((p) => [p.payload.title, p.status]));
    expect(byTitle).toEqual({ P1: 'replaced', P2: 'pending', P3: 'pending', P4: 'pending' });
    for (let n = 5; n <= 10; n++) await send(n);
    const limited = (await send(11)).json();
    expect(limited.result.content[0].text).toBe('Limite de propostas de hoje atingido. Tente amanhã.');
  });
});

describe('Ajustes (app API, with the app access code)', () => {
  it('turns it on, lists and revokes assistants; the assistant key never opens the app API', async () => {
    const { main, assist } = await setup({ enable: false });
    const auth = { authorization: `Bearer ${TOKEN}` };
    expect((await main.inject({ url: '/api/assist' })).statusCode).toBe(401);
    const on = await main.inject({ method: 'PUT', url: '/api/assist', headers: auth, payload: { enabled: true, publicUrl: PUBLIC } });
    expect(on.json()).toMatchObject({ enabled: true, publicUrl: PUBLIC, clients: [] });
    const t = await tokens(assist);
    const st = (await main.inject({ url: '/api/assist', headers: auth })).json();
    expect(st.clients).toEqual([expect.objectContaining({ id: t.clientId, name: 'Assistente de Teste' })]);
    expect((await main.inject({ method: 'POST', url: '/api/sync', headers: { authorization: `Bearer ${t.access_token}` }, payload: { deviceId: 'x', cursor: 0, changes: [] } })).statusCode).toBe(401);
    await main.inject({ method: 'DELETE', url: `/api/assist/clients/${t.clientId}`, headers: auth });
    expect((await rpc(assist, t.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode).toBe(401);
    const t2 = await tokens(assist);
    await main.inject({ method: 'PUT', url: '/api/assist', headers: auth, payload: { enabled: false } });
    expect((await rpc(assist, t2.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode).toBe(403);
    await main.inject({ method: 'PUT', url: '/api/assist', headers: auth, payload: { enabled: true } });
    expect((await rpc(assist, t2.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode).toBe(401);
  });
});

describe('caderno da disciplina: ler_disciplina and ler_apostila (spec 2026-11-26 §4)', () => {
  const rec = { createdAt: 1, updatedAt: 1, deleted: false };
  const seed = (store: RecordStore) => store.apply([
    { table: 'profile', record: { ...rec, id: 'me', name: 'Lia', companionName: 'Brasa', onboarded: true, look: { skin: 0, hair: 0, hairColor: 0, outfit: 0 }, studyProfile: 'Aprendo com exemplos.' } },
    { table: 'journeys', record: { ...rec, id: 'bd', title: 'Banco de Dados', status: 'active', order: 0, subject: true, chatUrl: 'https://chat.exemplo.test/c/link-privado' } },
    { table: 'journeys', record: { ...rec, id: 'calc', title: 'Cálculo I', status: 'active', order: 1, subject: true } },
    { table: 'subjectNotebooks', record: { ...rec, id: 'notebook-bd', journeyId: 'bd', plan: 'Ementa de BD', nextChat: 'Use exemplos de biblioteca.', bibliography: [{ title: 'Sistemas de Banco de Dados', kind: 'basica' }] } },
    { table: 'studyDocs', record: { ...rec, id: 'doc1', journeyId: 'bd', title: 'Normalização passo a passo', markdown: '# 1FN', source: 'ChatGPT' } },
    { table: 'studyDocs', record: { ...rec, id: 'doc2', journeyId: 'bd', title: 'Apagada', markdown: 'x', source: 'ChatGPT', deleted: true } },
    { table: 'decks', record: { ...rec, id: 'd1', name: 'BD', journeyId: 'bd', order: 0, archived: false } },
    { table: 'decks', record: { ...rec, id: 'd2', name: 'Inglês', order: 1, archived: false } },
    { table: 'notes', record: { ...rec, id: 'n1', deckId: 'd1', type: 'basic', front: 'O que é a 3FN?', back: 'Sem dependência transitiva.', draft: false } },
    { table: 'notes', record: { ...rec, id: 'n2', deckId: 'd1', type: 'basic', front: 'Rascunho que não sai', back: 'b', draft: true } },
    { table: 'notes', record: { ...rec, id: 'n3', deckId: 'd2', type: 'basic', front: 'Frente do baralho de inglês', back: 'b', draft: false } },
    { table: 'diaryEntries', record: { ...rec, id: 'di1', text: 'nada do diário sai daqui' } },
    { table: 'sleepLogs', record: { ...rec, id: 's1', night: '2026-10-02', quality: 2 } },
  ] as never);
  const call = (assist: FastifyInstance, token: string, name: string, args: unknown, id = 1) =>
    rpc(assist, token, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

  it('lists the reading tools as read-only, with their inputs', async () => {
    const { assist } = await setup();
    const { access_token } = await tokens(assist);
    const tools = (await rpc(assist, access_token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json().result.tools as { name: string; description: string; inputSchema: { required?: string[] }; annotations: { readOnlyHint: boolean } }[];
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.ler_disciplina!.inputSchema.required).toEqual(['disciplina']);
    expect(byName.ler_apostila!.inputSchema.required).toEqual(['id']);
    expect(byName.ler_disciplina!.annotations.readOnlyHint).toBe(true);
    expect(byName.ler_apostila!.annotations.readOnlyHint).toBe(true);
    expect(byName.ler_disciplina!.description).toMatch(/caderno/);
    expect(byName.ler_disciplina!.description).toMatch(/perfil de estudo/);
    expect(byName.ler_disciplina!.description).toMatch(/apostilas/);
    expect(byName.enviar_proposta!.description).toMatch(/caderno/);
    expect(byName.enviar_proposta!.description).toMatch(/perfil de estudo/);
    const init = (await rpc(assist, access_token, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json();
    expect(init.result.instructions).toMatch(/ler_disciplina/);
  });

  it('ler_disciplina brings the right subject; never drafts, decks outside the subjects, the diary or the chat link', async () => {
    const { assist, store } = await setup();
    seed(store);
    const { access_token } = await tokens(assist);
    const r = (await call(assist, access_token, 'ler_disciplina', { disciplina: 'banco de dados' })).json();
    expect(r.result.isError).toBeUndefined();
    const ctx = r.result.structuredContent;
    expect(ctx).toMatchObject({
      subject: 'Banco de Dados', studyProfile: 'Aprendo com exemplos.',
      notebook: { plan: 'Ementa de BD', studied: '', difficulties: '', nextChat: 'Use exemplos de biblioteca.', bibliography: [{ title: 'Sistemas de Banco de Dados', kind: 'basica' }] },
      docs: [{ id: 'doc1', title: 'Normalização passo a passo', chars: 5 }],
      cards: { total: 1, items: [{ type: 'basic', front: 'O que é a 3FN?', back: 'Sem dependência transitiva.' }] },
      otherSubjects: ['Cálculo I'],
    });
    const text = r.result.content[0].text as string;
    expect(JSON.parse(text)).toEqual(ctx);
    for (const secret of ['Rascunho que não sai', 'Frente do baralho de inglês', 'nada do diário', '2026-10-02', 'link-privado', 'Lia', 'Brasa']) {
      expect(text).not.toContain(secret);
    }
  });

  it('ler_disciplina and ler_apostila read only the tables of their views', async () => {
    const { assist, store } = await setup();
    seed(store);
    const { access_token } = await tokens(assist);
    const read: string[] = [];
    const list = store.list.bind(store);
    store.list = ((table: Parameters<typeof list>[0]) => { read.push(table); return list(table); }) as typeof store.list;
    await call(assist, access_token, 'ler_disciplina', { disciplina: 'Banco de Dados' });
    expect(new Set(read)).toEqual(new Set(['profile', 'settings', 'journeys', 'commitments', 'missions', 'subjectTopics', 'subjectNotebooks', 'studyDocs', 'decks', 'notes', 'studyFiles']));
    read.length = 0;
    await call(assist, access_token, 'ler_apostila', { id: 'doc1' });
    expect(new Set(read)).toEqual(new Set(['journeys', 'studyDocs']));
  });

  it('an unknown subject is an error with the list of subjects', async () => {
    const { assist, store } = await setup();
    seed(store);
    const { access_token } = await tokens(assist);
    const r = (await call(assist, access_token, 'ler_disciplina', { disciplina: 'Física I' })).json();
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toBe('Disciplina "Física I" não existe. As disciplinas do app são: Banco de Dados, Cálculo I.');
    expect(r.result.structuredContent).toEqual({ subjects: ['Banco de Dados', 'Cálculo I'] });
    const blank = (await call(assist, access_token, 'ler_disciplina', {}, 2)).json();
    expect(blank.result.isError).toBe(true);
    expect(blank.result.content[0].text).toBe('Informe o nome de uma disciplina: Banco de Dados, Cálculo I.');
  });

  it('ler_apostila gives the whole Markdown; an unknown or deleted id is an error', async () => {
    const { assist, store } = await setup();
    seed(store);
    const { access_token } = await tokens(assist);
    const ok = (await call(assist, access_token, 'ler_apostila', { id: 'doc1' })).json();
    expect(ok.result.structuredContent).toEqual({ id: 'doc1', title: 'Normalização passo a passo', subject: 'Banco de Dados', markdown: '# 1FN' });
    for (const id of ['doc2', 'nada']) {
      const bad = (await call(assist, access_token, 'ler_apostila', { id }, 2)).json();
      expect(bad.result.isError).toBe(true);
      expect(bad.result.content[0].text).toContain('não existe');
    }
  });

  it('ler_contexto says whether each subject has a notebook and how many apostilas, without their contents', async () => {
    const { assist, store } = await setup();
    seed(store);
    const { access_token } = await tokens(assist);
    // The apostilas are counted from id, subject and flag only: their Markdown is never read for the context.
    const read: string[] = [];
    const list = store.list.bind(store);
    store.list = ((table: Parameters<typeof list>[0]) => { read.push(table); return list(table); }) as typeof store.list;
    const ctx = (await call(assist, access_token, 'ler_contexto', {})).json();
    expect(read).toContain('subjectNotebooks');
    expect(read).not.toContain('studyDocs');
    expect(store.listFields('studyDocs', ['id', 'journeyId', 'deleted'])).toEqual(expect.arrayContaining([
      { id: 'doc1', journeyId: 'bd', deleted: false }, { id: 'doc2', journeyId: 'bd', deleted: true },
    ]));
    expect(ctx.result.structuredContent.subjects.map((s: { title: string; notebook: boolean; docs: number }) => [s.title, s.notebook, s.docs]))
      .toEqual([['Banco de Dados', true, 1], ['Cálculo I', false, 0]]);
    expect(ctx.result.content[0].text).not.toContain('Ementa de BD');
    expect(ctx.result.content[0].text).not.toContain('Aprendo com exemplos');
  });

  it('accepts a proposal with the notebook, the profile and an apostila of 40 thousand characters', async () => {
    const { assist, store } = await setup();
    seed(store);
    const { access_token } = await tokens(assist);
    const markdown = '# Normalização\nAção, função e relação: a decomposição sem perda. $x^2$\n'.repeat(700).slice(0, 40_000);
    const r = (await call(assist, access_token, 'enviar_proposta', {
      title: 'Aula de normalização', summary: 'O caderno atualizado e uma apostila.',
      studyProfile: { text: 'Aprendo com exemplos e exercícios curtos.' },
      study: [{
        subject: 'Banco de Dados',
        notebook: { plan: 'x'.repeat(8000), studied: 'Até a 3FN.', nextChat: 'Comece pela 4FN.', bibliography: [{ title: 'Sistemas de Banco de Dados', kind: 'basica', url: 'https://exemplo.test/livro' }] },
        docs: [{ title: 'Normalização passo a passo', markdown }],
      }],
    })).json();
    expect(r.result.isError).toBeUndefined();
    expect(r.result.structuredContent).toMatchObject({ items: 6 });
    const [p] = store.list<Proposal>('proposals');
    expect(p!.payload.study![0]!.docs![0]!.markdown).toHaveLength(40_000);
    expect(p!.payload.studyProfile).toEqual({ text: 'Aprendo com exemplos e exercícios curtos.' });
  });

  // A pt-BR apostila of 40 thousand characters is about 47 KB as JSON (accents take 2 bytes, line breaks are escaped).
  const ptDoc = 'Normalização é a técnica de organização das relações. Ação, função, lição! $x^2$\n'.repeat(1000).slice(0, 40_000);
  const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
  /** A valid proposal of exactly `target` bytes: five full apostilas and a sixth padded with ASCII. */
  const proposalOf = (target: number) => {
    const docs = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Parte ${i + 1}`, markdown: ptDoc }));
    const last = { title: 'Exercícios', markdown: 'a' };
    const args = { title: 'Apostilas', summary: 's', study: [{ subject: 'Banco de Dados', docs: docs(3) }, { subject: 'Cálculo I', docs: [...docs(2), last] }] };
    last.markdown = 'a'.repeat(1 + target - bytes(args));
    expect(last.markdown.length).toBeLessThanOrEqual(40_000);
    expect(bytes(args)).toBe(target);
    return args;
  };

  it('accepts a proposal between 64 KB and 256 KB, and one of exactly 256 KB', async () => {
    const { assist, store } = await setup();
    seed(store);
    const { access_token } = await tokens(assist);
    const mid = { title: 'Três apostilas', summary: 's', study: [{ subject: 'Banco de Dados', docs: [1, 2, 3].map((i) => ({ title: `Parte ${i}`, markdown: ptDoc })) }] };
    expect(bytes(mid)).toBeGreaterThan(64 * 1024);
    expect(bytes(mid)).toBeLessThan(256 * 1024);
    const r = (await call(assist, access_token, 'enviar_proposta', mid)).json();
    expect(r.result.isError).toBeUndefined();
    expect(r.result.structuredContent).toMatchObject({ items: 3 });
    const edge = (await call(assist, access_token, 'enviar_proposta', proposalOf(256 * 1024), 2)).json();
    expect(edge.result.isError).toBeUndefined();
    expect(edge.result.structuredContent).toMatchObject({ items: 6 });
    expect(store.list<Proposal>('proposals')).toHaveLength(2);
  });

  it('a proposal just over 256 KB gets a pt-BR answer the assistant can act on, and nothing is stored', async () => {
    const { assist, store } = await setup();
    seed(store);
    const { access_token } = await tokens(assist);
    const res = await call(assist, access_token, 'enviar_proposta', proposalOf(256 * 1024 + 1), 7);
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.id).toBe(7);
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toBe('A proposta não foi gravada. Corrija e envie de novo:\n- (proposta): A proposta passou de 256 KB. Mande as apostilas em propostas separadas.');
    expect(store.list<Proposal>('proposals')).toHaveLength(0);
  });

  it('a body over the MCP limit is still refused before parsing (413), with the same message', async () => {
    const { assist } = await setup();
    const { access_token } = await tokens(assist);
    const huge = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'enviar_proposta', arguments: { title: 't', summary: 'x'.repeat(MCP_BODY_BYTES) } } };
    const res = await rpc(assist, access_token, huge);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'A proposta passou de 256 KB. Mande as apostilas em propostas separadas.' } });
    // Other routes keep the default errors and the 256 KB limit.
    const reg = await assist.inject({ method: 'POST', url: '/oauth/register', headers: { 'content-type': 'application/json' }, payload: '{"client_name":' });
    expect(reg.statusCode).toBe(400);
    const big = await assist.inject({ method: 'POST', url: '/oauth/register', payload: { client_name: 'x'.repeat(256 * 1024) } });
    expect(big.statusCode).toBe(413);
    expect(big.json().code).toBe('FST_ERR_CTP_BODY_TOO_LARGE');
  });

  it('the consent page says the assistant reads the study of the subjects', async () => {
    const { assist } = await setup();
    const reg = (await assist.inject({ method: 'POST', url: '/oauth/register', payload: { client_name: 'x', redirect_uris: [REDIRECT] } })).json();
    const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' });
    const page = await assist.inject({ url: `/oauth/authorize?${q}` });
    expect(page.body).toContain('ler o estudo das disciplinas');
    expect(page.body).toContain('perfil de estudo');
    expect(page.body).toContain('nunca lê diário, sono, nutrição, check-ins, energia, estratégias, baralhos ou PDFs fora das disciplinas');
    expect(page.body).toContain('o texto dos PDFs das disciplinas');
  });
});

describe('PDFs da aula: ler_material (spec 2026-11-26 fase 2 §3)', () => {
  const rec = { createdAt: 1, updatedAt: 1, deleted: false };
  const dirs: string[] = [];
  afterEach(() => { vi.restoreAllMocks(); while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });
  const mediaDir = () => { const d = mkdtempSync(join(tmpdir(), 'liferpg-assist-')); dirs.push(d); return new MediaStore(join(d, 'media')); };
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  /** Stores the extracted text of `pages` in the media folder; returns its hash. */
  const putText = (media: MediaStore, pages: string[]) => {
    const { bytes } = encodePdfText(pages);
    expect(media.put(sha(bytes), bytes)).toBe('created');
    return sha(bytes);
  };
  const pdf = (id: string, p: Record<string, unknown>) => ({
    table: 'studyFiles', record: { ...rec, id, title: `PDF ${id}`, fileHash: 'a'.repeat(64), bytes: 9000, pages: 3, hasText: true, textChars: 30, ...p },
  });
  const call = (assist: FastifyInstance, token: string, args: unknown, id = 1) =>
    rpc(assist, token, { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'ler_material', arguments: args } });

  async function ready() {
    const media = mediaDir();
    const env = await setup({ media });
    const slides = putText(media, ['Modelo relacional', 'Chaves e 1FN', 'Dependências e 3FN']);
    const book = putText(media, ['a'.repeat(25_000), 'b'.repeat(25_000), 'c'.repeat(100)]);
    const secret = putText(media, ['extrato bancário secreto']);
    env.store.apply([
      { table: 'journeys', record: { ...rec, id: 'bd', title: 'Banco de Dados', status: 'active', order: 0, subject: true } },
      { table: 'journeys', record: { ...rec, id: 'proj', title: 'Projeto pessoal', status: 'active', order: 1 } },
      pdf('slides', { journeyId: 'bd', title: 'Slides da aula 3', textHash: slides }),
      pdf('book', { journeyId: 'bd', title: 'Capítulo 14', textHash: book }),
      pdf('scan', { journeyId: 'bd', title: 'Lista escaneada', hasText: false }),
      pdf('later', { journeyId: 'bd', title: 'Texto ainda no celular', textHash: 'c'.repeat(64) }),
      pdf('loose', { title: 'Extrato', textHash: secret }),
      pdf('plain', { journeyId: 'proj', title: 'De jornada comum', textHash: secret }),
      pdf('gone', { journeyId: 'bd', title: 'Apagado', textHash: slides, deleted: true }),
    ] as never);
    const { access_token } = await tokens(env.assist);
    return { ...env, media, token: access_token };
  }

  it('is a read-only tool with an id and an optional page range', async () => {
    const { assist, token } = await ready();
    const tools = (await rpc(assist, token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json().result.tools as {
      name: string; description: string; inputSchema: { required?: string[]; properties: Record<string, unknown> }; annotations: { readOnlyHint: boolean };
    }[];
    const t = tools.find((x) => x.name === 'ler_material')!;
    expect(t.inputSchema.required).toEqual(['id']);
    expect(Object.keys(t.inputSchema.properties)).toEqual(['id', 'fromPage', 'toPage']);
    expect(t.annotations.readOnlyHint).toBe(true);
    expect(t.description).toMatch(/40\.000 caracteres/);
    expect(t.description).toMatch(/nextPage/);
    expect(tools.find((x) => x.name === 'ler_disciplina')!.description).toMatch(/ler_material/);
  });

  it("ler_disciplina lists the subject's PDFs in files; ler_material reads a range with page numbers", async () => {
    const { assist, token } = await ready();
    const subj = (await rpc(assist, token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ler_disciplina', arguments: { disciplina: 'Banco de Dados' } } })).json();
    expect(subj.result.structuredContent.files.map((f: { id: string }) => f.id)).toEqual(['book', 'scan', 'slides', 'later']);
    expect(subj.result.content[0].text).not.toContain('Extrato');
    const all = (await call(assist, token, { id: 'slides' })).json();
    expect(all.result.isError).toBeUndefined();
    expect(all.result.structuredContent).toEqual({
      id: 'slides', title: 'Slides da aula 3', subject: 'Banco de Dados', pages: 3, fromPage: 1, toPage: 3,
      text: [{ page: 1, text: 'Modelo relacional' }, { page: 2, text: 'Chaves e 1FN' }, { page: 3, text: 'Dependências e 3FN' }],
    });
    expect(JSON.parse(all.result.content[0].text)).toEqual(all.result.structuredContent);
    const some = (await call(assist, token, { id: 'slides', fromPage: 2, toPage: 3 }, 2)).json();
    expect(some.result.structuredContent.text.map((p: { page: number }) => p.page)).toEqual([2, 3]);
  });

  it('cuts at 40 thousand characters at the last whole page, with nextPage', async () => {
    const { assist, token } = await ready();
    const first = (await call(assist, token, { id: 'book' })).json().result.structuredContent;
    expect([first.fromPage, first.toPage, first.nextPage]).toEqual([1, 1, 2]);
    const next = (await call(assist, token, { id: 'book', fromPage: first.nextPage }, 2)).json().result.structuredContent;
    expect([next.fromPage, next.toPage, next.nextPage]).toEqual([2, 3, undefined]);
  });

  it('errors in pt-BR: no text, text not on the PC yet, page out of range, unknown id', async () => {
    const { assist, token } = await ready();
    const text = async (args: unknown) => {
      const r = (await call(assist, token, args)).json();
      expect(r.result.isError).toBe(true);
      return r.result.content[0].text as string;
    };
    expect(await text({ id: 'scan' })).toBe('Este PDF não tem texto: é uma imagem escaneada.');
    expect(await text({ id: 'later' })).toBe('O texto deste PDF ainda não chegou ao PC. Abra o app no aparelho onde o PDF foi adicionado, com o PC ligado.');
    expect(await text({ id: 'slides', fromPage: 4 })).toMatch(/^Página fora do intervalo: o PDF tem 3 páginas/);
    expect(await text({ id: 'nada' })).toBe('PDF "nada" não existe. Use o id que ler_disciplina mostra em files.');
    expect(await text({ id: 'gone' })).toContain('não existe');
  });

  it('privacy: a "Sem disciplina" PDF or one of a plain journey answers as if it did not exist, and its text is never read', async () => {
    const { assist, token, media } = await ready();
    const get = vi.spyOn(media, 'get');
    for (const id of ['loose', 'plain']) {
      const r = (await call(assist, token, { id })).json();
      expect(r.result.isError).toBe(true);
      expect(r.result.content[0].text).toBe(`PDF "${id}" não existe. Use o id que ler_disciplina mostra em files.`);
    }
    expect(get).not.toHaveBeenCalled();
  });

  it('only PDFs of active subjects: once the subject is archived its PDFs answer as if they did not exist, like ler_disciplina', async () => {
    const { assist, store, token, media } = await ready();
    expect((await call(assist, token, { id: 'slides' })).json().result.isError).toBeUndefined();
    store.apply([
      { table: 'journeys', record: { ...rec, updatedAt: 2, id: 'bd', title: 'Banco de Dados', status: 'archived', order: 0, subject: true } },
    ] as never);
    const get = vi.spyOn(media, 'get');
    const r = (await call(assist, token, { id: 'slides' }, 2)).json();
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toBe('PDF "slides" não existe. Use o id que ler_disciplina mostra em files.');
    expect(get).not.toHaveBeenCalled();
  });

  it('reads only journeys and studyFiles; a server without a media folder says the text has not arrived', async () => {
    const { assist, store, token } = await ready();
    const read: string[] = [];
    const list = store.list.bind(store);
    store.list = ((table: Parameters<typeof list>[0]) => { read.push(table); return list(table); }) as typeof store.list;
    await call(assist, token, { id: 'slides' });
    expect(new Set(read)).toEqual(new Set(['journeys', 'studyFiles']));

    const bare = await setup();
    bare.store.apply([
      { table: 'journeys', record: { ...rec, id: 'bd', title: 'Banco de Dados', status: 'active', order: 0, subject: true } },
      pdf('slides', { journeyId: 'bd', textHash: 'd'.repeat(64) }),
    ] as never);
    const { access_token } = await tokens(bare.assist);
    const r = (await call(bare.assist, access_token, { id: 'slides' })).json();
    expect(r.result.content[0].text).toMatch(/ainda não chegou ao PC/);
  });
});
