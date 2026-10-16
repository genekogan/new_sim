// A body that can climb a stair can always come back down it (Eden 2026 tower, r3b 2026-10-16): a wide body (0.289 m) climbed
// past furniture beside the stair top, then every route down was refused: the departure test wanted 0.9 x the planning
// radius (0.314 m) between the top approach and the top entry, which had 0.311 m; arriving had only snapped near it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGrids, segmentClearance } from '../spatial/grid.ts';
import { findRoute, linkApproach } from '../spatial/path.ts';
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
