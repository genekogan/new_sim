// Co-builders and handoff (lane WORLDOPS, backlog P3), entirely in the launcher:
//  - the owner invites a co-builder (one-time link); the invited person signs in and accepts;
//  - a co-builder pairs their own agent (agent asks, the co-builder approves in their browser) and gets a god token
//    labelled cobuilder:<account>:<agent>, theirs alone: listed, revoked with them, never able to archive, invite or
//    hand the world on;
//  - the owner offers the world to another person (optionally a named account); it changes hands only when that
//    person signs in and accepts. Then every god token (the old owner's agents, the co-builders') is revoked.
// Every step is appended to <data>/audit.jsonl. Offer and pairing codes are kept only as hashes.
// Gene 2026-10-16: one god per world. Co-builders stay in the code for later but are OFF unless the launcher runs with
// --cobuilders (or SIM_COBUILDERS=1): inviting, accepting a co-builder invitation and co-builder pairing are refused with
// code `cobuilders-off`; the owner can still list and remove old co-builders, and handover to a new owner works as before.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { addGodToken, audit, dropGodTokens, hashToken, setWorldOwner } from './worldops.mjs';

const OFFER_TTL = 7 * 24 * 3600e3, PAIR_TTL = 10 * 60e3;
const ACCOUNT_RE = /^[A-Za-z0-9_:.-]{3,48}$/;
const code = (n = 18) => randomBytes(n).toString('base64url');

export const COBUILDERS_OFF = { ok: false, code: 'cobuilders-off', message: 'Co-builders are turned off on this site: each world has one god, its owner. To give the world to someone else, the owner hands it over (transfer).' };

export function makeHandoff({ registry, pool, dataDir, wp, publicOrigin, actorOf, isOwner, closing, log, cobuilders = false }) {
  const pairs = new Map(); // user_code → { slug, agent, poll, expires, token? }
  const db = (slug) => join(registry.worldDir(slug), 'sim.db');
  const live = (w) => (w.offers ?? []).filter((o) => o.expires > Date.now());
  const link = (w, kind, c) => `${publicOrigin}${wp(w.slug)}/#${kind}/${c}`;
  const findOffer = (w, c) => (typeof c === 'string' && c ? live(w).find((o) => o.hash === hashToken(c)) : null) ?? null;

  async function owner(w, authorization) { const a = await actorOf(w, authorization); return isOwner(w, a) ? a : null; }
  async function person(w, authorization) { const a = await actorOf(w, authorization); return a?.via === 'session' ? a : null; }

  function offer(w, kind, by, to) {
    const c = code();
    const o = { kind, hash: hashToken(c), by, at: Date.now(), expires: Date.now() + OFFER_TTL, ...(to ? { to } : {}) };
    // one open handoff at a time: a new one replaces the old
    registry.update(w.slug, { offers: [...live(w).filter((x) => kind !== 'transfer' || x.kind !== 'transfer'), o] });
    audit(dataDir, { op: kind === 'transfer' ? 'transfer-offer' : 'cobuilder-invite', slug: w.slug, by, ...(to ? { to } : {}) });
    return { ok: true, kind, code: c, url: link(w, 'worldoffer', c), expiresAt: new Date(o.expires).toISOString(), ...(to ? { to } : {}) };
  }

  async function accept(w, body, authorization) {
    const o = findOffer(w, body?.code);
    if (!o) return [404, { ok: false, code: 'no-offer', message: 'this invitation is not valid (used, cancelled or expired)' }];
    const a = await person(w, authorization);
    if (!a) return [401, { ok: false, code: 'signin-required', message: 'sign in to accept' }];
    if (o.to && o.to !== a.account) return [403, { ok: false, code: 'not-for-you', message: 'this invitation is for another account' }];
    const prev = registry.get(w.slug).offers ?? [];
    if (o.kind === 'cobuild' && !cobuilders) return [403, COBUILDERS_OFF];
    if (o.kind === 'cobuild') {
      if (isOwner(w, a)) return [409, { ok: false, code: 'owner', message: 'you already own this world' }];
      const cobuilders = [...(w.cobuilders ?? []).filter((c) => c.account !== a.account), { account: a.account, at: Date.now(), by: o.by }];
      registry.update(w.slug, { cobuilders, offers: prev.filter((x) => x.hash !== o.hash) });
      audit(dataDir, { op: 'cobuilder-add', slug: w.slug, by: a.account, invitedBy: o.by });
      log(`${w.slug}: ${a.account} is now a co-builder (invited by ${o.by})`);
      return [200, { ok: true, kind: 'cobuild', slug: w.slug, account: a.account }];
    }
    // transfer: the world is stopped while its owner changes, then wakes on the next visit under the new owner
    const from = o.by;
    if (a.account === from) return [409, { ok: false, code: 'owner', message: 'you already own this world' }];
    closing.add(w.slug);
    try {
      await pool.stop(w.slug); pool.kids.delete(w.slug);
      setWorldOwner(db(w.slug), `${w.slug}-1`, a.account);
      const revoked = dropGodTokens(db(w.slug), `${w.slug}-1`);
      registry.update(w.slug, { offers: [], cobuilders: [], godName: null, god: true, owner: a.account });
      audit(dataDir, { op: 'transfer', slug: w.slug, from, to: a.account, by: a.account, tokensRevoked: revoked });
      log(`${w.slug}: handed from ${from} to ${a.account} (${revoked} god tokens revoked)`);
      return [200, { ok: true, kind: 'transfer', slug: w.slug, owner: a.account, tokensRevoked: revoked }];
    } finally { closing.delete(w.slug); }
  }

  /** Routes under /__sim/worlds/<slug>/<sub>; returns [status, body] or null when the route is not ours. */
  return async function route(w, sub, method, body, authorization) {
    if (sub === 'offer' && method === 'GET') {
      const o = findOffer(w, body?.code);
      if (o?.kind === 'cobuild' && !cobuilders) return [403, COBUILDERS_OFF];
      return o ? [200, { ok: true, kind: o.kind, world: { slug: w.slug, name: w.name }, ...(o.to ? { forAccount: true } : {}), expiresAt: new Date(o.expires).toISOString() }] : [404, { ok: false, code: 'no-offer' }];
    }
    if (sub === 'offer/accept' && method === 'POST') return accept(w, body, authorization);
    if (sub.startsWith('cobuild/pair/') && !cobuilders) return [403, COBUILDERS_OFF];
    if (sub === 'cobuild/pair/start' && method === 'POST') {
      const userCode = code(6).replace(/[-_]/g, 'x').toUpperCase(), poll = code(24);
      const agent = (typeof body?.agent === 'string' ? body.agent : 'agent').replace(/[^\w .-]/g, '').slice(0, 24) || 'agent';
      for (const [k, p] of pairs) if (p.expires < Date.now()) pairs.delete(k);
      if (pairs.size > 200) return [429, { ok: false, code: 'slow-down' }];
      pairs.set(userCode, { slug: w.slug, agent, poll: hashToken(poll), expires: Date.now() + PAIR_TTL });
      const url = link(w, 'cobuildpair', userCode);
      return [200, { ok: true, user_code: userCode, poll_token: poll, approve_url: url, interval_s: 3, expires_in: PAIR_TTL / 1000, tell_your_human: `Open ${url} , sign in as a co-builder of this world, and approve me.` }];
    }
    if (sub === 'cobuild/pair/poll' && method === 'POST') {
      const h = typeof body?.poll_token === 'string' ? hashToken(body.poll_token) : '';
      const [k, p] = [...pairs].find(([, x]) => x.poll === h && x.slug === w.slug) ?? [];
      if (!p || p.expires < Date.now()) return [404, { ok: false, code: 'expired' }];
      if (!p.token) return [200, { ok: true, approved: false }];
      pairs.delete(k);
      return [200, { ok: true, approved: true, token: p.token, world: `${w.slug}-1` }];
    }
    if (sub === 'cobuild/pair/approve' && method === 'POST') {
      const p = pairs.get(typeof body?.code === 'string' ? body.code : '');
      if (!p || p.slug !== w.slug || p.expires < Date.now()) return [404, { ok: false, code: 'expired', message: 'this pairing code is unknown or expired' }];
      const a = await person(w, authorization);
      if (!a || !(w.cobuilders ?? []).some((c) => c.account === a.account)) return [403, { ok: false, code: 'forbidden', message: "only a co-builder of this world approves their own agent here (the owner uses the world's own pairing)" }];
      if (p.token) return [409, { ok: false, code: 'used' }];
      p.token = `god_${w.slug}-1_${code(24)}`; // the shape the world itself mints (newGodToken)
      addGodToken(db(w.slug), `${w.slug}-1`, p.token, `cobuilder:${a.account}:${p.agent}`);
      audit(dataDir, { op: 'cobuilder-pair', slug: w.slug, by: a.account, agent: p.agent });
      return [200, { ok: true, agent: p.agent }];
    }
    // ---- the owner's own (signed in, or their own agent's god token)
    const ownerOnly = { cobuilders: 'GET', 'cobuilders/invite': 'POST', 'cobuilders/remove': 'POST', transfer: 'POST', 'offers/cancel': 'POST' };
    if (ownerOnly[sub] !== method) return null;
    const a = await owner(w, authorization);
    if (!a) return [403, { ok: false, code: 'forbidden', message: "only this world's owner" }];
    if (sub === 'cobuilders') return [200, { ok: true, enabled: cobuilders, cobuilders: w.cobuilders ?? [], offers: live(w).map(({ hash: _h, ...o }) => o) }];
    if (sub === 'cobuilders/invite' && !cobuilders) return [403, COBUILDERS_OFF];
    if (sub === 'cobuilders/invite') {
      const to = typeof body?.to === 'string' && body.to ? body.to : undefined;
      if (to && !ACCOUNT_RE.test(to)) return [400, { ok: false, code: 'invalid', message: 'to: an account id' }];
      return [200, offer(w, 'cobuild', a.account, to)];
    }
    if (sub === 'transfer') {
      const to = typeof body?.to === 'string' && body.to ? body.to : undefined;
      if (to && !ACCOUNT_RE.test(to)) return [400, { ok: false, code: 'invalid', message: 'to: an account id' }];
      if (to === a.account) return [400, { ok: false, code: 'invalid', message: 'you already own it' }];
      return [200, offer(w, 'transfer', a.account, to)];
    }
    if (sub === 'offers/cancel') {
      const n = live(w).length; registry.update(w.slug, { offers: [] });
      audit(dataDir, { op: 'offers-cancel', slug: w.slug, by: a.account, cancelled: n });
      return [200, { ok: true, cancelled: n }];
    }
    if (sub === 'cobuilders/remove') {
      const acct = typeof body?.account === 'string' ? body.account : '';
      if (!(w.cobuilders ?? []).some((c) => c.account === acct)) return [404, { ok: false, code: 'not-found', message: 'no such co-builder' }];
      const revoked = dropGodTokens(db(w.slug), `${w.slug}-1`, `cobuilder:${acct}:`);
      registry.update(w.slug, { cobuilders: w.cobuilders.filter((c) => c.account !== acct) });
      audit(dataDir, { op: 'cobuilder-remove', slug: w.slug, by: a.account, account: acct, tokensRevoked: revoked });
      return [200, { ok: true, account: acct, tokensRevoked: revoked }];
    }
    return null;
  };
}
