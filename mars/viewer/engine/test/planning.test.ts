// Planning budget (docs/engineering/PLANNING_BUDGET.md): the opt-in profiler,
// planner equality against the frozen reference A*, and the stress-30 bound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import type { ActionDef } from '../actions/types.ts';

function setup(...people: ReturnType<typeof human>[]) {
  const base = provingGround();
  const w = addAll(emptyWorld('proving-ground', base), ...people);
  return new Runtime(w, new Map<string, ActionDef>([['walk_to', walkTo]]), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
}

test('profiler: rt.profile = true records plan/step/spatial costs and never changes the run', () => {
  const run = (profile: boolean) => {
    const rt = setup(human('p1', -18, -15, { yaw: 0 }), human('p2', -15, 12));
    rt.profile = profile;
    rt.submit('walk_to', { actor: 'p1', x: -12, z: -15 });
    rt.submit('walk_to', { actor: 'p2', x: -15, z: 20 });
    assert.ok(rt.runUntilIdle(20 * 120));
    return rt;
  };
  const on = run(true), off = run(false);
  assert.equal(on.stateHash(), off.stateHash());
  assert.equal(off.prof, null);
  const st = on.prof!.stats;
  assert.equal(st.get('walk_to.plan')?.calls, 2);
  assert.equal(st.get('spatial.route')?.calls, 2);
  assert.ok(st.get('walk_to.step')!.calls > 100);
  assert.equal(st.get('invariants')?.calls, on.tick);
  assert.ok((st.get('spatial.sync')?.calls ?? 0) + (st.get('spatial.sync.rebuild')?.calls ?? 0) > 100);
  for (const r of on.prof!.report()) assert.ok(r.ms >= 0 && r.max <= r.ms + 1e-9, r.key);
  on.profile = false;
  assert.equal(on.prof, null);
  assert.equal((on.services.spatial as Spatial).prof, undefined);
});
