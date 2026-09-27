// connect_beam + release_support (spec §7, §12, §28 "Raise tall frame").
import { z } from 'zod';
import { angleDelta, dot2, rot2, sub2, wrapAngle, type Vec2 } from '../core/math.ts';
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { groupStability, holdingDiagnostic, isBeam, isStanding, isSupported, isUpright, seatPoint, snapSeat, STANDING_REACH } from './rules.ts';
import { checkStations, childrenState, walkCrew, type Children } from './children.ts';
import { liftDuration, pathPose, sweptLiftPath } from './access.ts';

type CP = { crew: string[]; beam: string; a: string; b: string; column: 'l' | 'r'; height: number };
type CProg = { colB: 'l' | 'r'; height: number; endA: 'end-l' | 'end-r'; target: { p: [number, number, number]; yaw: number }; stations: { p: Vec2; yaw: number }[]; path: Pose[]; duration: number };
type CExec = { p: CP; prog: CProg; id: string; phase: 'approach' | 'lift'; children?: Children; t: number; from: { p: [number, number, number]; yaw: number }; path?: Pose[]; duration?: number };

const fail = (code: string, message: string, subjects: string[]): { ok: false; diagnostic: Diagnostic } => ({ ok: false, diagnostic: { code, message, subjects } });

/** Geometry + preconditions for seating a beam between the same column of uprights a and b. */
export function planBeam(rt: Runtime, p: CP): { ok: true; program: CProg } | { ok: false; diagnostic: Diagnostic } {
  const w = rt.world;
  const a = w.entities[p.a], b = w.entities[p.b], beam = w.entities[p.beam];
  if (!isBeam(beam)) return fail('beam.not-beam', `${p.beam} is not a pallet-rack beam`, [p.beam]);
  for (const u of [a, b] as (Entity | undefined)[]) {
    if (!isUpright(u)) return fail('beam.not-upright', `${u ? u.id : '?'} is not an upright`, [p.a, p.b]);
    if (!isStanding(u!)) return fail('beam.upright-not-standing', `${u!.id} is not standing`, [u!.id]);
    if (!isSupported(w, u!)) return fail('beam.upright-unsupported', `${u!.id} is standing but neither held nor stable`, [u!.id]);
  }
  if (p.crew.length !== 2) return fail('beam.crew', 'seating a beam needs exactly two people, one at each end', p.crew);
  for (const c of p.crew) {
    const d = holdingDiagnostic(w, c);
    if (d) return { ok: false, diagnostic: d };
  }
  // alignment: b must sit along a's frame normal at the beam's length
  const L = def(beam.def).size[0];
  const rel = rot2(sub2([b.pose.p[0], b.pose.p[2]], [a.pose.p[0], a.pose.p[2]]), -a.pose.yaw);
  const dz = Math.abs(rel[1]);
  // frames are symmetric: parallel means yaw equal modulo π; a flipped frame's columns swap sides
  const dyaw = angleDelta(a.pose.yaw, b.pose.yaw);
  const flip = Math.abs(dyaw) > Math.PI / 2;
  if (Math.abs(rel[0]) > 0.04 || Math.abs(dz - L) > 0.06 || Math.abs(flip ? Math.PI - Math.abs(dyaw) : dyaw) > 0.035)
    return fail('beam.misaligned', `${a.id} and ${b.id} are ${dz.toFixed(2)} m apart (offset ${rel[0].toFixed(2)} m); a ${def(beam.def).label} needs ${L.toFixed(2)} m with frames parallel`, [a.id, b.id, beam.id]);
  const h = snapSeat(a, p.height);
  if (h === null) return fail('beam.no-seat', `no seat hole near ${p.height.toFixed(2)} m on ${a.id}`, [a.id]);
  if (h > STANDING_REACH)
    return fail('reach.too-high', `a beam seat at ${h.toFixed(2)} m exceeds standing reach (${STANDING_REACH} m); ladders/scaffold/deck access are not modelled yet`, [beam.id, ...p.crew]);
  const col = p.column === 'l' ? -1 : 1;
  const colB = (flip ? -col : col) as -1 | 1;
  const sa = seatPoint(a, col, h), sb = seatPoint(b, colB, h);
  // seat height is frame-relative; the beam's world height comes from the seat point (ground may not be y=0)
  const mid: [number, number, number] = [(sa[0] + sb[0]) / 2, sa[1] - def(beam.def).size[1] / 2, (sa[2] + sb[2]) / 2];
  // staged at the bay: lying roughly under its final position (the carry action delivers it here)
  const bp = beam.pose.p;
  if (beam.support?.kind !== 'ground' || Math.hypot(bp[0] - mid[0], bp[2] - mid[2]) > 0.9)
    return fail('beam.not-staged', `${beam.id} must be lying on the ground within 0.9 m below its seat position (carry it to the bay first)`, [beam.id]);
  // installers stand just outside the column and outside the bay, facing the seat
  const sgn = Math.sign(rel[1]) || 1;
  const face = (s: [number, number, number], outZ: number) => {
    const o = rot2([col * 0.25, outZ * 0.8], a.pose.yaw); // beyond the bay end, clear of the column holders
    return { p: [s[0] + o[0], s[2] + o[1]] as Vec2, yaw: Math.atan2(-o[1], -o[0]) };
  };
  // beam long axis (local x) along a's frame normal; the beam is end-for-end symmetric, so take the
  // yaw (mod π) nearest the staged yaw — it must not spin 180° mid-air — and map its ends to a/b by geometry
  const axis = a.pose.yaw + Math.PI / 2;
  const d = angleDelta(beam.pose.yaw, axis);
  const beamYaw = wrapAngle(Math.abs(d) > Math.PI / 2 ? axis + Math.PI : axis);
  const endA = dot2([Math.cos(beamYaw), Math.sin(beamYaw)], [sa[0] - mid[0], sa[2] - mid[2]]) > 0 ? 'end-r' : 'end-l';
  // swept lift: the beam may touch the two uprights it hooks into; nothing else on the way up
  const lift = sweptLiftPath(rt, beam, beam.pose, { p: mid, yaw: beamYaw }, { ignore: [a.id, b.id], what: `${def(beam.def).label} ${beam.id}` });
  if (!lift.ok) return lift;
  return {
    ok: true,
    program: { colB: colB < 0 ? 'l' : 'r', height: h, endA, target: { p: mid, yaw: beamYaw }, stations: [face(sa, -sgn), face(sb, sgn)], path: lift.path.poses, duration: liftDuration(lift.path, 2.5) },
  };
}

export const connectBeam: ActionDef<CP, CProg, CExec> = {
  verb: 'connect_beam',
  description: 'Two people seat a staged beam into the same column (l or r) of two standing, supported uprights at a seat height.',
  schema: z.strictObject({
    crew: z.array(z.string().max(80)).min(1).max(4),
    beam: z.string().max(80),
    a: z.string().max(80),
    b: z.string().max(80),
    column: z.enum(['l', 'r']),
    height: z.number().min(0.1).max(6),
  }),
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.beam}`, mode: 'exclusive' }],
  plan(rt, p) {
    const r = planBeam(rt, p);
    if (!r.ok) return r;
    const unreachable = checkStations(rt, p.crew.map((c, i) => ({ actor: c, p: r.program.stations[i].p })));
    return unreachable ? { ok: false, diagnostic: { ...unreachable, code: 'beam.station-unreachable' } } : r;
  },
  start(rt, p, prog, id) {
    const beam = rt.world.entities[p.beam];
    beam.phase = 'reserved';
    return { p, prog, id, phase: 'approach', t: 0, from: { p: [...beam.pose.p], yaw: beam.pose.yaw } };
  },
  step(rt, ex, dt) {
    const w = rt.world;
    const beam = w.entities[ex.p.beam];
    if (ex.phase === 'approach') {
      if (!ex.children) {
        const r = walkCrew(rt, ex.id, ex.p.crew.map((c, i) => ({ actor: c, ...ex.prog.stations[i] })));
        if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'beam.station-unreachable' } };
        ex.children = r;
      }
      const s = childrenState(ex.children);
      if (s === 'running') return { status: 'running', phase: 'approach' };
      if (s !== 'done') return { status: 'failed', diagnostic: s };
      // re-check at the moment of lifting: uprights may have lost support meanwhile
      const again = planBeam(rt, ex.p);
      if (!again.ok) return { status: 'failed', diagnostic: again.diagnostic };
      ex.path = again.program.path;
      ex.duration = again.program.duration;
      ex.phase = 'lift';
      beam.support = { kind: 'held', by: [...ex.p.crew] };
      beam.phase = 'carried';
      for (const c of ex.p.crew) Object.assign(w.entities[c].human!, { activity: 'lift', grip: { entity: beam.id, slot: c } });
    }
    ex.t = Math.min(1, ex.t + dt / (ex.duration ?? 2.5));
    const q = pathPose(ex.path!, ex.t);
    beam.pose = { p: q.p, yaw: q.yaw };
    if (ex.t < 1) return { status: 'running', phase: 'lift' };
    const key = `col${ex.p.column}@${ex.prog.height.toFixed(3)}`;
    const keyB = `col${ex.prog.colB}@${ex.prog.height.toFixed(3)}`;
    beam.phase = 'installed';
    beam.support = { kind: 'connected', to: [ex.p.a, ex.p.b] };
    const endA = ex.prog.endA, endB = endA === 'end-l' ? 'end-r' : 'end-l';
    beam.connections = [{ socket: endA, to: ex.p.a, toSocket: key }, { socket: endB, to: ex.p.b, toSocket: keyB }];
    (w.entities[ex.p.a].connections ??= []).push({ socket: key, to: beam.id, toSocket: endA });
    (w.entities[ex.p.b].connections ??= []).push({ socket: keyB, to: beam.id, toSocket: endB });
    for (const c of ex.p.crew) Object.assign(w.entities[c].human!, { activity: 'idle', grip: undefined, task: undefined });
    return { status: 'completed', outputs: { stable: groupStability(w, w.entities[ex.p.a]).stable } };
  },
  cancel(rt, ex) {
    if (ex.phase === 'lift') return { ok: false, diagnostic: { code: 'beam.cancel-unsafe', message: `${ex.p.beam} is being lifted; it cannot be abandoned mid-air`, subjects: [ex.p.beam] } };
    for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
    rt.world.entities[ex.p.beam].phase = 'staged';
    return { ok: true };
  },
};

type RP = { item: string };
export const releaseSupport: ActionDef<RP, string[], { p: RP; crew: string[] }> = {
  verb: 'release_support',
  description: 'Let go of an upright. Refused unless its beam-joined assembly satisfies the Mars assembly stability rule.',
  schema: z.strictObject({ item: z.string().max(80) }),
  reservations: (w, p) => [{ resource: `entity:${p.item}`, mode: 'exclusive' }, ...(w.entities[p.item]?.support?.kind === 'held' ? (w.entities[p.item].support as { by: string[] }).by : []).map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const }))],
  plan(rt, p) {
    const u = rt.world.entities[p.item];
    if (!isUpright(u)) return fail('release.not-upright', `${p.item} is not an upright`, [p.item]);
    if (u.support?.kind !== 'held') return fail('release.not-held', `${u.id} is not being held`, [u.id]);
    const r = groupStability(rt.world, u);
    if (!r.stable)
      return fail('support.release-premature', `the crew cannot release ${u.id}: required stabilizing connections are missing — ${r.missing.join('; ')}`, [u.id, ...u.support.by]);
    return { ok: true, program: u.support.by };
  },
  start: (_rt, p, crew) => ({ p, crew }),
  step(rt, ex) {
    const u = rt.world.entities[ex.p.item];
    const beams = (u.connections ?? []).map((c) => c.to);
    u.support = { kind: 'connected', to: beams };
    u.phase = 'installed';
    for (const c of ex.crew) Object.assign(rt.world.entities[c].human!, { activity: 'idle', grip: undefined, task: undefined });
    return { status: 'completed', outputs: { released: ex.crew } };
  },
  cancel: () => ({ ok: true }),
};
