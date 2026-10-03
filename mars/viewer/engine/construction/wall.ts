// install_wall — plywood wall panels on the rack's framing edge (owner feedback 2026-09-28 §7: "floors, ceilings
// and walls, gradually"; year builds phase B, W13). Mars assembly model v1, approximate; the fastening rule is
// PROVISIONAL (how Mars fixes its plywood walls to the racks is not documented).
//
// A panel (a 4x8 cut to the wall height, stood up: roll π/2, catalog-phase-b.ts) is walked into place by 1–2
// people on a floor and screwed to the rack members right behind it (≤ 1.2 cm from its back face, inside its
// outline or ≤ 5 cm below its bottom edge, which is screwed down into the rim below):
//   * a beam running along the wall (≥ 0.3 m of it behind the panel)  → one horizontal fastening line;
//   * a reconstruction frame in the panel's plane / behind its edge   → its column(s) + bracing: vertical lines
//     over the frame's height (a frame behind ≥ 0.3 m of the panel counts as two lines);
//   * the edge of an installed deck sheet                             → one horizontal line.
// It must be fastened in its bottom third AND its top third (a frame spanning both counts for both), each by a
// crew member who reaches a point of that line: ≤ 0.8 m horizontally from their feet, −0.5…2.06 m above them
// (standing on the ground / a deck, or kneeling at a deck edge above). A band nobody reaches is refused
// (`wall.fasten-out-of-reach`, naming the line and its height); a panel with nothing behind it,
// `wall.no-fastening`. Sequenced after the deck(s) it stands on / is fastened from.
import type { Vec2, Vec3 } from '../core/math.ts';
import { dist2, dot2, obbOverlap, rot2 } from '../core/math.ts';
import type { Diagnostic } from '../actions/types.ts';
import type { Entity, Pose, WorldState } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { entityCorners, entityFootprint } from '../spatial/service.ts';
import { f2 } from './access.ts';
import { flatObb, isPlywood, memberTop, supportProblems } from './deck.ts';
import { beamProblems } from './deck.ts';
import { isBeam, isKitUpright, isStanding, isSupported } from './rules.ts';
import { GIVE_MAX, REACH_DOWN } from './handup.ts';
import { BODY_MODEL } from '../body/model.ts';
import { localToWorld, setPartVerb, type SupportRule } from './setpart.ts';

export const WALL_BACK_GAP = 0.012; // m: members this close behind the panel's back face are fastened to
export const WALL_MIN_OVERLAP = 0.3; // m of the panel's width a beam / deck edge must run behind it
const RIM_BELOW = 0.05; // m below the bottom edge a rim (beam / deck edge) still takes the bottom screws

export const isWallPanel = (e?: Entity) => !!e && isPlywood(e) && Math.abs(Math.abs(e.pose.roll ?? 0) - Math.PI / 2) < 0.05;

type Line = { member: string; kind: 'beam' | 'frame' | 'deck'; y0: number; y1: number; u0: number; u1: number; socket: string };

/** Fastening lines behind a standing panel at pose `to` (sorted). */
export function wallLines(w: WorldState, e: Entity, to: Pose): { lines: Line[]; bottom: number; top: number; axis: Vec2; c: Vec2 } {
  const cs = entityCorners({ ...e, pose: to });
  const bottom = Math.min(...cs.map((c) => c[1])), top = Math.max(...cs.map((c) => c[1]));
  const f = entityFootprint({ ...e, pose: to }).obb;
  // the panel's width runs along its footprint's long side
  const long = f.half[0] >= f.half[1] ? 0 : 1;
  const axis: Vec2 = rot2(long === 0 ? [1, 0] : [0, 1], f.yaw);
  const halfW = f.half[long];
  const grown = { ...f, half: (long === 0 ? [f.half[0], f.half[1] + WALL_BACK_GAP] : [f.half[0] + WALL_BACK_GAP, f.half[1]]) as Vec2 };
  const u = (p: Vec2) => dot2([p[0] - f.c[0], p[1] - f.c[1]], axis);
  const lines: Line[] = [];
  for (const m of Object.values(w.entities).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (m.id === e.id || m.phase !== 'installed') continue;
    if (!(isBeam(m) || isKitUpright(m) || (isPlywood(m) && !isWallPanel(m)))) continue;
    const mf = entityFootprint(m);
    if (!obbOverlap(grown, mf.obb, 0)) continue;
    const mc = entityCorners(m);
    const us = mc.map((c) => u([c[0], c[2]]));
    const u0 = Math.max(-halfW, Math.min(...us)), u1 = Math.min(halfW, Math.max(...us));
    if (u1 - u0 <= 0.01) continue;
    if (isBeam(m)) {
      if (Math.abs(dot2(rot2([1, 0], m.pose.yaw), axis)) < 0.98 || u1 - u0 < WALL_MIN_OVERLAP) continue;
      // the beam's outer face (its whole depth takes screws)
      const y0 = m.pose.p[1], y1 = m.pose.p[1] + def(m.def).size[1];
      if (y1 < bottom - RIM_BELOW || y0 > top) continue;
      lines.push({ member: m.id, kind: 'beam', y0: Math.max(y0, bottom - RIM_BELOW), y1: Math.min(y1, top), u0, u1, socket: `beam@${((y0 + y1) / 2).toFixed(2)}` });
    } else if (isKitUpright(m)) {
      const y0 = Math.max(bottom, m.pose.p[1]), y1 = Math.min(top, m.pose.p[1] + def(m.def).size[1]);
      if (y1 <= y0) continue;
      lines.push({ member: m.id, kind: 'frame', y0, y1, u0, u1, socket: 'column' });
      if (u1 - u0 >= WALL_MIN_OVERLAP) lines.push({ member: m.id, kind: 'frame', y0, y1, u0, u1, socket: 'bracing' });
    } else {
      if (Math.abs((m.pose.pitch ?? 0)) > 0.1 || Math.abs(m.pose.roll ?? 0) > 0.1 || u1 - u0 < WALL_MIN_OVERLAP) continue;
      const y = memberTop(m);
      if (y < bottom - RIM_BELOW || y > top) continue;
      lines.push({ member: m.id, kind: 'deck', y0: y, y1: y, u0, u1, socket: `deck-edge@${y.toFixed(2)}` });
    }
  }
  return { lines, bottom, top, axis, c: f.c };
}

/** Can someone standing at `feet` put a screw somewhere on `line` (within the panel's outline)? */
function reaches(feet: Vec3, l: Line, c: Vec2, axis: Vec2, planeOff: Vec2): boolean {
  // nearest point of the line's span to the feet (horizontal), then the height window
  const uf = dot2([feet[0] - c[0], feet[2] - c[1]], axis);
  const uu = Math.max(l.u0, Math.min(l.u1, uf));
  const p: Vec2 = [c[0] + axis[0] * uu + planeOff[0], c[1] + axis[1] * uu + planeOff[1]];
  if (dist2(p, [feet[0], feet[2]]) > BODY_MODEL.maxHorizontalFromFeet + 1e-9) return false;
  const lo = feet[1] - REACH_DOWN, hi = feet[1] + GIVE_MAX;
  return l.y1 >= lo - 1e-9 && l.y0 <= hi + 1e-9;
}

export const wallRule: SupportRule = (w, e, to, p, feetOf) => {
  const { lines, bottom, top, axis, c } = wallLines(w, e, to);
  const H = top - bottom;
  const bad = (code: string, message: string, subjects: string[]): Diagnostic => ({ code, message, subjects });
  if (!lines.length) return bad('wall.no-fastening', `wall panel ${e.id} would have nothing behind it to be fastened to (no beam, frame or deck edge within ${WALL_BACK_GAP} m of its back)`, [e.id]);
  for (const l of lines) {
    const m = w.entities[l.member];
    const pr = isBeam(m) ? beamProblems(w, m) : isKitUpright(m) ? (isStanding(m) && isSupported(w, m) ? [] : [`frame ${m.id} is neither held nor stable`]) : supportProblems(w, m);
    if (pr.length) return bad('wall.member-unsupported', `wall panel ${e.id} cannot be fastened to ${m.id}: ${pr.join('; ')}`, [e.id, m.id]);
  }
  const fasten = p?.fasten ?? [];
  const feet = fasten.map((a) => ({ a, f: feetOf ? feetOf(a) : [...w.entities[a].pose.p] as Vec3 }));
  const band = (lo: number, hi: number) => lines.filter((l) => l.y1 >= lo && l.y0 <= hi);
  const need: [string, number, number][] = [['bottom', bottom - RIM_BELOW, bottom + H / 3], ['top', top - H / 3, top]];
  const used = new Set<Line>();
  for (const [what, lo, hi] of need) {
    const ls = band(lo, hi);
    if (!ls.length) return bad('wall.no-fastening', `wall panel ${e.id} has nothing to be fastened to in its ${what} third (${f2(lo)}–${f2(hi)} m): members behind it: ${lines.map((l) => `${l.member} (${l.kind} ${f2(l.y0)}–${f2(l.y1)} m)`).join(', ')}`, [e.id]);
    const ok = ls.find((l) => feet.some((x) => reaches(x.f, { ...l, y0: Math.max(l.y0, lo), y1: Math.min(l.y1, hi) }, c, axis, [0, 0])));
    if (!ok) {
      const l = ls[0];
      return bad('wall.fasten-out-of-reach', `nobody can fasten wall panel ${e.id} in its ${what} third: ${l.kind} ${l.member} at ${f2(Math.max(l.y0, lo))}–${f2(Math.min(l.y1, hi))} m is out of reach of ${feet.map((x) => `${x.a} (feet at ${f2(x.f[1])} m, ${f2(dist2([x.f[0], x.f[2]], c))} m away)`).join(', ') || 'no one'} (−${REACH_DOWN}…${GIVE_MAX} m above the feet, ≤ ${BODY_MODEL.maxHorizontalFromFeet} m out); someone on the deck ${what === 'top' ? 'above' : 'below'} must fasten it`, [e.id, l.member, ...fasten]);
    }
    used.add(ok);
  }
  // record every reachable line as a support (≥ 2 records: a frame behind ≥ 0.3 m gives column + bracing)
  const rec = lines.filter((l) => used.has(l) || feet.some((x) => reaches(x.f, l, c, axis, [0, 0])));
  if (rec.length < 2) return bad('wall.no-fastening', `wall panel ${e.id} would be fastened along one line only (${rec.map((l) => `${l.kind} ${l.member}`).join(', ')}); it needs two`, [e.id]);
  return { kind: 'connected', supports: rec.map((l) => l.member), sockets: rec.map((l) => l.socket) };
};

export const installWall = setPartVerb('install_wall', 'wall panel', wallRule, (d) => /^plywood-\dx\d{4}mm$/.test(d),
  'Stand a plywood wall panel against the outer face of the rack (a beam line or a frame plane) and screw it to the members behind it: in its bottom and top thirds, each by someone who reaches that line (−0.5…2.06 m from their feet, ≤ 0.8 m out; e.g. from the deck above). Lift crew on a floor, optional take crew on a deck above.');

void localToWorld; void flatObb;
