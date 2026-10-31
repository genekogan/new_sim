#!/usr/bin/env node
// Operator-only migration. No HTTP endpoint, account allocation, email merging,
// historical owner rewrites, credential rotation or resident resurrection.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { hashOf } from '../../packages/engine-contract/src/hash.ts';
const require = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const { createRemoteJWKSet, jwtVerify } = await import(pathToFileURL(require.resolve('jose')).href);
const proofs = new WeakSet();
export const sha = value => createHash('sha256').update(value).digest('hex');
const check = (condition, message) => { if (!condition) throw Error(message); };
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length < 512 && !value.includes('\0');

// The one account this operator migration may attach to: ATTACH_EXPECTED_EMAIL (required, never a default), which the
// reviewed manifest's expectedEmail and the provider's verified email must both match.
export function expectedAccountEmail(env = process.env) {
  const email = env.ATTACH_EXPECTED_EMAIL?.trim().toLowerCase();
  check(email && /^[^@\s]+@[^@\s]+$/.test(email), 'Set ATTACH_EXPECTED_EMAIL to the account email this migration is for');
  return email;
}

export function validateManifest(m, env = process.env) {
  check(m?.contract === 'sim-reviewed-historical-attachment/1', 'Unsupported manifest');
  check(text(m.reviewedBy) && digest(m.reviewEvidenceSHA256), 'Review evidence and reviewer required');
  check(m.expectedEmail === expectedAccountEmail(env), 'This migration is restricted to the account in ATTACH_EXPECTED_EMAIL');
  check(text(m.issuer) && new URL(m.issuer).protocol === 'https:' && new URL(m.issuer).origin === m.issuer, 'Exact HTTPS issuer required');
  check(/^user_[A-Za-z0-9]{1,128}$/.test(m.subject) && /^acct_[A-Za-z0-9-]+$/.test(m.accountId), 'Pin verified subject and existing registry account ID');
  check(text(m.registryPath) && isAbsolute(m.registryPath), 'Pin the absolute registry path');
  check(text(m.authorizedParty) && new URL(m.authorizedParty).origin === m.authorizedParty, 'Exact authorized party required');
  check(Array.isArray(m.worlds) && m.worlds.length > 0, 'No approved entries: inventory alone never authorizes attachment');
  const paths = new Set();
  for (const w of m.worlds) {
    check(text(w.worldId) && isAbsolute(w.dbPath) && !paths.has(w.dbPath), 'Unique absolute world DB path required'); paths.add(w.dbPath);
    check(Array.isArray(w.entries) && w.entries.length > 0, 'Each world needs explicitly reviewed entries');
    const ids = new Set();
    for (const e of w.entries) {
      check(e.approved === true && /^s_[a-f0-9]{10}$/.test(e.soulId) && /^h_[a-f0-9]{10}$/.test(e.entityId) && !ids.has(e.soulId), 'Approved unique exact Soul/entity IDs required'); ids.add(e.soulId);
      check(Number.isSafeInteger(e.birthSeq) && e.birthSeq > 0 && digest(e.birthHash) && digest(e.recordedOwnerSHA256) && digest(e.evidenceSHA256) && typeof e.retired === 'boolean', 'Exact birth, owner hash, retirement and attribution evidence required');
    }
  }
  return m;
}

/** Live provider proof is deliberately not accepted as manifest JSON. A fresh
 * signed Clerk session and fresh verified email link must resolve to the pinned
 * subject. Email only checks the reviewed target; it never finds/merges IDs. */
export async function verifyClerkIdentity(m, { token, backendKey, keySet, fetchImpl = fetch }) {
  validateManifest(m);
  check(typeof token === 'string' && token.length > 0 && token.length < 32000, 'Session credential required');
  check(typeof backendKey === 'string' && /^sk_live_[A-Za-z0-9_-]+$/.test(backendKey), 'Production Clerk backend credential required');
  const { payload } = await jwtVerify(token, keySet ?? createRemoteJWKSet(new URL('/.well-known/jwks.json', m.issuer)), {
    issuer: m.issuer, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat', 'nbf', 'sid', 'azp'], maxTokenAge: '5m',
  });
  check(payload.sub === m.subject && /^sess_[A-Za-z0-9]{1,128}$/.test(payload.sid) && payload.azp === m.authorizedParty, 'Verified session identity differs from manifest');
  const sessionResponse = await fetchImpl('https://api.clerk.com/v1/sessions/' + encodeURIComponent(payload.sid), {
    headers: { Authorization: 'Bearer ' + backendKey }, signal: AbortSignal.timeout(8000), redirect: 'error',
  });
  check(sessionResponse.ok, 'Provider session lookup failed');
  const session = await sessionResponse.json();
  check(session.id === payload.sid && session.user_id === payload.sub && session.status === 'active', 'Provider session is not active for this account');
  const response = await fetchImpl('https://api.clerk.com/v1/users/' + encodeURIComponent(payload.sub), {
    headers: { Authorization: 'Bearer ' + backendKey }, signal: AbortSignal.timeout(8000), redirect: 'error',
  });
  check(response.ok, 'Provider identity lookup failed');
  const profile = await response.json();
  check(profile.id === payload.sub && profile.banned !== true && profile.locked !== true && profile.deleted !== true && Array.isArray(profile.email_addresses) && profile.email_addresses.some(e =>
    typeof e.email_address === 'string' && e.email_address.toLowerCase() === m.expectedEmail && e.verification?.status === 'verified'), 'Fresh provider verified email link differs');
  const proof = Object.freeze({ id: m.accountId, issuer: m.issuer, subject: payload.sub, verifiedAt: Date.now(), expiresAt: payload.exp * 1000 });
  proofs.add(proof); return proof;
}

function registryBinding(registryPath, m) {
  check(registryPath === m.registryPath && realpathSync(registryPath) === m.registryPath && statSync(registryPath).isFile(), 'Existing registry must match the manifest real path');
  const registry = new DatabaseSync(realpathSync(registryPath), { readOnly: true });
  try {
    const rows = registry.prepare('SELECT account_id,issuer,subject FROM provider_accounts_v1 WHERE account_id=? OR (issuer=? AND subject=?)').all(m.accountId, m.issuer, m.subject);
    check(rows.length === 1 && rows[0].account_id === m.accountId && rows[0].issuer === m.issuer && rows[0].subject === m.subject, 'Existing registry binding differs; never allocate or merge accounts');
  } finally { registry.close(); }
}
const memberColumns = 'world_id,soul_id,account_id,attribution,evidence_hash,created_at,current_grant_id';
function inspect(db, m, world) {
  check(db.prepare('SELECT 1 FROM worlds WHERE id=?').get(world.worldId), 'World lineage missing');
  // A local identity must not conflict with the separately verified registry.
  const identities = db.prepare('SELECT account_id,issuer,subject FROM account_identities_v1 WHERE account_id=? OR (issuer=? AND subject=?)').all(m.accountId,m.issuer,m.subject);
  check(identities.every(r => r.account_id === m.accountId && r.issuer === m.issuer && r.subject === m.subject), 'World identity conflicts with registry');
  return world.entries.map(e => {
    // No token values, private journals or full event history are read.
    const row = db.prepare('SELECT id,world_id,entity_id,owner,native,retired_at,token_hash IS NOT NULL AS has_token FROM souls WHERE id=?').get(e.soulId);
    check(row && row.world_id === world.worldId && row.entity_id === e.entityId && !row.native && row.owner !== 'system' && sha(row.owner) === e.recordedOwnerSHA256 && (row.retired_at !== null) === e.retired, 'Soul identity/current owner/retirement differs: ' + e.soulId);
    const event = db.prepare('SELECT seq,tick,kind,author,payload,at FROM events WHERE world_id=? AND seq=?').get(world.worldId,e.birthSeq);
    const birth = event && { ...event, payload: JSON.parse(event.payload) };
    check(birth && birth.kind === 'birth' && birth.payload.soulId === e.soulId && birth.payload.entityId === e.entityId && birth.payload.owner === row.owner && hashOf(birth) === e.birthHash, 'Accepted birth differs: ' + e.soulId);
    if (/^dev:agent-[a-f0-9]{24}$/.test(row.owner) && row.has_token) {
      check(db.prepare('SELECT 1 FROM account_legacy_authority_v1 WHERE world_id=? AND soul_id=? AND legacy_owner_id=? AND revoked_at IS NULL').get(world.worldId,e.soulId,row.owner), 'Existing legacy authority missing/revoked; refusing to disrupt or revive it: ' + e.soulId);
    }
    const previous = db.prepare('SELECT ' + memberColumns + ' FROM account_soul_memberships_v1 WHERE world_id=? AND soul_id=?').get(world.worldId,e.soulId);
    check(!previous || previous.account_id === m.accountId && previous.attribution === 'reviewed-historical-creator' && previous.evidence_hash === e.evidenceSHA256, 'Existing membership cannot be overwritten: ' + e.soulId);
    return { soulId:e.soulId, retired:e.retired, action:previous?'already-attached':'attach', evidenceSHA256:e.evidenceSHA256 };
  });
}

/** Dry-run opens both registry and world databases read-only. Apply is atomic
 * per world (not across worlds); a failed later world is safe to retry. */
export function attachHistorical(m, { registryPath, proof, apply = false }) {
  validateManifest(m);
  check(proofs.has(proof) && proof.id === m.accountId && proof.issuer === m.issuer && proof.subject === m.subject && proof.expiresAt > Date.now() && Date.now()-proof.verifiedAt < 300000, 'Fresh in-process provider verification required');
  registryBinding(registryPath,m);
  const reports = [];
  // Preflight every world read-only before the first write.
  for (const world of m.worlds) {
    check(realpathSync(world.dbPath) === world.dbPath && statSync(world.dbPath).isFile(), 'Manifest must pin the real existing DB path');
    const db = new DatabaseSync(world.dbPath,{readOnly:true});
    try { reports.push({worldId:world.worldId,entries:inspect(db,m,world)}); } finally { db.close(); }
  }
  if (apply) for (const world of m.worlds) {
    const db = new DatabaseSync(world.dbPath); db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    try {
      registryBinding(registryPath,m);
      check(proof.expiresAt > Date.now() && Date.now()-proof.verifiedAt < 300000, 'Provider proof expired before write');
      const plan = inspect(db,m,world);
      db.exec('CREATE TABLE IF NOT EXISTS account_historical_attachments_v1(world_id TEXT NOT NULL,soul_id TEXT NOT NULL,account_id TEXT NOT NULL,manifest_hash TEXT NOT NULL,evidence_hash TEXT NOT NULL,reviewed_by TEXT NOT NULL,attached_at INTEGER NOT NULL,PRIMARY KEY(world_id,soul_id))');
      for (const entry of plan) if (entry.action === 'attach') {
        db.prepare('INSERT OR IGNORE INTO account_identities_v1(account_id,issuer,subject,verified_at) VALUES(?,?,?,?)').run(m.accountId,m.issuer,m.subject,proof.verifiedAt);
        db.prepare('INSERT INTO account_soul_memberships_v1(' + memberColumns + ') VALUES(?,?,?,?,?,?,NULL)').run(world.worldId,entry.soulId,m.accountId,'reviewed-historical-creator',entry.evidenceSHA256,Date.now());
        db.prepare('INSERT INTO account_historical_attachments_v1 VALUES(?,?,?,?,?,?,?)').run(world.worldId,entry.soulId,m.accountId,hashOf(m),entry.evidenceSHA256,m.reviewedBy,Date.now());
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; } finally { db.close(); }
  }
  return {contract:'sim-historical-attachment-result/1',mode:apply?'apply':'dry-run',manifestSHA256:hashOf(m),worlds:reports};
}

async function main(args) {
  const options = {}; let apply = false;
  for (let n=0;n<args.length;n++) {
    if (args[n] === '--apply') { apply = true; continue; }
    check(['--manifest','--registry','--token-file','--clerk-key-file'].includes(args[n]) && args[n+1] && !args[n+1].startsWith('--') && !options[args[n]], 'Expected --manifest --registry --token-file --clerk-key-file [--apply]');
    options[args[n]] = args[++n];
  }
  const m = validateManifest(JSON.parse(readFileSync(options['--manifest'],'utf8')));
  const credential = path => { check(isAbsolute(path) && (statSync(path).mode & 0o077) === 0, 'Credential files must be absolute and private (0600)'); return readFileSync(path,'utf8').trim(); };
  const proof = await verifyClerkIdentity(m,{token:credential(options['--token-file']),backendKey:credential(options['--clerk-key-file'])});
  process.stdout.write(JSON.stringify(attachHistorical(m,{registryPath:options['--registry'],proof,apply}),null,2)+'\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => { console.error('Attachment refused. Check reviewed manifest, exact lineage, provider verification and existing memberships. No credentials are logged.'); process.exitCode=1; });
}
