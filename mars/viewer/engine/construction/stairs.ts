// Stair flights and treads — Mars assembly model v1, approximate (spec §7, §10,
// §28 "Incomplete floor/stairs"). A flight module (catalog `stair-flight-N`)
// is two stringers: its foot stands on a floor (ground or a supported deck),
// its top edge hooks onto an installed, supported joist or beam whose top is
// 0–0.25 m below the flight's top. Treads are separate parts installed one by
// one (`install_tread`, index 1 = bottom). The flight becomes a walkable stair
// link only when every tread is in AND a supported landing surface exists at
// the top (contributor.ts); otherwise its link is emitted with usable = false
// and a reason such as "treads 3, 7 missing" or "no landing at top".
import { z } from 'zod';
import { distPointSeg, obbOverlap, pointInObb, rot2, type OBB2, type Vec2, type Vec3 } from '../core/math.ts';
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose, WorldState } from '../world/types.ts';
import type { Link, Surface } from '../spatial/types.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { clearanceAt, nearestBlocker } from '../spatial/grid.ts';
import { def } from '../world/catalog.ts';
import { isBeam } from './rules.ts';
import { beamProblems, isJoist, memberSeg, memberTop, supportProblems } from './deck.ts';
import {
  approach, beginSweptLift, cancelLift, crewCheck, f2, fail, findStations, levelFor, liftStep, releaseCrew, spatialOf, stagedCheck, lerpPose, stationFloor, sweptLiftPath, symmetricYaw,
  type Fail, type LiftExec, type Station, type SweepOpts,
} from './access.ts';

export const TOP_SUPPORT_REACH = 0.15; // m: stringer hooks within this horizontal distance of the member
export const LANDING_TOL = 0.08; // m: landing surface height vs flight top (adjustable feet / shims)
const APPROACH_OUT = 0.45; // m: link endpoints beyond the foot and past the top edge

export const isStairFlight = (e?: Entity) => !!e && def(e.def).category === 'stair' && !!def(e.def).stair;

export type StairGeom = { dir: Vec2; perp: Vec2; foot: Vec2; top: Vec2; c: Vec2; run: number; rise: number; width: number; treads: number; going: number; riser: number; baseY: number; topY: number; yaw: number };

export function stairGeom(defId: string, pose: Pose): StairGeom {
  const d = def(defId);
  const [run, rise, width] = d.size;
  const treads = d.stair!.treads;
  const dir = rot2([1, 0], pose.yaw), perp = rot2([0, 1], pose.yaw);
  const c: Vec2 = [pose.p[0], pose.p[2]];
  return {
    dir, perp, c, run, rise, width, treads, yaw: pose.yaw,
    foot: [c[0] - dir[0] * run / 2, c[1] - dir[1] * run / 2],
    top: [c[0] + dir[0] * run / 2, c[1] + dir[1] * run / 2],
    going: run / treads, riser: rise / (treads + 1), baseY: pose.p[1], topY: pose.p[1] + rise,
  };
}
const along = (g: StairGeom, s: number, y: number): Vec3 => [g.c[0] + g.dir[0] * s, y, g.c[1] + g.dir[1] * s];
export const stairObb = (g: StairGeom): OBB2 => ({ c: g.c, half: [g.run / 2, g.width / 2], yaw: g.yaw });

function segSegDist(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return 0;
  return Math.min(distPointSeg(a, c, d), distPointSeg(b, c, d), distPointSeg(c, a, b), distPointSeg(d, a, b));
}

/** Installed, supported joist/beam the flight's top edge can hook onto (nearest), or null. */
export function topSupport(w: WorldState, g: StairGeom): Entity | null {
  const e0: Vec2 = [g.top[0] - g.perp[0] * g.width / 2, g.top[1] - g.perp[1] * g.width / 2];
  const e1: Vec2 = [g.top[0] + g.perp[0] * g.width / 2, g.top[1] + g.perp[1] * g.width / 2];
  let best: Entity | null = null, bd = Infinity;
  for (const m of Object.values(w.entities).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!(isJoist(m) || isBeam(m)) || m.phase !== 'installed') continue;
    const t = memberTop(m);
    if (t < g.topY - 0.25 || t > g.topY + 0.03) continue;
    const [a, b] = memberSeg(m);
    const d = segSegDist(a, b, e0, e1);
    if (d > TOP_SUPPORT_REACH || d >= bd) continue;
    if ((isBeam(m) ? beamProblems(w, m) : supportProblems(w, m)).length) continue;
    best = m; bd = d;
  }
  return best;
}

export function missingTreads(w: WorldState, st: Entity): number[] {
  const g = def(st.def).stair!.treads;
  const have = new Set((st.connections ?? []).filter((c) => /^tread-\d+$/.test(c.socket) && w.entities[c.to]?.phase === 'installed').map((c) => Number(c.socket.slice(6))));
  const out: number[] = [];
  for (let i = 1; i <= g; i++) if (!have.has(i)) out.push(i);
  return out;
}

/** "treads 3, 7 missing" / "treads 1–10 missing" / "tread 4 missing". */
export function treadsPhrase(ix: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < ix.length; ) {
    let j = i;
    while (j + 1 < ix.length && ix[j + 1] === ix[j] + 1) j++;
    parts.push(j - i >= 2 ? `${ix[i]}–${ix[j]}` : j === i ? `${ix[i]}` : `${ix[i]}, ${ix[j]}`);
    i = j + 1;
  }
  return `${ix.length === 1 ? 'tread' : 'treads'} ${parts.join(', ')} missing`;
}

/** The navigation link for an installed flight, given the walkable surfaces that currently exist. */
export function stairLink(w: WorldState, st: Entity, surfaces: Surface[]): Link {
  const g = stairGeom(st.def, st.pose);
  const from: Vec2 = [g.foot[0] - g.dir[0] * APPROACH_OUT, g.foot[1] - g.dir[1] * APPROACH_OUT];
  const to: Vec2 = [g.top[0] + g.dir[0] * APPROACH_OUT, g.top[1] + g.dir[1] * APPROACH_OUT];
  const landing = surfaces.find((s) => Math.abs(s.y - g.topY) <= LANDING_TOL && pointInObb(to, s.obb, -0.05) && pointInObb(g.top.map((v, i) => v + g.dir[i] * 0.1) as Vec2, s.obb));
  const bottom = surfaces.find((s) => Math.abs(s.y - g.baseY) <= LANDING_TOL && pointInObb(from, s.obb));
  const reasons: string[] = [];
  const miss = missingTreads(w, st);
  if (miss.length) reasons.push(treadsPhrase(miss));
  const sp = supportProblems(w, st);
  if (sp.length) reasons.push(`top not supported (${sp.join('; ')})`);
  if (!landing) reasons.push('no landing at top');
  if (!bottom) reasons.push('no floor at the foot');
  const landY = landing?.y ?? g.topY;
  const path: Vec3[] = [[from[0], g.baseY, from[1]], along(g, -g.run / 2, g.baseY)];
  for (let i = 1; i <= g.treads; i++) path.push(along(g, -g.run / 2 + (i - 0.5) * g.going, g.baseY + i * g.riser));
  path.push(along(g, g.run / 2, landY), [to[0], landY, to[1]]);
  return {
    id: st.id,
    kind: 'stairs',
    from: { level: bottom?.level ?? levelFor(g.baseY), p: from, y: g.baseY },
    to: { level: landing?.level ?? levelFor(g.topY), p: to, y: landY },
    width: g.width,
    heading: g.yaw,
    path,
    usable: reasons.length === 0,
    reason: reasons.length ? reasons.join('; ') : undefined,
  };
}

// ---------------------------------------------------------------- install_stair_flight

type SP = { crew: string[]; stair: string; x: number; z: number; heading: number; level?: number };
type SProg = { to: Pose; support: string; stations: Station[]; offsets: Vec2[]; duration: number; sweep: SweepOpts };

function siteBlocker(rt: Runtime, id: string, obb: OBB2, y0: number, y1: number, ignore: string[]): string | null {
  const sp = spatialOf(rt);
  for (const o of sp.scene.obstacles) {
    if (o.id === id || ignore.includes(o.id) || o.y1 <= y0 || o.y0 >= y1) continue;
    if (obbOverlap(obb, o.obb, -0.01)) return o.label ?? o.id;
  }
  return null;
}

export function planStairFlight(rt: Runtime, p: SP): { ok: true; program: SProg } | Fail {
  const w = rt.world;
  const st = w.entities[p.stair];
  if (!isStairFlight(st)) return fail('stair.not-stair', `${p.stair} is not a stair flight`, [p.stair]);
  const sp = spatialOf(rt);
  const lv = sp.scene.levels.find((l) => l.id === (p.level ?? 0));
  if (!lv) return fail('stair.no-base', `level ${p.level ?? 0} does not exist (no supported floor there)`, [st.id]);
  const d = def(st.def);
  const dir = rot2([1, 0], p.heading);
  const c: Vec2 = [p.x + dir[0] * d.size[0] / 2, p.z + dir[1] * d.size[0] / 2];
  const to: Pose = { p: [c[0], lv.y, c[1]], yaw: p.heading };
  const g = stairGeom(st.def, to);
  const base = sp.scene.surfaces.filter((s) => s.level === lv.id);
  if (![g.c, [g.foot[0] - dir[0] * APPROACH_OUT, g.foot[1] - dir[1] * APPROACH_OUT] as Vec2].every((q) => base.some((s) => pointInObb(q, s.obb))))
    return fail('stair.no-base', `the foot of ${st.id} at (${f2(p.x)}, ${f2(p.z)}) is not on a walkable floor of level ${lv.id}`, [st.id]);
  const sup = topSupport(w, g);
  if (!sup)
    return fail('stair.no-top-support', `the top of ${st.id} (${f2(g.topY)} m at (${f2(g.top[0])}, ${f2(g.top[1])})) has nothing to rest on: no installed, supported joist or beam within ${TOP_SUPPORT_REACH} m with its top at ${f2(g.topY - 0.25)}–${f2(g.topY + 0.03)} m`, [st.id], [g.top[0], g.topY, g.top[1]]);
  const obb = stairObb(g);
  const blk = siteBlocker(rt, st.id, obb, g.baseY + 0.02, g.topY - 0.02, [sup.id]);
  if (blk) return fail('stair.site-blocked', `${st.id} would intersect ${blk} in its installed position`, [st.id], [g.c[0], g.baseY, g.c[1]]);
  const staged = stagedCheck(st, g.c, 'stair.not-staged');
  if (staged) return staged;
  if (Math.abs(st.pose.pitch ?? 0) > 0.01 || Math.abs(st.pose.roll ?? 0) > 0.01) return fail('stair.not-staged', `${st.id} must be standing on its stringers before it is walked into place`, [st.id]);
  const cc = crewCheck(rt, p.crew, 2, 2, `setting a ${d.label}`);
  if (cc) return cc;
  for (const h of Object.values(w.entities))
    if (h.kind === 'human' && h.human && !p.crew.includes(h.id) && h.human.level === lv.id && pointInObb([h.pose.p[0], h.pose.p[2]], obb, HUMAN_PROFILE.radius))
      return fail('stair.site-occupied', `${h.id} is standing where ${st.id} goes`, [st.id, h.id]);
  // the crew stands either side of the staged flight and walks it into place
  const off = g.width / 2 + 0.45;
  const offsets: Vec2[] = [[0, -off], [0, off]];
  const from = st.pose;
  const dist = Math.hypot(to.p[0] - from.p[0], to.p[2] - from.p[2]);
  // the flight body (shared swept-lift check; it may touch the member its top hooks onto). It is
  // walked along the floor by its carriers, so it cannot be hoisted over an obstacle.
  const sweep: SweepOpts = { ignore: [sup.id], liftOver: false, what: `stair flight ${st.id}` };
  const path = sweptLiftPath(rt, st, from, to, sweep);
  if (!path.ok) return path;
  const gr = sp.level(lv.id)!;
  const r = HUMAN_PROFILE.radius;
  const n = Math.max(2, Math.ceil(dist / 0.1));
  for (let k = 0; k <= n; k++) {
    const q = lerpPose(from, to, k / n);
    for (const o of offsets) {
      const oo = rot2(o, q.yaw);
      const cp: Vec2 = [q.p[0] + oo[0], q.p[2] + oo[1]];
      if (clearanceAt(gr, cp) < r - 0.02)
        return fail('stair.move-blocked', `a carrier of ${st.id} would hit ${nearestBlocker(gr, cp) ?? 'the floor edge'} at (${f2(cp[0])}, ${f2(cp[1])})`, [st.id]);
    }
  }
  const stations: Station[] = p.crew.map((actor, i) => {
    const oo = rot2(offsets[i], from.yaw);
    return { actor, level: lv.id, p: [from.p[0] + oo[0], from.p[2] + oo[1]], yaw: from.yaw };
  });
  return { ok: true, program: { to, support: sup.id, stations, offsets, duration: Math.max(2, dist / 0.6), sweep } };
}

type SExec = LiftExec & { p: SP; prog: SProg };

export const installStairFlight: ActionDef<SP, SProg, SExec> = {
  verb: 'install_stair_flight',
  description: 'Two people walk a staged stair flight into place: foot at (x, z) on `level` (default ground), ascending along `heading`; its top must hook onto an installed, supported joist or beam at the deck edge. Treads are installed separately.',
  schema: z.strictObject({
    crew: z.array(z.string().max(80)).min(1).max(2),
    stair: z.string().max(80),
    x: z.number().min(-1e4).max(1e4),
    z: z.number().min(-1e4).max(1e4),
    heading: z.number().min(-10).max(10),
    level: z.number().int().min(0).max(20).optional(),
  }),
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.stair}`, mode: 'exclusive' }],
  plan: planStairFlight,
  start(rt, p, prog, id) {
    rt.world.entities[p.stair].phase = 'reserved';
    // carriers either side of the flight (offsets ∓z) hold its long-edge midpoints (liftcrew hand points)
    return { p, prog, id, crew: p.crew, item: p.stair, phase: 'approach', t: 0, from: rt.world.entities[p.stair].pose, to: prog.to, duration: prog.duration, slots: ['lift-edge-0', 'lift-edge-1'] };
  },
  step(rt, ex, dt) {
    if (ex.phase === 'approach') {
      const s = approach(rt, ex, ex.prog.stations, 'stair.station-unreachable', false);
      if (s === 'running') return { status: 'running', phase: 'approach' };
      if (s !== 'arrived') return { status: 'failed', diagnostic: s };
      const blocked = beginSweptLift(rt, ex, ex.prog.sweep, ex.duration);
      if (blocked) return { status: 'failed', diagnostic: blocked };
      ex.phase = 'place';
    }
    const done = liftStep(rt, ex, dt, false) === true;
    const q = rt.world.entities[ex.item].pose;
    for (const [i, c] of ex.crew.entries()) {
      const oo = rot2(ex.prog.offsets[i], q.yaw);
      const h = rt.world.entities[c];
      h.pose = { ...h.pose, p: [q.p[0] + oo[0], h.pose.p[1], q.p[2] + oo[1]] };
    }
    if (!done) return { status: 'running', phase: 'place' };
    const st = rt.world.entities[ex.item];
    st.phase = 'installed';
    st.support = { kind: 'connected', to: [ex.prog.support] };
    st.connections = [{ socket: 'top', to: ex.prog.support, toSocket: 'stair-top' }];
    releaseCrew(rt, ex.crew);
    return { status: 'completed', outputs: { support: ex.prog.support, missing: missingTreads(rt.world, st) } };
  },
  cancel(rt, ex) {
    const r = cancelLift(rt, ex, 'stair.cancel-unsafe');
    if (r.ok) rt.world.entities[ex.item].phase = 'staged';
    return r;
  },
};

// ---------------------------------------------------------------- install_tread

type TP = { crew: string[]; stair: string; tread: string; index: number };
type TProg = { to: Pose; stations: Station[]; sweep: SweepOpts };

export function planTread(rt: Runtime, p: TP): { ok: true; program: TProg } | Fail {
  const w = rt.world;
  const st = w.entities[p.stair], tr = w.entities[p.tread];
  if (!isStairFlight(st) || st.phase !== 'installed') return fail('tread.no-stair', `${p.stair} is not an installed stair flight`, [p.stair]);
  if (tr?.def !== 'stair-tread') return fail('tread.not-tread', `${p.tread} is not a stair tread`, [p.tread]);
  const g = stairGeom(st.def, st.pose);
  if (!Number.isInteger(p.index) || p.index < 1 || p.index > g.treads) return fail('tread.index', `${st.id} has treads 1–${g.treads}; ${p.index} requested`, [st.id]);
  if (!missingTreads(w, st).includes(p.index)) return fail('tread.already-installed', `tread ${p.index} of ${st.id} is already installed`, [st.id]);
  const s = -g.run / 2 + (p.index - 0.5) * g.going;
  const yTop = g.baseY + p.index * g.riser;
  const to: Pose = { p: [g.c[0] + g.dir[0] * s, yTop - def(tr.def).size[1], g.c[1] + g.dir[1] * s], yaw: symmetricYaw(tr.pose.yaw, g.yaw + Math.PI / 2) };
  const staged = stagedCheck(tr, [to.p[0], to.p[2]], 'tread.not-staged');
  if (staged) return staged;
  const cc = crewCheck(rt, p.crew, 1, 2, 'installing a tread');
  if (cc) return cc;
  const obb: OBB2 = { c: [to.p[0], to.p[2]], half: [def(tr.def).size[0] / 2, def(tr.def).size[2] / 2], yaw: to.yaw };
  const st2 = findStations(rt, p.crew, [[to.p[0], to.p[2]]], { label: `tread ${p.index} of ${st.id}`, obb, y: yTop, y0: to.p[1] }, [stairObb(g)]);
  if (!st2.ok) return st2;
  // it seats into the flight (whose obstacle box is its whole envelope); nothing else on the way
  const sweep: SweepOpts = { ignore: [st.id], what: `tread ${p.index} (${tr.id}) of ${st.id}`, floor: stationFloor(rt, st2.stations) };
  const path = sweptLiftPath(rt, tr, tr.pose, to, sweep);
  if (!path.ok) return path;
  return { ok: true, program: { to, stations: st2.stations, sweep } };
}

type TExec = LiftExec & { p: TP; prog: TProg };

export const installTread: ActionDef<TP, TProg, TExec> = {
  verb: 'install_tread',
  description: 'Install tread `index` (1 = bottom) of an installed stair flight from a staged tread; a person stands beside the flight within reach.',
  schema: z.strictObject({
    crew: z.array(z.string().max(80)).min(1).max(2),
    stair: z.string().max(80),
    tread: z.string().max(80),
    index: z.number().int().min(1).max(40),
  }),
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.tread}`, mode: 'exclusive' }, { resource: `tread:${p.stair}:${p.index}`, mode: 'exclusive' }],
  plan: planTread,
  start(rt, p, prog, id) {
    rt.world.entities[p.tread].phase = 'reserved';
    return { p, prog, id, crew: p.crew, item: p.tread, phase: 'approach', t: 0, from: rt.world.entities[p.tread].pose, to: prog.to, duration: 1.5 };
  },
  step(rt, ex, dt) {
    if (ex.phase === 'approach') {
      const s = approach(rt, ex, ex.prog.stations, 'tread.station-unreachable');
      if (s === 'running') return { status: 'running', phase: 'approach' };
      if (s !== 'arrived') return { status: 'failed', diagnostic: s };
      const st = rt.world.entities[ex.p.stair];
      if (st.phase !== 'installed' || !missingTreads(rt.world, st).includes(ex.p.index))
        return { status: 'failed', diagnostic: { code: 'tread.stale', message: `tread ${ex.p.index} of ${st.id} can no longer be installed`, subjects: [st.id] } as Diagnostic };
      const blocked = beginSweptLift(rt, ex, ex.prog.sweep, ex.duration);
      if (blocked) return { status: 'failed', diagnostic: blocked };
      ex.phase = 'place';
    }
    const ls = liftStep(rt, ex, dt);
    if (ls !== true) return ls ? { status: 'blocked', diagnostic: ls } : { status: 'running', phase: 'place' };
    const w = rt.world;
    const tr = w.entities[ex.item], st = w.entities[ex.p.stair];
    tr.phase = 'installed';
    tr.support = { kind: 'connected', to: [st.id] };
    tr.connections = [{ socket: 'seat', to: st.id, toSocket: `tread-${ex.p.index}` }];
    (st.connections ??= []).push({ socket: `tread-${ex.p.index}`, to: tr.id, toSocket: 'seat' });
    releaseCrew(rt, ex.crew);
    return { status: 'completed', outputs: { missing: missingTreads(w, st) } };
  },
  cancel(rt, ex) {
    const r = cancelLift(rt, ex, 'tread.cancel-unsafe');
    if (r.ok) rt.world.entities[ex.item].phase = 'staged';
    return r;
  },
};

