import assert from 'node:assert/strict';
import {layout} from './patch.mjs';

const local = (p, obb) => {
  const dx = p[0] - obb.c[0], dz = p[1] - obb.c[1], c = Math.cos(obb.yaw), s = Math.sin(obb.yaw);
  return [dx * c + dz * s, -dx * s + dz * c];
};
const distance = (p, obb) => {
  const q = local(p, obb);
  return Math.hypot(Math.max(0, Math.abs(q[0]) - obb.half[0]), Math.max(0, Math.abs(q[1]) - obb.half[1]));
};
const round = x => Math.round(x * 10000) / 10000;

/** Numbers explain the physical repair; native useCheckV1 remains the feasibility
 * oracle. Ground→tier-1 has redundant links across the tread, so report those
 * separately from the unique central tier-to-tier chain. */
export function geometryReport(engine, ids, originalChecks) {
  const world = engine.world, physics = world.entityPhysicsV1;
  const part = physics.byEntity[ids.chiba];
  const chain = part.links.filter(l => l.from.level > 0 && l.to.level > 0 && l.id.includes('#mesh-step:'));
  const checks = engine.useCheckV1({of: layout.seats.map(s => ids[s.name])});
  const seats = layout.seats.map(s => {
    const e = world.entities[ids[s.name]], asset = physics.assets[e.def], slot = asset.slots.find(x => x.id === 'seat');
    // Level IDs are allocated when the host materializes floors. Preserve the
    // exact source world's level, not the dev world's incidental numeric ID.
    const native = checks.find(x => x.of === ids[s.name]), level = native.level;
    const c = Math.cos(e.pose.yaw), sn = Math.sin(e.pose.yaw), p = [e.pose.p[0] + slot.local[0] * c - slot.local[1] * sn, e.pose.p[2] + slot.local[0] * sn + slot.local[1] * c];
    const floors = part.surfaces.filter(f => f.level === level && Math.abs(f.y - e.pose.p[1]) < .01 && f.id.match(/#f\d+$/));
    const support = floors.map(f => {const q = local(p, f.obb); return {id: f.id, edge: Math.min(f.obb.half[0] - Math.abs(q[0]), f.obb.half[1] - Math.abs(q[1]))};}).sort((a,b) => b.edge - a.edge)[0];
    const entries = chain.flatMap(l => [l.from, l.to]).filter(x => x.level === level);
    const groundEntries = part.links.filter(l => l.from.level === 0 && l.to.level === level).map(l => l.to);
    const minEntry = xs => xs.length ? Math.min(...xs.map(x => Math.hypot(p[0]-x.p[0],p[1]-x.p[1]))) : null;
    const thin = part.solids.filter(o => o.y1 > e.pose.p[1] + .2 && o.y0 < e.pose.p[1] + 1.7 && Math.min(...o.obb.half) < .2);
    return {name: s.name, level, sourceLevel: originalChecks.find(x => x.of === ids[s.name]).level, slot: p.map(round), support: support ? {id: support.id, edge: round(support.edge)} : null,
      centralEntryClearance: entries.length ? round(minEntry(entries)) : null,
      redundantGroundEntryClearance: groundEntries.length ? round(minEntry(groundEntries)) : null,
      nearestThinSolidClearance: thin.length ? round(Math.min(...thin.map(o => distance(p, o.obb)))) : null,
      native,
    };
  });
  return {schema: 'mars-chiba-seating-geometry/1', source: layout.source, movingBodyRadius: .28, planMargin: .06,
    requiredCentralEntryClearance: .28 + .28 + .06, seats};
}

export function assertGeometry(report) {
  assert.equal(report.seats.length, 5);
  for (const s of report.seats) {
    assert.equal(s.native?.ok, true, `${s.name}: ${JSON.stringify(s.native)}`);
    assert.equal(s.native.level, s.sourceLevel, `${s.name} stays on its original native level`);
    if (s.level > 0) {
      assert(s.support && s.support.edge >= .28, `${s.name} has body-width tread support`);
      assert(s.centralEntryClearance >= report.requiredCentralEntryClearance, `${s.name} clears the central stair chain with a seated neighbor`);
    }
  }
}
