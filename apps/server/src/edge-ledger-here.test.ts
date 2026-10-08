// perception/1 (Core-A): GET /v1/edge/here is a compact first-person frame (≤ ~600 tokens) strictly limited to what
// the Soul can perceive: same enclosure (or both outdoors), within 30 m, clear sightline past nav/1 solids. Bearings
// are relative to the Soul's heading. Conversations show members only, never what is said.
import test from 'node:test';
import assert from 'node:assert/strict';
import {coreAWorld} from '../test/core-a-fixture.ts';
import {bearingWord, clearSight, compassOf, headingOfYaw, relativeAngle, yawOfHeading} from './edge/perception/geometry.ts';
import {Perception} from './edge/perception/here.ts';

test('geometry: compass headings, bearings relative to heading, sightline', () => {
  assert.equal(compassOf(0, -1), 0); assert.equal(compassOf(1, 0), 90); assert.equal(compassOf(0, 1), 180); assert.equal(compassOf(-1, 0), 270);
  for (const h of [0, 45, 90, 135, 180, 225, 270, 315]) assert.equal(headingOfYaw(yawOfHeading(h)), h);
  // facing north at the origin: east is right, west is left, south is behind
  assert.equal(bearingWord(relativeAngle(0, [0, 0], [5, 0])), 'right'); assert.equal(bearingWord(relativeAngle(0, [0, 0], [-5, 0])), 'left');
  assert.equal(bearingWord(relativeAngle(0, [0, 0], [0, 5])), 'behind'); assert.equal(bearingWord(relativeAngle(0, [0, 0], [0, -5])), 'ahead');
  assert.equal(bearingWord(relativeAngle(0, [0, 0], [3, -3])), 'front-right'); assert.equal(bearingWord(relativeAngle(90, [0, 0], [0, -5])), 'left');
  const wall = [{id: 'w', c: [0, 0] as [number, number], half: [0.2, 3] as [number, number], yaw: 0, height: 3}], rail = [{...wall[0], height: 1.1}];
  assert.equal(clearSight([-4, 0], [4, 0], wall).clear, false); assert.equal(clearSight([-4, 0], [4, 0], rail).clear, true); assert.equal(clearSight([-4, 5], [4, 5], wall).clear, true);
});

test('here: compact, first person, bearings by heading; never other places, behind walls or conversation content', {timeout: 300000}, async t => {
  const w = await coreAWorld(6); t.after(() => w.close());
  const [a, b, c, d, e, f] = w.souls;
  const here = async (s: typeof a) => {const r = await w.http(s, 'GET', '/v1/edge/here'); assert.equal(r.status, 200); return r.body.here;};
  // A on open ground facing north; B east, C west, D south of A
  await w.put(a, [14, 14]); const turn: any = await w.act(a, 'stand:here'); void turn;
  const tr = (await w.http(a, 'POST', '/v1/edge/act', {verb: 'turn', heading: 0})).body; assert.equal(tr.accepted, true, JSON.stringify(tr)); assert.equal(tr.chosen.turned, 'body');
  assert.equal(headingOfYaw(w.body(a).pose.yaw), 0);
  const [ax, az] = w.pos(a); await w.put(b, [ax + 5, az]); await w.put(c, [ax - 5, az]); await w.put(d, [ax, az + 5]);
  const h1 = await here(a), near = new Map(h1.near.map((n: any) => [n.id, n]));
  assert.equal((near.get(b.soulId) as any)?.bearing, 'right', JSON.stringify(h1.near)); assert.equal((near.get(c.soulId) as any)?.bearing, 'left'); assert.equal((near.get(d.soulId) as any)?.bearing, 'behind');
  assert.equal((near.get(b.soulId) as any).earshot, true); assert.equal(h1.me.heading, 0); assert.equal(h1.me.facing, 'N'); assert.equal(h1.me.posture, 'standing');
  assert.ok(typeof h1.clock === 'string' && typeof h1.light === 'string' && typeof h1.day === 'string', JSON.stringify(h1));
  assert.ok(h1.exits.length > 0 && h1.exits.every((x: any) => x.walk.startsWith('walk:') && x.dir && x.eta), JSON.stringify(h1.exits));
  // facingMe: B turns to face A
  const fb = (await w.http(b, 'POST', '/v1/edge/act', {verb: 'turn', face: a.soulId})).body; assert.equal(fb.accepted, true, JSON.stringify(fb));
  assert.equal(((await here(a)).near.find((n: any) => n.id === b.soulId)).facingMe, true);
  // far away (> 30 m): not listed; inside the enclosed classroom: neither side sees the other
  await w.put(e, [ax + 45, az]); await w.put(f, [42, -6]);
  const h2 = await here(a); assert.ok(!h2.near.some((n: any) => n.id === e.soulId), 'beyond sight radius');
  assert.ok(!h2.near.some((n: any) => n.id === f.soulId), 'inside an enclosed room');
  assert.equal(w.ledger.enclosureOf(f.soulId), 'eden-classroom-1');
  const hf = await here(f); assert.ok(!hf.near.some((n: any) => [a, b, c, d].some(s => s.soulId === n.id)), 'from inside the room, nobody outside');
  assert.ok(hf.objects.some((o: any) => o.kind === 'seat' && o.id.startsWith('eden-classroom-seat')), 'inside: the room\'s seats');
  assert.ok(!JSON.stringify([hf.near, hf.objects, hf.conversations_in_earshot]).includes('social-eden'), 'no Soul or thing from outside the room (exits are public map walks)');
  // a building between two Souls hides them from each other (sightline against nav/1 solids)
  const P = new Perception(w.ledger, a), solids = P.solids().filter(s => (s.height ?? 3) >= 1.5 && s.half[0] < 7 && s.half[1] < 7 && s.half[0] > 1.5);
  let hidden = false;
  for (const s of solids) {
    const off = s.half[0] + 4, cs = Math.cos(s.yaw), sn = Math.sin(s.yaw), p1: [number, number] = [s.c[0] - cs * off, s.c[1] - sn * off], p2: [number, number] = [s.c[0] + cs * off, s.c[1] + sn * off];
    await w.put(e, p1); await w.put(c, p2);
    const q1 = w.pos(e), q2 = w.pos(c);
    if (Math.hypot(q1[0] - p1[0], q1[1] - p1[1]) > 1 || Math.hypot(q2[0] - p2[0], q2[1] - p2[1]) > 1 || w.ledger.enclosureOf(e.soulId) || w.ledger.enclosureOf(c.soulId)) continue;
    if (clearSight(q1, q2, [s]).clear) continue;
    const he = await here(e); assert.ok(!he.near.some((n: any) => n.id === c.soulId), `${s.id} hides them`);
    assert.ok(w.ledger.perceivedBodies(e.soulId, 30).some(n => n.soulId === c.soulId), 'within radius and both outdoors: only the wall hides them');
    t.diagnostic(`sightline blocked by ${s.label ?? s.id}`); hidden = true; break;
  }
  assert.ok(hidden, 'found a building to test the sightline');
  // conversations: members only, never the words
  await w.put(c, [ax - 2, az]); await w.put(b, [ax + 2, az]);
  const cv: any = w.comms.conversations.handle(b, {op: 'start', with: [c.soulId], text: 'SECRET-WORDS-1'}); assert.equal(cv.accepted, true, JSON.stringify(cv));
  w.comms.conversations.handle(c, {op: 'accept', conversation: cv.conversation.id}); w.comms.conversations.handle(c, {op: 'say', conversation: cv.conversation.id, text: 'SECRET-WORDS-2'});
  const h3 = await here(a), raw = JSON.stringify(h3);
  assert.ok(!raw.includes('SECRET'), 'no conversation content'); assert.ok(!raw.includes('owner') && !raw.includes('dev:'), 'no owner data');
  const talk = h3.conversations_in_earshot.find((x: any) => x.members.includes(b.name)); assert.ok(talk && talk.members.includes(c.name) && !talk.id && talk.public === false, JSON.stringify(h3.conversations_in_earshot));
  assert.match(h3.near.find((n: any) => n.id === b.soulId).doing, /talking with/);
  // size: a few hundred tokens (≈ 4 chars per token)
  t.diagnostic(`here frame ${raw.length} chars with ${h3.near.length} Souls, ${h3.objects.length} things, ${h3.exits.length} exits`);
  assert.ok(raw.length <= 2600, `frame ${raw.length} chars`);
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
});
