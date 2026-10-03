// "Mars proving ground" (spec §28): a compact synthetic scene that exercises
// the navigation edge cases. Zones (x, z in metres):
//   wall      — single wall at x=-15, z∈[-19,-11]
//   u-trap    — cup around (-15, 12) opening toward -z
//   passage   — 1.0 m gap at x=15 in a wall along z=-15
//   corridor  — opt-in ({ corridor: true }): 2.0 m-wide, 8 m-long corridor along z at x=22,
//               z∈[17,25] where two walkers can pass (opt-in so pinned proving-ground hashes hold)
//   deck      — 3 m high deck x∈[6,14], z∈[7,13] with complete stairs A (west, ascending +x)
//               and incomplete stairs B (east, ascending -x)
import type { Link, Obstacle, SpatialScene } from '../spatial/types.ts';

export const DECK_Y = 3.0;
/** Clear width of the passing corridor (x = 22, z ∈ [17, 25]). */
export const PASS_W = 2.0;

export function stairPath(from: [number, number, number], to: [number, number, number], steps: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]);
  }
  return out;
}

const wall = (id: string, cx: number, cz: number, hx: number, hz: number, y1 = 2.4, label?: string): Obstacle => ({
  id,
  obb: { c: [cx, cz], half: [hx, hz], yaw: 0 },
  y0: 0,
  y1,
  kind: 'wall',
  label: label ?? id,
});

export function provingGround(opts: { stairsBUsable?: boolean; stairsAUsable?: boolean; corridor?: boolean; extra?: Obstacle[] } = {}): SpatialScene {
  const stairsA: Link = {
    id: 'stairs-a',
    kind: 'stairs',
    from: { level: 0, p: [1.55, 10], y: 0 },
    to: { level: 1, p: [6.4, 10], y: DECK_Y },
    width: 1.0,
    heading: 0,
    path: stairPath([2, 0, 10], [6, DECK_Y, 10], 16),
    usable: opts.stairsAUsable ?? true,
    reason: opts.stairsAUsable === false ? 'stringers installed but treads 5–12 missing' : undefined,
  };
  const stairsB: Link = {
    id: 'stairs-b',
    kind: 'stairs',
    from: { level: 0, p: [18.45, 10], y: 0 },
    to: { level: 1, p: [13.6, 10], y: DECK_Y },
    width: 1.0,
    heading: Math.PI,
    path: stairPath([18, 0, 10], [14, DECK_Y, 10], 16),
    usable: opts.stairsBUsable ?? false,
    reason: opts.stairsBUsable ? undefined : 'treads 6–9 not installed',
  };
  return {
    bounds: [-30, -30, 30, 30],
    levels: [
      { id: 0, y: 0, label: 'ground' },
      { id: 1, y: DECK_Y, label: 'deck' },
    ],
    surfaces: [
      { id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [30, 30], yaw: 0 } },
      { id: 'deck', level: 1, y: DECK_Y, obb: { c: [10, 10], half: [4, 3], yaw: 0 } },
    ],
    obstacles: [
      wall('wall', -15, -15, 0.15, 4, 2.4, 'test wall'),
      wall('u-back', -15, 15, 3.15, 0.15, 2.4, 'U back wall'),
      wall('u-west', -18, 12, 0.15, 3, 2.4, 'U west wall'),
      wall('u-east', -12, 12, 0.15, 3, 2.4, 'U east wall'),
      wall('passage-w', 10, -15, 4.5, 0.15, 2.4, 'passage west wall'),
      wall('passage-e', 20, -15, 4.5, 0.15, 2.4, 'passage east wall'),
      // 2.0 m clear between the inner faces (x = 21.0 and 23.0)
      ...(opts.corridor
        ? [wall('corridor-w', 22 - PASS_W / 2 - 0.15, 21, 0.15, 4, 2.4, 'corridor west wall'), wall('corridor-e', 22 + PASS_W / 2 + 0.15, 21, 0.15, 4, 2.4, 'corridor east wall')]
        : []),
      // deck posts (ground level) and slab (overhead on ground, floor on deck)
      ...[[6.1, 7.1], [13.9, 7.1], [6.1, 12.9], [13.9, 12.9]].map(([x, z], i) => wall(`deck-post-${i}`, x, z, 0.1, 0.1, DECK_Y, 'deck post')),
      { id: 'deck-slab', obb: { c: [10, 10], half: [4, 3], yaw: 0 }, y0: DECK_Y - 0.25, y1: DECK_Y, kind: 'solid', label: 'deck slab' },
      // stair bodies block the ground beneath/beside them
      { id: 'stairs-a-body', obb: { c: [4, 10], half: [2, 0.5], yaw: 0 }, y0: 0, y1: DECK_Y, kind: 'solid', label: 'stairs A' },
      { id: 'stairs-b-body', obb: { c: [16, 10], half: [2, 0.5], yaw: 0 }, y0: 0, y1: DECK_Y, kind: 'solid', label: 'stairs B' },
      ...(opts.extra ?? []),
    ],
    links: [stairsA, stairsB],
  };
}
