// E2 #4: an excavator's arm and a forklift's forks did not move (only spin/door/lid/fill/flame roles existed).
// Their parts are now role pivots driven by `components.swing` while the engine is on; off, they rest.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {defSchema} from '../../../packages/world-compiler/src/schemas.ts';
import {kitArgs} from '../../../packages/generators/src/kit.ts';
import {buildKit} from '../src/gen-mesh/kit.mesh.ts';
import {MaterialLib} from '../src/gen-mesh/materials.ts';
import {animate, hasMotion, swingStroke} from '../src/gen-mesh/motion.ts';
import vocabW2 from '../../../packages/world-compiler/src/core-kit/vocab-w2.json' with {type: 'json'};
import work from '../../../packages/world-compiler/src/core-kit/work.json' with {type: 'json'};

const lib = new MaterialLib();
function thing(name: string) {
  const input = [...vocabW2, ...work].find((d: {name: string}) => d.name === name)!;
  const def = defSchema.parse(input) as any;
  const obj = buildKit(kitArgs.parse(def.make.args), {materials: lib, tint: (k: string | undefined, f: string) => (k && def.palette?.[k]) || f, params: {}, state: {}});
  return {def, obj};
}
const at = (obj: THREE.Object3D, def: any, on: boolean, t: number, role: string) => {
  animate(obj, {id: 'e1', def: def.ref ?? def.name, state: {on}, in: {parent: 'world'}} as any, def, 840_000_000 + t, {y: 0, yaw: 0});
  const r = obj.getObjectByName('role:' + role)!; return {rx: r.rotation.x, py: r.position.y};
};

test('the schema keeps a working-parts component and the viewer animates such defs', () => {
  const {def} = thing('core-excavator');
  assert.deepEqual(def.components.swing?.parts[0], {role: 'boom', kind: 'rotate', axis: 'x', amount: -0.45, period: 7, phase: 0, when: 'on'});
  assert.equal(hasMotion(def), true);
});

test("an excavator's arm digs while its engine runs and rests when it is off", () => {
  const {def, obj} = thing('core-excavator');
  assert.ok(obj.getObjectByName('role:boom'), 'the arm is its own pivot');
  const rest = at(obj, def, false, 0, 'boom').rx;
  const a = at(obj, def, true, 0, 'boom').rx, b = at(obj, def, true, 3.5, 'boom').rx;   // stroke 0 then full
  assert.ok(Math.abs(a - rest) < 1e-6 && Math.abs(b - rest + 0.45) < 1e-3, `on: ${a} -> ${b}`);
  let off = b; for (let t = 3.5; t < 6; t += 0.1) off = at(obj, def, false, t, 'boom').rx;
  assert.ok(Math.abs(off - rest) < 1e-3, `engine off: settles to rest (${off})`);
});

test("a forklift's forks lift up the mast and come back down while it is on", () => {
  const {def, obj} = thing('core-forklift');
  assert.ok((def.actions ?? []).some((a: {name: string}) => a.name === 'switch-on'), 'it can be switched on');
  const y0 = at(obj, def, true, 0, 'forks').py, top = at(obj, def, true, 6, 'forks').py, back = at(obj, def, true, 12, 'forks').py;
  assert.ok(Math.abs(top - y0 - 1.3) < 1e-6 && Math.abs(back - y0) < 1e-6, `${y0} ${top} ${back}`);
  assert.ok(Math.abs(swingStroke(3, 12, 0) - 0.5) < 1e-9);
});
