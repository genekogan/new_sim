import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { holder } from '../../../../tools/god-skill/lib/locks.mjs';

test('doctor inventory is authenticated, excludes tokens, and fixes only stale leases/claims', async t => {
  const db = new Db(':memory:'); t.after(() => db.close()); let now = Date.now();
  const god = new GodMode(db, { worldId: 'doctor', ownerId: 'owner', tick: () => 1, emit: () => {}, now: () => now, buildPauseMs: 50 });
  const token = god.mintFor({ id: 'owner', role: 'user' }, 'doctor-lead'), identity = god.godIdentity(token)!;
  const app = new Hono();
  mountGodRoutes(app, { god, worldName: 'doctor', requireUser: async () => { throw Error('unused'); }, soulFromBearer: () => null, baseOf: () => 'http://127.0.0.1:5366', limitIp: () => {} });
  app.onError((e, c) => e instanceof ApiError ? c.json({ code: e.code }, e.status as 401) : c.json({ error: String(e) }, 500));
  const req = (fix = false, auth = token) => app.request('/v1/god/doctor', { method: fix ? 'POST' : 'GET', headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, ...(fix ? { body: JSON.stringify({ fix: true }) } : {}) });
  assert.equal((await req(false, 'wrong')).status, 401);
  const start = god.builds.start({ id: 'church', title: 'Church', steps: ['shell'], site: { at: [0, 0], size: [30, 30] } }, identity);
  assert.equal(start.ok, true); if (!start.ok) return;
  const claim = god.builds.claim('church', { part: 'roof', region: { at: [0, 0], size: [10, 10] } }, identity); assert.equal(claim.ok, true);
  let result = await (await req(true)).json() as { locks: { kind: string; stale: boolean; fixed?: boolean }[] };
  assert.ok(result.locks.every(l => !l.fixed));
  now += 51;
  result = await (await req(true)).json() as typeof result;
  assert.ok(result.locks.find(l => l.kind === 'build-lease')?.fixed);
  assert.ok(result.locks.find(l => l.kind === 'claim')?.fixed);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${token}|${start.lease}`));
  assert.equal((await req()).headers.get('cache-control'), 'no-store');
});
test('PID start mismatch lets another lead resume immediately without explicit take', t => {
  const db = new Db(':memory:'); t.after(() => db.close());
  const god = new GodMode(db, { worldId: 'recycled', ownerId: 'owner', tick: () => 1, emit: () => {} });
  const a = god.godIdentity(god.mintFor({ id: 'owner', role: 'user' }, 'old'))!;
  const b = god.godIdentity(god.mintFor({ id: 'owner', role: 'user' }, 'new'))!;
  a.holder = { ...holder('old'), start: 'a prior process' };
  const r = god.builds.start({ id: 'church', title: 'Church', steps: ['shell'], site: { at: [0, 0], size: [30, 30] } }, a); assert.equal(r.ok, true);
  const resumed = god.builds.resume('church', {}, b); assert.equal(resumed.ok, true, JSON.stringify(resumed));
});
test('resume by the same token refreshes a previous command process identity', t => {
  const db = new Db(':memory:'); t.after(() => db.close());
  const god = new GodMode(db, { worldId: 'same-token', ownerId: 'owner', tick: () => 1, emit: () => {} });
  const caller = god.godIdentity(god.mintFor({ id: 'owner', role: 'user' }, 'lead'))!;
  caller.holder = { ...holder('previous command'), start: 'recycled' };
  const r = god.builds.start({ id: 'church', title: 'Church', steps: ['shell'], site: { at: [0, 0], size: [30, 30] } }, caller); assert.equal(r.ok, true);
  caller.holder = holder('new command');
  const resumed = god.builds.resume('church', {}, caller); assert.equal(resumed.ok, true);
  if (resumed.ok) assert.deepEqual(resumed.build.lead.holder, caller.holder);
});
