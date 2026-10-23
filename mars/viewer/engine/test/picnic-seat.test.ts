// SPOTS 2026-10-22: a picnic sits on the blanket (seat top 0.2 m, the ground); a tall body was refused pose.seat-too-low.
// Any body may picnic; a real 0.2 m seat (eat on a low stool) still refuses a tall body.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll } from '../world/factory.ts';
import { poseV1 } from '../social/pose.ts';
import type { ActionDef } from '../actions/types.ts';

const tall = () => {
  const scene = provingGround(), world = addAll(emptyWorld('proving-ground', scene), human('a', -6, -6));
  (world.entities.a as any).body = { family: 'humanoid', model: 'humanoid2-0123456789abcdef', params: { height: 1.85 } };
  const spatial = new Spatial(scene); spatial.sync(world);
  return new Runtime(world, new Map<string, ActionDef>([[poseV1.verb, poseV1 as ActionDef]]), { spatial }, DEFAULT_INVARIANTS);
};
test('a tall body picnics on a blanket (0.2 m); a 0.2 m seat for eating still does not fit it', () => {
  const rt = tall(), r = rt.submit('pose_v1', { actor: 'a', activity: 'picnic', seconds: 2, base: 'sit', seatHeight: 0.2 });
  assert.notEqual(r.status, 'failed', JSON.stringify(r).slice(0, 300));
  const rt2 = tall(), r2 = rt2.submit('pose_v1', { actor: 'a', activity: 'eat', seconds: 2, base: 'sit', seatHeight: 0.2 });
  assert.equal(r2.status, 'failed'); assert.match(JSON.stringify(r2), /seat-too-low/);
});
