// Lane OPS2 (Gene 2026-10-21, "OPCLI"): the launcher's half of the operator's TEST-Soul commands (op.mjs soul-*), run on
// eden2 by the release owner so lanes can test Soul flows unattended. The world's half is apps/server/src/op-souls.ts.
//   POST /__sim/op/soul-pending  {slug}                       pairing requests waiting in that world
//   POST /__sim/op/soul-approve  {slug, approvalId, name}     approve one TEST Soul's request (as op:test-operator)
//   POST /__sim/op/soul-message  {slug, soulId, name, text}   an owner message into a TEST Soul's inbox (the card's path)
//   POST /__sim/op/soul-inbox    {slug, soulId, name}         that inbox as its owner sees it (latest, ack, result)
//   POST /__sim/op/soul-delete   {slug, soulId, name}         retire a TEST Soul (by name + id)
//   POST /__sim/op/set-test      {slug, test}                 flag a scratch world as a test world (or unflag it)
// Guards, here and again in the world: direct loopback requests only (launcher.mjs `direct`); the world must be flagged
// test (registry `test: true`, op set-test) or listed in <data>/op-test-worlds.json (a JSON array of slugs), and never one
// of the product worlds below or a fork of an old world; Gene's Souls are refused by id and name (Kwyjibo, plus any in
// <data>/op-deny-souls.json {ids: [], names: []}). Every call, refused or not, is one audit.jsonl row with by: operator
// (op.mjs audit shows them); a message's text is never journaled, only its length.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { audit } from './worldops.mjs';

/** Product worlds: never test worlds, whatever a flag or list says. */
export const NEVER_TEST_SLUGS = ['eden-2026', 'godmode-lab', 'my-mars-college-2026-3', 'little-martians-arium', 'eden', 'mars', 'littlemartians'];
export const DENY_SOUL_IDS = ['s_c8520a0a76'];
export const DENY_SOUL_NAMES = [/kwyjibo/i];
export const SOUL_VERBS = ['pending', 'approve', 'message', 'inbox', 'delete'];

const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };
/** The slugs <data>/op-test-worlds.json allows (a JSON array; anything else allows none). */
export function allowedTestSlugs(dataDir) { const v = readJson(join(dataDir, 'op-test-worlds.json'), []); return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []; }
/** Why this world may not take operator Soul commands, or null when it may. */
export function notTestWorld(w, dataDir) {
  if (!w) return [404, 'not-found', 'no world by that slug'];
  if (w.fork) return [403, 'op.not-test-world', `${w.slug} is a copy of an old world, never a test world`];
  if (NEVER_TEST_SLUGS.includes(w.slug)) return [403, 'op.not-test-world', `${w.slug} is a product world, never a test world`];
  if (w.test === true || allowedTestSlugs(dataDir).includes(w.slug)) return null;
  return [403, 'op.not-test-world', `${w.slug} is not flagged test (op.mjs set-test --slug ${w.slug} --test true, or list it in op-test-worlds.json)`];
}
/** Is this Soul (by id or name) one of Gene's, on the built-in or the data dir's deny list? */
export function deniedSoul(dataDir, id, name) {
  const extra = readJson(join(dataDir, 'op-deny-souls.json'), {});
  const ids = [...DENY_SOUL_IDS, ...(Array.isArray(extra?.ids) ? extra.ids : [])];
  const names = [...DENY_SOUL_NAMES, ...(Array.isArray(extra?.names) ? extra.names.filter((n) => typeof n === 'string' && n).map((n) => new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')) : [])];
  return (typeof id === 'string' && ids.includes(id)) || (typeof name === 'string' && names.some((r) => r.test(name)));
}

/**
 * One operator Soul command. `ensure(w)` starts the world if it sleeps and gives its port; `call(w, port, path, body)` posts
 * to it directly with the site key and gives [status, json].
 */
export async function opSoul({ verb, body, registry, dataDir, ensure, call, log = () => {} }) {
  const slug = typeof body?.slug === 'string' ? body.slug : '';
  const row = { op: `soul-${verb}`, slug, by: 'operator', ...(typeof body?.approvalId === 'string' ? { approvalId: body.approvalId.slice(0, 40) } : {}), ...(typeof body?.soulId === 'string' ? { soulId: body.soulId.slice(0, 40) } : {}), ...(typeof body?.name === 'string' ? { name: body.name.slice(0, 40) } : {}), ...(typeof body?.text === 'string' ? { chars: body.text.length } : {}) };
  const done = (status, out) => { audit(dataDir, { ...row, status, ...(out.code ? { code: out.code } : {}), ...(out.approval?.soulId ? { soulId: out.approval.soulId } : {}) }); log(`operator soul-${verb} ${slug}${row.name ? ` ${row.name}` : ''}: ${status}${out.code ? ` ${out.code}` : ''}`); return [status, out]; };
  if (!SOUL_VERBS.includes(verb)) return done(404, { ok: false, code: 'not-found' });
  const w = registry.get(slug), why = notTestWorld(w, dataDir);
  if (why) return done(why[0], { ok: false, code: why[1], message: why[2] });
  if (verb !== 'pending') {
    if (typeof body?.name !== 'string' || !body.name) return done(400, { ok: false, code: 'invalid', message: 'name is required (the TEST Soul’s exact name)' });
    if (verb === 'approve' ? typeof body?.approvalId !== 'string' : typeof body?.soulId !== 'string') return done(400, { ok: false, code: 'invalid', message: verb === 'approve' ? 'approvalId is required (ap_…, from soul-pending)' : 'soulId is required (s_…)' });
    if (deniedSoul(dataDir, body.soulId, body.name)) return done(403, { ok: false, code: 'op.denied-soul', message: 'that Soul is on the deny list (Gene’s own Souls)' });
  }
  let port; try { port = await ensure(w); } catch (e) { return done(503, { ok: false, code: 'unavailable', message: `${w.name} could not start: ${e.message}` }); }
  const { slug: _s, ...rest } = body;
  try { const [status, out] = await call(w, port, `/v1/op/souls/${verb}`, rest); return done(status, { ...out, slug }); }
  catch (e) { return done(504, { ok: false, code: 'unreachable', message: `${w.name} did not answer: ${e.message}` }); }
}

/** op set-test: flag (or unflag) a scratch world as a test world. */
export function opSetTest({ body, registry, dataDir, log = () => {} }) {
  const w = registry.get(typeof body?.slug === 'string' ? body.slug : '');
  if (!w) return [404, { ok: false, code: 'not-found', message: 'no world by that slug' }];
  if (typeof body?.test !== 'boolean') return [400, { ok: false, code: 'invalid', message: 'test: true or false' }];
  if (body.test && (w.fork || NEVER_TEST_SLUGS.includes(w.slug))) return [403, { ok: false, code: 'op.not-test-world', message: `${w.slug} is a product world, never a test world` }];
  registry.update(w.slug, { test: body.test });
  audit(dataDir, { op: 'set-test', slug: w.slug, by: 'operator', test: body.test });
  log(`${w.slug} is ${body.test ? 'a test world' : 'no longer a test world'} (operator)`);
  return [200, { ok: true, slug: w.slug, test: body.test }];
}
