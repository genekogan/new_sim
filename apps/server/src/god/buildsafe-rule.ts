// The clearance rule the commit-time auto-repair (buildsafe/1, lane BS2) judges ways by: one swap point. Today it is
// lane SEALED's furnish ways rule (tools/god-skill/lib/furnish.mjs: a body BODY_R round on a CELL grid; a piece's
// approach is in front of each seat, else the free spot nearest it). When BUILDSAFE part 1's shared clearance rule and
// use-check land, re-export them here; buildsafe.ts reads nothing else.
import { approachOf as furnishApproach } from '../../../../tools/god-skill/lib/furnish.mjs';

export type Vec2 = [number, number];
/** A way key: the free cell nearest any of `pts` within `r` metres stands for it (as the walk goal search does). */
export type ApproachKey = { pts: Vec2[]; r: number };

/** Body radius and raster cell of the ways rule (furnish.mjs BODY_R / CELL). */
export const BODY_R = 0.34;
export const CELL = 0.1;
/** Heights above the floor a blocker must reach into to stop a walker (furnish.mjs: walls 0.15..1.6 m). */
export const BAND: [number, number] = [0.15, 1.6];
/** The standing spot of a piece (`baked` in its def frame) at world `at`, `yaw`. */
export function approachOf(baked: unknown, at: Vec2, yaw: number): ApproachKey {
  const k = furnishApproach(baked, at, yaw) as unknown;
  return Array.isArray(k) ? { pts: [k as Vec2], r: 0.3 } : k as ApproachKey;
}
