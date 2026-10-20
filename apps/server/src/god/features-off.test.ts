// G5 (Gene 2026-10-20): flags and the Constitution are switched off by default (tools/god-skill/lib/features.mjs).
// A new flag is refused with a precise code (act, dryrun, preview); flags a world already has stay; the Constitution's
// writes answer 404 feature.off while its reads and data stay. Turning a feature back on restores it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono, type Context } from 'hono';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { governanceOf } from './governance.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
function fixture() {
  delete process.env.SIM_GOD_FEATURES;
  const db = new Db(':memory:');
  let tick = 100;
  const god = new GodMode(db, { worldId: 'g5-1', ownerId: 'dev:gene', tick: () => tick++, emit: () => {} });
  const app = new Hono();
  mountGodRoutes(app, {
    god, worldName: 'G5',
    requireUser: async (c: Context) => { if (c.req.header('authorization') !== 'Bearer dev:gene') throw new ApiError(401, 'unauthorized', 'sign in'); return { id: 'dev:gene', role: 'user', email: null } as any; },
    soulFromBearer: () => null,
    baseOf: () => 'http://localhost:6710/w/g5', limitIp: () => {},
  } as any);
  app.onError((err, c) => err instanceof ApiError ? c.json({ ok: false, code: err.code, message: err.message }, err.status as 400) : c.json({ ok: false, code: 'internal', message: String(err) }, 500));
  governanceOf(god, { residents: () => [], deliver: () => {} });
  const token = god.mintFor({ id: 'dev:gene', role: 'user' }, 'test');
  const req = async (path: string, body: unknown) => {
    const r = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json() as any };
  };
  return { god, req };
}
const FLAG = { op: 'place', def: 'core/flag@1', name: 'camp', p: [4, 4], state: { label: 'camp' } };

test('a new flag is refused with feature.off (act, dryrun, preview); other things still place', (t) => {
  const { god } = fixture(); t.after(() => { delete process.env.SIM_GOD_FEATURES; });
  for (const r of [god.act({ ops: [FLAG] }), god.dryrun({ ops: [FLAG] }), god.preview({ ops: [FLAG] })] as any[]) {
    assert.equal(r.accepted, false); assert.equal(r.failures[0].code, 'feature.off'); assert.match(r.failures[0].fix, /--name/);
  }
  { const r = god.act({ ops: [{ op: 'place', def: 'core/fountain@1', name: 'arrival', p: [0, 0] }] }) as any; assert.equal(r.accepted, true, JSON.stringify(r)); }
  process.env.SIM_GOD_FEATURES = 'flags';
  assert.equal((god.act({ ops: [FLAG] }) as any).accepted, true, 'turned back on, a flag places');
});

test('the Constitution\'s writes answer 404 feature.off; on again they work', async (t) => {
  const { req } = fixture(); t.after(() => { delete process.env.SIM_GOD_FEATURES; });
  const off = await req('/v1/god/governance', { residentsDecide: true });
  assert.equal(off.status, 404); assert.equal(off.data.code, 'feature.off');
  assert.equal((await req('/v1/god/amendments/a_1/decide', { decision: 'accept' })).data.code, 'feature.off');
  process.env.SIM_GOD_FEATURES = 'constitution';
  const on = await req('/v1/god/governance', { residentsDecide: true });
  assert.equal(on.status, 200, JSON.stringify(on.data)); assert.equal(on.data.residentsDecide, true);
});
