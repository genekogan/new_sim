// A body that can climb a stair can always come back down it (Eden 2026 tower, r3b 2026-10-16): a wide body (0.289 m) climbed
// past furniture beside the stair top, then every route down was refused: the departure test wanted 0.9 x the planning
// radius (0.314 m) between the top approach and the top entry, which had 0.311 m; arriving had only snapped near it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGrids, clearanceAt, segmentClearance } from '../spatial/grid.ts';
import { findRoute, linkApproach, snap } from '../spatial/path.ts';
import { HUMAN_PROFILE, type Link, type SpatialScene } from '../spatial/types.ts';

const obb = (c: [number, number], half: [number, number]) => ({ c, half, yaw: 0 });
function scene(gap: number): SpatialScene {
  // two floors over the same 12 x 12 m; a straight stair rising +z from (0,-2) on level 0 to (0,1) on level 1; on level 1
  // a cabinet beside the stair top (not beside its approach) leaves `gap` metres to the top entry
  const link: Link = { id: 'stairs', kind: 'stairs', from: { level: 0, p: [0, -2], y: 0 }, to: { level: 1, p: [0, 1], y: 3 }, width: 0.9, heading: Math.PI / 2, path: [], usable: true } as unknown as Link;
  return {
    bounds: [-6, -6, 6, 6], levels: [{ id: 0, y: 0, label: 'ground' }, { id: 1, y: 3, label: 'upper' }],
    surfaces: [{ id: 'g', level: 0, y: 0, obb: obb([0, 0], [6, 6]) }, { id: 'u', level: 1, y: 3, obb: obb([0, 0], [6, 6]) }],
    obstacles: [{ id: 'cabinet', obb: obb([gap + 0.5, 0], [0.5, 1]), y0: 3, y1: 4.5, kind: 'component' }],
    links: [link],
  };
}
const body = (radius: number) => ({ ...HUMAN_PROFILE, radius });

test('a link a body can climb it can also descend, when the top has room for the body but not for the planning margin', () => {
  let found = false;
  for (let gap = 0.28; gap <= 0.36 && !found; gap += 0.005) {
    const s = scene(gap), grids = buildGrids(s), up = grids.levels.get(1)!, link = s.links[0], down = linkApproach(link, false);
    const seg = segmentClearance(up, down.approach, down.entry.p), p = body(seg - 0.02), r = p.radius + 0.06;
    if (!(seg < r * 0.9 && seg >= p.radius)) continue;   // the case that stranded wide bodies
    found = true;
    const climb = findRoute(grids, s, p, { level: 0, p: [0, -4] }, { level: 1, p: [-2, 3] });
    assert.equal(climb.ok, true, 'it climbs up');
    const back = findRoute(grids, s, p, { level: 1, p: [-2, 3] }, { level: 0, p: [0, -4] });
    assert.equal(back.ok, true, `it comes back down (top clearance ${seg.toFixed(3)} m, body ${p.radius.toFixed(3)} m): ${back.ok ? '' : back.diagnostic.message}`);
    // a body wider than the stair top still cannot leave that way
    const wide = body(seg + 0.03);
    assert.equal(findRoute(grids, s, wide, { level: 1, p: [-2, 3] }, { level: 0, p: [0, -4] }).ok, false, 'no squeezing past furniture');
  }
  assert.ok(found, 'the fixture reaches the stranding clearance band');
});

test('a stair top whose approach point falls on a cell one short of room departs from the roomy cell beside it (lane RAIL)', () => {
  // hillside-home-1: the head's approach lies on the centre line of a corridor at 45 deg to the grid, whose cells with room
  // are a one-cell ridge; the point fell on the cell beside it (0.31 m where 0.34 is needed) and the way down was refused
  // while the way up (which snaps within 0.4 m) was not. Here a cabinet beside the approach (not beside the top) does it.
  const p = body(HUMAN_PROFILE.radius), r = p.radius + 0.06;
  let exercised = 0;
  for (let gap = 0.3; gap <= 0.4; gap += 0.005) {
    const s = scene(0), link = s.links[0];
    s.obstacles = [{ id: 'cabinet', obb: obb([gap + 0.5, 2.2], [0.5, 0.45]), y0: 3, y1: 4.5, kind: 'component' }] as SpatialScene['obstacles'];
    const grids = buildGrids(s), up = grids.levels.get(1)!, down = linkApproach(link, false);
    if (clearanceAt(up, down.approach) >= r || snap(up, down.approach, r, 0.15) < 0) continue;
    exercised++;
    assert.equal(findRoute(grids, s, p, { level: 0, p: [0, -4] }, { level: 1, p: [-2, 3] }).ok, true, `it climbs up (gap ${gap.toFixed(3)})`);
    const back = findRoute(grids, s, p, { level: 1, p: [-2, 3] }, { level: 0, p: [0, -4] });
    assert.equal(back.ok, true, `it comes back down (gap ${gap.toFixed(3)}, approach cell ${clearanceAt(up, down.approach).toFixed(3)} m): ${back.ok ? '' : back.diagnostic.message}`);
  }
  assert.ok(exercised > 0, 'the fixture puts the approach on a cell short of room with room beside it');
});

test('a stair foot whose approach point falls by a stove departs from the room within 0.4 m, as arriving does (lane WALK2)', () => {
  // eden-house-3/4 kitchens: the point 0.7 m back from the foot lay 0.2 m off the stove beside the flight (0.15 m of room)
  // while the alcove's middle had 0.7 m, so the stairs were never climbed (arriving down snaps within 0.4 m and worked).
  const p = body(HUMAN_PROFILE.radius), r = p.radius + 0.06;
  let exercised = 0;
  for (let gap = 0.1; gap <= 0.3; gap += 0.01) {
    const s = scene(0), link = s.links[0];
    s.obstacles = [{ id: 'stove', obb: obb([gap + 0.4, -3.0], [0.4, 0.3]), y0: 0, y1: 1.2, kind: 'component' }] as SpatialScene['obstacles'];
    const grids = buildGrids(s), g0 = grids.levels.get(0)!, up = linkApproach(link, true);
    if (snap(g0, up.approach, r, 0.15) >= 0 || snap(g0, up.approach, r, 0.4) < 0) continue;
    exercised++;
    const climb = findRoute(grids, s, p, { level: 0, p: [-2, -4] }, { level: 1, p: [-2, 3] });
    assert.equal(climb.ok, true, `it climbs up (gap ${gap.toFixed(2)}, approach cell ${clearanceAt(g0, up.approach).toFixed(3)} m): ${climb.ok ? '' : climb.diagnostic.message}`);
    assert.equal(findRoute(grids, s, p, { level: 1, p: [-2, 3] }, { level: 0, p: [-2, -4] }).ok, true, `it comes back down (gap ${gap.toFixed(2)})`);
  }
  assert.ok(exercised > 0, 'the fixture puts the foot approach by the stove with room within 0.4 m only');
});

test('a clear snap cell beyond a blocked landing does not admit a collision on arrival', () => {
  const s=scene(0), link=s.links[0];
  link.approach={from:[...link.from.p],to:[...link.to.p]};
  // A narrow cabinet clips the physical landing, while standing room within
  // 0.4m still exists on its far side. The body must not land inside it first.
  s.obstacles=[{id:'landing-cabinet',obb:obb([.16,1],[.1,.12]),y0:3,y1:4.5,kind:'component'}];
  const grids=buildGrids(s), upper=grids.levels.get(1)!, profile=body(.28);
  assert.ok(snap(upper,link.to.p,profile.radius+.06,.4)>=0,'nearby clear cell exists');
  assert.ok(clearanceAt(upper,link.to.p)<profile.radius,'physical landing is occupied');
  const route=findRoute(grids,s,profile,{level:0,p:[0,-4]},{level:1,p:[-2,3]});
  assert.equal(route.ok,false,'the landing itself must be safe before any onward walk');
});
