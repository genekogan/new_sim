// Joists and plywood decks — Mars assembly model v1, approximate (rule-based
// plausibility, NOT structural engineering; spec §7, §12). Assumed build-up
// (how Mars decks are made): plywood on 2x4 framing on rack beams.
//   * A 2x4 joist stands on edge ACROSS the bay depth (between the two columns),
//     bearing on the pair of installed beams (left + right column) at one seat
//     height; joists are spaced along the bay. Ends must reach the beam
//     centrelines and may cantilever ≤ 12 in past them (a 6 ft joist on a 4 ft
//     deep bay gives a 6 ft deck).
//   * A plywood sheet rests on the highest parallel members under it: ≥ 2
//     supports, each bearing along ≥ half the sheet, clear gaps ≤ 24 in (3/4 in
//     ply rated 24 in o.c.), edge overhang ≤ 12 in. Directly on a beam pair is
//     allowed only when the beams are ≤ 24 in apart — every Mars frame is 3–4 ft
//     deep, so in practice decks need joists (deviation from the brief's 4 ft,
//     which would make joists optional on every bay; see PROGRESSIVE.md).
//   * Support is a chain: sheet → joists → beams → uprights (held or stable).
//     Supports are recorded as `bears-on` connections on the supported part.
import { z } from 'zod';
import { dot2, IN, obbOverlap, rot2, sub2, type OBB2, type Vec2 } from '../core/math.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose, WorldState } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { beamLinks, isBeam, isStanding, isSupported, isUpright, snapSeat } from './rules.ts';
import {
  approach, beginLift, cancelLift, crewCheck, f2, fail, findStations, liftStep, releaseCrew, spatialOf, stagedCheck,
  type Fail, type LiftExec, type Station,
} from './access.ts';

export const JOIST_CANTILEVER_MAX = 12 * IN + 0.005;
export const PLY_SPAN_MAX = 24 * IN + 0.01; // clear distance between adjacent supports (centre to centre)
export const PLY_OVERHANG_MAX = 12 * IN + 0.005;

export const isJoist = (e?: Entity) => !!e && e.def.startsWith('2x4-');
export const isPlywood = (e?: Entity) => !!e && def(e.def).category === 'plywood';
const size = (e: Entity) => def(e.def).size;
export const memberTop = (e: Entity) => e.pose.p[1] + size(e)[1];
/** Horizontal centreline of a linear member (beam / joist), local x. */
export function memberSeg(e: Entity): [Vec2, Vec2] {
  const h = rot2([size(e)[0] / 2, 0], e.pose.yaw);
  return [[e.pose.p[0] - h[0], e.pose.p[2] - h[1]], [e.pose.p[0] + h[0], e.pose.p[2] + h[1]]];
}
export const flatObb = (p: Pose, e: Entity): OBB2 => ({ c: [p.p[0], p.p[2]], half: [size(e)[0] / 2, size(e)[2] / 2], yaw: p.yaw });
export const bearsOn = (e: Entity) => (e.connections ?? []).filter((c) => c.socket === 'bears-on').map((c) => c.to);

/** Why a beam cannot carry load right now ([] = it can). */
export function beamProblems(w: WorldState, b: Entity): string[] {
  if (b.phase !== 'installed') return [`beam ${b.id} is not installed`];
  const out: string[] = [];
  for (const c of b.connections ?? []) {
    const u = w.entities[c.to];
    if (!isUpright(u)) continue;
    if (!isStanding(u) || !isSupported(w, u)) out.push(`upright ${u.id} (under beam ${b.id}) is neither held nor stable`);
  }
  return out;
}

/** Why an installed joist / sheet / stair / tread is not (fully) supported ([] = supported). */
export function supportProblems(w: WorldState, e: Entity, depth = 0): string[] {
  if (depth > 6) return [];
  const sub = (id: string): string[] => {
    const s = w.entities[id];
    if (!s) return [`support ${id} no longer exists`];
    if (isBeam(s)) return beamProblems(w, s);
    if (s.phase !== 'installed') return [`${s.id} is not installed`];
    return supportProblems(w, s, depth + 1);
  };
  if (isJoist(e) || isPlywood(e)) {
    const on = bearsOn(e);
    if (on.length < 2) return [`${e.id} bears on ${on.length} support(s); needs 2`];
    return on.flatMap(sub);
  }
  const cat = def(e.def).category;
  if (cat === 'stair') {
    const top = (e.connections ?? []).find((c) => c.socket === 'top');
    return top ? sub(top.to) : [`stair ${e.id} has no top support`];
  }
  if (e.def === 'stair-tread') {
    const seat = (e.connections ?? []).find((c) => c.socket === 'seat');
    const st = seat && w.entities[seat.to];
    if (!st || st.phase !== 'installed') return [`tread ${e.id} has no installed stair flight under it`];
    return [];
  }
  return [];
}

// ---------------------------------------------------------------- install_joist

type JP = { crew: string[]; joist: string; bay: { a: string; b: string }; height: number; at: number };
type JProg = { to: Pose; beams: [string, string]; stations: Station[]; height: number };

export function planJoist(rt: Runtime, p: JP): { ok: true; program: JProg } | Fail {
  const w = rt.world;
  const j = w.entities[p.joist], a = w.entities[p.bay.a], b = w.entities[p.bay.b];
  if (!isJoist(j)) return fail('joist.not-joist', `${p.joist} is not a 2x4`, [p.joist]);
  for (const u of [a, b]) if (!isUpright(u) || !isStanding(u)) return fail('joist.no-bay', `${u ? u.id : '?'} is not a standing upright; a joist spans a bay between two standing uprights`, [p.bay.a, p.bay.b]);
  const h = snapSeat(a, p.height);
  if (h === null) return fail('joist.no-beams', `no beam seat near ${f2(p.height)} m on ${a.id}`, [a.id]);
  const links = beamLinks(w, a).filter((l) => l.other === b.id && Math.abs(l.height - h) < 0.005);
  const byCol = new Map(links.map((l) => [l.col, l.beam]));
  if (byCol.size < 2) {
    const found = [...byCol.entries()].map(([c, id]) => `${id} (${c < 0 ? 'left' : 'right'} column)`);
    return fail('joist.no-beams', `joist ${j.id} needs installed beams on both columns of bay ${a.id}–${b.id} at ${f2(h)} m to rest on; found ${found.length ? found.join(', ') : 'none'}`, [j.id, a.id, b.id]);
  }
  const beams = [byCol.get(-1)!, byCol.get(1)!] as [string, string];
  for (const id of beams) {
    const pr = beamProblems(w, w.entities[id]);
    if (pr.length) return fail('joist.beam-unsupported', `joist ${j.id} cannot rest on ${id}: ${pr.join('; ')}`, [j.id, id]);
  }
  const pa: Vec2 = [a.pose.p[0], a.pose.p[2]], pb: Vec2 = [b.pose.p[0], b.pose.p[2]];
  const L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
  const n: Vec2 = [(pb[0] - pa[0]) / L, (pb[1] - pa[1]) / L];
  if (p.at < 0.1 || p.at > L - 0.1) return fail('joist.out-of-bay', `joist position ${f2(p.at)} m is outside bay ${a.id}–${b.id} (0.10–${f2(L - 0.1)} m clear of the frames)`, [j.id]);
  const D = size(a)[0], len = size(j)[0];
  const cant = (len - D) / 2;
  if (cant < -1e-6) return fail('joist.too-short', `a ${def(j.def).label} (${f2(len)} m) cannot reach both beams ${f2(D)} m apart`, [j.id]);
  if (cant > JOIST_CANTILEVER_MAX)
    return fail('joist.overhang', `a ${def(j.def).label} would cantilever ${f2(cant)} m past each beam (max ${f2(JOIST_CANTILEVER_MAX)} m / 12 in)`, [j.id]);
  for (const o of Object.values(w.entities))
    if (isJoist(o) && o.phase === 'installed' && bearsOn(o).includes(beams[0]) && Math.abs(dot2(sub2([o.pose.p[0], o.pose.p[2]], pa), n) - p.at) < 0.06)
      return fail('joist.occupied', `joist ${o.id} already sits at ${f2(p.at)} m in bay ${a.id}–${b.id}`, [j.id, o.id]);
  const y = Math.max(...beams.map((id) => memberTop(w.entities[id])));
  const c: Vec2 = [pa[0] + n[0] * p.at, pa[1] + n[1] * p.at];
  const staged = stagedCheck(j, c, 'joist.not-staged');
  if (staged) return staged;
  const cc = crewCheck(rt, p.crew, 1, 2, `setting a ${def(j.def).label}`);
  if (cc) return cc;
  const to: Pose = { p: [c[0], y, c[1]], yaw: a.pose.yaw };
  const u = rot2([len * 0.45, 0], a.pose.yaw);
  const anchors: Vec2[] = p.crew.length === 1 ? [c] : [[c[0] - u[0], c[1] - u[1]], [c[0] + u[0], c[1] + u[1]]];
  const st = findStations(rt, p.crew, anchors, { label: `joist ${j.id}`, obb: flatObb(to, j), y: y + size(j)[1], y0: y });
  if (!st.ok) return st;
  return { ok: true, program: { to, beams, stations: st.stations, height: h } };
}

type JExec = LiftExec & { p: JP; prog: JProg };

export const installJoist: ActionDef<JP, JProg, JExec> = {
  verb: 'install_joist',
  description: 'Set a staged 2x4 joist on edge across a bay, resting on the two installed beams (left and right column) at one seat height, `at` metres along the bay from upright a.',
  schema: z.strictObject({
    crew: z.array(z.string().max(80)).min(1).max(2),
    joist: z.string().max(80),
    bay: z.strictObject({ a: z.string().max(80), b: z.string().max(80) }),
    height: z.number().min(0.1).max(6),
    at: z.number().min(0).max(12),
  }),
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.joist}`, mode: 'exclusive' }],
  plan: planJoist,
  start(rt, p, prog, id) {
    rt.world.entities[p.joist].phase = 'reserved';
    const from = rt.world.entities[p.joist].pose;
    return { p, prog, id, crew: p.crew, item: p.joist, phase: 'approach', t: 0, from, to: prog.to, duration: 2.0 };
  },
  step(rt, ex, dt) {
    if (ex.phase === 'approach') {
      const s = approach(rt, ex, ex.prog.stations, 'joist.station-unreachable');
      if (s === 'running') return { status: 'running', phase: 'approach' };
      if (s !== 'arrived') return { status: 'failed', diagnostic: s };
      for (const id of ex.prog.beams) {
        const pr = beamProblems(rt.world, rt.world.entities[id]);
        if (pr.length) return { status: 'failed', diagnostic: { code: 'joist.beam-unsupported', message: `joist ${ex.item} cannot rest on ${id}: ${pr.join('; ')}`, subjects: [ex.item, id] } };
      }
      ex.phase = 'place';
      beginLift(rt, ex);
    }
    if (!liftStep(rt, ex, dt)) return { status: 'running', phase: 'place' };
    const j = rt.world.entities[ex.item];
    j.phase = 'installed';
    j.support = { kind: 'resting-on', on: ex.prog.beams[0] };
    j.connections = ex.prog.beams.map((b) => ({ socket: 'bears-on', to: b, toSocket: `joist@${f2(ex.p.at)}` }));
    releaseCrew(rt, ex.crew);
    return { status: 'completed', outputs: { beams: ex.prog.beams, y: memberTop(j) } };
  },
  cancel(rt, ex) {
    const r = cancelLift(rt, ex, 'joist.cancel-unsafe');
    if (r.ok) rt.world.entities[ex.item].phase = 'staged';
    return r;
  },
};

// ---------------------------------------------------------------- install_plywood

type PP = { crew: string[]; sheet: string; x: number; z: number; yaw: number; height?: number };
type PProg = { to: Pose; supports: string[]; stations: Station[] };

/** Support analysis for a sheet footprint (used by install and by tests/diagnostics). */
export function sheetSupports(w: WorldState, sheet: Entity, obb: OBB2, height?: number): { ok: true; y: number; supports: string[] } | Fail {
  const cands = Object.values(w.entities)
    .filter((e) => (isJoist(e) || isBeam(e)) && e.phase === 'installed' && e.id !== sheet.id)
    .filter((e) => obbOverlap(obb, flatObb(e.pose, e), -0.005))
    .filter((e) => height === undefined || Math.abs(memberTop(e) - height) <= 0.3)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const where = `(${f2(obb.c[0])}, ${f2(obb.c[1])})`;
  if (!cands.length) return fail('plywood.unsupported', `nothing to rest ${sheet.id} on at ${where}: no installed joists or beams under its footprint`, [sheet.id]);
  const Y = Math.max(...cands.map(memberTop));
  const sup = cands.filter((e) => memberTop(e) >= Y - 0.01);
  const u = rot2([1, 0], sup[0].pose.yaw), v: Vec2 = [-u[1], u[0]];
  for (const s of sup)
    if (Math.abs(Math.abs(dot2(rot2([1, 0], s.pose.yaw), u)) - 1) > 0.002)
      return fail('plywood.support-geometry', `${sheet.id} would rest on members that are not parallel (${sup[0].id}, ${s.id})`, [sheet.id, sup[0].id, s.id]);
  const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => { const o = rot2([a * obb.half[0], b * obb.half[1]], obb.yaw); return [obb.c[0] + o[0], obb.c[1] + o[1]] as Vec2; });
  const pu = corners.map((c) => dot2(c, u)), pv = corners.map((c) => dot2(c, v));
  const t0 = Math.min(...pu), t1 = Math.max(...pu), s0 = Math.min(...pv), s1 = Math.max(...pv);
  const bearing = sup.filter((s) => {
    const [a, b] = memberSeg(s).map((q) => dot2(q, u));
    return Math.min(t1, Math.max(a, b)) - Math.max(t0, Math.min(a, b)) >= 0.5 * (t1 - t0) - 1e-6;
  });
  const joists = bearing.filter(isJoist).length;
  if (bearing.length < 2)
    return fail('plywood.too-few-supports', `${sheet.id} needs ≥ 2 joists under it (or a beam pair ≤ 24 in apart); at ${f2(Y)} m it would rest on ${bearing.length ? bearing.map((s) => s.id).join(', ') : 'nothing that bears along it'} (${joists} joist${joists === 1 ? '' : 's'})`, [sheet.id, ...bearing.map((s) => s.id)]);
  const pos = bearing.map((s) => ({ id: s.id, v: dot2([s.pose.p[0], s.pose.p[2]], v) })).sort((a, b) => a.v - b.v);
  for (let i = 1; i < pos.length; i++)
    if (pos[i].v - pos[i - 1].v > PLY_SPAN_MAX)
      return fail('plywood.span', `3/4 in plywood ${sheet.id} cannot span ${f2(pos[i].v - pos[i - 1].v)} m between ${pos[i - 1].id} and ${pos[i].id} (max ${f2(PLY_SPAN_MAX)} m / 24 in)${joists ? '' : '; install 2x4 joists first'}`, [sheet.id, pos[i - 1].id, pos[i].id]);
  const over = Math.max(pos[0].v - s0, s1 - pos[pos.length - 1].v);
  if (over > PLY_OVERHANG_MAX) return fail('plywood.overhang', `${sheet.id} would overhang its outermost support by ${f2(over)} m (max ${f2(PLY_OVERHANG_MAX)} m / 12 in)`, [sheet.id]);
  for (const s of bearing) {
    const pr = supportProblems(w, s).concat(isBeam(s) ? beamProblems(w, s) : []);
    if (pr.length) return fail('plywood.support-unsupported', `${sheet.id} cannot rest on ${s.id}: ${pr.join('; ')}`, [sheet.id, s.id]);
  }
  return { ok: true, y: Y, supports: bearing.map((s) => s.id) };
}

export function planPlywood(rt: Runtime, p: PP): { ok: true; program: PProg } | Fail {
  const w = rt.world;
  const sh = w.entities[p.sheet];
  if (!isPlywood(sh)) return fail('plywood.not-plywood', `${p.sheet} is not a plywood sheet`, [p.sheet]);
  const obb: OBB2 = { c: [p.x, p.z], half: [size(sh)[0] / 2, size(sh)[2] / 2], yaw: p.yaw };
  const s = sheetSupports(w, sh, obb, p.height);
  if (!s.ok) return s;
  const top = s.y + size(sh)[1];
  for (const o of Object.values(w.entities))
    if (isPlywood(o) && o.id !== sh.id && o.phase === 'installed' && Math.abs(memberTop(o) - top) < 0.05 && obbOverlap(obb, flatObb(o.pose, o), -0.01))
      return fail('plywood.overlap', `${sh.id} would overlap installed sheet ${o.id}`, [sh.id, o.id]);
  const staged = stagedCheck(sh, obb.c, 'plywood.not-staged');
  if (staged) return staged;
  const cc = crewCheck(rt, p.crew, 2, 2, `setting a ${def(sh.def).label}`);
  if (cc) return cc;
  const to: Pose = { p: [p.x, s.y, p.z], yaw: p.yaw };
  const e = rot2([size(sh)[0] * 0.45, 0], p.yaw);
  const st = findStations(rt, p.crew, [[p.x - e[0], p.z - e[1]], [p.x + e[0], p.z + e[1]]], { label: `plywood ${sh.id}`, obb, y: top, y0: s.y });
  if (!st.ok) return st;
  return { ok: true, program: { to, supports: s.supports, stations: st.stations } };
}

type PExec = LiftExec & { p: PP; prog: PProg };

export const installPlywood: ActionDef<PP, PProg, PExec> = {
  verb: 'install_plywood',
  description: 'Two people lay a staged plywood sheet flat at (x, z, yaw) on the highest parallel joists (or a close beam pair) under it. Refused unless ≥ 2 supports bear along it with ≤ 24 in gaps.',
  schema: z.strictObject({
    crew: z.array(z.string().max(80)).min(1).max(2),
    sheet: z.string().max(80),
    x: z.number().min(-1e4).max(1e4),
    z: z.number().min(-1e4).max(1e4),
    yaw: z.number().min(-10).max(10),
    height: z.number().min(0).max(12).optional(),
  }),
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.sheet}`, mode: 'exclusive' }],
  plan: planPlywood,
  start(rt, p, prog, id) {
    rt.world.entities[p.sheet].phase = 'reserved';
    return { p, prog, id, crew: p.crew, item: p.sheet, phase: 'approach', t: 0, from: rt.world.entities[p.sheet].pose, to: prog.to, duration: 3.0 };
  },
  step(rt, ex, dt) {
    if (ex.phase === 'approach') {
      const s = approach(rt, ex, ex.prog.stations, 'plywood.station-unreachable');
      if (s === 'running') return { status: 'running', phase: 'approach' };
      if (s !== 'arrived') return { status: 'failed', diagnostic: s };
      const sh = rt.world.entities[ex.item];
      const again = sheetSupports(rt.world, sh, flatObb(ex.to, sh), ex.p.height);
      if (!again.ok) return { status: 'failed', diagnostic: again.diagnostic };
      ex.phase = 'place';
      beginLift(rt, ex);
    }
    if (!liftStep(rt, ex, dt)) return { status: 'running', phase: 'place' };
    const sh = rt.world.entities[ex.item];
    sh.phase = 'installed';
    sh.support = { kind: 'resting-on', on: ex.prog.supports[0] };
    sh.connections = ex.prog.supports.map((s) => ({ socket: 'bears-on', to: s, toSocket: 'deck' }));
    releaseCrew(rt, ex.crew);
    spatialOf(rt);
    return { status: 'completed', outputs: { supports: ex.prog.supports, top: memberTop(sh) } };
  },
  cancel(rt, ex) {
    const r = cancelLift(rt, ex, 'plywood.cancel-unsafe');
    if (r.ok) rt.world.entities[ex.item].phase = 'staged';
    return r;
  },
};

