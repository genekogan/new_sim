// Eyes (M3): GET /v1/edge/view — sightline, deterministic caption, privacy (nothing behind walls, no other places'
// occupants), cache, rate limits and the 503 caption-only fallback. The render worker is replaced by a fake renderer
// that records what it was asked to draw (the real worker is exercised in team/proofs/eyes-20261008).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {accept} from '../test/native-owner-fixture.ts';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';
import {edgeSoulResolver} from './edge/routes.ts';
import {mountEdgeEyes} from './edge/eyes/routes.ts';
import {buildOccluders, clearLine, computeSight, lightOf, compassOf, sideOf, type SightInput} from './edge/eyes/sight.ts';
import {fixtureName, plainName} from './edge/eyes/view.ts';
import {EyesUnavailable, type EyesRenderer, type RenderJob} from './edge/eyes/worker.ts';
import type {Place} from './edge/ledger/places.ts';

const house: Place = {id: 'house', name: 'House', kind: 'building', parent: 'root', polygon: [[30.5, 12], [37.5, 12], [37.5, 18], [30.5, 18]], level: 0, enclosed: true, capacity: null, starting: false};
const root: Place = {id: 'root', name: 'Eden', kind: 'world', parent: null, polygon: [[-100, -100], [100, -100], [100, 100], [-100, 100]], level: 0, enclosed: false, capacity: null, starting: true};
const body = (id: string, x: number, z: number, yaw = 0, enclosure: string | null = null, activity = 'idle', state = 'standing') =>
  ({soulId: 's_' + id, entityId: 'h_' + id, name: id, p: [x, 0, z] as [number, number, number], yaw, level: 0, enclosure, state, activity});
function input(over: Partial<SightInput> = {}): SightInput {
  const me = body('me', 34, 4, Math.PI / 2);
  return {me, pose: {p: [34, 1.62, 4], yaw: Math.PI / 2, pitch: -0.06, hfov: Math.PI / 2, vfov: 1}, gaze: {mode: 'forward', yaw: Math.PI / 2}, light: lightOf('2026-11-30T10:00:00.000Z', {clouds: 0}, false),
    place: 'Lawn', enclosureName: null, others: [body('bea', 34, 24, -Math.PI / 2), body('cy', 31, 8, -Math.PI / 2, null, 'warm'), body('dot', 34, -6), body('eve', 33, 15, 0, 'house')],
    fixtures: [{id: 'fire', name: 'campfire', p: [35, 0, 7], enclosure: null}], spots: [], places: [root, house], containing: new Set(['root']), occluders: buildOccluders([root, house], {}), ...over};
}

test('eyes sight: walls, field of view and enclosures decide who is seen; the caption is deterministic', () => {
  const a = computeSight(input()), b = computeSight(input());
  assert.deepEqual(a, b, 'same state → same sight, byte for byte');
  assert.deepEqual(a.souls.map(s => s.name), ['cy'], 'bea is behind the house, dot is behind me, eve is inside');
  assert.ok(a.alt.includes('cy, ') && !/bea|dot|eve/.test(a.alt), a.alt);
  assert.ok(a.alt.includes('warming by the fire') && a.alt.includes('facing you'), a.alt);
  assert.ok(a.things.some(t => t.id === 'house') && a.things.some(t => t.id === 'fire'), 'the house and the fire are in view');
  // without the house in the way, bea is seen
  const open = computeSight(input({places: [root], occluders: buildOccluders([root], {})}));
  assert.deepEqual(open.souls.map(s => s.name).sort(), ['bea', 'cy']);
  // turning the head behind shows dot, not cy
  const back = computeSight(input({gaze: {mode: 'behind', yaw: -Math.PI / 2}, pose: {...input().pose, yaw: -Math.PI / 2}}));
  assert.deepEqual(back.souls.map(s => s.name), ['dot']); assert.ok(back.alt.includes('head turned behind'), back.alt);
  // left to right: a Soul on the left is listed before one on the right
  const lr = computeSight(input({others: [body('right', 30, 10), body('left', 38, 10)], places: [root], occluders: buildOccluders([root], {})}));
  assert.ok(lr.alt.indexOf('left,') < lr.alt.indexOf('right,'), lr.alt);
  // night shortens sight outdoors
  const night = computeSight(input({light: lightOf('2026-11-30T02:00:00.000Z', {}, false), others: [body('far', 34, 30)], places: [root], occluders: buildOccluders([root], {})}));
  assert.equal(night.souls.length, 0); assert.ok(night.alt.includes('night (dark'), night.alt);
});

test('eyes geometry helpers', () => {
  const occ = buildOccluders([root, house], {solids: [{id: 'wall', c: [0, 10], half: [5, 0.2], yaw: 0, height: 3}, {id: 'rail', c: [0, 20], half: [5, 0.2], yaw: 0, height: 1}],
    interiors: [{place: 'house', doors: [[34, 12, 35, 12]], walls: [[34, 12, 34, 18]], furniture: [{id: 'shelf', c: [32, 15], half: [0.3, 1], yaw: 0, height: 2}]}]});
  assert.equal(clearLine(occ, [0, 0], [0, 15]), false, 'a tall solid blocks');
  assert.equal(clearLine(occ, [0, 15], [0, 25]), true, 'a low rail does not');
  assert.equal(clearLine(occ, [31, 13], [37, 17]), false, 'an interior wall run blocks inside');
  assert.equal(clearLine(occ, [35, 13], [37, 17]), true, 'same room, clear');
  assert.equal(clearLine(occ, [31, 13], [31, 25]), false, 'from inside to outside a wall is in the way');
  assert.deepEqual([compassOf(0).compass, compassOf(-Math.PI / 2).compass, compassOf(Math.PI / 2).compass, compassOf(Math.PI).compass], ['east', 'north', 'south', 'west']);
  assert.deepEqual([sideOf(-0.7, Math.PI / 2), sideOf(0, Math.PI / 2), sideOf(0.7, Math.PI / 2)], ['far left', 'ahead', 'far right']);
  assert.equal(fixtureName({id: 'social-eden-fire-bench-north', def: 'bench-6ft', label: 'Fire Bench North'}), 'Fire bench');
  assert.equal(fixtureName({id: 'social-eden-dining-chair-north-2', def: 'camp-chair', label: 'Dining Chair North 2'}), 'camp chair');
  assert.equal(plainName('Reading table, east (south side)'), 'Reading table'); assert.equal(plainName('Post box 6'), 'Post box');
  // caption weather = the viewer's clock weather (atmosphere/weather.ts, mirrored), including the eased change between slots
  assert.deepEqual(lightOf('2026-12-01T04:10:00.000Z', {}, false).weather, ['rain starting', 'stormy', 'raining']);
  assert.deepEqual(lightOf('2026-12-01T06:20:00.000Z', {}, false).weather, ['rain clearing', 'clear sky']);
  assert.deepEqual(lightOf('2026-12-01T07:10:00.000Z', {}, false).weather, ['clear sky']);
});

class FakeRenderer implements EyesRenderer {
  jobs: RenderJob[] = []; up = true;
  status() {return {state: this.up ? 'ready' as const : 'down' as const, renderer: 'fake', detail: this.up ? null : 'stopped for the test', queue: 0, renders: this.jobs.length, failures: 0, latencyMs: {p50: null, p95: null, last: null}, since: null};}
  async render(job: RenderJob) {if (!this.up) throw new EyesUnavailable('stopped'); this.jobs.push(job); return {jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), ms: 12, queueMs: 0, frameTick: 1};}
  close() {}
}

test('eyes route: privacy, cache, per-Soul and global limits, 503 caption fallback, gaze refusals', {timeout: 600000}, async t => {
  const w = await edenNavWorld(4, {nav: false}); t.after(() => {w.f.host.stop();w.f.db.close();});
  const tokens = new Map<string, string>(); w.souls.forEach((s, i) => tokens.set('tok' + i, s.soulId));
  const resolver = edgeSoulResolver(w.f.host, w.f.souls, () => undefined);
  const soulOf = (c: any) => {const id = tokens.get(c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? ''); const s = w.souls.find(x => x.soulId === id); if (!s) return resolver(c); return s;};
  let clock = 1_000_000;
  const fake = new FakeRenderer(), app = new Hono(), bare = new Hono();
  const deps = {host: w.f.host, db: w.f.db, souls: w.f.souls, soul: soulOf, ledger: w.ledger};
  mountEdgeEyes(app, deps, {renderer: fake, now: () => clock, soulSeconds: 30, globalPerMinute: 3});
  mountEdgeEyes(bare, deps, {now: () => clock});   // no render worker on this server
  const place = (i: number, x: number, z: number, yaw: number) => {const e = (w.engine.world.entities as any)[w.souls[i].entityId]; e.pose.p = [x, 0, z]; e.pose.yaw = yaw; if (e.human) e.human.activity = 'idle';};
  // A faces south toward house 1; B stands behind it; C is in front; D is inside the library (another building)
  place(0, 34, 4, Math.PI / 2); place(1, 34, 24, -Math.PI / 2); place(2, 31, 8, -Math.PI / 2); place(3, 74, -7, 0);
  const get = async (a: Hono, i: number, q = '') => {const r = await accept(w.f.host, Promise.resolve(a.request('/v1/edge/view' + q, {headers: {authorization: 'Bearer tok' + i}}))); return {status: r.status, body: await r.json() as any};};

  const first = await get(app, 0);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const names = first.body.seen.souls.map((s: any) => s.soulId);
  assert.deepEqual(names, [w.souls[2].soulId], 'only C is in view');
  assert.ok(!first.body.alt.includes(w.souls[1].name) && !first.body.alt.includes(w.souls[3].name), 'nobody behind walls or elsewhere in the caption: ' + first.body.alt);
  assert.deepEqual(fake.jobs[0].show, [w.souls[2].entityId], 'the frame shows exactly the seen Souls');
  assert.equal(fake.jobs[0].self, w.souls[0].entityId);
  assert.ok(Math.abs(fake.jobs[0].pose.p[1] - 1.62) < 1e-6 && Math.abs(fake.jobs[0].pose.yaw - Math.PI / 2) < 1e-9, 'eye height and heading');
  assert.match(first.body.url, /^\/v1\/edge\/view\/img\/[0-9a-f]{32}\.jpg$/); assert.equal(first.body.cached, false);
  const img = await app.request(first.body.url); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await img.arrayBuffer())], [0xff, 0xd8, 0xff, 0xd9]);

  // determinism and cache: same state → same caption, same picture URL, no second render
  const again = await get(app, 0);
  assert.equal(again.status, 200); assert.equal(again.body.cached, true); assert.equal(again.body.url, first.body.url); assert.equal(again.body.alt, first.body.alt); assert.equal(fake.jobs.length, 1);
  // alt=only is free and identical
  const alt = await get(app, 0, '?alt=only'); assert.equal(alt.status, 200); assert.equal(alt.body.alt, first.body.alt); assert.equal(alt.body.url, null);

  // per-Soul limit: a different gaze inside 30 s is refused with the caption; later it renders
  const left = await get(app, 0, '?gaze=left');
  assert.equal(left.status, 429); assert.equal(left.body.error.code, 'eyes.rate-limited'); assert.ok(left.body.retry_after > 0 && left.body.alt.includes('head turned left'), JSON.stringify(left.body));
  clock += 31_000;
  const left2 = await get(app, 0, '?gaze=left'); assert.equal(left2.status, 200, JSON.stringify(left2.body)); assert.equal(left2.body.gaze.mode, 'left');
  const held = await get(app,0,'?alt=only');
  assert.ok(Math.abs(held.body.gaze.yaw-left2.body.gaze.yaw)<0.001,'no-gaze view follows logged Core-A look');
  const attentionRows=w.f.db.db.prepare("SELECT capability,detail FROM edge_receipts_v1 WHERE soul_id=? AND capability='look:left'").all(w.souls[0].soulId) as {capability:string;detail:string}[];
  assert.ok(attentionRows.length>=1 && attentionRows.every(r=>JSON.parse(r.detail).channel==='attention'),'explicit view gaze has a quiet independent attention receipt');
  // looking at C by id turns the head toward C; looking at B (behind the house) or D (inside elsewhere) is refused
  clock += 31_000;
  const atC = await get(app, 0, '?gaze=' + w.souls[2].soulId); assert.equal(atC.status, 200); assert.equal(atC.body.gaze.mode, 'target');
  assert.equal((await get(app, 0, '?gaze=' + w.souls[3].soulId)).body.error.code, 'gaze.not-visible');
  assert.equal((await get(app, 0, '?gaze=nothing-here')).body.error.code, 'gaze.unknown');

  // global limit: 3 renders per minute across Souls
  const others = [await get(app, 1), await get(app, 2), await get(app, 3)];
  assert.deepEqual(others.map(o => o.status), [200, 429, 429]); assert.equal(others[1].body.error.code, 'eyes.busy');
  // B sees nobody (the house hides A and C); D inside the library sees nobody from outside
  assert.deepEqual(others[0].body.seen.souls, []);
  const dAlt = await get(app, 3, '?alt=only'); assert.ok(dAlt.body.where.inside && dAlt.body.alt.includes('inside'), dAlt.body.alt); assert.deepEqual(dAlt.body.seen.souls, []);

  // map mode: overhead around the Soul, only Souls it could see around it
  clock += 61_000;
  const map = await get(app, 2, '?mode=map'); assert.equal(map.status, 200, JSON.stringify(map.body));
  assert.equal(fake.jobs.at(-1)!.mode, 'map'); assert.deepEqual([fake.jobs.at(-1)!.w, fake.jobs.at(-1)!.h], [256, 256]);
  assert.ok(map.body.alt.startsWith('Overhead view') && map.body.alt.includes(w.souls[0].name) && !map.body.alt.includes(w.souls[1].name), map.body.alt);

  // no worker: 503 with the caption; worker down: same; alt=only still works
  const none = await get(bare, 1); assert.equal(none.status, 503); assert.equal(none.body.error.code, 'eyes.unavailable'); assert.ok(none.body.alt.length > 40);
  fake.up = false; clock += 61_000;
  const down = await get(app, 1, '?gaze=right'); assert.equal(down.status, 503); assert.ok(down.body.alt.includes('head turned right'));
  assert.equal((await get(bare, 1, '?alt=only')).status, 200);
  // bad input and auth
  assert.equal((await get(app, 0, '?w=5000')).status, 400);
  assert.equal((await app.request('/v1/edge/view')).status, 401);
  assert.equal((await app.request('/v1/edge/view/img/' + 'a'.repeat(32) + '.jpg')).status, 404);
  // expiry: after the URL lifetime the picture is gone
  clock += 11 * 60_000; assert.equal((await app.request(first.body.url)).status, 404);
});
