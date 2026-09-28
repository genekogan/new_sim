// paint (owner feedback 2026-09-28 §8, W8): a person paints a 4x8 sheet standing upright on the ground —
// coverage of the reachable band reaches 1.0, hands inside the painting envelope every tick and
// reproducible from the take's grip slot, progress stored in the take; refusals: a non-paintable
// entity, a band out of reach, painting while walking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { component, human, emptyWorld, addAll } from '../world/factory.ts';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { walkTo } from '../locomotion/walk.ts';
import { PAINT_ACTIONS, paintEnvelopeGap, paintHands, REACH_HI, REACH_LO } from '../work/paint.ts';
import { TakeRecorder } from '../take/recorder.ts';
import { sampleTake } from '../take/replay.ts';
import { openGround } from './frame-fixtures.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Entity } from '../world/types.ts';

const DT = 1 / 20;

/** A 4x8 sheet standing on its short edge (2.44 m tall, 1.22 m wide), its front face toward −x; painter p1 3 m away. */
function wall(extra: Entity[] = [], bottom = 0) {
  const base = openGround();
  const sheet = component('w1', 'plywood-4x8', [0, bottom + 1.2192, 0], 0, { phase: 'placed' });
  sheet.pose.roll = Math.PI / 2;
  sheet.support = { kind: 'ground' };
  const w = addAll(emptyWorld('open-ground', base), sheet, human('p1', -3, 0.5), component('bm', 'beam-8ft', [-2, 0, 3], 0, { phase: 'stored' }), ...extra);
  const reg = new Map<string, ActionDef>([['walk_to', walkTo], ...PAINT_ACTIONS.map((a) => [a.verb, a] as [string, ActionDef])]);
  return new Runtime(w, reg, { spatial: new Spatial(base) }, [...DEFAULT_INVARIANTS]);
}

test('paint green: a person on the ground paints a standing 4x8 sheet — the reachable band 0.5–2.1 m reaches coverage 1.0, hands in the envelope every tick, progress in the take', () => {
  const rt = wall();
  const rec = new TakeRecorder(rt, { rulesVersion: 'test' });
  const r = rt.submit('paint', { actor: 'p1', panel: 'w1', color: '#e8c547' });
  assert.notEqual(r.status, 'failed', `${r.diagnostic?.code} ${r.diagnostic?.message}`);
  const E = rt.world.entities;
  let paintTicks = 0, ticks = 0, lastCov = 0;
  while (r.status !== 'completed' && r.status !== 'failed' && ticks++ < 20 * 120) {
    rt.step();
    const a = E.p1;
    if (a.human!.activity !== 'paint') continue;
    paintTicks++;
    const hs = a.human!.hands!;
    assert.ok(hs?.left && hs.right, 'both hand points published');
    for (const p of [hs.left!, hs.right!]) assert.ok(paintEnvelopeGap(a.pose.p, p) <= 1e-9, `hand outside the envelope at tick ${rt.tick}: ${paintEnvelopeGap(a.pose.p, p)}`);
    assert.deepEqual(paintHands(E.w1, a, a.human!.grip!.slot), [hs.left, hs.right], 'hands rebuilt from the grip slot');
    const b = hs.right![1] - a.pose.p[1];
    assert.ok(b >= REACH_LO - 1e-9 && b <= REACH_HI + 1e-9, `brush at ${b} m above the floor`);
    assert.ok(E.w1.paint!.coverage >= lastCov, 'coverage never decreases');
    lastCov = E.w1.paint!.coverage;
  }
  assert.equal(r.status, 'completed', `${r.diagnostic?.code} ${r.diagnostic?.message}`);
  const secs = paintTicks * DT;
  assert.ok(secs <= 20, `painted the reachable band in ${secs.toFixed(1)} s (≤ 20 s)`);
  const p = E.w1.paint!;
  assert.equal(p.color, '#e8c547');
  assert.equal(p.face, 'front');
  for (const band of p.bands) {
    if (band.from >= REACH_LO - 1e-9 && band.to <= REACH_HI + 1e-9) assert.equal(band.coverage, 1, `band ${band.from}–${band.to} fully painted`);
    if (band.to <= REACH_LO + 1e-9 || band.from >= REACH_HI - 1e-9) assert.equal(band.coverage, 0, `band ${band.from}–${band.to} (out of reach) unpainted`);
  }
  assert.equal(p.bands.find((b) => b.from === 0.4)!.coverage, 0.5, 'half of the 0.4–0.6 band is within reach');
  assert.equal(p.coverage, Math.round((1.6 / 2.4384) * 100) / 100);
  assert.equal(E.p1.human!.hands, undefined, 'hands cleared at the end');
  assert.deepEqual(rt.violations, [], JSON.stringify(rt.violations.slice(0, 3)));
  // the take has it: coverage changes over time, the final state carries the paint
  const take = rec.finish();
  const changes = take.changes.filter(([, id, f]) => id === 'w1' && f === 'paint');
  assert.ok(changes.length > 50, `${changes.length} paint changes recorded`);
  const mid = sampleTake(take, take.ticks * DT * 0.5).entities.w1.state.paint as { coverage: number };
  assert.ok(mid.coverage > 0 && mid.coverage < p.coverage, `mid-take coverage ${mid.coverage}`);
  assert.deepEqual(take.finalState.entities.w1.paint, p);
});

test('paint refusals: a non-paintable beam, a band above reach from the ground, a sheet mounted out of reach, painting while walking', () => {
  const rt = wall();
  const beam = rt.submit('paint', { actor: 'p1', panel: 'bm', color: 'red' });
  assert.equal(beam.diagnostic?.code, 'paint.not-paintable');
  assert.match(beam.diagnostic!.message, /8 ft .*bm has no paintable face/);
  const top = rt.submit('paint', { actor: 'p1', panel: 'w1', texture: 'flower-mural-2024', band: { from: 2.1, to: 2.4384 } });
  assert.equal(top.diagnostic?.code, 'paint.out-of-reach');
  assert.match(top.diagnostic!.message, /p1 standing on the ground \(floor 0\.00 m\) reaches 0\.50–2\.10 m; the band 2\.10–2\.44 m of w1's front face \(2\.10–2\.44 m\) is above that — stand on a deck or beam/);
  const both = rt.submit('paint', { actor: 'p1', panel: 'w1', color: 'red', texture: 'x' });
  assert.equal(both.diagnostic?.code, 'paint.what');
  // a sheet whose bottom edge is 2.3 m up: nothing of it is within reach from the ground
  const high = wall([], 2.3);
  const h = high.submit('paint', { actor: 'p1', panel: 'w1', color: 'red' });
  assert.equal(h.diagnostic?.code, 'paint.out-of-reach');
  assert.match(h.diagnostic!.message, /the band 0\.00–2\.44 m of w1's front face \(2\.30–4\.74 m\) is above that/);
  // walking: refused while the walk is under way
  const wk = rt.submit('walk_to', { actor: 'p1', x: -3, z: 4 });
  assert.notEqual(wk.status, 'failed');
  for (let i = 0; i < 10; i++) rt.step();
  assert.equal(rt.world.entities.p1.human!.activity, 'walk');
  const mv = rt.submit('paint', { actor: 'p1', panel: 'w1', color: 'red' });
  assert.equal(mv.diagnostic?.code, 'paint.while-walking');
  assert.match(mv.diagnostic!.message, /p1 is walking .*nobody paints on the move/);
});
