// Y4 end to end, in process: the real god CLI (tools/god-skill) drives the real god routes through a fetch shim.
// No listener, no network: fetch to the fixture origin is answered by app.fetch; any other URL is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { hashToken } from '../auth.ts';
// The CLI is untyped .mjs; load it by URL so the server's typecheck does not need declarations for it.
type Untyped = Record<string, (...args: any[]) => any>;
const tool = (path: string) => import(new URL(`../../../../tools/god-skill/${path}`, import.meta.url).href) as Promise<Untyped>;
const [{ act, build, undo }, { call, load }, { invalidate }] = await Promise.all([tool('cli.mjs'), tool('lib/state.mjs'), tool('lib/mirror.mjs')]);

const ORIGIN = 'http://127.0.0.1:5399';
const partDef = { schema: 'def/1', name: 'part', size: { box: [1, 1, 1] }, layer: 'decor', make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0, 0], size: [1, 1, 1] }] } } };
const place = (name: string, x = 0, z = 0, parent = 'world') => ({ op: 'place', def: 'part@1', name, p: [x, z], in: { parent } });

test('Y4 CLI: build claim --helper hands a sub-agent a scoped token that edits its claim and nothing else', async t => {
  const db = new Db(':memory:'), god = new GodMode(db, { worldId: 'helpers', ownerId: 'owner', tick: () => 0, assetDir: join(tmpdir(), 'y4-assets'), emit: () => {} });
  const leadToken = god.mintFor({ id: 'owner', role: 'user' }, 'lead');
  assert.equal(god.as({ identity: god.godIdentity(leadToken)! }, () => god.act({ ops: [{ op: 'define', def: partDef }] })).accepted, true);
  const app = new Hono();
  mountGodRoutes(app, { god, worldName: 'Helpers', requireUser: async () => { throw new ApiError(401, 'unauthorized', 'owner only'); }, soulFromBearer: () => null, baseOf: () => ORIGIN, limitIp: () => {} });
  app.onError((e, c) => e instanceof ApiError ? c.json({ ok: false, code: e.code, message: e.message, ...e.extra }, e.status as 400) : c.json({ internal: String(e) }, 500));
  const cwd = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'y4-cli-')), originalFetch = globalThis.fetch, previous = { helper: process.env.EDEN_GOD_HELPER, claim: process.env.EDEN_GOD_CLAIM };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(ORIGIN + '/')) throw new Error(`fixture refuses ${url}`);
    return app.fetch(new Request(url, init));
  }) as typeof fetch;
  delete process.env.EDEN_GOD_HELPER; delete process.env.EDEN_GOD_CLAIM;
  process.chdir(dir); invalidate();
  t.after(() => {
    globalThis.fetch = originalFetch; process.chdir(cwd); invalidate(); rmSync(dir, { recursive: true, force: true }); db.close();
    for (const [k, v] of [['EDEN_GOD_HELPER', previous.helper], ['EDEN_GOD_CLAIM', previous.claim]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });
  writeFileSync('.eden-god.json', JSON.stringify({ world: ORIGIN, token: leadToken }), { mode: 0o600 });

  // The lead starts a build, lays out the shell and claims the east aisle for a sub-agent.
  await build('start', ['church'], { title: 'Church', steps: 'shell,roof', at: '0,0', size: '100,100', brief: 'a church' });
  assert.equal((await act({ ops: [{ ...place('shell'), tmp: '$s' }, place('east', 10, 0, '$s'), place('west', -10, 0, '$s')] })).accepted, true);
  const lead = readFileSync('.eden-god.json', 'utf8');
  const text = await build('claim', ['east'], { root: 'shell/east', helper: true }) as string;
  const file = text.match(/export EDEN_GOD_HELPER=(\S+)/)?.[1]; assert.ok(file, text);
  assert.ok(!text.includes(leadToken), 'the lead token is never printed');
  const helperToken = JSON.parse(readFileSync(file, 'utf8')).token as string; assert.notEqual(helperToken, leadToken); assert.ok(!text.includes(helperToken));
  assert.equal(readFileSync('.eden-god.json', 'utf8'), lead);

  // The sub-agent sets only EDEN_GOD_HELPER.
  process.env.EDEN_GOD_HELPER = file; invalidate();
  assert.equal(load().token, helperToken);
  const inside = await act({ ops: [place('pew', 1, 0, 'shell/east')] }); assert.equal(inside.accepted, true, JSON.stringify(inside)); assert.equal(inside.build.group, 'church/east');
  const outside = await act({ ops: [{ op: 'set', id: 'shell/west', name: 'stolen' }] }); assert.equal(outside.accepted, false); assert.equal(outside.failures[0].code, 'helper.scope');
  const env = await call('/v1/god/env', { body: { weather: { kind: 'rain' } } }); assert.equal(env.status, 403); assert.equal(env.data.code, 'helper.scope');
  await assert.rejects(build('done'), /claim holders cannot build done/);
  assert.match(await undo({ group: 'church/east' }) as string, /undid group "church\/east"/);
  assert.equal((await act({ ops: [place('pew', 1, 0, 'shell/east')] })).accepted, true);
  const helperHash8 = hashToken(helperToken).slice(0, 8), rows = god.store.edits(50);
  assert.deepEqual(rows.filter(r => r.hash8 === helperHash8).map(r => r.kind), ['edit', 'undo', 'edit']);
  assert.ok(rows.every(r => r.label), 'every row is attributed');
  assert.match(await build('release', [], { done: true }) as string, /claim released/);

  // Releasing the claim ends the helper token; the lead's token is unaffected.
  const after = await call('/v1/god/builds');
  assert.equal(after.status, 401); assert.equal(after.data.code, 'helper.expired');
  delete process.env.EDEN_GOD_HELPER; invalidate();
  assert.equal((await call('/v1/god/builds')).status, 200);
});
