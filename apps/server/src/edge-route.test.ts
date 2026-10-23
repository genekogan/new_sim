// Lane AWARE (2026-10-23): perception only — `here` opens with the world's time and date, and `around?to=<words>` gives
// directions (metres, compass word, a landmark, the walk) to a named place, or says where a named Soul is (its building or
// outdoor place, never its room). Nothing moves; unknown names are a plain miss. Fake minds; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {coreAWorld} from '../test/core-a-fixture.ts';
import {compassWord} from './edge/perception/route.ts';
import {worldNow} from './edge/perception/here.ts';

test('compass words and the world-now line', () => {
  assert.deepEqual([0, 44, 90, 135, 180, 225, 270, 315, 359].map(compassWord), ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north']);
  assert.equal(worldNow({day: 18, hour: 3, minute: 33, datetime: '2026-10-21T03:33:00.000Z'}), 'Wed 21 Oct 2026 · 03:33 · night · world day 19');
});

test('here opens with now; around?to gives directions to a place and finds a Soul', {timeout: 300000}, async t => {
  const w = await coreAWorld(3); t.after(() => w.close());
  const [a, b] = w.souls, L = w.ledger;
  const h = await w.http(a, 'GET', '/v1/edge/here'); assert.equal(h.status, 200);
  if (h.body.here.clock) {const keys = Object.keys(h.body.here); assert.equal(keys[0], 'now'); assert.match(h.body.here.now, /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2} [A-Z][a-z]{2} \d{4} · \d\d:\d\d · \w+ · world day \d+$/);}
  // a place a has not been to, by its name
  const mine = new Set(L.placePathOf(a.soulId).map(p => p.id));
  const target = [...L.places.byId.values()].find(p => p.parent !== null && !mine.has(p.id) && !p.carrier && L.knowledge.knows(a.soulId, p.id) && /^[a-z]/i.test(p.name) && !p.name.includes('/'))!;
  assert.ok(target, 'a known place to ask for');
  const r = await w.http(a, 'GET', '/v1/edge/around?to=' + encodeURIComponent(target.name)); assert.equal(r.status, 200, JSON.stringify(r.body));
  const route = r.body.route; assert.equal(route.found, true, JSON.stringify(route)); assert.equal(route.place.id, target.id);
  assert.ok(Number.isInteger(route.m) && route.m >= 0); assert.match(route.dir, /^(north|south|east|west)(-(east|west))?$/); assert.match(route.say, new RegExp(`${route.m} m ${route.dir}`));
  assert.equal(route.walk, route.walk && route.walk.startsWith('walk:') ? route.walk : 'walk:?');
  assert.ok(r.body.around, 'around still comes with it');
  // a Soul by name: where it is, never moved by asking
  const before = JSON.stringify(w.f.host.engine.world.entities[b.entityId]?.pose);
  const s = (await w.http(a, 'GET', '/v1/edge/around?to=' + encodeURIComponent(b.name))).body.route;
  assert.equal(s.found, true, JSON.stringify(s)); assert.equal(s.soul.id, b.soulId); assert.ok(typeof s.at === 'string' && s.at.length > 0); assert.match(s.say, new RegExp(`^${b.name} is at`));
  assert.equal(JSON.stringify(w.f.host.engine.world.entities[b.entityId]?.pose), before);
  // an unknown name is a plain miss; no `to` keeps the old shape
  const miss = (await w.http(a, 'GET', '/v1/edge/around?to=zzqx-nowhere')).body.route; assert.equal(miss.found, false); assert.match(miss.reason, /No place or Soul/);
  const plain = await w.http(a, 'GET', '/v1/edge/around'); assert.equal(plain.body.route, undefined);
});
