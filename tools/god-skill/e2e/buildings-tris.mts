// Measure building/1 mesh triangles and draws per preset in node (no browser): node tools/god-skill/e2e/buildings-tris.mts
import { WorldModel, CORE_KIT } from '../../../packages/world-compiler/src/index.ts';
import { GENERATORS } from '../../../packages/generators/src/index.ts';
import '../../../apps/web/src/gen-mesh/building.mesh.ts';
import { meshFor } from '../../../apps/web/src/gen-mesh/registry.ts';
import { MaterialLib } from '../../../apps/web/src/gen-mesh/materials.ts';
const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 't' });
for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
const lib = new MaterialLib();
const extra: Record<string, Record<string, unknown>> = { 'cottage+': { floors: 2, porch: 1.6, balcony: true }, 'cottage3': { floors: 3, w: 9, d: 7 }, 'townhouse4': { floors: 4 } };
const cases = [...['cottage', 'townhouse', 'shop', 'hall', 'chapel', 'barn', 'shed', 'greenhouse', 'pavilion', 'tower', 'lighthouse'].map((n) => [n, n, {}]), ['cottage+', 'cottage', extra['cottage+']], ['cottage3', 'cottage', extra.cottage3], ['townhouse4', 'townhouse', extra.townhouse4], ['lighthouse6', 'lighthouse', { floors: 6 }]] as [string, string, Record<string, unknown>][];
for (const [label, name, p] of cases) {
  const def = w.resolvedDef(`core/${name}@1`)!;
  const gen = GENERATORS['building/1'];
  const params: Record<string, unknown> = {};
  for (const [k, f] of Object.entries({ ...gen.params, ...def.params })) if ((f as { default?: unknown }).default !== undefined) params[k] = (f as { default?: unknown }).default;
  Object.assign(params, p);
  const entity = { id: 'e_' + label, def: def.ref, in: { parent: 'world' }, by: 'x', born: 0, v: 1, params, state: { paint: (def.state.paint as { default?: string })?.default } };
  const ctx = { def, entity, params, args: (def.make as { args?: Record<string, unknown> }).args ?? {}, baked: w.bake(def, params as never, 0), model: w, materials: lib, tint: (_k: string, f: string) => f } as never;
  const t0 = performance.now();
  const g = meshFor(def)!.build(ctx)!;
  let tris = 0, draws = 0; g.traverse((o) => { const m = o as unknown as { isMesh?: boolean; geometry: { attributes: { position: { count: number } } } }; if (m.isMesh) { draws++; tris += m.geometry.attributes.position.count / 3; } });
  if (process.env.DETAIL === label) g.traverse((o) => { const m = o as any; if (m.isMesh) console.log("   ", m.name, m.geometry.attributes.position.count / 3); });
  console.log(label.padEnd(12), 'tris', String(Math.round(tris)).padStart(5), 'draws', String(draws).padStart(3), 'est', String((ctx as { baked: { tris: number } }).baked.tris).padStart(5), `${(performance.now() - t0).toFixed(0)} ms`);
}
