// Mars pallet-rack assembly model v1 — approximate, rule-based plausibility,
// NOT structural engineering (spec §8, §12). Vocabulary (Gene): an *upright*
// is the tall blue two-column braced frame; *beams* are the orange horizontals
// that join the columns of two parallel uprights to form a bay.
//
// Frame-local axes: x = across the frame (between its two columns, ±depth/2),
// y = up, z = normal to the frame plane (beams run along ±z to the next frame).
//
// Stability rule (v1): a group of uprights joined by installed beams is
// self-supporting iff it has ≥ 2 standing uprights and every upright in it
// has beams on BOTH columns at ≥ N distinct heights (N = 1 for frames ≤ 9 ft,
// 2 for taller frames). Until then every upright must be held by ≥ holdCrew people.
// (v1.1, year builds) Other uprights of the group that are still held by ≥ holdCrew
// people are exempt from the height count (their holders carry them); the upright
// being judged never is.
import { FT, datan2, rot2, type Vec2, type Vec3 } from '../core/math.ts';
import type { Diagnostic } from '../actions/types.ts';
import type { Entity, WorldState } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { BODY_MODEL } from '../body/model.ts';

// 2: crews accompany lifted parts; swept lifts; raise choreography
// 3: hand_up (receivers kneel at the edge: hands ≤ 0.8 m from their feet), items / eating, solar, paint
export const RULES_VERSION = 'mars-assembly/3';
export const STANDING_REACH = BODY_MODEL.overheadMax; // m: highest beam seat a person on the ground can place (2.06; body/model.ts)
export const LADDER_REACH = 3.6; // m: with a ladder at the station

export const isUpright = (e?: Entity) => !!e && def(e.def).category === 'rack-upright';
export const isBeam = (e?: Entity) => !!e && def(e.def).category === 'rack-beam';
export const isStanding = (e: Entity) => Math.abs(e.pose.pitch ?? 0) < 0.02 && Math.abs(e.pose.roll ?? 0) < 0.02;
export const requiredLevels = (u: Entity) => (def(u.def).size[1] > 9.5 * FT ? 2 : 1);

/** World position of a column seat on a standing upright. col ∈ {-1, 1}. */
export function seatPoint(u: Entity, col: -1 | 1, height: number): Vec3 {
  const d = def(u.def).size[0];
  const o = rot2([(col * d) / 2, 0], u.pose.yaw);
  return [u.pose.p[0] + o[0], u.pose.p[1] + height, u.pose.p[2] + o[1]];
}

/** Snap a requested beam height to the frame's discrete seat holes. */
export function snapSeat(u: Entity, height: number): number | null {
  const ys = [...new Set((def(u.def).sockets ?? []).filter((s) => s.kind === 'beam-seat').map((s) => s.local[1]))];
  let best: number | null = null;
  for (const y of ys) if (best === null || Math.abs(y - height) < Math.abs(best - height)) best = y;
  return best !== null && Math.abs(best - height) < 0.08 ? best : null;
}

export type BeamLink = { beam: string; col: -1 | 1; height: number; other: string };

/** Installed beams attached to an upright, derived from connection records. */
export function beamLinks(w: WorldState, u: Entity): BeamLink[] {
  const out: BeamLink[] = [];
  for (const c of u.connections ?? []) {
    const b = w.entities[c.to];
    if (!isBeam(b) || b.phase !== 'installed') continue;
    const m = /^col([lr])@(\d+(?:\.\d+)?)$/.exec(c.socket);
    if (!m) continue;
    const other = (b.connections ?? []).find((x) => x.to !== u.id)?.to;
    if (!other) continue;
    out.push({ beam: b.id, col: m[1] === 'l' ? -1 : 1, height: Number(m[2]), other });
  }
  return out;
}

/** Uprights joined to `u` through installed beams (including u). */
export function assemblyGroup(w: WorldState, u: Entity): Entity[] {
  const seen = new Set([u.id]);
  const q = [u];
  while (q.length) {
    const x = q.pop()!;
    for (const l of beamLinks(w, x))
      if (!seen.has(l.other) && isUpright(w.entities[l.other])) {
        seen.add(l.other);
        q.push(w.entities[l.other]);
      }
  }
  return [...seen].sort().map((id) => w.entities[id]);
}

export type StabilityReport = { stable: boolean; group: string[]; missing: string[] };

export function groupStability(w: WorldState, u: Entity): StabilityReport {
  const group = assemblyGroup(w, u);
  const missing: string[] = [];
  if (group.length < 2) missing.push(`${u.id} is not joined by beams to another upright`);
  for (const g of group) {
    if (!isStanding(g)) { missing.push(`${g.id} is not standing`); continue; }
    // an upright still held by enough people is carried by them, not by its beams: a new frame hung on a
    // stable run (year builds, campus/sequence.ts) does not un-stabilise the frames already released
    if (g.id !== u.id && g.support?.kind === 'held' && g.support.by.length >= (def(g.def).handling?.holdCrew ?? 1)) continue;
    const n = requiredLevels(g);
    const links = beamLinks(w, g);
    for (const col of [-1, 1] as const) {
      const hs = new Set(links.filter((l) => l.col === col).map((l) => l.height.toFixed(3)));
      if (hs.size < n)
        missing.push(`${g.id} needs beams on its ${col < 0 ? 'left' : 'right'} column at ≥${n} height${n > 1 ? 's' : ''} (has ${hs.size})`);
    }
  }
  return { stable: missing.length === 0, group: group.map((g) => g.id), missing };
}

/** Is this upright currently held up (by people, or by a stable assembly)? */
export function isSupported(w: WorldState, u: Entity): boolean {
  if (u.support?.kind === 'held') return u.support.by.length >= (def(u.def).handling?.holdCrew ?? 1);
  if (u.support?.kind === 'connected') return groupStability(w, u).stable;
  return u.support?.kind === 'ground' && !isStanding(u); // lying on the ground
}

/** People who are holding something cannot take unrelated tasks (spec §17: critical responsibilities are not abandoned). */
export function holdingDiagnostic(w: WorldState, actor: string): Diagnostic | null {
  const h = w.entities[actor]?.human;
  if (!h?.grip) return null;
  return {
    code: 'actor.holding',
    message: `${actor} is holding ${h.grip.entity} and cannot leave until it is set down or stable`,
    subjects: [actor, h.grip.entity],
  };
}

/**
 * Stations where people raise and then hold an upright: first beside each
 * column in the frame plane (outside any bay the beams will enclose), then on
 * the frame's −z side (its base side while it lies toward +z).
 */
export function holdStations(u: Entity, n: number): { p: Vec2; yaw: number }[] {
  const d = def(u.def).size[0];
  // beside each column in the frame plane (never inside the future bay), then behind the base
  const offs: Vec2[] = [[-(d / 2 + 0.42), 0], [d / 2 + 0.42, 0], [-(d / 2 + 0.42), -0.7], [d / 2 + 0.42, -0.7]];
  return offs.slice(0, n).map((o) => {
    const w = rot2(o, u.pose.yaw);
    const p: Vec2 = [u.pose.p[0] + w[0], u.pose.p[2] + w[1]];
    // face the column
    const col = rot2([Math.sign(o[0]) * (d / 2), 0], u.pose.yaw);
    return { p, yaw: datan2(u.pose.p[2] + col[1] - p[1], u.pose.p[0] + col[0] - p[0]) };
  });
}
