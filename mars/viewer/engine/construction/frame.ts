// Rack-structure access (owner feedback 2026-09-28 §5) — Mars assembly model v1, approximate.
// Nobody up top needs a finished floor: builders climb an installed upright's bracing like a
// ladder and stand on / walk along connected beams while staging. Same "only what exists is
// usable" rule as stairs (access.ts / stairs.ts): the links are derived from the world every sync.
//   * climb link  `climb:<upright>:<l|r>@<seat>` — one per installed, standing, supported upright,
//     column and beam seat height at that column: from the ground on the frame's outside face, up
//     the bracing beside the column, round the column and onto the beam end. 0.35 m/s, single
//     occupant, only small loads (catalog `handling.smallLoad`, ≤ 10 kg).
//   * beam walkway `beam:<beam>` — an installed, supported beam whose partner beam (same two
//     uprights, other column, same seat) is installed too. Width = catalog flange + 2 × 0.05 m;
//     balance-limited 0.4 m/s; nothing carried except small loads.
// Both links are narrower than a person's routing disc (2 × 0.28 m), so the generic route planner
// (spatial/path.ts skips links with width < 2r) never sends walkers up a frame: only the frame
// verbs (framemove.ts) and hand_up (handup.ts) traverse them. A person on one has `human.on` = its id.
import { add2, datan2, dist2, distPointSeg, dot2, rot2, scale2, sub2, type Vec2, hypot } from '../core/math.ts';
import type { Diagnostic } from '../actions/types.ts';
import { DT, type Invariant, type Runtime } from '../runtime/runtime.ts';
import type { Link } from '../spatial/types.ts';
import type { Entity, WorldState } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { levelFor } from './access.ts';
import { beamProblems, memberSeg, memberTop } from './deck.ts';
import { isBeam, isStanding, isSupported, isUpright, seatPoint } from './rules.ts';

export const CLIMB_SPEED = 0.35; // m/s along the climb path
export const BEAM_SPEED = 0.4; // m/s balance-limited walking on a beam
export const CLIMB_WIDTH = 0.4; // m usable width of a frame climb (one person)
export const BEAM_TOL = 0.05; // m either side of the flange a foot may land
export const CLIMB_OFF = 0.36; // m in front of the frame plane at the foot / while climbing (body radius 0.28 + column half-thickness + margin)
export const CLIMB_IN = 0.15; // m inward of the column (on the bracing) while climbing
export const CLIMB_ROUND = 0.3; // m outside the column line when stepping round it at the top
export const BEAM_END_IN = 0.15; // m: a walkway starts this far from the frame plane

const byId = (a: Entity, b: Entity) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const f2 = (x: number) => x.toFixed(2);
const unit = (v: Vec2): Vec2 => { const l = hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const xz = (e: Entity): Vec2 => [e.pose.p[0], e.pose.p[2]];

export const isSmallLoad = (defId: string) => !!def(defId).handling?.smallLoad;

/** What a person on the rack structure grips that is too big for it (null = hands free or small). */
export function bigLoad(w: WorldState, actor: string): Entity | null {
  const g = w.entities[actor]?.human?.grip;
  const e = g ? w.entities[g.entity] : undefined;
  return e && e.kind === 'component' && !isSmallLoad(e.def) ? e : null;
}

type BeamEnd = { upright: string; col: -1 | 1; height: number; p: Vec2 };

/** The two uprights a beam is hooked into, with column / seat parsed from the connection record. */
export function beamEnds(w: WorldState, b: Entity): [BeamEnd, BeamEnd] | null {
  const cs = (b.connections ?? []).filter((c) => isUpright(w.entities[c.to]));
  if (cs.length !== 2) return null;
  const [l, r] = memberSeg(b);
  const out: BeamEnd[] = [];
  for (const c of cs) {
    const m = /^col([lr])@(\d+(?:\.\d+)?)$/.exec(c.toSocket ?? '');
    if (!m) return null;
    out.push({ upright: c.to, col: m[1] === 'l' ? -1 : 1, height: Number(m[2]), p: c.socket === 'end-l' ? l : r });
  }
  return [out[0], out[1]];
}

const pairKey = (a: string, b: string, h: number) => `${a < b ? a : b}|${a < b ? b : a}|${h.toFixed(3)}`;

/** Beam walkways: every installed, supported beam whose partner at the same seat is installed too. */
export function beamWalkways(w: WorldState): Link[] {
  const beams = Object.values(w.entities).filter((e) => isBeam(e) && e.phase === 'installed').sort(byId);
  const ends = new Map<string, [BeamEnd, BeamEnd]>();
  const byPair = new Map<string, Entity[]>();
  for (const b of beams) {
    const en = beamEnds(w, b);
    if (!en || beamProblems(w, b).length) continue;
    ends.set(b.id, en);
    const k = pairKey(en[0].upright, en[1].upright, en[0].height);
    byPair.set(k, [...(byPair.get(k) ?? []), b]);
  }
  const out: Link[] = [];
  for (const b of beams) {
    const en = ends.get(b.id);
    if (!en) continue;
    const mates = byPair.get(pairKey(en[0].upright, en[1].upright, en[0].height)) ?? [];
    const colOf = (x: Entity) => ends.get(x.id)!.find((q) => q.upright === en[0].upright)!.col;
    const partner = mates.find((m) => m.id !== b.id && colOf(m) !== en[0].col);
    if (!partner) continue;
    const dir = unit(sub2(en[1].p, en[0].p));
    const a = add2(en[0].p, scale2(dir, BEAM_END_IN)), z = sub2(en[1].p, scale2(dir, BEAM_END_IN));
    const y = memberTop(b);
    const lv = levelFor(y);
    out.push({
      id: `beam:${b.id}`,
      kind: 'beam',
      from: { level: lv, p: a, y },
      to: { level: lv, p: z, y },
      width: (def(b.def).walkway?.flange ?? 0.1) + 2 * BEAM_TOL,
      heading: datan2(dir[1], dir[0]),
      path: [[a[0], y, a[1]], [z[0], y, z[1]]],
      usable: true,
      maxSpeed: BEAM_SPEED,
      carry: 'small',
      members: [b.id, partner.id],
    });
  }
  return out;
}

/** Climb links: installed, standing, supported uprights; one per column and beam seat there. */
export function climbLinks(w: WorldState): Link[] {
  const out: Link[] = [];
  const ups = Object.values(w.entities).filter((e) => isUpright(e) && e.phase === 'installed' && isStanding(e) && isSupported(w, e)).sort(byId);
  for (const u of ups) {
    const nU = rot2([0, 1], u.pose.yaw);
    const groundY = u.pose.p[1];
    for (const col of [-1, 1] as const) {
      // beams hooked into this column, by seat height (each beam end: which side of the frame its bay is)
      const seats = new Map<string, { h: number; top: number; sides: Set<number>; beams: string[] }>();
      for (const c of u.connections ?? []) {
        const b = w.entities[c.to];
        if (!isBeam(b) || b.phase !== 'installed') continue;
        const m = /^col([lr])@(\d+(?:\.\d+)?)$/.exec(c.socket);
        if (!m || (m[1] === 'l' ? -1 : 1) !== col) continue;
        const h = Number(m[2]);
        const [p0, p1] = memberSeg(b);
        const mid: Vec2 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        const k = h.toFixed(3);
        const s = seats.get(k) ?? { h, top: memberTop(b), sides: new Set<number>(), beams: [] };
        s.sides.add(Math.sign(dot2(sub2(mid, xz(u)), nU)) || 1);
        s.beams.push(b.id);
        seats.set(k, s);
      }
      for (const s of [...seats.values()].sort((a, b) => a.h - b.h)) {
        if (s.sides.size !== 1) continue; // beams on both faces (a middle frame): no free outside face
        const bay = [...s.sides][0];
        const out_ = scale2(nU, -bay), in_ = scale2(nU, bay);
        const e = rot2([col, 0], u.pose.yaw); // column direction (from the frame centre)
        const sp = seatPoint(u, col, 0);
        const colP: Vec2 = [sp[0], sp[2]];
        const bottom = add2(add2(colP, scale2(e, -CLIMB_IN)), scale2(out_, CLIMB_OFF));
        const round0 = add2(add2(colP, scale2(e, CLIMB_ROUND)), scale2(out_, CLIMB_OFF));
        const round1 = add2(add2(colP, scale2(e, CLIMB_ROUND)), scale2(in_, BEAM_END_IN));
        const exit = add2(colP, scale2(in_, BEAM_END_IN));
        const y = s.top;
        const d = sub2(exit, bottom);
        out.push({
          id: `climb:${u.id}:${col < 0 ? 'l' : 'r'}@${f2(s.h)}`,
          kind: 'climb',
          from: { level: levelFor(groundY), p: bottom, y: groundY },
          to: { level: levelFor(y), p: exit, y },
          width: CLIMB_WIDTH,
          heading: datan2(d[1], d[0]),
          path: [[bottom[0], groundY, bottom[1]], [bottom[0], y, bottom[1]], [round0[0], y, round0[1]], [round1[0], y, round1[1]], [exit[0], y, exit[1]]],
          usable: true,
          maxSpeed: CLIMB_SPEED,
          occupancy: 1,
          carry: 'small',
          members: [u.id, ...s.beams.sort()],
        });
      }
    }
  }
  return out;
}

/**
 * Shared physical climbing lane: upright + column + outside face, independent
 * of the destination beam seat. Derive the face in the upright's local frame
 * from its ground entry, so different heights share a key and opposite faces
 * remain independent. No field is added to the world or generated link.
 */
export function climbFaceResource(w: WorldState, link: Link): string | undefined {
  if (link.kind !== 'climb') return undefined;
  const column = /:([lr])@[^@]+$/.exec(link.id)?.[1];
  const upright = link.members?.[0] ? w.entities[link.members[0]] : undefined;
  if (!column || !upright) return undefined;
  const localZ = dot2(sub2(link.from.p, xz(upright)), rot2([0, 1], upright.pose.yaw));
  return `climb-face:${upright.id}:${column}:z${localZ < 0 ? '-' : '+'}`;
}

/** Every rack-structure link that exists right now (climbs, then walkways), deterministic order. */
export function frameLinks(w: WorldState): Link[] {
  return [...climbLinks(w), ...beamWalkways(w)];
}

export const frameLink = (w: WorldState, id: string) => frameLinks(w).find((l) => l.id === id);

/** Distance from (x, z) to a walkway's centre segment. */
export const offWalkway = (l: Link, p: Vec2) => distPointSeg(p, l.from.p, l.to.p);

/** Point of the walkway centreline nearest p, and its distance along the walkway from `from`. */
export function onWalkway(l: Link, p: Vec2): { q: Vec2; s: number; len: number } {
  const len = dist2(l.from.p, l.to.p);
  const d = unit(sub2(l.to.p, l.from.p));
  const s = Math.max(0, Math.min(len, dot2(sub2(p, l.from.p), d)));
  return { q: add2(l.from.p, scale2(d, s)), s, len };
}

/** The walkway a climb link lands on (its exit within the walkway strip), if any. */
export function walkwayAtExit(w: WorldState, climb: Link): Link | null {
  let best: Link | null = null, bd = Infinity;
  for (const l of beamWalkways(w)) {
    if (Math.abs(l.from.y - climb.to.y) > 0.01) continue;
    const d = offWalkway(l, climb.to.p);
    if (d <= l.width / 2 + 0.02 && d < bd) { bd = d; best = l; }
  }
  return best;
}

// ---- invariant: people on the rack structure are on something that exists, and not overloaded ----

const last = new WeakMap<Runtime, { tick: number; p: Map<string, Vec2> }>();

/**
 * Everyone with `human.on` stands on a frame link that exists now (`frame.link-gone`); on a beam they
 * stay within its walkway strip at its top (`frame.off-beam`), move ≤ 0.4 m/s (`frame.beam-overspeed`)
 * and never move while gripping a load that is not small (`frame.carry-on-beam`).
 */
export const frameAccessOk: Invariant = (rt) => {
  const out: Diagnostic[] = [];
  const people = Object.values(rt.world.entities).filter((e) => e.human?.on).sort(byId);
  const prev = last.get(rt);
  const valid = !!prev && prev.tick === rt.tick - 1;
  const now = new Map<string, Vec2>();
  if (people.length) {
    const links = new Map(frameLinks(rt.world).map((l) => [l.id, l]));
    for (const h of people) {
      const id = h.human!.on!;
      if (id.startsWith('stairwork:')) continue; // on an unfinished Kit stair's treads (moves-b.ts stairWorkOk checks those)
      const l = links.get(id);
      const p = xz(h);
      now.set(h.id, p);
      if (!l) {
        out.push({ code: 'frame.link-gone', message: `${h.id} is on ${id}, which no longer exists (a frame is climbable only while installed; a beam is walkable only with its partner beam in)`, subjects: [h.id], at: h.pose.p });
        continue;
      }
      if (l.kind !== 'beam' || h.human!.activity.startsWith('climb') || h.human!.activity === 'step-off') continue;
      const off = offWalkway(l, p);
      if (off > l.width / 2 + 0.02 || Math.abs(h.pose.p[1] - l.from.y) > 0.03)
        out.push({ code: 'frame.off-beam', message: `${h.id} is ${f2(off)} m off the centreline of ${l.id} (half-width ${f2(l.width / 2)} m) at ${f2(h.pose.p[1])} m (beam top ${f2(l.from.y)} m)`, subjects: [h.id, ...(l.members ?? [])], at: h.pose.p });
      const q = valid ? prev!.p.get(h.id) : undefined;
      if (!q) continue;
      const moved = dist2(p, q);
      if (moved > BEAM_SPEED * DT + 1e-6)
        out.push({ code: 'frame.beam-overspeed', message: `${h.id} moved ${f2(moved / DT)} m/s on ${l.id} (balance limit ${BEAM_SPEED} m/s)`, subjects: [h.id, l.members![0]], at: h.pose.p });
      const big = bigLoad(rt.world, h.id);
      if (big && moved > 0.005)
        out.push({ code: 'frame.carry-on-beam', message: `${h.id} walks ${l.id} holding ${big.id} (${def(big.def).label}, ${def(big.def).massKg} kg): only small loads (≤ 10 kg) are carried on a beam`, subjects: [h.id, big.id, l.members![0]], at: h.pose.p });
    }
  }
  last.set(rt, { tick: rt.tick, p: now });
  return out;
};
