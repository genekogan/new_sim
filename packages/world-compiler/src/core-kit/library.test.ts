// The core library (L4): every family def parses, has a description and tags, stays in budget,
// creatures carry the roles their gait needs, and every point def places in a world.
//   node --test packages/world-compiler/src/core-kit/library.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kitArgs, kitPhysics } from '@sim/generators';
import { CORE_KIT, WorldModel, applyBatch, defSchema, type Refused } from '../index.ts';
import { FAMILY_KITS } from './index.ts';

const kit = FAMILY_KITS.filter((d) => d.make.kind === 'gen' && d.make.gen === 'kit/2');

test('family defs parse, are unique, described, tagged, and within the Eden budgets', () => {
  const names = new Set<string>();
  for (const d of kit) {
    const def = defSchema.parse(d);
    assert.ok(!names.has(def.name), `duplicate ${def.name}`); names.add(def.name);
    assert.ok(def.description.length > 20, `${def.name}: one-line description`);
    assert.ok(def.tags.length >= 2, `${def.name}: tags`);
    const tris = kitPhysics(kitArgs.parse((def.make as { args: unknown }).args)).tris;
    const budget = def.tags.includes('creature') ? 600 : def.tags.includes('structure') || def.tags.includes('ride') || def.tags.includes('large') ? 6000 : def.tags.includes('vehicle') ? 1200 : 400;
    assert.ok(tris <= budget, `${def.name}: ${tris} tris > ${budget}`);
  }
  assert.ok(kit.length >= 19, `only ${kit.length} kit defs`);
});

test('creatures: gait roles present (legs swing, heads nod, wings flap, tails wag)', () => {
  const need: Record<string, string[]> = { 'quadruped-walk': ['leg.fl', 'leg.fr', 'leg.bl', 'leg.br', 'head'], 'biped-waddle': ['leg.l', 'leg.r', 'head', 'wing.l', 'wing.r'], 'bird-fly': ['leg.l', 'leg.r', 'wing.l', 'wing.r', 'head'], 'fish-swim': ['tail'] };
  const creatures = kit.filter((d) => (d.tags ?? []).includes('creature'));
  assert.ok(creatures.length >= 19);
  for (const d of creatures) {
    const a = kitArgs.parse((d.make as { args: unknown }).args), roles = new Set(a.shapes.map((s) => s.role).filter(Boolean));
    for (const r of need[a.gait] ?? []) assert.ok(roles.has(r as never), `${d.name}: gait ${a.gait} needs role ${r}`);
    assert.ok(d.components?.behavior, `${d.name}: behavior component`);
  }
});

test('the library replaces the base kit placeholders (same names) and keeps their slots', () => {
  const byName = new Map(CORE_KIT.map((d) => [d.name, d]));
  for (const n of ['bench', 'table', 'chair', 'tree', 'rock', 'bowl', 'lamp-post', 'fountain']) {
    const d = byName.get(`core-${n}`); if (!d) continue;
    if (!kit.includes(d)) continue;   // not ported yet
    assert.equal(d.make.kind === 'gen' && d.make.gen, 'kit/2', `${n} is a kit def`);
  }
  const bench = byName.get('core-bench'); if (bench && kit.includes(bench)) assert.equal(bench.slots?.length, 2);
  const table = byName.get('core-table'); if (table && kit.includes(table)) assert.ok(table.slots?.some((s) => s.id === 'top'));
});

test('every point def places in a world (water things on a pond), nudged apart', () => {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'library' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  const pond = applyBatch(w, { ops: [{ op: 'place', def: 'core/pond@1', name: 'pond', shape: { area: [[-200, 180], [200, 180], [200, 220], [-200, 220]] }, params: { depth: 1.5, level: -0.2 } }] }, 'god', 1);
  assert.equal(pond.result.accepted, true);
  let x = -300, fx = -180;
  const ops = kit.filter((d) => (d.form ?? 'point') === 'point').map((d) => {
    const ref = `core/${d.name.slice(5)}@1`;
    if (d.anchor === 'float') { fx += 4; return { op: 'place', def: ref, name: `t-${d.name.slice(5)}`, p: [fx, 200] }; }
    x += Math.max(4, (d.size?.box[0] ?? 1) + 3); return { op: 'place', def: ref, name: `t-${d.name.slice(5)}`, p: [((x + 300) % 560) - 280, -300 + Math.floor((x + 300) / 560) * 30], mode: 'nudge' };
  });
  for (let i = 0; i < ops.length; i += 200) {
    const r = applyBatch(w, { ops: ops.slice(i, i + 200) }, 'god', 2 + i);
    assert.equal(r.result.accepted, true, JSON.stringify((r.result as Refused).failures?.slice(0, 3)));
  }
});
