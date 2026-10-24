// Private account associations and agent approval storage. Identity and actual
// body readiness are verified by the caller; this module never creates bodies.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db.ts';

/** Adapter must use tracked BEGIN IMMEDIATE for an outer transaction and shared
 * nested savepoints, so the allocation journal and after-commit pump participate. */
export type AccountsDb = Pick<Db, 'db'> & { tx<T>(operation: () => T): T };
/** Only construct this from server-verified provider identity, never request JSON. */
export type AccountIdentity = { id: string; issuer: string; subject: string; verifiedEmail?: string; verifiedAt: number; expiresAt: number };
export type ApprovalStatus = 'pending' | 'creating' | 'ready' | 'refused' | 'cancelled' | 'expired';
/** `inWindow`: lane PUX, the request was addressed (with a window code) to one account, whose open world window shows it. */
export type ApprovalDTO = { id: string; worldId: string; agentLabel: string; name: string; description: string; mode: 'create' | 'repair'; status: ApprovalStatus; soulId: string | null; createdAt: number; expiresAt: number; inWindow: boolean; reason?: { code: 'arrival-unavailable'; message: string } };
/** Lane PB: 'refused' only ever follows an approval whose Soul then could not arrive; say so, for the person and the agent. */
export const ARRIVAL_REFUSAL = { code: 'arrival-unavailable', message: 'Approved, but the Soul could not arrive: there is no clear ground for it to stand on in this world. Nothing was created. The world\'s god can clear some ground; then ask your agent to try again.' } as const;
/** `forCode`: a window code the human's signed-in page gave them for their agent (lane PUX); never part of the request's identity. */
export type StartApprovalInput = { agentLabel: string; name: string; description?: string; idempotencyKey: string; pollSecret?: string; forCode?: string };
/** Lane PUX: a short code a signed-in page shows its person, for their agent's request to reach that page. */
export const WINDOW_CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', CODE_TTL_MS = 24 * 60 * 60_000;
export type AllocationInput = { approvalId: string; worldId: string; accountId: string; requestId: string; requestNonce: string; name: string; description: string; mode: 'create' | 'repair'; soulId: string | null };
export type Allocation = { worldId: string; accountId: string; requestId: string; soulId: string };
/** Trusted actual lifecycle/body projection, never an agent or browser assertion.
 * legacy-ready is only a repair of an existing body, not a synthetic birth fact. */
export type LifecycleProjection = Allocation & { lifecycleState: 'pending' | 'recorded' | 'complete' | 'refused' | 'legacy-ready'; ready: boolean };
export type SoulMembership = { worldId: string; soulId: string; accountId: string; attribution: string; evidenceHash: string; createdAt: number };
export type DelegatedGrant = { id: string; worldId: string; soulId: string; accountId: string; approvalId: string; requestId: string; createdAt: number; /** SOUL3: the token's first issue (its first ready poll); createdAt for older grants. */ issuedAt: number };
export class AccountStoreError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'AccountStoreError'; this.code = code; }
}

type ApprovalRow = {
  id: string; world_id: string; agent_label: string; name: string; description: string;
  mode: 'create' | 'repair'; status: ApprovalStatus; repair_soul_id: string | null;
  account_id: string | null; soul_id: string | null; request_id: string | null;
  request_nonce: string; poll_hash: string; client_poll_secret: number; input_hash: string; created_at: number; expires_at: number;
  target_account_id: string | null;
};
type GrantRow = { id: string; world_id: string; soul_id: string; account_id: string; approval_id: string; request_id: string; nonce: string; token_hash: string | null; created_at: number; revoked_at: number | null; token_issued_at?: number | null; revoked_reason?: string | null };
type MemberRow = { world_id: string; soul_id: string; account_id: string; attribution: string; evidence_hash: string; created_at: number; current_grant_id: string | null };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const nonce = (prefix: string) => prefix + randomBytes(16).toString('hex');
function fail(code: string, message: string): never { throw new AccountStoreError(code, message); }
function text(value: unknown, field: string, min = 1, max = 128): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || value.includes('\0')) fail('invalid', `Invalid ${field}`);
  return value as string;
}
function validPollSecret(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{43}$/.test(raw) && Buffer.from(raw, 'base64url').toString('base64url') === raw;
}
function hashMatches(raw: unknown, hash: string): boolean {
  if (!validPollSecret(raw) || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(sha(raw), 'hex'), Buffer.from(hash, 'hex'));
}
function sync<T>(value: T): T {
  if (value && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function') fail('async-callback', 'Allocation must be synchronous');
  return value;
}

export class AccountStore {
  readonly db: AccountsDb;
  readonly worldId: string;
  private now: () => number;
  private approvalTtlMs: number;
  private nameTaken: (name: string) => boolean;
  constructor(db: AccountsDb, worldId: string, options: { now?: () => number; approvalTtlMs?: number; nameTaken?: (name: string) => boolean } = {}) {
    this.db = db;
    this.nameTaken = options.nameTaken ?? (() => false);
    this.worldId = text(worldId, 'worldId');
    this.now = options.now ?? Date.now;
    this.approvalTtlMs = options.approvalTtlMs ?? 15 * 60_000;
    if (!Number.isSafeInteger(this.approvalTtlMs) || this.approvalTtlMs < 1 || this.approvalTtlMs > 24 * 60 * 60_000) fail('invalid', 'Invalid approval lifetime');
    // Independent private tables. No historical Soul ownership rewrites or
    // foreign-key assumptions about pending, refused, or legacy birth rows.
    this.db.tx(() => this.db.db.exec(`
      CREATE TABLE IF NOT EXISTS account_identities_v1 (
        account_id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
        verified_at INTEGER NOT NULL, UNIQUE(issuer,subject)
      );
      CREATE TABLE IF NOT EXISTS account_soul_memberships_v1 (
        world_id TEXT NOT NULL, soul_id TEXT NOT NULL, account_id TEXT NOT NULL,
        attribution TEXT NOT NULL, evidence_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
        current_grant_id TEXT, PRIMARY KEY(world_id,soul_id)
      );
      CREATE INDEX IF NOT EXISTS account_soul_memberships_owner_v1 ON account_soul_memberships_v1(world_id,account_id);
      CREATE TABLE IF NOT EXISTS account_approvals_v1 (
        id TEXT PRIMARY KEY, world_id TEXT NOT NULL, agent_label TEXT NOT NULL,
        name TEXT NOT NULL, description TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('create','repair')),
        status TEXT NOT NULL CHECK(status IN ('pending','creating','ready','refused','cancelled','expired')),
        repair_soul_id TEXT, account_id TEXT, soul_id TEXT, request_id TEXT,
        request_nonce TEXT NOT NULL, poll_hash TEXT NOT NULL, client_poll_secret INTEGER NOT NULL DEFAULT 0, input_hash TEXT NOT NULL,
        idempotency_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        UNIQUE(world_id,idempotency_hash)
      );
      CREATE INDEX IF NOT EXISTS account_approvals_owner_v1 ON account_approvals_v1(world_id,account_id);
      CREATE TABLE IF NOT EXISTS account_agent_grants_v1 (
        id TEXT PRIMARY KEY, world_id TEXT NOT NULL, soul_id TEXT NOT NULL, account_id TEXT NOT NULL,
        approval_id TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL, nonce TEXT NOT NULL,
        token_hash TEXT UNIQUE, created_at INTEGER NOT NULL, revoked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS account_agent_grants_soul_v1 ON account_agent_grants_v1(world_id,soul_id);
      CREATE TABLE IF NOT EXISTS account_legacy_authority_v1 (
        world_id TEXT NOT NULL,soul_id TEXT NOT NULL,legacy_owner_id TEXT NOT NULL,
        captured_at INTEGER NOT NULL,revoked_at INTEGER,revoked_reason TEXT,
        PRIMARY KEY(world_id,soul_id)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS account_window_codes_v1 (
        world_id TEXT NOT NULL, code TEXT NOT NULL, account_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        PRIMARY KEY(world_id,code)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS account_window_codes_owner_v1 ON account_window_codes_v1(world_id,account_id);
    `));
    // Lane PUX: an approval may be addressed to one account (its window code); older databases gain the column.
    this.db.tx(() => {
      const cols = this.db.db.prepare('PRAGMA table_info(account_approvals_v1)').all() as { name: string }[];
      if (!cols.some(c => c.name === 'target_account_id')) this.db.db.exec('ALTER TABLE account_approvals_v1 ADD COLUMN target_account_id TEXT');
      // SOUL3: when a grant's token was first handed out (its first ready poll) and why the grant ended.
      const grantCols = this.db.db.prepare('PRAGMA table_info(account_agent_grants_v1)').all() as { name: string }[];
      if (!grantCols.some(c => c.name === 'token_issued_at')) this.db.db.exec('ALTER TABLE account_agent_grants_v1 ADD COLUMN token_issued_at INTEGER');
      if (!grantCols.some(c => c.name === 'revoked_reason')) this.db.db.exec('ALTER TABLE account_agent_grants_v1 ADD COLUMN revoked_reason TEXT');
      this.db.db.exec('CREATE INDEX IF NOT EXISTS account_approvals_target_v1 ON account_approvals_v1(world_id,target_account_id,status)');
    });
  }
  private time(): number {
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) fail('invalid-clock', 'Invalid account clock');
    return now;
  }
  private identity(identity: AccountIdentity): void {
    if (!identity || typeof identity !== 'object') fail('identity', 'Verified account identity required');
    text(identity.id, 'account identity', 1, 256); text(identity.issuer, 'identity issuer', 1, 256); text(identity.subject, 'identity subject', 1, 256);
    const now = this.time();
    if (!Number.isSafeInteger(identity.verifiedAt) || !Number.isSafeInteger(identity.expiresAt) || identity.verifiedAt < 0 || identity.verifiedAt > now || identity.expiresAt <= now || identity.expiresAt <= identity.verifiedAt) fail('identity', 'Verified account identity expired or invalid');
    const stored = this.db.db.prepare('SELECT account_id,issuer,subject FROM account_identities_v1 WHERE account_id=? OR (issuer=? AND subject=?)').all(identity.id, identity.issuer, identity.subject) as { account_id: string; issuer: string; subject: string }[];
    if (stored.some(row => row.account_id !== identity.id || row.issuer !== identity.issuer || row.subject !== identity.subject)) fail('identity-conflict', 'Verified account binding changed');
  }
  private capture(identity: AccountIdentity): void {
    this.identity(identity);
    // Email is intentionally absent: it neither identifies an account nor grants
    // rights here. Its provider-verified association belongs to the auth boundary.
    this.db.db.prepare('INSERT INTO account_identities_v1(account_id,issuer,subject,verified_at) VALUES (?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET verified_at=excluded.verified_at').run(identity.id, identity.issuer, identity.subject, identity.verifiedAt);
  }
  private row(id: string): ApprovalRow | undefined {
    text(id, 'approval');
    return this.db.db.prepare('SELECT * FROM account_approvals_v1 WHERE world_id=? AND id=?').get(this.worldId, id) as ApprovalRow | undefined;
  }
  private required(id: string): ApprovalRow { return this.row(id) ?? fail('not-found', 'Approval not found'); }
  private fresh(row: ApprovalRow): ApprovalRow {
    if (row.status === 'pending' && row.expires_at <= this.time()) {
      this.db.db.prepare("UPDATE account_approvals_v1 SET status='expired' WHERE world_id=? AND id=? AND status='pending'").run(this.worldId, row.id);
      return this.required(row.id);
    }
    return row;
  }
  private dto(row: ApprovalRow): ApprovalDTO {
    return { id: row.id, worldId: row.world_id, agentLabel: row.agent_label, name: row.name, description: row.description, mode: row.mode, status: row.status, soulId: row.soul_id ?? row.repair_soul_id, createdAt: row.created_at, expiresAt: row.expires_at, inWindow: !!row.target_account_id, ...(row.status === 'refused' ? { reason: { ...ARRIVAL_REFUSAL } } : {}) };
  }
  private member(soulId: string): MemberRow | undefined {
    text(soulId, 'Soul');
    return this.db.db.prepare('SELECT * FROM account_soul_memberships_v1 WHERE world_id=? AND soul_id=?').get(this.worldId, soulId) as MemberRow | undefined;
  }
  private membership(row: MemberRow): SoulMembership {
    return { worldId: row.world_id, soulId: row.soul_id, accountId: row.account_id, attribution: row.attribution, evidenceHash: row.evidence_hash, createdAt: row.created_at };
  }
  private owned(identity: AccountIdentity, soulId: string): MemberRow {
    this.identity(identity);
    const row = this.member(soulId);
    if (!row || row.account_id !== identity.id) fail('forbidden', 'Soul does not belong to this account');
    return row;
  }
  /** Trusted attribution association only. Does not change souls.owner or birth
   * history. A caller must independently verify public lineage/current authority. */
  associate(identity: AccountIdentity, soulId: string, evidence: { attribution: string; evidenceHash: string }): SoulMembership {
    text(soulId, 'Soul'); text(evidence.attribution, 'attribution', 1, 256);
    if (!/^[a-f0-9]{64}$/.test(evidence.evidenceHash)) fail('invalid', 'Invalid evidence hash');
    return this.db.tx(() => {
      this.capture(identity);
      const previous = this.member(soulId);
      if (previous) {
        if (previous.account_id !== identity.id || previous.attribution !== evidence.attribution || previous.evidence_hash !== evidence.evidenceHash) fail('membership-conflict', 'Existing Soul attribution cannot be overwritten');
        return this.membership(previous);
      }
      this.db.db.prepare('INSERT INTO account_soul_memberships_v1(world_id,soul_id,account_id,attribution,evidence_hash,created_at) VALUES (?,?,?,?,?,?)').run(this.worldId, soulId, identity.id, evidence.attribution, evidence.evidenceHash, this.time());
      return this.membership(this.member(soulId)!);
    });
  }
  memberships(identity: AccountIdentity): SoulMembership[] {
    this.identity(identity);
    return (this.db.db.prepare('SELECT * FROM account_soul_memberships_v1 WHERE world_id=? AND account_id=? ORDER BY created_at,soul_id').all(this.worldId, identity.id) as MemberRow[]).map(row => this.membership(row));
  }
  registerIdentity(identity:AccountIdentity){this.db.tx(()=>this.capture(identity));}
  recordedAccount(accountId:string){return !!this.db.db.prepare('SELECT 1 FROM account_identities_v1 WHERE account_id=?').get(accountId);}
  /** Capture only pre-existing valid legacy authority at the trusted adapter
   * boundary. INSERT OR IGNORE never revives an explicitly revoked owner. */
  captureLegacyAuthority(soulId:string,ownerId:string){if(!/^dev:agent-[a-f0-9]{24}$/.test(ownerId))return;this.db.tx(()=>this.db.db.prepare('INSERT OR IGNORE INTO account_legacy_authority_v1(world_id,soul_id,legacy_owner_id,captured_at) VALUES(?,?,?,?)').run(this.worldId,soulId,ownerId,this.time()));}
  legacyAuthority(soulId:string,ownerId:string){return !!this.db.db.prepare('SELECT 1 FROM account_legacy_authority_v1 WHERE world_id=? AND soul_id=? AND legacy_owner_id=? AND revoked_at IS NULL').get(this.worldId,soulId,ownerId);}
  invalidateSoul(soulId:string,ownerId:string,reason:string){this.db.tx(()=>{
    this.db.db.prepare('UPDATE account_agent_grants_v1 SET revoked_at=?,revoked_reason=? WHERE world_id=? AND soul_id=? AND revoked_at IS NULL').run(this.time(),text(reason,'revocation reason',1,80),this.worldId,soulId);
    this.db.db.prepare('UPDATE account_soul_memberships_v1 SET current_grant_id=NULL WHERE world_id=? AND soul_id=?').run(this.worldId,soulId);
    if(/^dev:agent-[a-f0-9]{24}$/.test(ownerId))this.db.db.prepare('INSERT INTO account_legacy_authority_v1(world_id,soul_id,legacy_owner_id,captured_at,revoked_at,revoked_reason) VALUES(?,?,?,?,?,?) ON CONFLICT(world_id,soul_id) DO UPDATE SET revoked_at=COALESCE(account_legacy_authority_v1.revoked_at,excluded.revoked_at),revoked_reason=COALESCE(account_legacy_authority_v1.revoked_reason,excluded.revoked_reason)').run(this.worldId,soulId,ownerId,this.time(),this.time(),text(reason,'revocation reason',1,80));
  });}
  private begin(input: StartApprovalInput, repairSoulId: string | null): ApprovalDTO & { pollSecret?: string } {
    const agentLabel = text(input.agentLabel, 'agent label', 1, 120), name = text(input.name, 'Soul name', 2, 32), description = text(input.description ?? '', 'description', 0, 1200);
    const idempotencyHash = sha(text(input.idempotencyKey, 'idempotency key', 16, 256));
    if (input.pollSecret !== undefined && !validPollSecret(input.pollSecret)) fail('invalid', 'Invalid approval poll credential');
    const mode = repairSoulId ? 'repair' : 'create', inputHash = sha(JSON.stringify([agentLabel, name, description, mode, repairSoulId]));
    return this.db.tx(() => {
      const previous = this.db.db.prepare('SELECT * FROM account_approvals_v1 WHERE world_id=? AND idempotency_hash=?').get(this.worldId, idempotencyHash) as ApprovalRow | undefined;
      if (previous) {
        if ((previous.client_poll_secret || input.pollSecret !== undefined) && !hashMatches(input.pollSecret, previous.poll_hash)) fail('poll-secret', 'Approval retry credential invalid');
        if (previous.input_hash !== inputHash) fail('idempotency-conflict', 'Approval retry changed its request');
        // Stored hashes cannot recover the secret. Never regenerate it on retry.
        return this.dto(this.fresh(previous));
      }
      // Lane SOULSIM-E (real-agent run 2026-10-21): a new Soul under a name already taken in this world was accepted here and
      // refused only when the person approved it, while the agent sat in `approval wait` for its full ten minutes. Refuse
      // it now, when the agent can still ask its person for another name. (A retry of a request made earlier is answered above.)
      if (mode === 'create' && this.nameTaken(name)) fail('name-taken', `a soul named ${name} already exists in this world; ask your person for another name`);
      const id = nonce('ap_'), pollSecret = input.pollSecret ?? randomBytes(32).toString('base64url'), now = this.time();
      // Lane PUX: a live window code addresses the request to its account; an unknown or stale code leaves the link only
      // Lane PAIR-INWINDOW (Gene's review #1): a repair names a Soul whose owner is already known, so with no code the request
      // goes to the owner's open window. This conveys no control: approve() still requires that exact membership.
      const target = (repairSoulId ? this.member(repairSoulId)?.account_id : null) ?? this.codeAccount(input.forCode);
      this.db.db.prepare("INSERT INTO account_approvals_v1(id,world_id,agent_label,name,description,mode,status,repair_soul_id,request_nonce,poll_hash,client_poll_secret,input_hash,idempotency_hash,created_at,expires_at,target_account_id) VALUES (?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?)").run(id, this.worldId, agentLabel, name, description, mode, repairSoulId, nonce('rq_'), sha(pollSecret), input.pollSecret === undefined ? 0 : 1, inputHash, idempotencyHash, now, now + this.approvalTtlMs, target);
      // Client-generated credentials are already durable in its own secure
      // storage before POST; never echo them into a response or regenerate them.
      return { ...this.dto(this.required(id)), ...(input.pollSecret === undefined ? { pollSecret } : {}) };
    });
  }
  start(input: StartApprovalInput): ApprovalDTO & { pollSecret?: string } { return this.begin(input, null); }
  /** An agent may propose repairing a public Soul ID. This conveys no control;
   * approve() requires the verified account's exact existing membership. */
  startRepairRequest(soulId:string,input:StartApprovalInput){text(soulId,'Soul');return this.begin(input,soulId);}
  startRepair(identity: AccountIdentity, soulId: string, input: StartApprovalInput): ApprovalDTO & { pollSecret?: string } {
    return this.db.tx(() => { this.owned(identity, soulId); return this.begin(input, soulId); });
  }
  view(id: string, identity?: AccountIdentity): ApprovalDTO {
    return this.db.tx(() => {
      const row = this.required(id);
      if (row.account_id) {
        if (!identity) fail('identity', 'Verified account identity required');
        this.identity(identity);
        if (row.account_id !== identity.id) fail('forbidden', 'Approval belongs to another account');
      }
      if (identity) this.addressedTo(row, identity);
      return this.dto(this.fresh(row));
    });
  }
  /** SERVER-INTERNAL exact reconciliation scope. Never serialize this through
   * a public endpoint; it contains the captured account association. */
  allocation(id: string): Allocation | null {
    const row = this.row(id);
    if (!row?.account_id || !row.soul_id || !row.request_id) return null;
    return { worldId: this.worldId, accountId: row.account_id, soulId: row.soul_id, requestId: row.request_id };
  }
  approve(identity: AccountIdentity, id: string, allocate: (input: AllocationInput) => Allocation): ApprovalDTO {
    return this.db.tx(() => {
      this.identity(identity);
      const row = this.fresh(this.required(id));
      if (row.account_id && row.account_id !== identity.id) fail('forbidden', 'Approval belongs to another account');
      this.addressedTo(row, identity);
      if (row.status !== 'pending') {
        if (row.account_id === identity.id && (row.status === 'creating' || row.status === 'ready' || row.status === 'refused')) return this.dto(row);
        // Expiry is durable, so return it instead of throwing inside this transaction.
        return this.dto(row);
      }
      if (row.mode === 'repair') this.owned(identity, row.repair_soul_id!);
      this.capture(identity);
      if (typeof allocate !== 'function' || allocate.constructor.name === 'AsyncFunction') fail('async-callback', 'Allocation must be synchronous');
      const requestId = nonce(row.mode === 'create' ? 'lc_' : 'ar_');
      const allocation = sync(allocate({ approvalId: id, worldId: this.worldId, accountId: identity.id, requestId, requestNonce: row.request_nonce, name: row.name, description: row.description, mode: row.mode, soulId: row.repair_soul_id }));
      if (!allocation || allocation.worldId !== this.worldId || allocation.accountId !== identity.id || (row.mode === 'create' && allocation.requestId !== requestId) || (row.mode === 'repair' && allocation.soulId !== row.repair_soul_id)) fail('allocation-conflict', 'Allocation changed approval scope');
      text(allocation.soulId, 'allocated Soul'); text(allocation.requestId, 'allocation request');
      this.identity(identity); // Authority may expire inside an allocation callback.
      this.db.db.prepare("UPDATE account_approvals_v1 SET account_id=?,soul_id=?,request_id=?,status='creating' WHERE world_id=? AND id=? AND status='pending'").run(identity.id, allocation.soulId, allocation.requestId, this.worldId, id);
      if (row.mode === 'create') this.associate(identity, allocation.soulId, { attribution: 'approved-creation', evidenceHash: sha(JSON.stringify(['account-approval/1', this.worldId, id, allocation.requestId, allocation.soulId, identity.id, row.request_nonce])) });
      const member = this.owned(identity, allocation.soulId), grantId = nonce('gr_'), now = this.time();
      this.db.db.prepare("UPDATE account_agent_grants_v1 SET revoked_at=?,revoked_reason='replaced' WHERE world_id=? AND soul_id=? AND revoked_at IS NULL").run(now, this.worldId, allocation.soulId);
      this.db.db.prepare('INSERT INTO account_agent_grants_v1(id,world_id,soul_id,account_id,approval_id,request_id,nonce,created_at) VALUES (?,?,?,?,?,?,?,?)').run(grantId, this.worldId, allocation.soulId, member.account_id, id, allocation.requestId, nonce('gn_'), now);
      this.db.db.prepare('UPDATE account_soul_memberships_v1 SET current_grant_id=? WHERE world_id=? AND soul_id=? AND account_id=?').run(grantId, this.worldId, allocation.soulId, identity.id);
      return this.dto(this.required(id));
    });
  }
  /** Lane PUX: a request addressed to one account is that account's alone to see and answer. */
  private addressedTo(row: ApprovalRow, identity: AccountIdentity): void {
    if (row.target_account_id && row.target_account_id !== identity.id) fail('forbidden', 'This request is for another account');
  }
  private codeAccount(code: unknown): string | null {
    if (typeof code !== 'string' || !WINDOW_CODE.test(code)) return null;
    const row = this.db.db.prepare('SELECT account_id FROM account_window_codes_v1 WHERE world_id=? AND code=? AND expires_at>?').get(this.worldId, code, this.time()) as { account_id: string } | undefined;
    return row?.account_id ?? null;
  }
  /** Lane PUX: the signed-in person's window code (reused while it has over an hour left), for their agent's request. */
  windowCode(identity: AccountIdentity): { code: string; expiresAt: number } {
    return this.db.tx(() => {
      this.capture(identity);
      const now = this.time();
      const kept = this.db.db.prepare('SELECT code,expires_at FROM account_window_codes_v1 WHERE world_id=? AND account_id=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1').get(this.worldId, identity.id, now + 60 * 60_000) as { code: string; expires_at: number } | undefined;
      if (kept) return { code: kept.code, expiresAt: kept.expires_at };
      this.db.db.prepare('DELETE FROM account_window_codes_v1 WHERE world_id=? AND expires_at<=?').run(this.worldId, now);
      for (;;) {
        const bytes = randomBytes(8), code = [...bytes].map((b, i) => (i === 4 ? '-' : '') + CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
        if (this.db.db.prepare('SELECT 1 FROM account_window_codes_v1 WHERE world_id=? AND code=?').get(this.worldId, code)) continue;
        this.db.db.prepare('INSERT INTO account_window_codes_v1(world_id,code,account_id,created_at,expires_at) VALUES (?,?,?,?,?)').run(this.worldId, code, identity.id, now, now + CODE_TTL_MS);
        return { code, expiresAt: now + CODE_TTL_MS };
      }
    });
  }
  /** Lane PUX: requests addressed to this account that still wait for an answer (newest first), for its open window. */
  waiting(identity: AccountIdentity): ApprovalDTO[] {
    return this.db.tx(() => {
      this.identity(identity);
      const rows = this.db.db.prepare("SELECT * FROM account_approvals_v1 WHERE world_id=? AND target_account_id=? AND status='pending' ORDER BY created_at DESC LIMIT 5").all(this.worldId, identity.id) as ApprovalRow[];
      return rows.map(row => this.fresh(row)).filter(row => row.status === 'pending').map(row => this.dto(row));
    });
  }
  /** Lane PUX ("Ask again"): an expired request becomes pending again, the same request with the same agent credential,
   * so the agent still waiting on it picks it up. It is then addressed to the person who asked again. */
  renew(identity: AccountIdentity, id: string): ApprovalDTO {
    return this.db.tx(() => {
      this.identity(identity);
      const row = this.fresh(this.required(id));
      if (row.account_id && row.account_id !== identity.id) fail('forbidden', 'Approval belongs to another account');
      this.addressedTo(row, identity);
      if (row.status !== 'expired') return this.dto(row);
      this.capture(identity);
      this.db.db.prepare("UPDATE account_approvals_v1 SET status='pending',expires_at=?,target_account_id=COALESCE(target_account_id,?) WHERE world_id=? AND id=? AND status='expired'").run(this.time() + this.approvalTtlMs, identity.id, this.worldId, id);
      return this.dto(this.required(id));
    });
  }
  cancel(identity: AccountIdentity | null, id: string, pollSecret?: string): ApprovalDTO {
    return this.db.tx(() => {
      const row = this.required(id);
      if (pollSecret !== undefined) { if (!hashMatches(pollSecret, row.poll_hash)) fail('poll-secret', 'Approval credential invalid'); }
      else {
        if (!identity) fail('identity', 'Verified account identity required');
        this.identity(identity);
        this.addressedTo(row, identity);
        // Lane PUX: the account a request was addressed to may refuse it; anyone else needs the agent's credential
        if (!row.account_id && row.target_account_id !== identity.id) fail('cancel-authority', 'Pending cancellation requires the approval credential');
        if (row.account_id && row.account_id !== identity.id) fail('forbidden', 'Approval belongs to another account');
      }
      const current = this.fresh(row);
      if (current.status === 'cancelled' || current.status === 'expired') return this.dto(current);
      if (current.status !== 'pending') fail('cannot-cancel', 'Creation was accepted; cancellation cannot undo it');
      this.db.db.prepare("UPDATE account_approvals_v1 SET status='cancelled' WHERE world_id=? AND id=? AND status='pending'").run(this.worldId, id);
      return this.dto(this.required(id));
    });
  }
  reconcile(id: string, actual: LifecycleProjection): ApprovalDTO {
    return this.db.tx(() => {
      const row = this.required(id);
      if (!row.account_id || !row.soul_id || !row.request_id || actual.worldId !== this.worldId || actual.accountId !== row.account_id || actual.soulId !== row.soul_id || actual.requestId !== row.request_id) fail('projection-conflict', 'Actual lifecycle projection changed approval scope');
      if (!['pending', 'recorded', 'complete', 'refused', 'legacy-ready'].includes(actual.lifecycleState) || typeof actual.ready !== 'boolean' || (actual.lifecycleState === 'legacy-ready' && row.mode !== 'repair') || (actual.ready && !['complete', 'legacy-ready'].includes(actual.lifecycleState))) fail('projection-conflict', 'Actual readiness does not match lifecycle state');
      if (row.status !== 'creating' && row.status !== 'ready' && row.status !== 'refused') fail('projection-conflict', 'Approval has no accepted creation');
      if (row.status === 'refused' && actual.lifecycleState !== 'refused') fail('projection-conflict', 'Refused creation cannot be revived');
      const member = this.member(row.soul_id);
      if (!member || member.account_id !== row.account_id) fail('membership-conflict', 'Current account membership changed');
      // SOUL3: a delegated grant, once ready, is not ended by a moment of not-ready (each use still checks readiness).
      const status: ApprovalStatus = actual.lifecycleState === 'refused' ? 'refused' : actual.ready || row.status === 'ready' ? 'ready' : 'creating';
      this.db.db.prepare('UPDATE account_approvals_v1 SET status=? WHERE world_id=? AND id=?').run(status, this.worldId, id);
      if (status === 'refused') {
        this.db.db.prepare("UPDATE account_agent_grants_v1 SET revoked_at=?,revoked_reason='refused' WHERE world_id=? AND approval_id=? AND revoked_at IS NULL").run(this.time(), this.worldId, id);
        this.db.db.prepare('UPDATE account_soul_memberships_v1 SET current_grant_id=NULL WHERE world_id=? AND soul_id=? AND current_grant_id IN (SELECT id FROM account_agent_grants_v1 WHERE world_id=? AND approval_id=?)').run(this.worldId, row.soul_id, this.worldId, id);
      }
      return this.dto(this.required(id));
    });
  }
  private currentGrant(row: ApprovalRow): GrantRow | undefined {
    if (row.status !== 'ready' || !row.account_id || !row.soul_id || !row.request_id) return undefined;
    return this.db.db.prepare('SELECT g.* FROM account_agent_grants_v1 g JOIN account_soul_memberships_v1 m ON m.world_id=g.world_id AND m.soul_id=g.soul_id AND m.account_id=g.account_id AND m.current_grant_id=g.id WHERE g.world_id=? AND g.soul_id=? AND g.account_id=? AND g.approval_id=? AND g.request_id=? AND g.revoked_at IS NULL').get(this.worldId, row.soul_id, row.account_id, row.id, row.request_id) as GrantRow | undefined;
  }
  poll(id: string, pollSecret: string): ApprovalDTO & { token?: string } {
    return this.db.tx(() => {
      const existing = this.row(id);
      if (!existing || !hashMatches(pollSecret, existing.poll_hash)) fail('poll-secret', 'Approval credential invalid');
      let row = this.fresh(existing);
      // Lane PUX: a request does not expire while its agent is still asking; it lapses approvalTtl after the last poll
      if (row.status === 'pending') { this.db.db.prepare("UPDATE account_approvals_v1 SET expires_at=MAX(expires_at,?) WHERE world_id=? AND id=? AND status='pending'").run(this.time() + this.approvalTtlMs, this.worldId, id); row = this.required(id); }
      const dto = this.dto(row), grant = this.currentGrant(row);
      if (!grant) return dto;
      const digest = createHmac('sha256', pollSecret).update(JSON.stringify(['eden-account-soul-grant/1', this.worldId, grant.soul_id, grant.request_id, grant.nonce])).digest('hex');
      const token = `sim_${grant.soul_id}_${digest}`, hash = sha(token);
      if (grant.token_hash && grant.token_hash !== hash) fail('grant-conflict', 'Delegated grant integrity changed');
      if (!grant.token_hash) this.db.db.prepare('UPDATE account_agent_grants_v1 SET token_hash=?,token_issued_at=? WHERE world_id=? AND id=? AND token_hash IS NULL AND revoked_at IS NULL').run(hash, this.time(), this.worldId, grant.id);
      return { ...dto, token };
    });
  }
  /** Only the currently selected world/Soul/account grant resolves. Logging out
   * has no storage operation; explicit revocation or re-pair invalidates grants. */
  resolveGrant(token: string): DelegatedGrant | null {
    if (typeof token !== 'string' || token.length > 1024 || !token.startsWith('sim_')) return null;
    const grant = this.db.db.prepare("SELECT g.* FROM account_agent_grants_v1 g JOIN account_soul_memberships_v1 m ON m.world_id=g.world_id AND m.soul_id=g.soul_id AND m.account_id=g.account_id AND m.current_grant_id=g.id JOIN account_approvals_v1 a ON a.world_id=g.world_id AND a.id=g.approval_id AND a.soul_id=g.soul_id AND a.account_id=g.account_id AND a.request_id=g.request_id AND a.status='ready' WHERE g.world_id=? AND g.token_hash=? AND g.revoked_at IS NULL").get(this.worldId, sha(token)) as GrantRow | undefined;
    if (!grant) return null;
    return { id: grant.id, worldId: grant.world_id, soulId: grant.soul_id, accountId: grant.account_id, approvalId: grant.approval_id, requestId: grant.request_id, createdAt: grant.created_at, issuedAt: grant.token_issued_at ?? grant.created_at };
  }
  revoke(identity: AccountIdentity, soulId: string): void {
    this.db.tx(() => {
      this.owned(identity, soulId);
      this.db.db.prepare("UPDATE account_agent_grants_v1 SET revoked_at=?,revoked_reason='revoked' WHERE world_id=? AND soul_id=? AND revoked_at IS NULL").run(this.time(), this.worldId, soulId);
      this.db.db.prepare('UPDATE account_soul_memberships_v1 SET current_grant_id=NULL WHERE world_id=? AND soul_id=? AND account_id=?').run(this.worldId, soulId, identity.id);
    });
  }
  releaseGrant(token:string){return this.db.tx(()=>{const grant=this.resolveGrant(token);if(!grant)fail('forbidden','Delegated grant unavailable');this.db.db.prepare("UPDATE account_agent_grants_v1 SET revoked_at=?,revoked_reason='released' WHERE world_id=? AND id=? AND revoked_at IS NULL").run(this.time(),this.worldId,grant.id);this.db.db.prepare('UPDATE account_soul_memberships_v1 SET current_grant_id=NULL WHERE world_id=? AND soul_id=? AND current_grant_id=?').run(this.worldId,grant.soulId,grant.id);});}
  /** SOUL3: the grant a delegated token was issued under, current or revoked (its hash stays on the row; never the token). */
  grantOf(token:string){if(typeof token!=='string'||token.length>1024||!token.startsWith('sim_'))return null;const row=this.db.db.prepare('SELECT soul_id,created_at,token_issued_at,revoked_at,revoked_reason FROM account_agent_grants_v1 WHERE world_id=? AND token_hash=?').get(this.worldId,sha(token)) as {soul_id:string;created_at:number;token_issued_at:number|null;revoked_at:number|null;revoked_reason:string|null}|undefined;return row?{soulId:row.soul_id,issuedAt:row.token_issued_at??row.created_at,revokedAt:row.revoked_at,reason:row.revoked_reason}:null;}
  agentStatus(soulId:string){const row=this.db.db.prepare("SELECT a.agent_label,COALESCE(g.token_issued_at,g.created_at) AS created_at FROM account_agent_grants_v1 g JOIN account_soul_memberships_v1 m ON m.world_id=g.world_id AND m.soul_id=g.soul_id AND m.current_grant_id=g.id JOIN account_approvals_v1 a ON a.id=g.approval_id AND a.world_id=g.world_id AND a.status='ready' WHERE g.world_id=? AND g.soul_id=? AND g.revoked_at IS NULL AND g.token_hash IS NOT NULL").get(this.worldId,soulId) as {agent_label:string;created_at:number}|undefined;return row?{attached:true,label:row.agent_label,since:row.created_at,last_used:null}:null;}
}
