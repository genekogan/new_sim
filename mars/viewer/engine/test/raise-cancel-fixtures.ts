import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial, type Contributor } from '../spatial/service.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { raiseUpright } from '../construction/raise.ts';
import { uprightsSupported } from '../construction/invariants.ts';
import { def } from '../world/catalog.ts';
import type { ActionDef } from '../actions/types.ts';
import type { SpatialScene } from '../spatial/types.ts';

export function raiseFixture(ft = 12, count = 2, action: ActionDef = raiseUpright, contributors: Contributor[] = []) {
  const base: SpatialScene = { bounds: [-15, -15, 15, 15], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [15, 15], yaw: 0 } }], obstacles: [], links: [] };
  const crew = Array.from({ length: count }, (_, i) => `p${i + 1}`);
  const definition = `upright-${ft}ft`;
  const world = addAll(emptyWorld('raise-cancel', base), component('frame', definition, [0, def(definition).size[2] / 2, 0], 0, { phase: 'staged', pose: { p: [0, def(definition).size[2] / 2, 0], yaw: 0, pitch: Math.PI / 2 } }), ...crew.map((id, i) => human(id, -6 + i * 1.2, -6)));
  const rt = new Runtime(world, new Map([[walkTo.verb, walkTo as ActionDef], [action.verb, action]]), { spatial: new Spatial(base, { contributors }) }, [...DEFAULT_INVARIANTS, uprightsSupported]);
  return { rt, crew, base };
}

// Identical fixture/recorder for the pre-change action and current action compatibility capture.
export async function normalRaiseProof(action: ActionDef = raiseUpright) {
  const { TakeRecorder } = await import('../take/recorder.ts');
  const { hashOf } = await import('../core/hash.ts');
  const proofs = [];
  for (const ft of [8, 9, 12, 16, 19]) for (let count = def(`upright-${ft}ft`).handling!.raiseCrew!; count <= 4; count++) {
    const { rt, crew } = raiseFixture(ft, count, action);
    const recorder = new TakeRecorder(rt, { rulesVersion: 'raise-cancel-compatibility' });
    const r = rt.submit('raise_upright', { item: 'frame', crew });
    rt.runUntilIdle(2000, [r.id]);
    proofs.push({ ft, count, status: r.status, tick: rt.tick, world: rt.stateHash(), events: hashOf(rt.events), take: hashOf(recorder.finish()), violations: rt.violations });
  }
  return proofs;
}
