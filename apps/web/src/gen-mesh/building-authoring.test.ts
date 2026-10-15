// XP3: real meshes, library default regression, and the CLI's --on solver against fixture buildings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GENERATORS, type Value } from '@sim/generators';
import { CORE_KIT, WorldModel, applyBatch, type Entity } from '@sim/world-compiler';
import { runQuery } from '../../../server/src/god/query.ts';
// @ts-expect-error CLI modules are plain JS; exercise the actual relation path, without HTTP.
import { view } from '../../../../tools/god-skill/lib/mirror.mjs';
// @ts-expect-error CLI modules are plain JS.
import { solve } from '../../../../tools/god-skill/lib/solver.mjs';
import { buildingLayout } from '../../../../packages/generators/src/building.ts';
import fixtures from '../../../../packages/generators/src/fixtures/building-dress.json' with { type: 'json' };
import defaults from './building-defaults.fixture.json' with { type: 'json' };
import { meshFor, type MeshCtx } from './registry.ts';
import { MaterialLib } from './materials.ts';
import './building.mesh.ts';

const flags = { chimney: false, shutters: false, flowerBoxes: false, quoins: false, hood: false, doorLamp: false };
const world = () => {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'b1' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  return w;
};
const w = world();
function draw(name: string, extra: Record<string, unknown> = {}, entity?: Entity) {
  const def = w.def(`core/${name}@1`)!;
  const params = Object.fromEntries(Object.entries({ ...GENERATORS['building/1'].params, ...def.params }).filter(([, f]) => f.default !== undefined).map(([k, f]) => [k, f.default]));
  Object.assign(params, extra);
  const e = entity ?? { id: 'b1', def: def.ref, in: { parent: 'world' }, by: 'b1', born: 0, v: 1, params } as Entity;
  const ctx = { def, entity: e, params, args: def.make.kind === 'gen' ? def.make.args ?? {} : {}, baked: w.bake(def, params as Record<string, Value>, 7), model: w, materials: new MaterialLib(), tint: (_k: string, f: string) => f } as MeshCtx;
  return meshFor(def)!.build(ctx)!;
}
function stats(g: THREE.Object3D) {
  const h = createHash('sha256'); let tris = 0, draws = 0;
  g.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return;
    h.update(m.name); for (const k of ['position', 'normal', 'color']) h.update(new Uint8Array((m.geometry.attributes[k].array as Float32Array).buffer));
    tris += m.geometry.attributes.position.count / 3; draws++;
  });
  return { hash: h.digest('hex'), tris, draws };
}
function triangles(g: THREE.Object3D) {
  const out: string[] = [];
  g.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return;
    const a = m.geometry.attributes;
    for (let i = 0; i < a.position.count; i += 3) out.push(m.name + ':' + ['position', 'normal', 'color'].map(k => Array.from(a[k].array.slice(i * 3, i * 3 + 9)).join(',')).join('|'));
  });
  return out;
}

test('all 40 library buildings retain exact pre-XP3 positions, normals, colours and draw counts', () => {
  assert.equal(defaults.length, CORE_KIT.filter(d => d.make.kind === 'gen' && d.make.gen === 'building/1').length);
  for (const { name, ...expected } of defaults) assert.deepEqual(stats(draw(name.replace(/^core-/, ''))), expected, name);
});

test('each ornament switch removes only its own triangles, without changing the remaining seeded facade', () => {
  for (const key of Object.keys(flags)) {
    let removed = 0;
    for (const name of ['cottage', 'townhouse', 'shop']) {
      // Small one-storey cases stay below the renderer's detail threshold in both variants.
      const small = { floors: 1, w: 8, d: 6 };
      const base = triangles(draw(name, small)), changed = triangles(draw(name, { ...small, [key]: false }));
      const counts = new Map<string, number>(); for (const t of base) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const t of changed) { const n = counts.get(t) ?? 0; assert.ok(n > 0, `${key} changed another triangle in ${name}`); counts.set(t, n - 1); }
      removed += base.length - changed.length;
    }
    assert.ok(removed > 0, `${key} actually removes geometry`);
  }
});

test('authored trim recolours the exterior sill and lintel vertices', () => {
  const params = { ...fixtures[1].params, ...flags, trim: '#112233' }, L = buildingLayout(params);
  const g = draw('cottage', params), wanted = new THREE.Color(params.trim);
  for (const op of L.openings.filter(o => o.exterior && o.kind === 'window')) {
    const wall = L.walls[op.wall], alongX = wall.axis === 'x', y = 0.1 + op.floor * L.fh + op.sill;
    for (const base of [y - 0.07, y + op.height]) {
      let count = 0;
      g.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh || !m.name.endsWith(' trim')) return;
        const P = m.geometry.attributes.position, C = m.geometry.attributes.color;
        for (let i = 0; i < P.count; i++) {
          const dx = P.getX(i) - op.at[0], dz = P.getZ(i) - op.at[1];
          if (Math.abs(P.getY(i) - base) > 1e-5 || Math.abs(alongX ? dx : dz) > op.width / 2 + 0.13 || Math.abs(alongX ? dz : dx) > wall.thick / 2 + 0.12) continue;
          assert.ok(Math.abs(C.getX(i) - wanted.r) < 1e-6 && Math.abs(C.getY(i) - wanted.g) < 1e-6 && Math.abs(C.getZ(i) - wanted.b) < 1e-6, `${op.id} trim vertex`); count++;
        }
      });
      assert.ok(count >= 6, `${op.id} has a coloured sill/lintel`);
    }
  }
});

test('church and tea-house fixtures remove the unwanted ornaments and mount facade kits via place --on relations', () => {
  for (const fixture of fixtures) {
    const model = world(), params = { ...fixture.params, ...flags };
    const shell = model.defineDef({ schema: 'def/1', name: 'fixture-shell', version: 1, form: 'point', layer: 'solid', make: { kind: 'gen', gen: 'building/1' }, size: { box: [12, 15, 24] } }, 'b1', 1);
    const placed = applyBatch(model, { ops: [{ op: 'place', def: shell.ref, name: fixture.name, p: [30, 0, 40], r: 0.6, params: params as never }] }, 'b1', 1);
    assert.equal(placed.result.accepted, true, JSON.stringify(placed.result));
    const host = model.get(fixture.name)!, baked = model.slotsOf(host);
    // Door lamps, hood, shutters, flower boxes and chimney colours never occur when switched off.
    const mesh = draw('cottage', params), colours = new Set<string>();
    mesh.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; const c = m.geometry.attributes.color;
      for (let i = 0; i < c.count; i++) colours.add(new THREE.Color(c.getX(i), c.getY(i), c.getZ(i)).getHexString());
    });
    for (const hex of ['8a4a36', 'a3442f', '6e4a30', 'd9485f', 'f1c84b', 'e86aa8', '9b6fd1', 'ff8a3d']) assert.equal(colours.has(hex), false, `${fixture.name}: no unwanted ${hex}`);
    const def = model.defineDef({ schema: 'def/1', name: 'facade-kit', version: 1, form: 'point', layer: 'decor', anchor: 'base', tags: ['building-part'], make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0.5, 0.06], size: [1, 1, 0.12], color: '#224422', collide: false }] } }, size: { box: [1, 1, 0.12] } }, 'b1', 1);
    const anchors = baked.filter(s => /^(opening-|facade-|gable-|ridge$)/.test(s.id));
    assert.ok(anchors.some(s => s.id.startsWith('opening-')) && anchors.some(s => s.id.startsWith('gable-')) && anchors.some(s => s.id === 'ridge'));
    for (const [i, slot] of anchors.entries()) {
      const layout = runQuery(model, { layout: { obbs: true } }) as { layout: { entities: unknown[] } };
      const v = view({ rows: layout.layout.entities, snapshot: { entities: [...model.entities.values()], defs: model.allDefs() }, extent: 1000 });
      const solved = solve(v, { def: def.ref, form: 'point', layer: 'decor', box: [1, 1, 0.12] }, { on: `${fixture.name}/${slot.id}` });
      const candidate = solved.items[0].candidates[0];
      assert.deepEqual(candidate.in, { parent: fixture.name, slot: slot.id });
      const name = `ornament-${i}`;
      const r = applyBatch(model, { ops: [{ op: 'place', def: def.ref, name, ...candidate }] }, 'b1', i + 2);
      assert.equal(r.result.accepted, true, `${fixture.name}/${slot.id}: ${JSON.stringify(r.result)}`);
      const child = [...model.entities.values()].find(e => e.name === name)!, pose = model.worldPose(child), hp = model.worldPose(host);
      assert.ok(Math.abs(pose.y - hp.y - slot.p[1]) < 0.001);
      assert.ok(Math.abs(pose.yaw - hp.yaw - slot.yaw) < 0.001);
      const full = runQuery(model, { layout: {} }) as { layout: { entities: unknown[] } };
      const vv = view({ rows: full.layout.entities, snapshot: { entities: [...model.entities.values()] }, extent: 1000 });
      assert.throws(() => solve(vv, { def: def.ref, form: 'point', layer: 'decor', box: [1, 1, 0.12] }, { on: `${fixture.name}/${slot.id}` }), /is full/);
    }
    console.log(`${fixture.name}: ${anchors.length} facade kits accepted from --on solver; no raw coordinate acts`);
  }
});
