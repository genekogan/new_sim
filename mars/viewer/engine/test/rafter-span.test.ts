import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { sheetSupports, installPlywood, PLY_SPAN_MAX } from '../construction/deck.ts';
import { RAFTER_SPACING_MAX } from '../construction/rules.ts';
import { addAll, component, emptyWorld, human } from '../world/factory.ts';
import { def } from '../world/catalog.ts';
import { rot2, type OBB2 } from '../core/math.ts';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import type { SpatialScene } from '../spatial/types.ts';

const captures: unknown[] = [];
function fixture(spacing: number, yaw: number, kind: 'rafters' | 'mixed' | 'joists' = 'rafters') {
  const base: SpatialScene = { bounds: [-10, -10, 10, 10], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [10, 10], yaw: 0 } }], obstacles: [], links: [] };
  const w = emptyWorld('hypothetical-rafter-span', base);
  const at = (x: number, y: number, z: number): [number, number, number] => { const q = rot2([x, z], yaw); return [q[0], y, q[1]]; };
  const H = def('upright-8ft').size[1];
  for (const side of [-1, 1]) {
    const ids = [-1, 1].map((end) => `u${side}/${end}`);
    for (const end of [-1, 1]) addAll(w, component(`u${side}/${end}`, 'upright-8ft', at(side * 1.15, 0, end), yaw, { phase: 'installed' }));
    addAll(w, component(`plate${side}`, '2x4-top-plate-8ft', at(side * 1.15, H, 0), yaw + Math.PI / 2, { phase: 'installed', support: { kind: 'resting-on', on: ids[0] }, connections: ids.map((to) => ({ socket: 'bears-on', to, toSocket: 'top' })) }));
  }
  const y = H + def('2x4-top-plate-8ft').size[1];
  for (const side of [-1, 1]) {
    const definition = kind === 'joists' || (kind === 'mixed' && side === 1) ? '2x4-8ft' : '2x4-rafter-8ft';
    addAll(w, component(`support${side}`, definition, at(0, y, side * spacing / 2), yaw, { phase: 'installed', support: { kind: 'resting-on', on: 'plate-1' }, connections: [-1, 1].map((p) => ({ socket: 'bears-on', to: `plate${p}`, toSocket: 'top' })) }));
  }
  const sheet = component('sheet', 'plywood-4x6', [0, 0, -5], yaw, { phase: 'staged' });
  addAll(w, sheet, human('p1', -5, -5), human('p2', -5, -3));
  const obb: OBB2 = { c: [0, 0], half: [def(sheet.def).size[0] / 2, def(sheet.def).size[2] / 2], yaw };
  return { w, base, sheet, obb };
}

for (const kind of ['rafters', 'mixed'] as const) for (const yaw of [0, Math.PI / 4]) {
  test(`LM-100 ${kind}, yaw ${yaw}: exact 24in support accepted; excessive spans refused atomically`, () => {
    for (const extra of [0, 0.005, 0.1]) {
      const { w, base, sheet, obb } = fixture(RAFTER_SPACING_MAX + extra, yaw, kind);
      const support = sheetSupports(w, sheet, obb);
      if (!extra) {
        assert.equal(support.ok, true, JSON.stringify(support));
        if (support.ok) assert.deepEqual(new Set(support.supports), new Set(['support-1', 'support1']));
      } else {
        assert.equal(support.ok, false);
        if (!support.ok) {
          assert.equal(support.diagnostic.code, 'plywood.span');
          assert.ok(support.diagnostic.message.includes(`${(RAFTER_SPACING_MAX + extra).toFixed(4)} m`));
          assert.ok(support.diagnostic.message.includes('max 0.6096 m'));
          assert.deepEqual(new Set(support.diagnostic.subjects), new Set(['sheet', 'support-1', 'support1']));
        }
        const rt = new Runtime(w, new Map([[installPlywood.verb, installPlywood]]), { spatial: new Spatial(base) });
        const before = structuredClone(rt.world);
        const record = rt.submit('install_plywood', { crew: ['p1', 'p2'], sheet: sheet.id, x: 0, z: 0, yaw });
        assert.equal(record.diagnostic?.code, 'plywood.span');
        assert.deepEqual(rt.world, before);
        for (const resource of ['entity:sheet', 'actor:p1', 'actor:p2']) assert.deepEqual(rt.holder(resource), []);
      }
      captures.push({ kind, yaw, spacing: RAFTER_SPACING_MAX + extra, support, atomicRefusalChecked: !!extra });
    }
  });
}
test('LM-100 ordinary joist allowance remains unchanged', () => {
  const { w, sheet, obb } = fixture(PLY_SPAN_MAX - 0.001, 0, 'joists');
  const result = sheetSupports(w, sheet, obb);
  assert.equal(result.ok, true, JSON.stringify(result));
  captures.push({ kind: 'ordinary-joist-control', spacing: PLY_SPAN_MAX - 0.001, result });
  if (process.env.MARS_RAFTER_SPAN_CAPTURE) writeFileSync(process.env.MARS_RAFTER_SPAN_CAPTURE, JSON.stringify(captures, null, 2) + '\n');
});
