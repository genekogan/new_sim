import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCast, normalizeCast } from '../cast.mjs';
import { NUDGE, plannerPrompt, templateDirections } from '../planner.mjs';
import { posAt, projectTruth, speechOf } from '../truth.mjs';
import { podiumOf, renderVerdictMd, verifySession } from '../verify.mjs';
import { testCast, WALL0 } from './fakes.mjs';

const CASTS = join(dirname(fileURLToPath(import.meta.url)), '../../../scenarios/casts');
const PODIUM = { label: 'the lectern at the front', pos: [10, -5], radiusM: 2 };

test('podium casts load: five haiku seats, a podium, fromPodium required; Eden with the opus planner, Mars without', () => {
  const e = loadCast(join(CASTS, 'podium-eden-hall.json')), m = loadCast(join(CASTS, 'podium-mars-room.json'));
  for (const c of [e, m]) {
    assert.equal(c.seats.length, 5); assert.ok(c.seats.every((s) => s.model === 'haiku'));
    assert.equal(c.order.length, 5); assert.equal(c.success.fromPodium, true); assert.ok(c.podium.radiusM > 0);
    assert.deepEqual(c.observer.viewport, [1024, 640]);
  }
  assert.equal(e.orchestrator.planner, 'opus'); assert.equal(m.orchestrator.planner, null);
  assert.equal(testCast().success.fromPodium, false, 'casts without a podium keep the old success condition');
});

test('normalizeCast: podium shape, and fromPodium without a podium', () => {
  const base = { kind: 'cast', name: 'p', brief: 'b', world: { kind: 'url' }, room: { label: 'r', match: ['r'] }, seats: [{ id: 'a', soulName: 'A', character: 'c' }] };
  assert.throws(() => normalizeCast({ ...base, podium: { pos: [1], radiusM: 0 } }), (e) => /podium.label/.test(e.message) && /podium.pos/.test(e.message) && /radiusM/.test(e.message));
  assert.throws(() => normalizeCast({ ...base, success: { fromPodium: true } }), /needs a podium/);
  assert.equal(normalizeCast({ ...base, podium: PODIUM }).podium.label, PODIUM.label);
});

test('directions send the speaker to the podium on its turn (templates, nudge, override, planner prompt)', () => {
  const c = testCast({ cast: { podium: PODIUM } });
  const d = templateDirections(c, 'bob');
  assert.match(d.go, /walk Bob up to the lectern at the front and give the talk from there/);
  assert.doesNotMatch(d.gather, /lectern/, 'gathering is to the room, not the podium');
  assert.match(NUDGE.speak(c, c.seats[1]), /stand at the lectern at the front/);
  assert.match(NUDGE.goOverride(c, c.seats[1], 'talk about pianos.'), /up to the lectern/);
  assert.match(plannerPrompt(c), /Podium: the lectern at the front/);
  const plain = testCast();
  assert.doesNotMatch(templateDirections(plain, 'bob').go + plannerPrompt(plain), /podium|lectern/i);
});

test('truth: each speech line carries where the body was at its tick (newest receipt ended by then)', () => {
  const pub = {
    self: { placePath: [{ name: 'hall' }] },
    receipts: [
      { id: 'r3', capability: 'walk:door', endedTick: 300, endedAt: { pos: [0, 0] } },
      { id: 'r2', capability: 'say', endedTick: 205, endedAt: { pos: [10.5, -5] } },
      { id: 'r1', capability: 'walk:podium', endedTick: 200, endedAt: { pos: [10, -5.2] } },
      { id: 'r0', capability: 'wave', phase: 'started' },
    ],
    events: [{ kind: 'speech', tick: 206, at: WALL0 + 1000, text: 'my talk' }, { kind: 'speech', tick: 150, at: WALL0, text: 'early' }],
  };
  const sp = speechOf(pub);
  assert.deepEqual(sp.map((s) => s.pos), [null, [10.5, -5]]);
  assert.match(sp[1].posSource, /r2 \(say\)/);
  assert.deepEqual(posAt(pub).pos, [0, 0], 'no tick: the newest ended receipt');
  const t = projectTruth('s_1', pub); assert.deepEqual(t.pos, [0, 0]); assert.match(t.posSource, /r3/);
  assert.equal(projectTruth('s_1', { self: {} }).pos, null);
});

test('verify fromPodium: talks from the podium pass; one from the floor or with no position fails the cast', () => {
  const cast = testCast({ cast: { podium: PODIUM, success: { fromPodium: true } } });
  const at = (s) => new Date(WALL0 + s * 1000).toISOString();
  const directions = [{ seat: 'ann', kind: 'go', t: at(100) }, { seat: 'bob', kind: 'go', t: at(200) }, { seat: 'cy', kind: 'go', t: at(300) }];
  const presence = ['ann', 'bob', 'cy'].map((seat) => ({ seat, present: true, t: at(50) }));
  const sp = (seat, s, pos) => ({ seat, atMs: WALL0 + s * 1000, at: at(s), text: `${seat} says a talk that is long enough to count as a presentation.`, present: true, pos });
  const ok = verifySession({ cast, directions, presence, speech: [sp('ann', 130, [10, -5]), sp('bob', 230, [11, -4]), sp('cy', 330, [9.2, -6])] });
  assert.equal(ok.pass, true, JSON.stringify(ok.checks)); assert.equal(ok.checks.fromPodium.pass, true);
  assert.match(ok.checks.fromPodium.detail, /3\/3 talks from the lectern/);
  const off = verifySession({ cast, directions, presence, speech: [sp('ann', 130, [10, -5]), sp('bob', 230, [20, 0]), sp('cy', 330, null)] });
  assert.equal(off.checks.fromPodium.pass, false); assert.equal(off.pass, false);
  assert.match(off.checks.fromPodium.detail, /away: bob 11\.2 m/); assert.match(off.checks.fromPodium.detail, /position unknown: cy/);
  assert.equal(off.seats.bob.podium.ok, false); assert.equal(off.seats.cy.podium.ok, null);
  assert.match(renderVerdictMd(cast, off, { seats: {}, planner: null, total: { turns: 0, inputTokens: 0, cachedTokens: 0, cacheCreationTokens: 0, outputTokens: 0, costUsd: 0 } }), /podium: the lectern at the front \(10, -5, ≤ 2 m\)[\s\S]*\| fromPodium \| FAIL/);
  // a podium cast that does not require it still reports the check but does not fail on it
  const soft = verifySession({ cast: testCast({ cast: { podium: PODIUM } }), directions, presence, speech: [sp('ann', 130, [10, -5]), sp('bob', 230, [20, 0]), sp('cy', 330, [10, -5])] });
  assert.equal(soft.checks.fromPodium.pass, false); assert.equal(soft.pass, true);
  // no podium: no such check
  assert.equal(verifySession({ cast: testCast(), directions, presence, speech: [sp('ann', 130)] }).checks.fromPodium, undefined);
  assert.equal(podiumOf(PODIUM, []), null);
});
