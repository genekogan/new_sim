// Lane OPS2 (Gene 2026-10-21, "OPCLI"): operator commands for TEST Souls, so lanes can test Soul flows unattended on
// scratch/test worlds. The launcher (tools/world-launcher/op-souls.mjs) is the only caller: it accepts the command from
// this machine only (op.mjs, run on eden2 by the release owner), checks the world is flagged test, then calls here
// directly with the run's site key. A request through the public proxy carries x-forwarded-for and is refused.
//   POST /v1/op/souls/pending   the requests waiting for an answer (id, name, agent, addressed, test)
//   POST /v1/op/souls/approve   {approvalId, name}  approve one, as the operator's own test account
//   POST /v1/op/souls/message   {soulId, name, text}  an owner message into the Soul's inbox, the browser card's path
//   POST /v1/op/souls/inbox     {soulId, name}  the owner's view of that inbox (latest, its ack/result, queued, presence)
//   POST /v1/op/souls/delete    {soulId, name}  retire it (Souls.operatorRetire, the journaled retire an owner's DELETE does)
//   POST /v1/op/god/pending     god pairing requests waiting for the owner;  POST /v1/op/god/approve {code}: approve one for
//                               the world's existing owner (the release probe's own god folder, so no signed-in step)
// Hard guards here (the launcher repeats the deny list): only a request no person was addressed in (no window code), for
// a create (never a repair of an existing Soul), whose name is a TEST name and not on the deny list; message/inbox/delete
// only reach Souls the operator's test account owns (so never Gene's Souls, which his own account owns). Every use prints
// one `[op-souls]` line in the world log; the launcher journals it as operator in <data>/audit.jsonl.
import type {Context, Hono} from 'hono';
import type {Db, SoulRow} from './db.ts';
import {ApiError, type Souls} from './souls.ts';
import type {AgentInbox} from './inbox.ts';
import type {GodMode} from './god/god.ts';
import {AccountStoreError, type AccountIdentity} from './accounts/store.ts';
import {siteRequestOk} from './travel/travel.ts';

/** The account every operator-approved TEST Soul belongs to. No sign-in provider issues an `op:` id. */
export const OPERATOR_ACCOUNT = 'op:test-operator';
/** Gene's own Souls, by id and by name: never approved, messaged, read or deleted by an operator, whatever world. */
export const DENY_SOUL_IDS: readonly string[] = ['s_c8520a0a76'];
export const DENY_SOUL_NAMES: readonly RegExp[] = [/kwyjibo/i];
/** A TEST Soul's name: "Test" then a capital, digit or separator ("TestMsg", "Test 3", "Test-probe"), or "test-<x>". */
export const TEST_NAME = /^(?:Test(?:[A-Z0-9]|[ _-][A-Za-z0-9])|test-[a-z0-9])/;
export const isTestName = (name: string) => TEST_NAME.test(name);
export const deniedSoul = (id: string | null | undefined, name: string | null | undefined) =>
  (!!id && DENY_SOUL_IDS.includes(id)) || (!!name && DENY_SOUL_NAMES.some(r => r.test(name)));

type Deps = {db: Db; worldId: string; souls: Souls; inbox: AgentInbox; god?: GodMode; siteKey: string | undefined; log?: (line: string) => void};
type PendingRow = {id: string; name: string; agent_label: string; mode: string; status: string; account_id: string | null; target_account_id: string | null; created_at: number; expires_at: number};

export function mountOperatorSouls(app: Hono, d: Deps) {
  const log = d.log ?? ((line: string) => console.log(line));
  const refuse = (code: string, message: string, status = 403): never => { throw new ApiError(status as 403, code, message); };
  const gate = async (c: Context) => {
    c.header('Cache-Control', 'no-store');
    if (!siteRequestOk(d.siteKey, c.req.header('x-sim-site-key'), c.req.header('x-forwarded-for'))) return null;
    try { const b = await c.req.json(); return b && typeof b === 'object' && !Array.isArray(b) ? b as Record<string, unknown> : {}; } catch { return {}; }
  };
  const str = (b: Record<string, unknown>, k: string) => typeof b[k] === 'string' ? (b[k] as string) : refuse('invalid', `${k} is required`, 400);
  const journal = (op: string, out: Record<string, unknown>) => log(`[op-souls] ${JSON.stringify({op, by: 'operator', world: d.worldId, ...out})}`);
  const identity = (): AccountIdentity => {
    const now = Date.now();
    if (!d.db.user(OPERATOR_ACCOUNT)) d.db.upsertUser({id: OPERATOR_ACCOUNT, email: null, wallet: null, role: 'user'});
    if (!d.souls.invited(d.db.user(OPERATOR_ACCOUNT)!)) d.db.setInvited(OPERATOR_ACCOUNT, 'operator');
    return {id: OPERATOR_ACCOUNT, issuer: 'sim-operator', subject: 'test-operator', verifiedAt: now, expiresAt: now + 10 * 60_000};
  };
  /** A live Soul of this world that the operator's test account owns (by name + id, both must match). */
  const testSoul = (b: Record<string, unknown>): SoulRow => {
    const id = str(b, 'soulId'), name = str(b, 'name');
    if (deniedSoul(id, name)) refuse('op.denied-soul', 'that Soul is on the deny list (Gene’s own Souls)');
    const row = d.db.soul(id);
    if (!row || row.world_id !== d.worldId || row.retired_at !== null) refuse('not-found', 'no such live Soul in this world', 404);
    if (row!.name !== name) refuse('op.name-mismatch', `that Soul is named ${row!.name}, not ${name}`, 409);
    if (deniedSoul(row!.id, row!.name)) refuse('op.denied-soul', 'that Soul is on the deny list (Gene’s own Souls)');
    if (row!.owner !== OPERATOR_ACCOUNT || !(d.souls.accounts?.owns(OPERATOR_ACCOUNT, row!) ?? false)) refuse('op.not-test-soul', 'only a TEST Soul an operator approved can be used here');
    return row!;
  };
  const scope = (row: SoulRow) => ({scope: `soul:${row.id}`, owner: row.owner});
  /** The account store's own refusals, as the account routes answer them (accounts/routes.ts wrap). */
  const store = <T>(run: () => T): T => { try { return run(); } catch (e) { if (e instanceof AccountStoreError) throw new ApiError(e.code === 'not-found' ? 404 : e.code === 'forbidden' ? 403 : 409, e.code, e.message); throw e; } };

  app.post('/v1/op/souls/pending', async c => {
    if (!await gate(c)) return c.json({ok: false, code: 'not-found'}, 404);
    const accounts = d.souls.accounts; if (!accounts) return c.json({ok: true, pending: [], accounts: false});
    const now = Date.now(), rows = d.db.db.prepare("SELECT id,name,agent_label,mode,target_account_id,created_at,expires_at FROM account_approvals_v1 WHERE world_id=? AND status='pending' ORDER BY created_at DESC LIMIT 20").all(d.worldId) as PendingRow[];
    const pending = rows.filter(r => store(() => accounts.store.view(r.id)).status === 'pending').map(r => ({id: r.id, name: r.name, agentLabel: r.agent_label, mode: r.mode, addressed: !!r.target_account_id, test: isTestName(r.name) && !deniedSoul(null, r.name) && r.mode === 'create' && !r.target_account_id, ageS: Math.round((now - r.created_at) / 1000)}));
    return c.json({ok: true, pending, accounts: true});
  });

  app.post('/v1/op/souls/approve', async c => {
    const b = await gate(c); if (!b) return c.json({ok: false, code: 'not-found'}, 404);
    const accounts = d.souls.accounts ?? refuse('op.accounts-off', 'this world has no account approvals (not a signed-in world)', 409);
    const id = str(b, 'approvalId'), name = str(b, 'name');
    const row = d.db.db.prepare('SELECT id,name,agent_label,mode,status,account_id,target_account_id,created_at,expires_at FROM account_approvals_v1 WHERE world_id=? AND id=?').get(d.worldId, id) as PendingRow | undefined;
    if (!row) refuse('not-found', 'no such request in this world', 404);
    if (row!.name !== name) refuse('op.name-mismatch', `that request is for ${row!.name}, not ${name}`, 409);
    if (deniedSoul(null, row!.name)) refuse('op.denied-soul', 'that name is on the deny list (Gene’s own Souls)');
    if (!isTestName(row!.name)) refuse('op.not-test-soul', `only a TEST Soul's request (a name like "TestMsg" or "test-probe"), not ${row!.name}`);
    if (row!.mode !== 'create') refuse('op.not-test-soul', 'a repair request reconnects an existing Soul: never approved by an operator');
    if (row!.target_account_id) refuse('op.addressed', 'this request was sent to a person’s open window: only they answer it');
    const status = row!.account_id ? row!.status : store(() => accounts.store.view(id)).status;   // answered: its account's own
    if (status !== 'pending') refuse('op.not-pending', `that request is ${status}`, 409);
    const approval = store(() => accounts.approve(identity(), id));
    journal('approve', {approvalId: id, name, soulId: approval.soulId, status: approval.status});
    return c.json({ok: true, approval: {id: approval.id, name: approval.name, status: approval.status, soulId: approval.soulId}, owner: OPERATOR_ACCOUNT});
  });

  app.post('/v1/op/souls/message', async c => {
    const b = await gate(c); if (!b) return c.json({ok: false, code: 'not-found'}, 404);
    const row = testSoul(b), text = str(b, 'text');
    if (!text.trim() || text.length > 280) refuse('invalid', 'text is required (1–280 characters)', 400);
    d.souls.requireControlReady(row);
    // the browser card's own bucket and store (inbox-routes.ts ownerRoutes, /v1/edge/owner/:soulId/inbox)
    const r = d.souls.limits.allow(`cmd:${row.owner}`, 20, 60_000);
    if (!r.ok) throw new ApiError(429, 'rate-limited', 'too many requests; slow down', {retry_after: r.retryAfter});
    const inbox = d.inbox.send(scope(row), text);
    journal('message', {soulId: row.id, name: row.name, messageId: inbox.latest?.id, chars: text.trim().length});
    return c.json({ok: true, inbox});
  });

  app.post('/v1/op/souls/inbox', async c => {
    const b = await gate(c); if (!b) return c.json({ok: false, code: 'not-found'}, 404);
    const row = testSoul(b), inbox = d.inbox.ownerView(scope(row));
    journal('inbox', {soulId: row.id, name: row.name});
    return c.json({ok: true, soulId: row.id, name: row.name, inbox});
  });

  app.post('/v1/op/souls/delete', async c => {
    const b = await gate(c); if (!b) return c.json({ok: false, code: 'not-found'}, 404);
    const row = testSoul(b);
    await d.souls.operatorRetire(row.id);
    journal('delete', {soulId: row.id, name: row.name});
    return c.json({ok: true, soulId: row.id, name: row.name, retired: true});
  });

  app.post('/v1/op/god/pending', async c => {
    if (!await gate(c)) return c.json({ok: false, code: 'not-found'}, 404);
    return c.json({ok: true, pending: d.god?.pendingPairings() ?? [], owned: !!d.god?.owner});
  });
  app.post('/v1/op/god/approve', async c => {
    const b = await gate(c); if (!b) return c.json({ok: false, code: 'not-found'}, 404);
    const god = d.god ?? refuse('op.no-god', 'this world has no god mode', 409), code = str(b, 'code');
    // never a first claim: the god pairs for the owner the world already has, exactly as their own approval would
    if (!god.owner) refuse('op.unowned', 'this world has no owner yet: an operator never claims a world');
    const agent = god.pendingPairings().find(p => p.code.replace(/[^A-Z0-9]/gi, '').toUpperCase() === code.replace(/[^A-Z0-9]/gi, '').toUpperCase())?.agent;
    god.pairApprove({id: god.owner!, role: 'user'}, code);
    journal('god-approve', {agent: agent ?? null});
    return c.json({ok: true, approved: true});
  });
}
