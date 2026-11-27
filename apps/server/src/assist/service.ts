import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ASSIST_CONTEXT_TABLES, ASSIST_LIMITS, ASSIST_STUDY_DOC_FIELDS, MATERIAL_TABLES, PDF_TEXT_TYPE, STUDY_DOC_TABLES, SUBJECT_CONTEXT_TABLES,
  buildAssistContext, buildMaterialView, buildStudyDocView, buildSubjectContext, dayKeyOf, parsePdfText, proposalItems, proposalNamesOf, ulid,
  validateProposal,
  type AssistContext, type AssistTables, type Journey, type MaterialResult, type PdfText, type Proposal, type ProposalIssue, type Settings,
  type StudyDocResult, type StudyFile, type SubjectContextResult, type SubjectTables, type SyncChange, type SyncTable,
} from '@life/shared';
import type { Hub } from '../hub';
import type { MediaStore } from '../media';
import type { RecordStore } from '../store';

// Assistentes pelo MCP (spec 2026-11-25): the state behind the assistant port — on/off and the public address, the
// OAuth clients, codes and grants (only hashes of keys are stored), the limits, the context and the proposals.
// Tables live in the server's own SQLite file, outside the synced records.

export const SCOPES = ['contexto:ler', 'propostas:enviar'] as const;
export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CODE_TTL_MS = 60 * 1000;
export const UNAUTHORIZED_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;
export const CONSENT_TTL_MS = 10 * 60 * 1000;
/** What an assistant reads when its proposal is over `ASSIST_LIMITS.bodyBytes` (256 KB): what to do instead. */
export const PROPOSAL_TOO_BIG = `A proposta passou de ${ASSIST_LIMITS.bodyBytes / 1024} KB. Mande as apostilas em propostas separadas.`;
export const ATTEMPTS_PER_MINUTE = 5;
export const FAILURES_BEFORE_LOCK = 20;
export const LOCK_MS = 60 * 60 * 1000;
export const REGISTRATIONS_PER_HOUR = 10;
export const PENDING_CLIENTS_MAX = 20;

export const hashKey = (s: string): string => createHash('sha256').update(s).digest('hex');
const newKey = (prefix: string): string => `${prefix}_${randomBytes(32).toString('base64url')}`;

export function safeEqual(given: string | undefined, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface AssistClient { id: string; name: string; redirectUris: string[]; createdAt: number; authorized: boolean }
export interface AssistGrant { id: string; clientId: string; clientName: string; createdAt: number; lastUsedAt?: number }
export interface TokenPair { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string }
export type TokenError = 'invalid_grant' | 'invalid_client' | 'invalid_request';

/** A sliding window of timestamps (limits kept in memory: a restart clears them, which only loosens them briefly). */
class Window {
  private hits: number[] = [];
  constructor(private ms: number) {}
  count(now: number): number { this.hits = this.hits.filter((t) => t > now - this.ms); return this.hits.length; }
  add(now: number): void { this.hits.push(now); }
}

export class AssistService {
  private calls = new Map<string, Window>();
  private attempts = new Window(60_000);
  private failures = new Window(LOCK_MS);
  private registrations = new Window(60 * 60 * 1000);

  /**
   * `media`: the media folder, where `ler_material` reads a PDF's extracted text (PDFs da aula 2026-11-26 §3.3). Absent:
   * every text answers that it has not reached the PC yet.
   */
  constructor(
    private store: RecordStore, private hub: Hub, private accessToken: string, private now: () => number = Date.now,
    private media?: MediaStore,
  ) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS assist_clients (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, created_at INTEGER NOT NULL, authorized INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS assist_codes (
        hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, challenge TEXT NOT NULL, redirect_uri TEXT NOT NULL,
        scope TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assist_grants (
        id TEXT PRIMARY KEY, client_id TEXT NOT NULL, access_hash TEXT NOT NULL, access_expires INTEGER NOT NULL,
        refresh_hash TEXT NOT NULL, refresh_expires INTEGER NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER,
        revoked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS assist_grants_access ON assist_grants(access_hash);
      CREATE INDEX IF NOT EXISTS assist_grants_refresh ON assist_grants(refresh_hash);
      CREATE TABLE IF NOT EXISTS assist_old_refresh (hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL);
    `);
  }

  // ---------------------------------------------------------------- on/off and the public address

  get enabled(): boolean { return this.store.getMeta('assist.enabled') === '1'; }
  get publicUrl(): string | undefined { return this.store.getMeta('assist.publicUrl') || undefined; }
  /** On, with an address: the only state in which the assistant port answers. */
  get ready(): boolean { return this.enabled && this.publicUrl !== undefined; }
  get resource(): string { return `${this.publicUrl}/mcp`; }

  lockedUntil(): number | undefined {
    const v = Number(this.store.getMeta('assist.lockedUntil'));
    return Number.isFinite(v) && v > this.now() ? v : undefined;
  }

  /** Ajustes: turns the feature on or off; off revokes every grant. Returns an error sentence when refused. */
  configure(enabled: boolean, publicUrl?: string): string | undefined {
    if (publicUrl !== undefined) {
      const url = publicUrl.trim().replace(/\/+$/, '');
      let ok = false;
      try { const u = new URL(url); ok = u.protocol === 'https:' && u.pathname === '/' && !u.search && !u.hash; } catch { ok = false; }
      if (url !== '' && !ok) return 'O endereço precisa começar com https:// e não ter caminho (por exemplo, o que o Tailscale Funnel mostrou).';
      this.store.setMeta('assist.publicUrl', url);
    }
    if (enabled && !this.publicUrl) return 'Cole o endereço público antes de ligar.';
    this.store.setMeta('assist.enabled', enabled ? '1' : '0');
    if (!enabled) this.revokeAll();
    return undefined;
  }

  status() {
    return { enabled: this.enabled, publicUrl: this.publicUrl ?? '', locked: this.lockedUntil() !== undefined, clients: this.connected() };
  }

  private secret(): string {
    let s = this.store.getMeta('assist.secret');
    if (!s) { s = randomBytes(32).toString('hex'); this.store.setMeta('assist.secret', s); }
    return s;
  }

  // ---------------------------------------------------------------- clients (RFC 7591)

  /** Registers a public client; undefined + reason when refused. */
  register(name: unknown, redirectUris: unknown): { client?: AssistClient; error?: string } {
    const now = this.now();
    this.db.prepare('DELETE FROM assist_clients WHERE authorized = 0 AND created_at < ?').run(now - UNAUTHORIZED_CLIENT_TTL_MS);
    if (this.registrations.count(now) >= REGISTRATIONS_PER_HOUR) return { error: 'Muitos registros na última hora.' };
    const pending = (this.db.prepare('SELECT COUNT(*) AS n FROM assist_clients WHERE authorized = 0').get() as { n: number }).n;
    if (pending >= PENDING_CLIENTS_MAX) return { error: 'Muitos clientes sem autorização.' };
    const uris = Array.isArray(redirectUris) ? redirectUris : [];
    if (uris.length < 1 || uris.length > 5 || !uris.every(isAllowedRedirect)) {
      return { error: 'redirect_uris: de 1 a 5 endereços https:// (ou http://localhost).' };
    }
    const clean = typeof name === 'string' && name.trim() ? name.trim().replace(/[\u0000-\u001f]/g, '').slice(0, 60) : 'Assistente';
    const client: AssistClient = { id: `lrc_${randomBytes(16).toString('base64url')}`, name: clean, redirectUris: uris as string[], createdAt: now, authorized: false };
    this.db.prepare('INSERT INTO assist_clients (id, name, redirect_uris, created_at, authorized) VALUES (?, ?, ?, ?, 0)')
      .run(client.id, client.name, JSON.stringify(client.redirectUris), now);
    this.registrations.add(now);
    return { client };
  }

  client(id: unknown): AssistClient | undefined {
    if (typeof id !== 'string') return undefined;
    const r = this.db.prepare('SELECT id, name, redirect_uris, created_at, authorized FROM assist_clients WHERE id = ?').get(id) as
      { id: string; name: string; redirect_uris: string; created_at: number; authorized: number } | undefined;
    return r ? { id: r.id, name: r.name, redirectUris: JSON.parse(r.redirect_uris) as string[], createdAt: r.created_at, authorized: r.authorized === 1 } : undefined;
  }

  // ---------------------------------------------------------------- consent form token (anti-forgery)

  consentToken(fields: string[]): string {
    const exp = this.now() + CONSENT_TTL_MS;
    const mac = createHmac('sha256', this.secret()).update([...fields, String(exp)].join('\n')).digest('base64url');
    return `${exp}.${mac}`;
  }

  checkConsentToken(token: unknown, fields: string[]): boolean {
    if (typeof token !== 'string') return false;
    const [exp, mac] = token.split('.');
    if (!exp || !mac || Number(exp) < this.now()) return false;
    const want = createHmac('sha256', this.secret()).update([...fields, exp].join('\n')).digest('base64url');
    return safeEqual(mac, want);
  }

  // ---------------------------------------------------------------- the access code on the consent page

  /** 'ok' | 'wrong' | 'slow-down' | 'locked'. Counts globally: every request arrives through the local proxy. */
  checkAccessCode(given: unknown): 'ok' | 'wrong' | 'slow-down' | 'locked' {
    const now = this.now();
    if (this.lockedUntil()) return 'locked';
    if (this.attempts.count(now) >= ATTEMPTS_PER_MINUTE) return 'slow-down';
    this.attempts.add(now);
    if (typeof given === 'string' && safeEqual(given.trim(), this.accessToken)) return 'ok';
    this.failures.add(now);
    if (this.failures.count(now) >= FAILURES_BEFORE_LOCK) this.store.setMeta('assist.lockedUntil', String(now + LOCK_MS));
    return 'wrong';
  }

  issueCode(clientId: string, challenge: string, redirectUri: string, scope: string): string {
    const code = newKey('lrk');
    this.db.prepare('INSERT INTO assist_codes (hash, client_id, challenge, redirect_uri, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(hashKey(code), clientId, challenge, redirectUri, scope, this.now() + CODE_TTL_MS);
    return code;
  }

  // ---------------------------------------------------------------- tokens

  /** authorization_code grant (PKCE S256 checked). Codes are single use. */
  exchangeCode(code: unknown, verifier: unknown, clientId: unknown, redirectUri: unknown): TokenPair | TokenError {
    if (typeof code !== 'string' || typeof verifier !== 'string' || typeof clientId !== 'string') return 'invalid_request';
    const h = hashKey(code);
    const row = this.db.prepare('SELECT client_id, challenge, redirect_uri, scope, expires_at FROM assist_codes WHERE hash = ?').get(h) as
      { client_id: string; challenge: string; redirect_uri: string; scope: string; expires_at: number } | undefined;
    this.db.prepare('DELETE FROM assist_codes WHERE hash = ? OR expires_at < ?').run(h, this.now());
    if (!row || row.expires_at < this.now() || row.client_id !== clientId) return 'invalid_grant';
    if (redirectUri !== undefined && redirectUri !== row.redirect_uri) return 'invalid_grant';
    const computed = createHash('sha256').update(verifier).digest('base64url');
    if (!safeEqual(computed, row.challenge)) return 'invalid_grant';
    this.db.prepare('UPDATE assist_clients SET authorized = 1 WHERE id = ?').run(clientId);
    return this.newGrant(clientId, row.scope);
  }

  /** refresh_token grant: rotates both keys; reusing an old refresh key revokes the whole grant. */
  refresh(refreshToken: unknown, clientId: unknown): TokenPair | TokenError {
    if (typeof refreshToken !== 'string') return 'invalid_request';
    const h = hashKey(refreshToken);
    const old = this.db.prepare('SELECT grant_id FROM assist_old_refresh WHERE hash = ?').get(h) as { grant_id: string } | undefined;
    if (old) { this.revokeGrant(old.grant_id); return 'invalid_grant'; }
    const g = this.db.prepare('SELECT id, client_id, refresh_expires, revoked_at FROM assist_grants WHERE refresh_hash = ?').get(h) as
      { id: string; client_id: string; refresh_expires: number; revoked_at: number | null } | undefined;
    if (!g || g.revoked_at !== null || g.refresh_expires < this.now()) return 'invalid_grant';
    if (typeof clientId === 'string' && clientId !== g.client_id) return 'invalid_grant';
    const access = newKey('lra');
    const next = newKey('lrr');
    this.db.prepare('INSERT OR IGNORE INTO assist_old_refresh (hash, grant_id) VALUES (?, ?)').run(h, g.id);
    this.db.prepare('UPDATE assist_grants SET access_hash = ?, access_expires = ?, refresh_hash = ?, refresh_expires = ? WHERE id = ?')
      .run(hashKey(access), this.now() + ACCESS_TTL_MS, hashKey(next), this.now() + REFRESH_TTL_MS, g.id);
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: next, scope: SCOPES.join(' ') };
  }

  private newGrant(clientId: string, scope: string): TokenPair {
    const access = newKey('lra');
    const refresh = newKey('lrr');
    const now = this.now();
    this.db.prepare(`INSERT INTO assist_grants (id, client_id, access_hash, access_expires, refresh_hash, refresh_expires, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(`lrg_${randomBytes(12).toString('base64url')}`, clientId, hashKey(access), now + ACCESS_TTL_MS, hashKey(refresh), now + REFRESH_TTL_MS, now);
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope };
  }

  /** The grant behind a bearer key, if valid now (touches its last use). */
  grantFor(bearer: string | undefined): AssistGrant | undefined {
    if (!bearer) return undefined;
    const g = this.db.prepare(`SELECT g.id, g.client_id, g.created_at, g.last_used_at, g.access_expires, g.revoked_at, c.name
      FROM assist_grants g JOIN assist_clients c ON c.id = g.client_id WHERE g.access_hash = ?`).get(hashKey(bearer)) as
      { id: string; client_id: string; created_at: number; last_used_at: number | null; access_expires: number; revoked_at: number | null; name: string } | undefined;
    if (!g || g.revoked_at !== null || g.access_expires < this.now()) return undefined;
    this.db.prepare('UPDATE assist_grants SET last_used_at = ? WHERE id = ?').run(this.now(), g.id);
    return { id: g.id, clientId: g.client_id, clientName: g.name, createdAt: g.created_at, lastUsedAt: this.now() };
  }

  /** "Assistentes conectados": one line per client with a live grant. */
  connected(): { id: string; name: string; connectedAt: number; lastUsedAt?: number }[] {
    const rows = this.db.prepare(`SELECT c.id, c.name, MIN(g.created_at) AS connected_at, MAX(g.last_used_at) AS last_used_at
      FROM assist_grants g JOIN assist_clients c ON c.id = g.client_id WHERE g.revoked_at IS NULL AND g.refresh_expires > ?
      GROUP BY c.id ORDER BY connected_at`).all(this.now()) as unknown as { id: string; name: string; connected_at: number; last_used_at: number | null }[];
    return rows.map((r) => ({ id: r.id, name: r.name, connectedAt: r.connected_at, ...(r.last_used_at ? { lastUsedAt: r.last_used_at } : {}) }));
  }

  revokeClient(clientId: string): boolean {
    const n = this.db.prepare('UPDATE assist_grants SET revoked_at = ? WHERE client_id = ? AND revoked_at IS NULL').run(this.now(), clientId).changes;
    this.db.prepare('DELETE FROM assist_clients WHERE id = ?').run(clientId);
    return Number(n) > 0;
  }

  private revokeGrant(id: string): void {
    this.db.prepare('UPDATE assist_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(this.now(), id);
  }

  private revokeAll(): void {
    this.db.prepare('UPDATE assist_grants SET revoked_at = ? WHERE revoked_at IS NULL').run(this.now());
  }

  // ---------------------------------------------------------------- limits of the tools

  /** False when the grant already made `callsPerHour` calls in the last hour. */
  allowCall(grantId: string): boolean {
    const now = this.now();
    const w = this.calls.get(grantId) ?? new Window(60 * 60 * 1000);
    this.calls.set(grantId, w);
    if (w.count(now) >= ASSIST_LIMITS.callsPerHour) return false;
    w.add(now);
    return true;
  }

  // ---------------------------------------------------------------- context and proposals

  /** Only the named tables: each tool reads just what its view needs. */
  private read<T>(names: readonly SyncTable[]): T {
    return Object.fromEntries(names.map((t) => [t, this.store.list(t)])) as T;
  }

  /** The context tables; the apostilas only as id, subject and flag (they are counted, their Markdown is never read). */
  private tables(): AssistTables {
    const t = this.read<AssistTables>(ASSIST_CONTEXT_TABLES.filter((name) => name !== 'studyDocs'));
    return { ...t, studyDocs: this.store.listFields('studyDocs', ASSIST_STUDY_DOC_FIELDS) };
  }

  private today(tables: { settings?: Settings[] }): string {
    const settings = (tables.settings ?? []).find((s) => !s.deleted) as Settings | undefined;
    return dayKeyOf(this.now(), settings?.dayStartHour ?? 4);
  }

  context(): AssistContext {
    const t = this.tables();
    return buildAssistContext(t, this.today(t));
  }

  /** `ler_disciplina`: the subject's study and the study profile (SUBJECT_CONTEXT_TABLES only). */
  subjectContext(name: unknown): SubjectContextResult {
    const t = this.read<SubjectTables>(SUBJECT_CONTEXT_TABLES);
    return buildSubjectContext(t, typeof name === 'string' ? name : '', this.today(t));
  }

  /** `ler_apostila`: one apostila (STUDY_DOC_TABLES only). */
  studyDoc(id: unknown): StudyDocResult {
    return buildStudyDocView(this.read<SubjectTables>(STUDY_DOC_TABLES), typeof id === 'string' ? id : '');
  }

  /**
   * `ler_material`: the text of a range of pages of a PDF linked to a subject (MATERIAL_TABLES only). The text is read
   * from the media folder by its hash; PDF.js never runs here.
   */
  material(input: unknown): MaterialResult {
    const args = (typeof input === 'object' && input !== null ? input : {}) as { id?: unknown; fromPage?: unknown; toPage?: unknown };
    const t = this.read<{ journeys: Journey[]; studyFiles: StudyFile[] }>(MATERIAL_TABLES);
    return buildMaterialView(t, args, (hash) => this.readText(hash));
  }

  private readText(hash: string): PdfText | undefined {
    const file = this.media?.get(hash);
    return file && file.type === PDF_TEXT_TYPE ? parsePdfText(file.body) : undefined;
  }

  /** Validates and stores a proposal from `grant`'s client; the oldest pending beyond the limit becomes 'replaced'. */
  propose(grant: AssistGrant, input: unknown): { id?: string; items?: number; issues?: ProposalIssue[]; limited?: true } {
    // The limit is on the proposal itself (the MCP body may be bigger, see http.ts), so the assistant learns what to do.
    if (Buffer.byteLength(JSON.stringify(input ?? null)) > ASSIST_LIMITS.bodyBytes) return { issues: [{ path: '', message: PROPOSAL_TOO_BIG }] };
    const t = this.tables();
    const today = this.today(t);
    const { payload, issues } = validateProposal(input, proposalNamesOf(t), today);
    if (!payload) return { issues };
    const all = (t.proposals ?? []).filter((p) => !p.deleted);
    const startOfDay = this.now() - 24 * 60 * 60 * 1000;
    if (all.filter((p) => p.clientId === grant.clientId && p.createdAt > startOfDay).length >= ASSIST_LIMITS.proposalsPerDay) {
      return { limited: true };
    }
    const now = this.now();
    const record: Proposal = {
      id: ulid(now), createdAt: now, updatedAt: now, deleted: false, source: grant.clientName, clientId: grant.clientId, payload, status: 'pending',
    };
    const pending = all.filter((p) => p.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
    const replaced = pending.slice(0, Math.max(0, pending.length - (ASSIST_LIMITS.pendingMax - 1)))
      .map((p) => ({ table: 'proposals' as const, record: { ...p, status: 'replaced' as const, updatedAt: now } }));
    const changes = [...replaced, { table: 'proposals' as const, record }] as unknown as SyncChange[];
    const { accepted, rev } = this.store.apply(changes);
    if (accepted > 0) this.hub.publish(rev);
    return { id: record.id, items: proposalItems(payload).length };
  }

  private get db() { return this.store.db; }
}

/** https:// anywhere, or http:// on this machine (a local client). */
export function isAllowedRedirect(u: unknown): boolean {
  if (typeof u !== 'string' || u.length > 500) return false;
  try {
    const url = new URL(u);
    if (url.hash) return false;
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
}
