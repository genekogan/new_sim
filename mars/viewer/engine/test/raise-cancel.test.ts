import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raiseFixture, normalRaiseProof } from './raise-cancel-fixtures.ts';
import { forgetMotion } from '../runtime/invariants.ts';
import { Runtime, DT } from '../runtime/runtime.ts';
import { Spatial, entityCorners } from '../spatial/service.ts';
import { human, component } from '../world/factory.ts';
import { def } from '../world/catalog.ts';
import { hypot } from '../core/math.ts';
import { isLying } from '../construction/lying.ts';
import { RAISE_REVERSE_LIMIT, recordRaise, raiseFrame, loweringIssue, type RaiseTrail } from '../construction/raise-lower.ts';
import { raiseUpright, LIFT_SPEED, liftHandPoint, raiseRoles } from '../construction/raise.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { ActionRecord } from '../actions/types.ts';

function capture(key: string, value: unknown) {
  const output = process.env.MARS_RAISE_CANCEL_CAPTURE;
  if (!output) return;
  const records = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : {};
  records[key] = value;
  writeFileSync(output, JSON.stringify(records, null, 2) + '\n');
}

function reach(rt: Runtime, r: ActionRecord, phase: string, ticks = 8) {
  for (let i = 0; i < 2000 && rt.isActive(r.id) && r.phase !== phase; i++) rt.step();
  assert.equal(r.phase, phase, r.diagnostic?.message);
  for (let i = 0; i < ticks; i++) rt.step();
  assert.ok(rt.isActive(r.id));
}
function lower(rt: Runtime, r: ActionRecord, crew: string[]) {
  const frame = rt.world.entities.frame;
  const before = structuredClone(rt.world);
  const requestedPhase = r.phase;
  const result = rt.cancel(r.id);
  assert.equal(result.diagnostic, undefined, result.diagnostic?.message);
  assert.ok(rt.isActive(r.id));
  assert.deepEqual(rt.world, before, 'cancel starts a deferred motion; it never snaps a pose');
  const begun = { tick: rt.tick, phase: requestedPhase, pose: structuredClone(frame.pose), support: structuredClone(frame.support), owners: rt.holder('entity:frame') };
  let ticks = 0;
  const samples: unknown[] = [];
  while (rt.isActive(r.id) && ticks++ < 2000) {
    const old = structuredClone(rt.world);
    rt.step();
    const d = (frame.pose.pitch ?? 0) - (old.entities.frame.pose.pitch ?? 0);
    assert.ok(d >= -1e-12 && d <= Math.PI / 2 / 5 * DT + 1e-12, `continuous lowering angle ${d}`);
    for (const id of crew) {
      const h = rt.world.entities[id], p = old.entities[id].pose.p;
      assert.ok(hypot(h.pose.p[0] - p[0], h.pose.p[2] - p[2]) <= LIFT_SPEED * DT + 1e-9, `${id} lowering pace`);
      if (rt.isActive(r.id)) {
        assert.equal(h.human!.task, r.id);
        assert.equal(h.human!.grip?.entity, frame.id);
        assert.ok(rt.holder(`actor:${id}`).includes(r.id));
      }
      if (h.human!.grip?.slot === 'lift-far') {
        const role = raiseRoles(crew).find((x) => x.actor === id)!;
        const hand = liftHandPoint(frame, 0, def(frame.def).size[2] / 2, role.side);
        assert.ok(hand[1] <= 1.9 + 1e-9);
        assert.ok(hypot(hand[0] - h.pose.p[0], hand[2] - h.pose.p[2]) <= 0.43);
      }
    }
    if (ticks % 20 === 0) samples.push({ tick: rt.tick, phase: r.phase, pose: structuredClone(frame.pose), holders: crew.map((id) => ({ id, pose: structuredClone(rt.world.entities[id].pose), grip: rt.world.entities[id].human!.grip })) });
    if (rt.isActive(r.id)) assert.deepEqual(frame.support, { kind: 'held', by: crew });
  }
  assert.equal(r.status, 'cancelled');
  assert.ok(ticks > 1);
  assert.ok(isLying(frame));
  assert.equal(frame.phase, 'staged');
  assert.deepEqual(frame.support, { kind: 'ground' });
  assert.ok(Math.abs(Math.min(...entityCorners(frame).map((p) => p[1]))) < 1e-8);
  for (const id of crew) {
    assert.equal(rt.world.entities[id].human!.grip, undefined);
    assert.equal(rt.world.entities[id].human!.task, undefined);
    assert.deepEqual(rt.holder(`actor:${id}`), []);
  }
  assert.deepEqual(rt.holder('entity:frame'), []);
  assert.deepEqual(rt.violations, []);
  capture(`${frame.def}/${crew.length}/${begun.phase}`, { begun, loweringTicks: ticks, samples, final: { tick: rt.tick, status: r.status, pose: frame.pose, support: frame.support, owners: rt.holder('entity:frame'), violations: rt.violations } });
}

for (const [ft, count, phase] of [[8, 1, 'raise'], [12, 2, 'raise'], [19, 3, 'step'], [19, 4, 'step'], [19, 4, 'set']] as const) {
  test(`raise cancel (LM-036): ${ft}ft/${count} crew continuously retraces ${phase} to supported lying`, () => {
    const { rt, crew } = raiseFixture(ft, count);
    const r = rt.submit('raise_upright', { item: 'frame', crew });
    reach(rt, r, phase, phase === 'set' ? 1 : 8);
    lower(rt, r, crew);
  });
}

test('raise cancel (LM-036): new static geometry and bystanders refuse the reverse sweep without changing support or owners', () => {
  for (const kind of ['frame-obstacle', 'carried-part', 'frame-person', 'holder-person']) {
    const { rt, crew } = raiseFixture();
    const r = rt.submit('raise_upright', { item: 'frame', crew });
    reach(rt, r, 'set', 1);
    if (kind === 'frame-obstacle' || kind === 'carried-part') rt.world.entities.blocker = component('blocker', 'plywood-4x6', [0, 0, 2.8], 0, { phase: 'staged' });
    else rt.world.entities.bystander = human('bystander', kind === 'holder-person' ? 1.0296 : 0, 2.8);
    if (kind === 'carried-part') { rt.world.entities.blocker.phase = 'carried'; rt.world.entities.blocker.support = { kind: 'held', by: ['other1', 'other2'] }; }
    const before = structuredClone(rt.world);
    const refused = rt.cancel(r.id);
    assert.equal(refused.diagnostic?.code, 'raise.cancel-unsafe', kind);
    assert.ok(refused.diagnostic?.subjects?.includes(kind === 'frame-obstacle' || kind === 'carried-part' ? 'blocker' : 'bystander'));
    assert.deepEqual(rt.world, before);
    capture(`refusal/${kind}`, { tick: rt.tick, diagnostic: refused.diagnostic, pose: rt.world.entities.frame.pose, support: rt.world.entities.frame.support, unchangedWorld: true, owners: rt.holder('entity:frame') });
    assert.ok(rt.isActive(r.id));
    assert.ok(rt.holder('entity:frame').includes(r.id));
    delete rt.world.entities.blocker;
    delete rt.world.entities.bystander;
    lower(rt, r, crew);
  }
});

test('raise cancel (LM-036): obstacles appearing during lowering block and retain the load until cleared', () => {
  const { rt, crew } = raiseFixture();
  const r = rt.submit('raise_upright', { item: 'frame', crew });
  reach(rt, r, 'set', 1);
  rt.cancel(r.id);
  for (let i = 0; i < 4; i++) rt.step();
  rt.world.entities.blocker = component('blocker', 'plywood-4x6', [0, 0, 2.8], 0, { phase: 'staged' });
  for (let i = 0; i < 1000 && r.status !== 'blocked'; i++) rt.step();
  assert.equal(r.status, 'blocked');
  assert.equal(r.diagnostic?.code, 'raise.cancel-unsafe');
  const pose = structuredClone(rt.world.entities.frame.pose);
  for (let i = 0; i < 5; i++) rt.step();
  assert.deepEqual(rt.world.entities.frame.pose, pose);
  assert.deepEqual(rt.world.entities.frame.support, { kind: 'held', by: crew });
  assert.ok(rt.holder('entity:frame').includes(r.id));
  delete rt.world.entities.blocker;
  rt.runUntilIdle(2000, [r.id]);
  assert.equal(r.status, 'cancelled');
  assert.deepEqual(rt.violations, []);
});


test('raise cancel (LM-036): moving and rotating held bodies are rechecked during lowering', () => {
  for (const variant of ['translated-load', 'rotated-load', 'vehicle']) {
    const { rt, crew } = raiseFixture();
    const r = rt.submit('raise_upright', { item: 'frame', crew });
    reach(rt, r, 'set', 1);
    const body = component('moving-body', variant === 'vehicle' ? 'bicycle' : 'plywood-4x6', [8, 0, 8], 0, { phase: 'carried', support: { kind: 'held', by: ['external-holder'] } });
    if (variant === 'vehicle') body.kind = 'vehicle';
    rt.world.entities[body.id] = body;
    const holder = human('external-holder', 9.8, 8);
    holder.human!.grip = { entity: body.id, slot: 'carry-l' };
    rt.world.entities[holder.id] = holder;
    assert.equal(rt.cancel(r.id).diagnostic, undefined);
    for (let i = 0; i < 4; i++) rt.step();
    // Another controller moves/rotates a held body after the full reverse preflight.
    body.pose.p = [0, 0, 2.8];
    holder.pose.p = [1.8, 0, 2.8];
    forgetMotion(rt); // External scene edit under test; the lowering action must revalidate it.
    if (variant === 'rotated-load') { body.pose.yaw = Math.PI / 3; body.pose.pitch = Math.PI / 4; }
    for (let i = 0; i < 1000 && r.status !== 'blocked'; i++) rt.step();
    assert.equal(r.status, 'blocked', variant);
    assert.equal(r.diagnostic?.code, 'raise.cancel-unsafe');
    assert.ok(r.diagnostic?.subjects?.includes(body.id));
    const held = structuredClone(rt.world);
    for (let i = 0; i < 3; i++) rt.step();
    assert.deepEqual(rt.world.entities, held.entities, 'blocked lowering cannot mutate either load or holders');
    assert.deepEqual(rt.world.entities.frame.support, { kind: 'held', by: crew });
    assert.ok(rt.holder('entity:frame').includes(r.id));
    delete rt.world.entities[body.id];
    holder.human!.grip = undefined;
    delete rt.world.entities[holder.id];
    rt.runUntilIdle(2000, [r.id]);
    assert.equal(r.status, 'cancelled');
    assert.deepEqual(rt.violations, []);
  }
});

test('raise cancel (LM-036): lowering snapshots restore tick-exactly and normal phases still refuse', () => {
  const { rt, crew, base } = raiseFixture(19, 4);
  const r = rt.submit('raise_upright', { item: 'frame', crew });
  reach(rt, r, 'step', 10);
  assert.throws(() => rt.snapshot(), /non-lowering/);
  const reason = { code: 'test.requested-cancellation', message: 'requested cancellation', subjects: [r.id] };
  rt.cancel(r.id, reason);
  for (let i = 0; i < 3; i++) rt.step();
  const snapshot = rt.snapshot();
  const bytes = Buffer.byteLength(JSON.stringify(snapshot));
  assert.ok(bytes < 1024 * 1024, `${bytes} snapshot bytes`);
  const clone = Runtime.restore(JSON.parse(JSON.stringify(snapshot)), rt.registry, { spatial: new Spatial(base) }, rt.invariants);
  const cursor = rt.events.length;
  for (let i = 0; i < 2000 && rt.isActive(r.id); i++) {
    rt.step(); clone.step();
    assert.equal(rt.stateHash(), clone.stateHash());
    assert.deepEqual(rt.holder('entity:frame'), clone.holder('entity:frame'));
  }
  assert.equal(r.status, 'cancelled');
  assert.deepEqual(r.diagnostic, reason);
  assert.deepEqual(clone.records.get(r.id)?.diagnostic, reason);
  assert.deepEqual(rt.events.slice(cursor), clone.events);
  assert.deepEqual(rt.violations, []);
  assert.deepEqual(clone.violations, []);
  capture('snapshot', { bytes, tick: snapshot.tick, stateHash: snapshot.stateHash, finalHash: rt.stateHash(), matchingEvents: true, violations: rt.violations });
  console.log(`# lowering snapshot ${bytes} bytes`);
});


test('raise cancel (LM-036): normal world, event and take outcomes match the pre-change action for every catalog frame and crew size', async () => {
  const expected = JSON.parse(readFileSync(new URL('./fixtures/raise-cancel.normal-baseline.json', import.meta.url), 'utf8'));
  let maxFrames = 0, maxBytes = 0;
  const observed: typeof raiseUpright = { ...raiseUpright, step(rt, ex, dt) {
    const result = raiseUpright.step(rt, ex, dt);
    if (ex.trail) {
      maxFrames = Math.max(maxFrames, ex.trail.frames.length);
      if (result.status === 'completed') maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(ex.trail)));
      assert.equal(ex.trail.overflow, false);
    }
    return result;
  } };
  const started = performance.now();
  const actual = await normalRaiseProof(observed);
  assert.deepEqual(actual, expected.cases);
  assert.ok(actual.every((p) => p.status === 'completed' && p.violations.length === 0));
  assert.ok(maxFrames < 400 && maxFrames < RAISE_REVERSE_LIMIT, `${maxFrames} frames`);
  assert.ok(maxBytes < 512 * 1024, `${maxBytes} trail bytes`);
  capture('normal-compatibility', { cases: actual.length, allWorldEventTakeHashesIdentical: true, maxFrames, maxBytes, limit: RAISE_REVERSE_LIMIT });
  console.log(`# normal raise compatibility ${actual.length} cases, max trail ${maxFrames} frames/${maxBytes} bytes, elapsed ${(performance.now() - started).toFixed(1)}ms`);
});

test('raise cancel (LM-036): overflow refuses without truncating or releasing the held frame', () => {
  let live: Parameters<typeof raiseUpright.step>[1] | undefined;
  const observed: typeof raiseUpright = { ...raiseUpright, step(rt, ex, dt) { live = ex; return raiseUpright.step(rt, ex, dt); } };
  const { rt, crew } = raiseFixture(12, 2, observed);
  const r = rt.submit('raise_upright', { item: 'frame', crew });
  reach(rt, r, 'raise');
  const original = structuredClone(live!.trail!.frames[0]);
  const trail: RaiseTrail = { frames: [], overflow: false };
  for (let i = 0; i <= RAISE_REVERSE_LIMIT; i++) recordRaise(trail, { ...original, pose: { ...original.pose, yaw: i / 1000 } });
  assert.equal(trail.overflow, true);
  assert.equal(trail.frames.length, RAISE_REVERSE_LIMIT);
  assert.deepEqual(trail.frames[0], original, 'never truncate the pickup state');
  live!.trail = trail;
  const before = structuredClone(rt.world);
  assert.equal(rt.cancel(r.id).diagnostic?.code, 'raise.cancel-unsafe');
  assert.deepEqual(rt.world, before);
  assert.ok(rt.holder('entity:frame').includes(r.id));
  rt.runUntilIdle(2000, [r.id]);
  assert.equal(r.status, 'completed', 'a refused cancel may still finish the raise');
  assert.deepEqual(rt.violations, []);
});

test('raise cancel (LM-036): missing floor support refuses before motion', () => {
  const { rt, crew, base } = raiseFixture();
  const r = rt.submit('raise_upright', { item: 'frame', crew });
  reach(rt, r, 'raise');
  rt.services.spatial = new Spatial({ ...base, surfaces: [] });
  const before = structuredClone(rt.world);
  assert.equal(rt.cancel(r.id).diagnostic?.code, 'raise.cancel-unsafe');
  assert.deepEqual(rt.world, before);
  assert.ok(rt.holder('entity:frame').includes(r.id));
  rt.services.spatial = new Spatial(base);
  lower(rt, r, crew);
});

test('LM-036 hypothetical proof fixture is explicit and does not alter probe presets', async () => {
  const { SCENARIOS, scenarioByName } = await import('../../app/lab/scenarios.ts');
  const { LabSim } = await import('../../app/lab/sim.ts');
  assert.equal(SCENARIOS.some((s) => s.name === 'raise-cancel-proof'), false);
  assert.equal(scenarioByName('raise-cancel-proof')?.title, 'Hypothetical raise cancellation proof');
  assert.equal(scenarioByName('raise-cancel-proo'), undefined);
  const sim = new LabSim();
  assert.throws(() => sim.load('raise-cancel-proo'), /unknown scenario/);
  sim.load('raise-cancel-proof');
  assert.equal(sim.rt.world.entities.A.kind, 'component');
});


test('raise cancel (LM-036): thin held sheets cannot penetrate the landing frame envelope', () => {
  const { rt, crew } = raiseFixture();
  const frame = raiseFrame(rt, 'frame', crew);
  const sheet = component('thin-held-sheet', 'plywood-4x6', [0, 0, 2.8], 0, { phase: 'carried', support: { kind: 'held', by: ['sheet-holder'] } });
  rt.world.entities[sheet.id] = sheet;
  // The 19mm sheet lies in the final landing envelope: a 20mm floor clearance would miss it.
  const issue = loweringIssue(rt, 'frame', frame, frame, 0);
  assert.equal(issue?.code, 'raise.cancel-unsafe');
  assert.ok(issue?.subjects?.includes(sheet.id));
  sheet.pose.p[1] = -def(sheet.def).size[1];
  assert.equal(loweringIssue(rt, 'frame', frame, frame, 0), null, 'exact vertical contact, without penetration, is permitted');
});
