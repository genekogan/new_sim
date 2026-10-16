// D1 (lane freeze2): after the nav goal cache was warm, most of a GET /v1/edge/here on Eden 2026 was place-path reads:
// PlaceIndex.containing ran inPoly over all ~1200 places, about three times per comms object (~2300 objects: twice in
// every object capabilities listing, once in Perception.things), so a warm /here in the cafe still blocked the server
// ~1.4 s. Now containing tests bounding boxes first and the listings read the place path once. This checks the answers
// are the same as the plain inPoly scan (the old containing, kept here as the oracle), that a /here reads the place
// path a bounded number of times, and a generous wall-time budget (measured ~0.4 s on the laptop; was ~1.4 s).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {accept} from '../test/native-owner-fixture.ts';
import {bootEden} from '../test/eden-capabilities-timing.ts';
import {mountEdgeRoutes} from './edge/routes.ts';
import {inOutline, inPoly, type Place} from './edge/ledger/places.ts';

const WARM_HERE_BUDGET_MS = 1500, PLACE_PATH_READS_MAX = 20;
type V2 = [number, number];
const area = (p: V2[]) => Math.abs(p.reduce((s, [x, z], i) => {const [x2, z2] = p[(i + 1) % p.length]; return s + x * z2 - x2 * z;}, 0)) / 2;
/** The containing() this replaced: every place's outline walked, areas recomputed in the sort. */
function oracleContaining(this: {byId: Map<string, Place>}, x: number, z: number, level = 0): Place[] {
  return [...this.byId.values()].filter(p => !p.carrier && ((p.level ?? 0) === level && inPoly(x, z, p.polygon) || p.parent === null)).sort((a, b) => (a.parent === null ? 1 : 0) - (b.parent === null ? 1 : 0) || area(a.polygon) - area(b.polygon));
}

test('Eden 2026: /here in the cafe gives the same frame and capabilities, reads the place path a few times, within budget', {timeout: 600_000}, async t => {
  const w = await bootEden();
  t.after(() => w.close());
  const L = w.edge, soul = w.soul, app = new Hono();
  const comms = mountEdgeRoutes(app, {host: w.host, db: w.db, souls: w.souls, build: 'test', soul: () => soul, ledger: L});
  t.after(() => comms.close());
  await w.settle(45);   // the god's named things become readable comms objects
  const objects = L.comms?.objects.all().length ?? 0;
  assert.ok(objects > 1000, `Eden 2026 lists its named things as objects (${objects})`);
  await accept(w.host, w.host.enqueue('edge-relocate', 'test:put', {soulId: soul.soulId, entityId: soul.entityId, to: [100.5, 25]}));
  await w.settle(4);
  assert.deepEqual(L.placePathOf(soul.soulId).map(p => p.id).slice(0, 2), ['g-int-cafe.cafe', 'g-int-cafe'], 'the Soul stands in the cafe');
  const get = async (path: string) => {L.invalidateBodies(); const r = await app.request(path); assert.equal(r.status, 200); return JSON.stringify(await r.json());};

  const cold = await get('/v1/edge/here');   // pays the nav goals once (nav code, not measured here)
  // same tick, same state: the frame and the full capability list with the oracle containing are byte-identical
  const here = await get('/v1/edge/here'), caps = await get('/v1/edge/capabilities');
  assert.equal(here, cold);
  (L.places as unknown as {containing: typeof oracleContaining}).containing = oracleContaining;
  try {
    assert.equal(await get('/v1/edge/here'), here, '/here unchanged');
    assert.equal(await get('/v1/edge/capabilities'), caps, 'capabilities unchanged');
  } finally {delete (L.places as unknown as {containing?: unknown}).containing;}

  // the place path is read a few times per /here, not per object
  const own = L.placePathOf.bind(L); let reads = 0;
  (L as unknown as {placePathOf: typeof own}).placePathOf = (id: string) => {reads++; return own(id);};
  try {
    L.invalidateBodies(); const t0 = performance.now(), res = await app.request('/v1/edge/here'), ms = performance.now() - t0;
    assert.equal(res.status, 200);
    t.diagnostic(`warm /here in the cafe: ${Math.round(ms)} ms, ${reads} place-path reads, ${objects} objects`);
    assert.ok(reads <= PLACE_PATH_READS_MAX, `${reads} place-path reads for one /here (max ${PLACE_PATH_READS_MAX}; it was ~3 per object)`);
    assert.ok(ms < WARM_HERE_BUDGET_MS, `warm /here took ${Math.round(ms)} ms (budget ${WARM_HERE_BUDGET_MS})`);
  } finally {delete (L as unknown as {placePathOf?: unknown}).placePathOf;}

  // containing() agrees with the oracle everywhere: a grid over the world on every level, and each outline's vertices,
  // edge midpoints and 1e-9 m nudges on its own level; inOutline agrees with inPoly on the same points
  const places = [...L.places.byId.values()], xs = places.flatMap(p => p.polygon.map(v => v[0])), zs = places.flatMap(p => p.polygon.map(v => v[1]));
  const levels = [...new Set(places.map(p => p.level ?? 0))], pts: [number, number, number][] = [];
  const [x0, x1, z0, z1] = [Math.min(...xs) - 2, Math.max(...xs) + 2, Math.min(...zs) - 2, Math.max(...zs) + 2], step = Math.sqrt((x1 - x0) * (z1 - z0) / 2500);
  for (let x = x0; x <= x1; x += step) for (let z = z0; z <= z1; z += step) for (const l of levels) pts.push([x, z, l]);
  for (const p of places) p.polygon.forEach((v, i) => {const u = p.polygon[(i + 1) % p.polygon.length], l = p.level ?? 0; for (const q of [v, [(v[0] + u[0]) / 2, (v[1] + u[1]) / 2], [v[0] + 1e-9, v[1]], [v[0] - 1e-9, v[1]], [v[0], v[1] + 1e-9], [v[0], v[1] - 1e-9]]) pts.push([q[0], q[1], l]);});
  const ids = (a: Place[]) => a.map(p => p.id).join(',');
  let bad = 0;
  for (const [x, z, l] of pts) if (ids(L.places.containing(x, z, l)) !== ids(oracleContaining.call(L.places, x, z, l))) bad++;
  assert.equal(bad, 0, `containing() differs from the plain scan at ${bad} of ${pts.length} points`);
  let off = 0;
  for (const p of places) for (const [x, z] of [...p.polygon, ...pts.slice(0, 400).map(q => [q[0], q[1]] as V2)]) if (inOutline(x, z, p.polygon) !== inPoly(x, z, p.polygon)) off++;
  assert.equal(off, 0, 'inOutline == inPoly');
});
