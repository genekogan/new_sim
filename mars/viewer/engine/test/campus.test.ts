// Mars 2026 campus → engine bridge (spec §4, §5, §21): generated scene data,
// staging clearance, routing, historical protection, determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '../core/hash.ts';
import { obbOverlap, type Vec2 } from '../core/math.ts';
import { WorldHistory, HistoryError } from '../history/store.ts';
import { buildGrids, clearanceAt, cellOf } from '../spatial/grid.ts';
import { Spatial, entityFootprint } from '../spatial/service.ts';
import { HUMAN_PROFILE, type SpatialScene } from '../spatial/types.ts';
import { formationFor } from '../carry/formation.ts';
import { rot2 } from '../core/math.ts';
import { readCampus2026File } from '../campus/node.ts';
import { cropScene, sceneFromFile } from '../campus/load.ts';
import { blockersIn } from '../campus/regions.ts';
import { CAMPUS_ID, FLAGSHIP_WORKSPACE, loadCampus2026, publishCampus2026 } from '../campus/world.ts';
import type { Region } from '../world/types.ts';

const file = readCampus2026File();
const campus = loadCampus2026(file);
const reg = (id: string) => campus.base.regions.find((r) => r.id === id)!;
const box = (r: Region) => {
  const xs = r.polygon.map((p) => p[0]), zs = r.polygon.map((p) => p[1]);
  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
};
const around = (r: Region, pad: number): [number, number, number, number] => {
  const b = box(r);
  return [b.x0 - pad, b.z0 - pad, b.x1 + pad, b.z1 + pad];
};
const stagingCrop = cropScene(campus.base, around(reg('staging-east'), 40));
const asScene = (s: typeof stagingCrop) => s as unknown as SpatialScene;

test('campus 2026 scene file loads with provenance on every obstacle', () => {
  assert.equal(file.schema, 'mars-campus-scene/1');
  assert.ok(campus.base.obstacles.length > 5000, `${campus.base.obstacles.length} obstacles`);
  for (const o of campus.base.obstacles) {
    assert.equal(o.provenance.origin, 'canonical');
    assert.ok(['inferred', 'provisional'].includes(o.provenance.confidence), `${o.id} confidence ${o.provenance.confidence}`);
    assert.ok(o.label && o.component && o.y1 > o.y0, o.id);
  }
  const kinds = new Set(campus.base.obstacles.map((o) => o.kind));
  for (const k of ['wall', 'solid', 'glass', 'vehicle', 'fixture']) assert.ok(kinds.has(k as never), `kind ${k} present`);
  assert.deepEqual(campus.base.levels.map((l) => l.id), [0], 'only the ground level is walkable');
  assert.equal(campus.base.links.length, 0, 'no stairs: none are verified in the reconstruction');
  for (const id of ['chiba', 'north-workshops', 'north-rack-building', 'northeast-compound', 'west-rack-building', 'staging-east', 'pile-uprights', 'pile-beams', 'pile-timber'])
    assert.ok(reg(id), `region ${id}`);
  for (const id of ['staging-east', 'pile-uprights', 'pile-beams', 'pile-timber']) assert.equal(reg(id).provenance.confidence, 'hypothetical');
});

test('no obstacle id is duplicated', () => {
  const seen = new Set<string>();
  for (const o of campus.base.obstacles) {
    assert.ok(!seen.has(o.id), `duplicate obstacle id ${o.id}`);
    seen.add(o.id);
  }
});

test('stored contentHash matches the data (extraction output is self-consistent)', () => {
  const { contentHash, ...rest } = file;
  assert.equal(hashOf(rest), contentHash);
  assert.equal(campus.world.base.staticHash, contentHash);
});

test('Chiba interior is not walkable (unknown ≠ walkable)', () => {
  const g = buildGrids(asScene(cropScene(campus.base, around(reg('chiba'), 2))), 0.25).levels.get(0)!;
  const poly = reg('chiba').polygon;
  const inside = (p: Vec2) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
      if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c;
    return c;
  };
  let n = 0, blocked = 0;
  for (let c = 0; c < g.nx * g.nz; c++) {
    const p: Vec2 = [g.x0 + ((c % g.nx) + 0.5) * g.cell, g.z0 + (Math.floor(c / g.nx) + 0.5) * g.cell];
    if (!inside(p)) continue;
    n++;
    if (!g.free[c]) blocked++;
  }
  assert.ok(blocked / n > 0.5, `only ${((100 * blocked) / n).toFixed(0)}% of Chiba's footprint blocks walking`);
});

test('staging-east is clear for a 4-person 19 ft upright carry at any heading', () => {
  const r = reg('staging-east'), b = box(r);
  assert.ok(b.x1 - b.x0 >= 20 && b.z1 - b.z0 >= 15, 'staging ≥ 20 × 15 m');
  assert.deepEqual(blockersIn(campus.base.obstacles, file.groundY, { c: [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2], half: [(b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2], yaw: 0 }), []);
  const g = buildGrids(asScene(stagingCrop), 0.1).levels.get(0)!;
  const f = formationFor('upright-19ft', 4);
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const poses: Vec2[] = [[cx, cz]];
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) poses.push([cx + dx * ((b.x1 - b.x0) / 2 - f.extent), cz + dz * ((b.z1 - b.z0) / 2 - f.extent)]);
  for (const [x, z] of poses)
    for (let k = 0; k < 16; k++) {
      const th = (k * Math.PI) / 8;
      for (const d of f.discs) {
        const o = rot2(d.c, th);
        const p: Vec2 = [x + o[0], z + o[1]];
        assert.ok(clearanceAt(g, p) >= d.r, `${d.part} disc at (${p[0].toFixed(2)}, ${p[1].toFixed(2)}) θ=${th.toFixed(2)} clearance ${clearanceAt(g, p).toFixed(2)} < ${d.r.toFixed(2)}`);
      }
    }
});

test('flagship inventory lies inside its pile regions, on clear ground, not overlapping', () => {
  const inv = Object.values(campus.world.entities).filter((e) => e.kind === 'component');
  assert.equal(inv.length, 5 + 12 + 18);
  const fps = inv.map((e) => ({ e, f: entityFootprint(e) }));
  for (const { e, f } of fps) {
    assert.equal(e.provenance.confidence, 'hypothetical');
    assert.match(e.provenance.note ?? '', /not historical/);
    assert.equal(e.support?.kind, 'ground');
    assert.ok(Math.abs(f.y0 - file.groundY) < 1e-6, `${e.id} rests on the ground (y0 ${f.y0})`);
    const pile = ['pile-uprights', 'pile-beams', 'pile-timber'].map(reg).find((r) => {
      const b = box(r);
      return f.obb.c[0] > b.x0 && f.obb.c[0] < b.x1 && f.obb.c[1] > b.z0 && f.obb.c[1] < b.z1;
    });
    assert.ok(pile, `${e.id} in a pile region`);
    assert.deepEqual(blockersIn(campus.base.obstacles, file.groundY, f.obb), [], `${e.id} clear of campus obstacles`);
  }
  for (let i = 0; i < fps.length; i++)
    for (let j = i + 1; j < fps.length; j++) assert.ok(!obbOverlap(fps[i].f.obb, fps[j].f.obb), `${fps[i].e.id} overlaps ${fps[j].e.id}`);
});

test('a walker can route from every pile to staging (±40 m crop)', () => {
  const sp = new Spatial(asScene(stagingCrop), { cell: 0.1 });
  const w = loadCampus2026(file).world;
  const s = box(reg('staging-east'));
  const goal: Vec2 = [(s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2];
  for (const id of ['pile-uprights', 'pile-beams', 'pile-timber']) {
    const b = box(reg(id));
    const start: Vec2 = [b.x0 - 0.6, (b.z0 + b.z1) / 2]; // pile edge, outside the laid items
    const r = sp.route(w, HUMAN_PROFILE, { level: 0, p: start }, { level: 0, p: goal });
    assert.ok(r.ok, `${id} → staging: ${r.ok ? '' : r.diagnostic.message}`);
    if (r.ok) assert.ok(r.route.length < 3 * Math.hypot(goal[0] - start[0], goal[1] - start[1]) + 5, `${id} route ${r.route.length.toFixed(1)} m`);
  }
  for (const e of Object.values(w.entities).filter((q) => q.kind === 'human'))
    assert.ok(cellOf(sp.level(0)!, [e.pose.p[0], e.pose.p[2]]) >= 0 && clearanceAt(sp.level(0)!, [e.pose.p[0], e.pose.p[2]]) >= HUMAN_PROFILE.radius, `${e.id} standable`);
});

test('canonical mars-2026 is protected; flagship work happens in a fork', () => {
  const h = new WorldHistory('mars-assembly/1');
  const { canonical, flagship } = publishCampus2026(h, file);
  assert.equal(canonical.id, CAMPUS_ID);
  assert.ok(canonical.protected);
  const w = h.read(CAMPUS_ID);
  assert.equal(Object.values(w.entities).filter((e) => e.kind === 'component').length, 0, 'canonical has no hypothetical inventory');
  assert.throws(() => h.commit(CAMPUS_ID, w, { kind: 'design-edit', note: 'try' }), (e: unknown) => e instanceof HistoryError && e.code === 'protected');
  assert.equal(flagship.id, FLAGSHIP_WORKSPACE);
  assert.equal(flagship.protected, false);
  const fw = h.read(FLAGSHIP_WORKSPACE);
  assert.equal(Object.values(fw.entities).filter((e) => e.kind === 'component').length, 35);
  assert.deepEqual(h.log(FLAGSHIP_WORKSPACE).map((c) => c.cause.kind), ['design-edit', 'canonical-publish']);
});

test('loading is deterministic', () => {
  assert.equal(hashOf(loadCampus2026(file).world), hashOf(campus.world));
  assert.equal(hashOf(sceneFromFile(file).obstacles), hashOf(campus.base.obstacles));
});
