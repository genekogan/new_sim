// Floater movement planning. A floater moves like a humanoid on the ground plane — the same Spatial
// route planner, the same obstacles, the same grid and clearance rules, only its own radius — and is
// drawn at a constant hover above the route. The walk controller selects this derived Spatial and
// body profile for floaters; humanoids retain the original planner and motion. This module builds
// its own Spatial over a link-filtered copy of the scene.
//
// Level changes: a floater cannot use stairs, ladders, climbs or beams. It changes level only through
// a link the scene author declared passable for floaters (an `opening`: a stairwell void, an atrium, a
// wide doorway between split levels) or along a ramp, gliding continuously along it — never a jump.
// Every other link is marked unusable here with a named reason, so a route that would need one fails
// 'floater.stairs-unsupported' (… 'ladder' / 'climb' / 'beam') naming the link, instead of teleporting.
import { datan2, hypot, type Vec2, type Vec3 } from '../core/math.ts';
import type { Place, Route, RouteResult } from '../spatial/path.ts';
import { Spatial, type Contributor } from '../spatial/service.ts';
import { HUMAN_PROFILE, type AgentProfile, type Link, type SpatialScene } from '../spatial/types.ts';
import type { Body, WorldState } from '../world/types.ts';
import { floaterBody, type FloaterBody } from './body.ts';
import { creatureSpecies } from './creatures.ts';

/** Cruising glide speed (m/s): a little slower than a walk, unhurried. */
export const FLOAT_SPEED = 1.0;

export const linkReason = (kind: Link['kind']): string => `floater.${kind}-unsupported`;

/** Movement profile of a floater: a humanoid's, with the head's radius (route planning reads only radius). */
export function floaterProfile(body: FloaterBody): AgentProfile {
  // a creature moves at its species' own speed (bodies/creatures.ts); every other floater glides at FLOAT_SPEED
  const creature = body.type === 'creature' ? creatureSpecies(body.model) : undefined;
  if (creature) return { ...HUMAN_PROFILE, id: `creature-${creature.id}-r${body.radius}`, radius: body.radius, height: body.hoverHeight + body.radius, speed: creature.speed, turnRate: creature.id === 'snail' ? 1.2 : 3.0 };
  return { ...HUMAN_PROFILE, id: `floater-r${body.radius}`, radius: body.radius, height: body.hoverHeight + body.radius, speed: FLOAT_SPEED, turnRate: 3.0 };
}

/** Whether a floater may glide along this link: a declared opening, or a ramp. */
export const floaterPassable = (link: Link, openings: ReadonlySet<string>) => openings.has(link.id) || link.kind === 'ramp';

/** Links as a floater sees them: impassable kinds become unusable with a named reason. Input untouched. */
export function floaterLinks(links: readonly Link[], openings: ReadonlySet<string>): Link[] {
  return links.map((l) => (openings.has(l.id)?{...l,usable:true}:floaterPassable(l, openings) ? l : { ...l, usable: false, reason: linkReason(l.kind) }));
}

/** A copy of the scene with floater link rules applied. */
export function floaterScene(base: SpatialScene, openings: ReadonlySet<string>): SpatialScene {
  return { ...base, links: floaterLinks(base.links, openings) };
}

/** One point of a float track: the ground point (x, ground y, z) and the cumulative path length. */
export type TrackPoint = { g: Vec3; s: number; level: number };
/** A planned glide: ground points (for the engine pose) and the constant hover above them. */
export type FloatTrack = { points: TrackPoint[]; length: number; hover: number };

export type FloatPlan =
  | { ok: true; route: Route; track: FloatTrack }
  | { ok: false; reason: string; message: string; links: string[]; diagnostic: { code: string; message: string; subjects?: string[] } };

export type FloatPlannerOpts = { openings?: Iterable<string>; contributors?: Contributor[]; baseId?: string; cell?: number };

export class FloatPlanner {
  readonly spatial: Spatial;
  readonly openings: ReadonlySet<string>;

  constructor(base: SpatialScene, opts: FloatPlannerOpts = {}) {
    const openings = (this.openings = new Set(opts.openings ?? []));
    // contributed links (construction stairs, rack climbs) get the same floater rules
    const contributors = (opts.contributors ?? []).map((c): Contributor => (w, b) => {
      const r = c(w, b);
      return r.links ? { ...r, links: floaterLinks(r.links, openings) } : r;
    });
    this.spatial = new Spatial(floaterScene(base, openings), { contributors, ...(opts.baseId ? { baseId: opts.baseId } : {}), ...(opts.cell ? { cell: opts.cell } : {}) });
  }

  /** Plan a glide for a floater with `body` from `start` to `goal`. Reads `world`; never mutates it. */
  plan(world: WorldState, body: Body, start: Place, goal: Place): FloatPlan {
    const fb = floaterBody(body);
    const r: RouteResult = this.spatial.route(world, floaterProfile(fb), start, goal);
    if (r.ok) return { ok: true, route: r.route, track: floatTrack(r.route, this.spatial.scene, fb.hoverHeight) };
    const d = r.diagnostic;
    if (d.code === 'route.link-unusable') {
      const blocked = (d.subjects ?? []).map((id) => this.spatial.scene.links.find((l) => l.id === id)).filter((l): l is Link => !!l && !floaterPassable(l, this.openings));
      if (blocked.length)
        return {
          ok: false,
          reason: linkReason(blocked[0].kind),
          message: `a floater cannot use ${blocked.map((l) => `${l.kind} ${l.id}`).join(', ')}; declare a passable opening or a ramp between these levels`,
          links: blocked.map((l) => l.id),
          diagnostic: d,
        };
    }
    return { ok: false, reason: d.code, message: d.message, links: [], diagnostic: d };
  }
}

const levelY = (scene: SpatialScene, level: number) => {
  const l = scene.levels.find((q) => q.id === level);
  if (!l) throw new Error(`no level ${level} in scene`);
  return l.y;
};

/** Ground points of a route, in order: walk legs at their level's height, link legs glided continuously. */
export function floatTrack(route: Route, scene: SpatialScene, hover: number): FloatTrack {
  const pts: TrackPoint[] = [];
  const push = (g: Vec3, level: number) => {
    const prev = pts[pts.length - 1];
    if (prev && prev.g[0] === g[0] && prev.g[1] === g[1] && prev.g[2] === g[2]) {
      prev.level = level;
      return;
    }
    const s = prev ? prev.s + hypot(g[0] - prev.g[0], g[1] - prev.g[1], g[2] - prev.g[2]) : 0;
    pts.push({ g, s, level });
  };
  for (const leg of route.legs) {
    if (leg.kind === 'walk') {
      const y = levelY(scene, leg.level);
      for (const p of leg.points) push([p[0], y, p[1]], leg.level);
    } else {
      const { link, ascending } = leg;
      const from = ascending ? link.from : link.to;
      const to = ascending ? link.to : link.from;
      // a ramp is glided along its own path; an opening straight through from entry to exit
      const mid: Vec3[] = link.kind === 'ramp' ? (ascending ? link.path : [...link.path].reverse()).map((q) => [q[0], q[1], q[2]] as Vec3) : [];
      push([from.p[0], from.y, from.p[1]], from.level);
      for (const q of mid) push(q, from.level);
      push([to.p[0], to.y, to.p[1]], to.level);
    }
  }
  return { points: pts, length: pts.length ? pts[pts.length - 1].s : 0, hover };
}

/** The glide at arc length s (clamped): ground point, hover point and travel heading (engine yaw). */
export function sampleFloat(track: FloatTrack, s: number): { ground: Vec3; at: Vec3; yaw: number; level: number; done: boolean } {
  const pts = track.points;
  if (!pts.length) throw new Error('empty float track');
  const c = Math.min(Math.max(s, 0), track.length);
  let i = 1;
  while (i < pts.length && pts[i].s < c) i++;
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(i, pts.length - 1)];
  const k = b.s > a.s ? (c - a.s) / (b.s - a.s) : 0;
  const g: Vec3 = [a.g[0] + (b.g[0] - a.g[0]) * k, a.g[1] + (b.g[1] - a.g[1]) * k, a.g[2] + (b.g[2] - a.g[2]) * k];
  const dir: Vec2 = [b.g[0] - a.g[0], b.g[2] - a.g[2]];
  const yaw = dir[0] || dir[1] ? datan2(dir[1], dir[0]) : 0;
  return { ground: g, at: [g[0], g[1] + track.hover, g[2]], yaw, level: k < 1 ? a.level : b.level, done: c >= track.length };
}
