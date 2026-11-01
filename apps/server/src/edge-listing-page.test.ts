// L3 item 5 (server reliability, 2026-10-31): listings are a page. On the live Eden 2026 copy one `capabilities`
// response was 9,218 offers / 2.86 MB and one `observe` 4.16 MB (8,293 objects in `here.objects`). The page keeps
// everything within the Soul's reach and the nearest of the rest (<= 300 offers, <= 90 kB); the rest is counted and
// stays reachable by id (act reads the whole menu) or in full on request.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {pageCapabilities, pageObjects, LISTING, type Where} from './edge/ledger/listing.ts';
import {bootEden} from '../test/eden-capabilities-timing.ts';
import type {EdgeCapability} from './edge/contract.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json';

test('pageCapabilities: small menus unchanged; big ones keep reach, nearest and invitations, in the original order', () => {
  const small: EdgeCapability[] = [{id: 'wave:here', verb: 'wave', label: 'Wave', available: true}];
  assert.deepEqual(pageCapabilities(small, () => null, [0, 0]), {listed: small, omitted: null});
  const caps: EdgeCapability[] = [], where = new Map<string, Where>();
  for (let i = 0; i < 2000; i++) {const id = `walk:p${i}`; caps.push({id, verb: 'walk', label: `Walk to p${i}`, available: i % 7 !== 0}); where.set(id, [i, 0]);}
  caps.push({id: 'accept:x', verb: 'accept', label: 'Accept', available: true}); where.set('accept:x', [5000, 0]);
  caps.push({id: 'make:mark', verb: 'make', label: 'Make', available: true}); where.set('make:mark', null);
  const {listed, omitted} = pageCapabilities(caps, c => where.get(c.id) ?? null, [0, 0]);
  assert.ok(listed.length <= LISTING.max && JSON.stringify(listed).length <= LISTING.bytes);
  const ids = new Set(listed.map(c => c.id));
  for (const id of ['accept:x', 'make:mark', 'walk:p1', 'walk:p29']) assert.ok(ids.has(id), id);
  assert.equal(omitted?.count, caps.length - listed.length);
  assert.deepEqual(listed.map(c => c.id), caps.filter(c => ids.has(c.id)).map(c => c.id), 'original order kept');
  // amber/red: only within the dial's radius (and reach)
  const red = pageCapabilities(caps, c => where.get(c.id) ?? null, [0, 0], 'red').listed;
  assert.ok(red.every(c => {const w = where.get(c.id); return !Array.isArray(w) || w[0] <= LISTING.radius.red || c.verb === 'accept';}));
});

test('pageObjects: objects here and within reach always; over ones last; the rest counted by kind', () => {
  const objs = Array.from({length: 3000}, (_, i) => ({id: `cal-${i}`, kind: 'calendar-item', here: false, placeId: `p${i}`, public: {phase: i < 2990 ? 'over' : 'upcoming', title: 'x'.repeat(200)}}));
  objs.push({id: 'ride-1', kind: 'ride', here: true, placeId: 'far', public: {phase: 'idle', title: 'balloon'}});
  const at = (o: {placeId: string}): Where => o.placeId === 'far' ? [1e9, 1e9] : [Number(o.placeId.slice(1)), 0];
  const {listed, omitted} = pageObjects(objs, at, [0, 0]);
  const ids = new Set(listed.map(o => o.id));
  assert.ok(ids.has('ride-1'), 'here');
  for (let i = 2990; i < 2996; i++) assert.ok(ids.has(`cal-${i}`), `current item ${i} listed before over ones`);
  assert.ok(JSON.stringify(listed).length <= LISTING.bytes / 3 + 400);
  assert.equal(omitted?.count, objs.length - listed.length);
});

test('Eden 2026: the listed page keeps every offer within reach, and an offer left out still acts by id', {timeout: 600_000, skip: NO_EDEN}, async t => {
  const w = await bootEden(); t.after(() => w.close());
  for (let i = 0; i < 120; i++) w.host.tickOnce();
  const full = w.edge.capabilities(w.soul), page = w.edge.capabilitiesPage(w.soul);
  assert.ok(page.capabilities.length <= LISTING.max, `${page.capabilities.length} listed`);
  assert.ok(JSON.stringify(page).length <= 100_000, `${JSON.stringify(page).length} bytes`);
  const me = w.host.engine.world.entities[w.soul.entityId]!.pose.p, listed = new Set(page.capabilities.map(c => c.id));
  const where = (w.edge as unknown as {listingWhere(s: unknown): (c: EdgeCapability) => Where}).listingWhere(w.soul);
  const lost = full.filter(c => {const at = where(c); return !listed.has(c.id) && (at === null || at === 'here' || Math.hypot(at[0] - me[0], at[1] - me[2]) <= LISTING.reach);});
  assert.deepEqual(lost.map(c => c.id), [], 'nothing within reach is left out');
  if (full.length > page.capabilities.length) {
    assert.equal(page.omitted?.count, full.length - page.capabilities.length);
    assert.deepEqual(w.edge.capabilitiesPage(w.soul, {all: true}).capabilities.map(c => c.id), full.map(c => c.id));
    const far = full.find(c => !listed.has(c.id) && c.verb === 'walk' && c.available);
    if (far) {let done = false; const p = w.edge.act(w.soul, {capability: far.id}).finally(() => {done = true;}); for (let i = 0; i < 400 && !done; i++) {w.host.tickOnce(); await setImmediate(); w.host.drainInputs();} const r = await p; assert.equal((r as {accepted: boolean}).accepted, true, JSON.stringify(r).slice(0, 300));}
  }
});
