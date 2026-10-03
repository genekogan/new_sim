// Engine Lab preset `solar-paint` (SOLAR_PAINT.md, YEAR_BUILD.md stock): the renderer's view of the
// W8 / W7 things on open ground, live where the engine can drive them:
//   * two painters paint two standing 4x8 sheets — one a colour, one the named flower-mural-2024
//     image texture: the per-band paint overlay grows with the engine's `paint.bands[].coverage`;
//   * two people carry a solar panel flat (fragile: ≤ 30° tilt, `carry/fragile.ts` checks it every tick);
//   * set pieces: a panel mounted at 20° on two rails, rails, a battery / charge controller / inverter with
//     their configuration on a label, every bundle / stack kind at a few counts (the drawn stack shrinks
//     with `contents.count`) and the cutting station.
// HYPOTHETICAL arrangement (a showcase, not a Mars place). Pure TS (no three.js/DOM).
import { Runtime } from '../../engine/runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../../engine/runtime/invariants.ts';
import { Spatial } from '../../engine/spatial/service.ts';
import { walkTo } from '../../engine/locomotion/walk.ts';
import { carry } from '../../engine/carry/actions.ts';
import { CARRY_INVARIANTS } from '../../engine/carry/invariants.ts';
import { PAINT_ACTIONS } from '../../engine/work/paint.ts';
import { bundleEntity } from '../../engine/construction/bundle.ts';
import { component, human, emptyWorld, addAll } from '../../engine/world/factory.ts';
import { def } from '../../engine/world/catalog.ts';
import type { ActionDef } from '../../engine/actions/types.ts';
import type { Entity, Provenance } from '../../engine/world/types.ts';
import type { Scenario } from './scenarios.ts';
import { buildBayGround } from './build-bay.ts';

const HYPO: Provenance = { origin: 'design-edit', confidence: 'hypothetical', note: 'lab showcase: solar, paint, stock' };
const DEG = Math.PI / 180;
export const SOLAR_PAINT = { panel: 'pv1', sheets: ['w1', 'w2'], painters: ['p1', 'p2'], carriers: ['c1', 'c2'], mounted: 'pv2' } as const;

/** A 4x8 sheet standing on its short edge, front face toward −x (engine/test/paint.test.ts `wall`). */
function standing(id: string, x: number, z: number): Entity {
  const s = component(id, 'plywood-4x8', [x, def('plywood-4x8').size[0] / 2, z], 0, { phase: 'placed' });
  s.pose.roll = Math.PI / 2;
  s.support = { kind: 'ground' };
  return s;
}

function entities(): Entity[] {
  const out: Entity[] = [standing('w1', 0, -1.5), standing('w2', 0, 1.8), human('p1', -3, -1.2), human('p2', -3, 2.2)];
  // a panel on the ground to be carried flat, and its crew
  out.push(component('pv1', 'solar-panel-100x170', [5, 0, -4], 0, { phase: 'stored', support: { kind: 'ground' } }), human('c1', 3.5, -6), human('c2', 6.5, -6));
  // mounted: two rails on the ground and a panel at 20° on them (low edge on the rails)
  const rl = def('panel-rail').size;
  for (const [id, z] of [['r1', 5.6], ['r2', 6.4]] as const) out.push(component(id, 'panel-rail', [-5, 0, z], 0, { phase: 'installed', support: { kind: 'ground' } }));
  const pv2 = component('pv2', 'solar-panel-100x200', [-5, rl[1], 6.0], 0, { phase: 'installed', support: { kind: 'resting-on', on: 'r1' } });
  pv2.pose.roll = 20 * DEG;
  pv2.connections = ['r1', 'r2'].map((r) => ({ socket: 'bears-on', to: r, toSocket: 'rail' }));
  out.push(pv2);
  // equipment with its configuration (a label on each)
  const eq = (id: string, d: string, x: number, config: Record<string, number | string>) => {
    const e = component(id, d, [x, 0, 9.5], 0, { phase: 'placed', support: { kind: 'ground' } });
    e.equipment = { kind: def(d).equipment!.kind, config: { ...def(d).equipment!.defaults, ...config } };
    return e;
  };
  out.push(eq('bat1', 'battery', -6.2, { capacityAh: 280 }), eq('cc1', 'charge-controller', -5.2, {}), eq('inv1', 'inverter', -4.2, { powerW: 2000 }));
  // stock: every bundle / stack kind, full and part-used, and the cutting station
  const piles: [string, string, number, number, number][] = [
    ['b-ply-full', 'bundle-plywood-4x8', 24, 9, -9], ['b-ply-part', 'bundle-plywood-4x8', 7, 9, -6.5],
    ['b-2x4', 'bundle-2x4-16ft', 30, 11, -3.5], ['b-2x6', 'bundle-2x6-16ft', 8, 11, -1.5],
    ['s-beam-full', 'stack-beam-12ft', 20, 9, 1.5], ['s-beam-part', 'stack-beam-12ft', 3, 9, 3.5],
    ['s-up-full', 'stack-upright-16ft-kit', 6, 11, 6.5], ['s-up-part', 'stack-upright-16ft-kit', 2, 11, 9],
  ];
  for (const [id, d, n, x, z] of piles) out.push(bundleEntity(id, d, x, z, 0, n, 0, HYPO));
  out.push({ id: 'saw', def: 'cutting-station', kind: 'fixture', label: 'cutting station', pose: { p: [3, 0, 10], yaw: 0 }, provenance: HYPO });
  return out;
}

export function solarPaintRuntime(): Runtime {
  const base = buildBayGround();
  const w = addAll(emptyWorld('open-ground', base), ...entities());
  const reg = new Map<string, ActionDef>([['walk_to', walkTo], ['carry', carry], ...PAINT_ACTIONS.map((a) => [a.verb, a] as [string, ActionDef])]);
  return new Runtime(w, reg, { spatial: new Spatial(base) }, [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS]);
}

export const solarPaint: Scenario = {
  name: 'solar-paint',
  title: 'Solar, paint and stock (renderer showcase)',
  description:
    'HYPOTHETICAL showcase (SOLAR_PAINT.md, YEAR_BUILD.md): p1 paints sheet w1 yellow and p2 paints w2 with the flower-mural-2024 image texture, band by band from the top down, as far as they reach (the top 0.38 m of a standing 4x8 is out of reach from the ground); c1 and c2 carry solar panel pv1 flat (fragile, ≤ 30° tilt). Set pieces: panel pv2 mounted at 20° on two rails, a battery / charge controller / inverter labelled with their configuration, every bundle / stack kind at a few counts, the cutting station.',
  scene: buildBayGround,
  humans: () => [],
  build: solarPaintRuntime,
  start: (rt) => {
    rt.submit('paint', { actor: 'p1', panel: 'w1', color: '#e8c547' });
    rt.submit('paint', { actor: 'p2', panel: 'w2', texture: 'flower-mural-2024' });
    rt.submit('carry', { crew: ['c1', 'c2'], item: 'pv1', to: { x: 5, z: 3, yaw: 0 } });
  },
  maxTicks: 20 * 180,
  focus: [3, 1, 11, 210],
  expect: (rt) => {
    const recs = [...rt.records.values()];
    const bad = recs.filter((r) => r.status !== 'completed');
    const E = rt.world.entities;
    return [
      { ok: bad.length === 0, message: bad.length ? `not completed: ${bad.map((r) => `${r.id} ${r.verb} ${r.status} ${r.diagnostic?.message ?? ''}`).join('; ')}` : 'all actions completed' },
      { ok: rt.violations.length === 0, message: rt.violations.length ? `${rt.violations.length} violations, first: ${rt.violations[0].message}` : 'zero violations' },
      // from the ground the brush reaches 0.5–2.06 m of the 2.44 m face (SOLAR_PAINT.md): 0.64 of it
      { ok: (E.w1.paint?.coverage ?? 0) >= 0.6 && (E.w2.paint?.coverage ?? 0) >= 0.6, message: `painted w1 ${E.w1.paint?.coverage ?? 0}, w2 ${E.w2.paint?.coverage ?? 0} of the face (the reachable 0.5–2.06 m)` },
      { ok: Math.hypot(E.pv1.pose.p[0] - 5, E.pv1.pose.p[2] - 3) < 0.05, message: `panel pv1 carried to (5, 3): at (${E.pv1.pose.p[0].toFixed(2)}, ${E.pv1.pose.p[2].toFixed(2)})` },
    ];
  },
};
