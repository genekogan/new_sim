// Y3 / NT10 slice 1: district plans recorded once, built as chapter builds that close only their own plots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { coreRef } from '@sim/world-compiler';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode, type WorldBuildMessage, type WorldDiffMessage } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { GodLayers } from './layers.ts';
import { inClosure } from './builds.ts';
import { chapterShape, checkPlan, districtPlanSchema } from './districts.ts';
import { godSchema } from './schema.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const plot = (id: string, x: number, z: number, title: string) => ({ id, title, at: [x, z], size: [16, 18], massing: [{ name: 'hall', at: [0, z < 0 ? -2 : 2], size: [10, 8], h: 6, roof: 'gable' }] });
export const streetPlan = () => ({
  id: 'high', title: 'High Street', brief: 'Owner words: a lively six-shop street by the river', steps: ['massing', 'shops', 'details'],
  roads: [{ id: 'high', name: 'High Street', path: [[-60, 0], [60, 0]], width: 8 }],
  plots: [plot('p1', -40, -14, 'Bakery'), plot('p2', -40, 14, 'Smithy'), plot('p3', 0, -14, 'Inn'), plot('p4', 0, 14, 'Chapel'), plot('p5', 40, -14, 'Market'), plot('p6', 40, 14, 'Mill')],
  chapters: [['p1', 'p2'], ['p3', 'p4'], ['p5', 'p6']],
  terrain: 'gentle fall to the south', water: 'river 40 m south of the street',
});
function fixture() {
  const db = new Db(':memory:'), emitted: (WorldDiffMessage | WorldBuildMessage)[] = [];
  let now = 2_000_000;
  const god = new GodMode(db, { worldId: 'district-test', ownerId: 'owner', tick: () => 1, now: () => now, buildPauseMs: 50, buildClosureMs: 500, emit: (m: WorldDiffMessage | WorldBuildMessage) => emitted.push(m) });
  const token = god.mintFor({ id: 'owner', role: 'user' }, 'lead'), other = new GodMode(db, { worldId: 'other-world', ownerId: 'owner', tick: () => 1, emit: () => {} }).mintFor({ id: 'owner', role: 'user' }, 'wrong');
  const app = new Hono();
  mountGodRoutes(app, { god, worldName: 'District test', requireUser: async () => { throw new ApiError(401, 'unauthorized', 'sign in'); }, soulFromBearer: () => null, baseOf: () => 'http://127.0.0.1', limitIp: () => {} });
  app.onError((e, c) => e instanceof ApiError ? c.json({ ok: false, code: e.code }, e.status as 400) : c.json({ ok: false, internal: String(e) }, 500));
  const req = async (path: string, data?: unknown, auth: string | null = token) => { const r = await app.request(path, { method: data === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }); return { status: r.status, data: await r.json() as any }; };
  const layers = new GodLayers({ get model() { return god.model; }, engine: { world: { tick: 0, entities: {} } }, living: () => null, engineAct: () => ({ accepted: false, failures: [] }) as never, building: id => god.builds.closing(id), closingSites: () => god.builds.closingSites(), log() {} });
  return { db, god, token, other, app, req, emitted, layers, advance: (ms: number) => { now += ms; } };
}
const code = (r: any) => r.failures?.[0]?.code;
const bench = (name: string, x: number, z: number) => ({ op: 'place', def: coreRef('bench'), name, p: [x, z] });
const resident = { soulId: 's_ana', name: 'Ana' } as never;

test('Y3: a district plan is validated with fields, recorded once, replayed, private to god tokens, and advertised', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const plan = streetPlan(), post = (body: unknown) => f.req('/v1/god/districts', body);
  assert.equal(code((await post({ id: 'high', title: 'x' })).data), 'schema');
  // Direct calls: the route's per-token limiter (6 plans a minute) is asserted at the end.
  const caller = f.god.godIdentity(f.token)!, bad = async (mutate: (p: any) => void) => { const p = streetPlan() as any; mutate(p); return { data: f.god.districts.record(p, caller) as any }; };
  let r = (await bad(p => { p.plots[1].id = 'p1'; })).data; assert.equal(code(r), 'district.plan'); assert.equal(r.failures[0].field, 'plots.1.id');
  r = (await bad(p => { p.plots[0].massing[0].at = [6, 0]; })).data; assert.equal(r.failures[0].field, 'plots.0.massing.0'); assert.match(r.failures[0].fix, /plan field/);
  r = (await bad(p => { p.plots[2].at = [-35, -14]; })).data; assert.match(r.failures[0].detail, /p1 and p3 overlap/);
  r = (await bad(p => { p.plots[5].at = [180, 14]; p.chapters = [['p1', 'p6']]; })).data; assert.equal(r.failures[0].field, 'chapters.0'); assert.match(r.failures[0].detail, /spans/);
  r = (await bad(p => { p.chapters = [['p1', 'p9']]; })).data; assert.match(r.failures[0].detail, /unknown plot p9/);
  r = (await bad(p => { p.chapters = [['p1'], ['p1', 'p2']]; })).data; assert.match(r.failures[0].detail, /p1 is in chapters 1 and 2/);
  r = (await bad(p => { for (const x of p.plots) x.massing = Array.from({ length: 5 }, (_, i) => ({ name: `m${i}`, at: [0, 0], size: [1, 1], h: 3 })); })).data; assert.match(r.failures[0].detail, /10 masses/);
  assert.equal((await f.req('/v1/god/districts')).data.districts.length, 0, 'refusals write nothing');
  const ok = (await post(plan)).data;
  assert.equal(ok.ok, true, JSON.stringify(ok)); assert.deepEqual(ok.warnings, []);
  assert.deepEqual(ok.district.counts, { plots: 6, built: 0, building: 0, planned: 6 });
  assert.deepEqual(ok.district.next, { action: 'start', id: 'high-1', plots: ['p1', 'p2'] });
  assert.equal((await post(plan)).data.replayed, true);
  assert.equal(code((await post({ ...plan, title: 'Another street' })).data), 'district.exists');
  for (const auth of [null, f.other]) for (const [path, body] of [['/v1/god/districts', undefined], ['/v1/god/districts/high', undefined], ['/v1/god/districts', plan]] as const) assert.equal((await f.req(path, body, auth)).status, 401);
  assert.equal((await f.req('/v1/god/districts/missing')).status, 404);
  const listed = (await f.req('/v1/god/districts')).data.districts; assert.equal(listed[0].id, 'high'); assert.equal(listed[0].counts.planned, 6);
  const schema = godSchema() as any; assert.ok(schema.districts.plan.properties.plots); assert.ok(schema.endpoints.god.includes('POST /v1/god/districts')); assert.ok(schema.refusals.includes('district.plot'));
  const publicData = JSON.stringify([f.god.publicSnapshot(), f.god.builds.publicList(), f.emitted]);
  for (const word of ['six-shop street', 'gentle fall', 'Bakery']) assert.equal(publicData.includes(word), false, word);
  let limited = false; for (let i = 0; i < 8 && !limited; i++) limited = (await post(plan)).status === 429; assert.ok(limited);
});

test('Y3: plan warnings cover roads, the closure margin and the ground extent without blocking', () => {
  const plan = districtPlanSchema.parse({ ...streetPlan(), plots: [{ id: 'a', at: [0, -6], size: [10, 10], massing: [{ at: [4, 0], size: [2, 2], h: 3 }] }, { id: 'b', at: [10.5, -6], size: [10, 10], massing: [{ at: [-4, 0], size: [2, 2], h: 3 }] }, { id: 'far', at: [5000, 0], size: [10, 10] }], chapters: undefined });
  const fake = { ground: () => ({ extent: [-500, -500, 500, 500] }) } as never;
  const { failures, warnings } = checkPlan(plan, fake);
  assert.deepEqual(failures, []);
  assert.ok(warnings.some(w => /plot a overlaps road high/.test(w))); assert.ok(warnings.some(w => /plots a and b have masses within 1.5 m/.test(w))); assert.ok(warnings.some(w => /far centre is outside the ground/.test(w)));
});

test('Y3: chapter shapes keep plot massing in place, including yawed plots', () => {
  const plan = districtPlanSchema.parse(streetPlan()), [p1, p2] = plan.plots;
  const one = chapterShape([p1]); assert.deepEqual(one.site.at, [-40, -14]); assert.deepEqual(one.site.size, [16.02, 18.02]); assert.equal(one.massing[0].name, 'p1-hall');
  const two = chapterShape([p1, p2]); assert.deepEqual(two.site.at, [-40, 0]); assert.deepEqual(two.site.size.map(v => Math.round(v * 100) / 100), [16.02, 46.02]);
  assert.deepEqual(two.massing.map(m => [m.name, m.at.map(v => Math.round(v * 1e6) / 1e6)]), [['p1-hall', [0, -16]], ['p2-hall', [0, 16]]]);
  const turned = chapterShape([{ ...p1, yaw: Math.PI / 2 }, { ...p2, yaw: 0 }]); assert.equal(turned.site.yaw, 0, 'mixed yaw uses world axes');
  assert.ok(Math.abs(turned.massing[0].yaw! - Math.PI / 2) < 1e-9);
});

test('Y3: chapters take site and massing from plots, refuse taken plots, close only their own buildings, and inherit follow-ups', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assert.equal((await f.req('/v1/god/districts', streetPlan())).data.ok, true);
  // Refusals use direct calls; the route limits starts to 6 a minute per token.
  const caller = f.god.godIdentity(f.token)!, start = (raw: unknown) => f.god.builds.start(raw, caller) as any;
  assert.equal(code(start({ id: 'x', district: { id: 'missing' } })), 'district.unknown');
  assert.equal(code(start({ id: 'x', district: { id: 'high' }, site: { at: [0, 0], size: [10, 10] } })), 'district.plot');
  assert.equal(code(start({ id: 'x', district: { id: 'high' }, massing: [{ at: [0, 0], size: [2, 2], h: 3 }] })), 'district.plot');
  assert.equal(code(start({ id: 'x', district: { id: 'high', plots: ['p1', 'p1'] } })), 'district.plot');
  assert.equal(code(start({ id: 'x', district: { id: 'high', plots: ['p9'] } })), 'district.plot');
  assert.equal(code(start({ id: 'x', district: { id: 'high', plots: [] } })), 'schema');
  const input = { id: 'high-1', district: { id: 'high' }, brief: 'Chapter one: bakery and smithy' };
  const s = (await f.req('/v1/god/builds', input)).data;
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.deepEqual(s.build.district, { id: 'high', plots: ['p1', 'p2'] }); assert.equal(s.build.title, 'High Street: Bakery, Smithy'); assert.deepEqual(s.build.plan.steps, ['massing', 'shops', 'details']);
  assert.deepEqual(s.build.site.at, [-40, 0]); assert.deepEqual(s.build.massing.map((m: any) => m.name), ['p1-hall', 'p2-hall']); assert.deepEqual(s.build.roots, [], 'a chapter never adopts earlier roots');
  assert.deepEqual(s.report.district.plots.map((p: any) => p.id), ['p1', 'p2']); assert.deepEqual(s.report.district.frontage[0], { plot: 'p1', road: 'high', distance: 10, side: 'south', frontYaw: 0 });
  assert.deepEqual(s.report.district.neighbours.map((n: any) => n.plot), ['p3', 'p4']);
  assert.equal(start(input).replayed, true, 'the expanded start replays');
  const busy = start({ id: 'other', district: { id: 'high', plots: ['p2'] } }); assert.equal(code(busy), 'district.plot'); assert.equal(busy.failures[0].fix, 'build resume high-1');
  const field = { id: 'high-1', lease: s.lease };
  assert.equal(f.god.act({ ops: [bench('bakery-bench', -40, -16), bench('smithy-bench', -40, 16)], build: field }).accepted, true);
  const shown = (await f.req('/v1/god/builds/high-1')).data; assert.equal(shown.district.id, 'high'); assert.equal(shown.district.plots.find((p: any) => p.id === 'p1').status, 'building');
  assert.equal(f.layers.refusal(f.god.model.get('bakery-bench')!.id, resident)?.code, 'site.under-construction');
  const done = (await f.req('/v1/god/builds/high-1/done', {})).data; assert.equal(done.ok, true); assert.deepEqual(done.district.next, { action: 'start', id: 'high-2', plots: ['p3', 'p4'] });
  assert.equal(code(start({ id: 'again', district: { id: 'high', plots: ['p1'] } })), 'district.plot');
  // Chapter two is under construction: chapter one stays open to residents (things, seats and walks).
  const two = (await f.req('/v1/god/builds', { id: 'high-2', district: { id: 'high' } })).data; assert.equal(two.ok, true); assert.deepEqual(two.build.district.plots, ['p3', 'p4']);
  assert.equal(two.inventory.things.length, 0); assert.deepEqual(two.report.district.neighbours.find((n: any) => n.plot === 'p1'), { plot: 'p1', status: 'built', chapter: 'high-1' });
  assert.equal(f.god.act({ ops: [bench('inn-bench', 0, -16)], build: { id: 'high-2', lease: two.lease } }).accepted, true);
  const bakery = f.god.model.get('bakery-bench')!.id, inn = f.god.model.get('inn-bench')!.id;
  assert.equal(f.god.builds.closing(bakery), null); assert.equal(f.layers.refusal(bakery, resident), null);
  assert.equal(f.layers.refusal(inn, resident)?.code, 'site.under-construction');
  const walk = (to: [number, number]) => f.layers.constructionRefusal(resident, [{ verb: 'walk_to', params: { to } }]);
  assert.equal(walk([-40, -16]), null); assert.equal(walk([-40, 16]), null); assert.equal(walk([0, -16])?.code, 'site.under-construction');
  assert.equal(f.god.builds.closingSites().every(s => !inClosure(s, [-40, -16])), true);
  // An outside edit from chapter two to a finished plot is the covenant's business, not a silent change.
  assert.equal(code(f.god.act({ ops: [{ op: 'move', id: 'bakery-bench', p: [-41, -16] }], build: { id: 'high-2', lease: two.lease } })), 'build.outside');
  const view = (await f.req('/v1/god/districts/high')).data.district;
  assert.deepEqual(view.counts, { plots: 6, built: 2, building: 2, planned: 2 }); assert.deepEqual(view.next, { action: 'resume', id: 'high-2', plots: ['p3', 'p4'] });
  assert.deepEqual(view.plots.find((p: any) => p.id === 'p1'), { id: 'p1', title: 'Bakery', at: [-40, -14], size: [16, 18], masses: 1, status: 'built', chapter: 'high-1', parts: 1 });
  assert.equal(view.chapters.find((c: any) => c.id === 'high-2').closed, true); assert.equal(view.chapters.find((c: any) => c.id === 'high-1').closed, false);
  // A follow-up chapter on built plots (build continue) inherits the district link and shows up beside them.
  assert.equal((await f.req('/v1/god/builds/high-2/done', {})).data.ok, true);
  const follow = (await f.req('/v1/god/builds', { id: 'high-1-2', root: 'high-1', title: 'Bakery awning', steps: ['awning'], site: s.build.site, brief: 'Add an awning' })).data;
  assert.equal(follow.ok, true, JSON.stringify(follow)); assert.deepEqual(follow.build.district, { id: 'high', plots: ['p1', 'p2'] });
  const after = (await f.req('/v1/god/districts/high')).data.district;
  assert.equal(after.plots.find((p: any) => p.id === 'p1').chapter, 'high-1-2'); assert.equal(after.chapters.find((c: any) => c.id === 'high-1-2').followUpOf, 'high-1');
  assert.deepEqual(after.next, { action: 'resume', id: 'high-1-2', plots: ['p1', 'p2'] });
});

test('Y3: one undo per chapter; abandoned and undone chapters free their plots; the plan survives restart', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assert.equal((await f.req('/v1/god/districts', streetPlan())).data.ok, true);
  const leases: Record<string, string> = {};
  for (const [i, xs] of [[1, [-40, -40]], [2, [0, 0]], [3, [40, 40]]] as const) {
    const s = (await f.req('/v1/god/builds', { id: `high-${i}`, district: { id: 'high' } })).data; assert.equal(s.ok, true); leases[i] = s.lease;
    assert.equal(f.god.act({ ops: [bench(`n-${i}`, xs[0], -16)], build: { id: `high-${i}`, lease: s.lease } }).accepted, true);
    assert.equal(f.god.act({ ops: [bench(`s-${i}`, xs[1], 16)], build: { id: `high-${i}`, lease: s.lease } }).accepted, true);
    assert.equal((await f.req(`/v1/god/builds/high-${i}/done`, {})).data.ok, true);
  }
  const names = () => ['n-1', 's-1', 'n-2', 's-2', 'n-3', 's-3'].filter(n => f.god.model.get(n));
  assert.deepEqual(names(), ['n-1', 's-1', 'n-2', 's-2', 'n-3', 's-3']);
  const undo = f.god.undoGroup('high-2'); assert.equal(undo.accepted, true); assert.equal(undo.reverted.length, 2);
  assert.deepEqual(names(), ['n-1', 's-1', 'n-3', 's-3'], 'undoing chapter 2 leaves chapters 1 and 3 intact');
  const restarted = new GodMode(f.db, { worldId: 'district-test', ownerId: 'owner', tick: () => 1, emit() {} });
  const view = restarted.districts.view('high')!;
  assert.deepEqual(view.plots.map(p => p.status), ['built', 'built', 'undone', 'undone', 'built', 'built']); assert.deepEqual(view.next, { action: 'start', id: 'high-4', plots: ['p3', 'p4'] });
  const caller = restarted.godIdentity(f.token)!, rebuilt = restarted.builds.start({ id: 'high-4', district: { id: 'high' } }, caller);
  assert.equal(rebuilt.ok, true); if (!rebuilt.ok) return;
  const abandoned = restarted.builds.abandon('high-4', {}, () => ({ accepted: true, reverted: [], notReverted: [] })); assert.equal(abandoned.ok, true);
  assert.deepEqual(restarted.districts.view('high')!.next, { action: 'start', id: 'high-5', plots: ['p3', 'p4'] });
  assert.equal(restarted.undoGroup('high-1').accepted, true); assert.equal(restarted.undoGroup('high-3').accepted, true);
  assert.equal(restarted.model.get('n-1'), undefined); assert.equal(restarted.model.get('s-3'), undefined);
  assert.equal(restarted.districts.view('high')!.counts.built, 0);
});
