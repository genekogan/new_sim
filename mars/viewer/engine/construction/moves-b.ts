// Year build phase B access and logistics verbs (owner feedback 2026-09-28 §7; W13). Mars model v1, approximate.
//
// * climb_stair {actor, boards[], to}  — builders stand on the treads they have already built to set the next
//   ones (the stair's walking link stays unusable until every tread is in: setpart.ts kitStairLink). `boards`
//   = the installed, supported tread boards of treads 1…k in climbing order; the actor walks to the foot of the
//   flight and climbs them (0.35 m/s, like a ladder) to `to` on the top board (`human.on = stairwork:<board>`,
//   level 0: they are among the people on the ground for the walkers). Only small loads may be held while
//   climbing. `leave_stair {actor, boards[], to}` climbs back down to the foot and steps off onto the ground at `to`.
// * step_onto_beam {actor, beam, x, z}  — from a deck onto a walkable beam at that level (the reverse of
//   beam_walk's step-off): the beam point ≤ 1.0 m away, ±0.25 m in height, not under a deck, nobody within
//   0.6 m of it on that beam. Then beam_walk / climb_frame down as usual.
// * stack_offcut {actor, piece, pile}  — put an offcut lying beside a scrap pile (≤ 1.2 m from it) onto it: the
//   person walks beside it, crouches, lifts and lays it on the pile (2 s, hands on it); the piece is removed and
//   the pile's count goes up (the reverse of take_from_bundle).
import { z } from 'zod';
import { dist2, datan2, obbOverlap, rot2, type Vec2, type Vec3 } from '../core/math.ts';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import { canonicalEntityOrder, type Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { BUNDLES } from '../world/catalog-stock.ts';
import { entityFootprint } from '../spatial/service.ts';
import { checkStations, childrenState, walkCrew, type Children } from './children.ts';
import { beamWalkways, BEAM_TOL, CLIMB_SPEED, isSmallLoad } from './frame.ts';
import { beamBlocker, stepTrack, track, type Track } from './framemove.ts';
import { deckOver, STEP_OFF_MAX, STEP_UP_MAX } from './framemove.ts';
import { flatObb } from './deck.ts';
import { holdingDiagnostic } from './rules.ts';
import { setHands } from './handup.ts';
import { supportOf } from './setpart.ts';
import { bundleContents, bundleCount } from './bundle.ts';

const f2 = (x: number) => x.toFixed(2);
const bad = (code: string, message: string, subjects: string[], at?: Vec3) => ({ ok: false as const, diagnostic: { code, message, subjects, at } });
const xz = (e: Entity): Vec2 => [e.pose.p[0], e.pose.p[2]];
export const STAIRWORK = 'stairwork:';
const NOT_RESUMABLE = 'stair / beam traversal tracks and child walks are not serialised';

// ---------------------------------------------------------------- climb_stair / leave_stair

type SP = { actor: string; boards: string[]; to: { x: number; z: number } };
type SProg = { pts: Vec3[]; foot: Vec2 };
type SExec = { p: SP; prog: SProg; id: string; walk?: Children; tr?: Track; phase: 'walk' | 'climb' };

function stairPath(rt: Runtime, p: SP, verb: string): { ok: true; program: SProg } | { ok: false; diagnostic: Diagnostic } {
  const w = rt.world;
  const a = w.entities[p.actor];
  if (!a?.human) return bad('actor.not-human', `"${p.actor}" is not a person in this world`, [p.actor]);
  if (!p.boards.length) return bad('stair.no-treads', 'no tread boards given', [p.actor]);
  const bs = p.boards.map((id) => w.entities[id]);
  for (const [i, b] of bs.entries()) {
    if (!b || !b.def.startsWith('stair-tread-board-kit')) return bad('stair.not-tread', `"${p.boards[i]}" is not a Kit tread board`, [p.boards[i]]);
    if (b.phase !== 'installed') return bad('stair.tread-missing', `tread board ${b.id} is not installed: ${verb} only over treads that are in`, [b.id]);
    const why = supportOf(w, b);
    if (why) return bad('stair.tread-unsupported', `tread board ${b.id} is not supported (${why})`, [b.id]);
  }
  const top = bs[bs.length - 1];
  const to: Vec2 = [p.to.x, p.to.z];
  const topO = flatObb(top.pose, top);
  const onTop = bs.filter((b) => Math.abs(b.pose.p[1] - top.pose.p[1]) < 0.01).some((b) => { const o = flatObb(b.pose, b); const l = rot2([to[0] - o.c[0], to[1] - o.c[1]], -o.yaw); return Math.abs(l[0]) <= o.half[0] - 0.25 && Math.abs(l[1]) <= o.half[1] + 0.25; });
  if (!onTop) return bad('stair.off-tread', `(${f2(to[0])}, ${f2(to[1])}) is not on the top tread (${top.id}) with room to stand`, [p.actor, top.id]);
  // climb line: across the treads in order, at the target's position along them
  const along = rot2([1, 0], topO.yaw);
  const lat = (to[0] - topO.c[0]) * along[0] + (to[1] - topO.c[1]) * along[1];
  const pts: Vec3[] = [];
  const centre = (b: Entity): Vec2 => { const o = flatObb(b.pose, b); return [o.c[0] + along[0] * lat, o.c[1] + along[1] * lat]; };
  const b0 = centre(bs[0]), b1 = bs.length > 1 ? centre(bs[1]) : b0;
  const d = dist2(b0, b1) || 1;
  const dir: Vec2 = bs.length > 1 ? [(b1[0] - b0[0]) / d, (b1[1] - b0[1]) / d] : [0, 0];
  const foot: Vec2 = [b0[0] - dir[0] * 0.6, b0[1] - dir[1] * 0.6];
  pts.push([foot[0], 0, foot[1]]);
  for (const b of bs) { const c = centre(b); pts.push([c[0], b.pose.p[1] + def(b.def).size[1], c[1]]); }
  pts.push([to[0], top.pose.p[1] + def(top.def).size[1], to[1]]);
  return { ok: true, program: { pts, foot } };
}

export const climbStair: ActionDef<SP, SProg, SExec> = {
  verb: 'climb_stair',
  description: 'Climb the installed treads of an unfinished Kit stair (like a ladder, 0.35 m/s) to stand on its top installed tread at `to`, to set the next tread / riser from there. Small loads only.',
  schema: z.strictObject({ actor: z.string().max(80), boards: z.array(z.string().max(80)).min(1).max(20), to: z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4) }) }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }],
  resumable: NOT_RESUMABLE,
  plan(rt, p) {
    const a = rt.world.entities[p.actor];
    if (a?.human?.on) return bad('stair.already-up', `${p.actor} is on ${a.human.on}`, [p.actor]);
    const hd = holdingDiagnostic(rt.world, p.actor);
    if (hd) {
      const g = a!.human!.grip!;
      if (!isSmallLoad(rt.world.entities[g.entity]?.def ?? '')) return { ok: false, diagnostic: hd };
    }
    const r = stairPath(rt, p, 'climb_stair');
    if (!r.ok) return r;
    const un = checkStations(rt, [{ actor: p.actor, p: r.program.foot, level: 0 }]);
    return un ? { ok: false, diagnostic: { ...un, code: 'stair.unreachable' } } : r;
  },
  start: (_rt, p, prog, id) => ({ p, prog, id, phase: 'walk' }),
  step(rt, ex, dt) {
    const a = rt.world.entities[ex.p.actor];
    if (ex.phase === 'walk') {
      if (!ex.walk) {
        const f = ex.prog.pts[0], n = ex.prog.pts[1];
        const r = walkCrew(rt, ex.id, [{ actor: a.id, p: [f[0], f[2]], yaw: datan2(n[2] - f[2], n[0] - f[0]), level: 0 }]);
        if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'stair.unreachable' } };
        ex.walk = r;
      }
      const s = childrenState(ex.walk);
      if (s === 'running') return { status: 'running', phase: 'walk' };
      if (s !== 'done') return { status: 'failed', diagnostic: s };
      ex.phase = 'climb';
      ex.tr = track(ex.prog.pts);
    }
    Object.assign(a.human!, { activity: 'climb-up', on: `${STAIRWORK}${ex.p.boards[ex.p.boards.length - 1]}`, task: ex.id });
    if (!stepTrack(a, ex.tr!, CLIMB_SPEED, dt)) return { status: 'running', phase: 'climb' };
    Object.assign(a.human!, { activity: 'idle', task: undefined });
    return { status: 'completed', outputs: { on: a.human!.on, y: a.pose.p[1] } };
  },
  cancel: (rt, ex) => { for (const r of ex.walk?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id); return { ok: true }; },
};

export const leaveStair: ActionDef<SP, SProg, SExec> = {
  verb: 'leave_stair',
  description: 'Climb back down the installed treads of an unfinished Kit stair and step off onto the ground at `to`.',
  schema: z.strictObject({ actor: z.string().max(80), boards: z.array(z.string().max(80)).min(1).max(20), to: z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4) }) }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }],
  resumable: NOT_RESUMABLE,
  plan(rt, p) {
    const a = rt.world.entities[p.actor];
    if (!a?.human?.on?.startsWith(STAIRWORK)) return bad('stair.not-on-stair', `${p.actor} is not standing on a stair (${a?.human?.on ?? `level ${a?.human?.level}`})`, [p.actor]);
    const hd = holdingDiagnostic(rt.world, p.actor);
    if (hd) return { ok: false, diagnostic: hd };
    // down the same line (from where they stand)
    const top = rt.world.entities[p.boards[p.boards.length - 1]];
    const r = stairPath(rt, { ...p, to: { x: a.pose.p[0], z: a.pose.p[2] } }, 'leave_stair');
    if (!r.ok) return r;
    void top;
    const pts = [...r.program.pts].reverse();
    pts.push([p.to.x, 0, p.to.z]);
    return { ok: true, program: { pts, foot: r.program.foot } };
  },
  start: (_rt, p, prog, id) => ({ p, prog, id, phase: 'climb', tr: track(prog.pts) }),
  step(rt, ex, dt) {
    const a = rt.world.entities[ex.p.actor];
    Object.assign(a.human!, { activity: 'climb-down', task: ex.id });
    if (!stepTrack(a, ex.tr!, CLIMB_SPEED, dt)) return { status: 'running', phase: 'climb' };
    Object.assign(a.human!, { activity: 'idle', on: undefined, level: 0, task: undefined });
    a.pose.p = [a.pose.p[0], 0, a.pose.p[2]];
    return { status: 'completed', outputs: { level: 0 } };
  },
  cancel: () => ({ ok: true }),
};

// ---------------------------------------------------------------- step_onto_beam

type BP = { actor: string; beam: string; x: number; z: number };
type BProg = { walkway: string; to: Vec3 };
type BExec = { p: BP; prog: BProg; id: string; tr: Track };

export const stepOntoBeam: ActionDef<BP, BProg, BExec> = {
  verb: 'step_onto_beam',
  description: `Step from a deck onto a walkable beam at that level (≤ ${STEP_OFF_MAX} m away, ±${STEP_UP_MAX} m), e.g. to walk to a frame and climb down.`,
  schema: z.strictObject({ actor: z.string().max(80), beam: z.string().max(80), x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4) }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }],
  resumable: NOT_RESUMABLE,
  plan(rt, p) {
    const a = rt.world.entities[p.actor];
    if (!a?.human) return bad('actor.not-human', `"${p.actor}" is not a person in this world`, [p.actor]);
    if (a.human.on) return bad('beam.not-on-deck', `${a.id} is on ${a.human.on}, not on a deck`, [a.id]);
    const hd = holdingDiagnostic(rt.world, p.actor);
    if (hd) return { ok: false, diagnostic: hd };
    const l = beamWalkways(rt.world).find((x) => x.id === `beam:${p.beam}`);
    if (!l) return bad('beam.no-walkway', `beam ${p.beam} is not a walkable beam (installed, supported, with its partner)`, [p.beam]);
    const q: Vec2 = [p.x, p.z];
    const d = rot2([q[0] - l.from.p[0], q[1] - l.from.p[1]], -l.heading);
    const len = dist2(l.from.p, l.to.p);
    if (Math.abs(d[1]) > (l.width / 2) + BEAM_TOL || d[0] < -1e-6 || d[0] > len + 1e-6) return bad('beam.off-walkway', `(${f2(p.x)}, ${f2(p.z)}) is not on ${l.id}`, [a.id, p.beam]);
    if (dist2(xz(a), q) > STEP_OFF_MAX + 1e-9) return bad('beam.too-far', `${a.id} stands ${f2(dist2(xz(a), q))} m from (${f2(p.x)}, ${f2(p.z)}) on ${p.beam} (≤ ${STEP_OFF_MAX} m)`, [a.id, p.beam]);
    if (Math.abs(a.pose.p[1] - l.from.y) > STEP_UP_MAX + 1e-9) return bad('beam.step-height', `${p.beam}'s top (${f2(l.from.y)} m) is ${f2(Math.abs(a.pose.p[1] - l.from.y))} m from ${a.id}'s feet (≤ ${STEP_UP_MAX} m)`, [a.id, p.beam]);
    if (deckOver(rt, l, q)) return bad('beam.under-deck', `(${f2(p.x)}, ${f2(p.z)}) on ${p.beam} is under a deck`, [a.id, p.beam]);
    const s = rot2([q[0] - l.from.p[0], q[1] - l.from.p[1]], -l.heading)[0];
    const who = beamBlocker(rt, l, a.id, s, s);
    if (who) return bad('beam.occupied', `${who.id} stands on ${l.id} within 0.6 m of (${f2(p.x)}, ${f2(p.z)})`, [a.id, who.id]);
    return { ok: true, program: { walkway: l.id, to: [p.x, l.from.y, p.z] } };
  },
  start: (rt, p, prog, id) => ({ p, prog, id, tr: track([[...rt.world.entities[p.actor].pose.p] as Vec3, prog.to]) }),
  step(rt, ex, dt): StepResult {
    const a = rt.world.entities[ex.p.actor];
    Object.assign(a.human!, { activity: 'step-off', task: ex.id });
    if (!stepTrack(a, ex.tr, 0.4, dt)) return { status: 'running', phase: 'step' };
    const l = beamWalkways(rt.world).find((x) => x.id === ex.prog.walkway)!;
    Object.assign(a.human!, { activity: 'idle', on: ex.prog.walkway, level: l.from.level, task: undefined });
    return { status: 'completed', outputs: { on: ex.prog.walkway } };
  },
  cancel: () => ({ ok: true }),
};

// ---------------------------------------------------------------- stack_offcut

type OP = { actor: string; piece: string; pile: string };
type OProg = { at: Vec2; yaw: number; top: Vec3 };
type OExec = { p: OP; prog: OProg; id: string; walk?: Children; t: number; from?: Entity['pose'] };
export const SCRAP_PILE = 'scrap-pile';
const STACK_S = { crouch: 0.6, place: 1.4 };

function planStack(rt: Runtime, p: OP): { ok: true; program: OProg } | { ok: false; diagnostic: Diagnostic } {
  const w = rt.world;
  const e = w.entities[p.piece], pile = w.entities[p.pile];
  if (!pile || pile.def !== SCRAP_PILE || bundleCount(pile) === null) return bad('offcut.no-pile', `"${p.pile}" is not a scrap pile`, [p.pile]);
  if (!e || e.kind !== 'component' || !['timber', 'plywood'].includes(def(e.def).category)) return bad('offcut.not-offcut', `"${p.piece}" is not a lumber / plywood offcut`, [p.piece]);
  if (def(e.def).size[0] > 1.6) return bad('offcut.too-long', `${e.id} (${f2(def(e.def).size[0])} m) is not an offcut (≤ 1.6 m)`, [e.id]);
  if (e.support?.kind !== 'ground' || (e.phase !== 'stored' && e.phase !== 'staged')) return bad('offcut.not-lying', `${e.id} must lie on the ground beside the pile`, [e.id]);
  if ((bundleCount(pile) ?? 0) >= BUNDLES[SCRAP_PILE].capacity) return bad('offcut.pile-full', `${p.pile} is full`, [p.pile]);
  const pf = entityFootprint(pile).obb, ef = entityFootprint(e).obb;
  const gap = (() => { const g = { ...pf, half: [pf.half[0] + 1.2, pf.half[1] + 1.2] as Vec2 }; return obbOverlap(g, ef) ? 0 : 1; })();
  if (gap) return bad('offcut.too-far', `${e.id} lies more than 1.2 m from ${p.pile}; carry it there first`, [e.id, p.pile]);
  const hd = holdingDiagnostic(w, p.actor);
  if (hd) return { ok: false, diagnostic: hd };
  // stand on the far side of the piece from the pile, facing it
  const away: Vec2 = [ef.c[0] - pf.c[0], ef.c[1] - pf.c[1]];
  const l = Math.sqrt(away[0] * away[0] + away[1] * away[1]) || 1;
  const at: Vec2 = [ef.c[0] + (away[0] / l) * (Math.min(ef.half[0], ef.half[1]) + 0.4), ef.c[1] + (away[1] / l) * (Math.min(ef.half[0], ef.half[1]) + 0.4)];
  const top: Vec3 = [pf.c[0], pile.pose.p[1] + def(pile.def).size[1], pf.c[1]];
  return { ok: true, program: { at, yaw: datan2(ef.c[1] - at[1], ef.c[0] - at[0]), top } };
}

export const stackOffcut: ActionDef<OP, OProg, OExec> = {
  verb: 'stack_offcut',
  description: 'Put an offcut lying beside a scrap pile onto it (the piece is removed, the pile count goes up): one person, hands on it.',
  schema: z.strictObject({ actor: z.string().max(80), piece: z.string().max(80), pile: z.string().max(80) }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }, { resource: `entity:${p.piece}`, mode: 'exclusive' }, { resource: `entity:${p.pile}`, mode: 'exclusive' }],
  resumable: 'drives a child walk; its exec is not serialised',
  plan(rt, p) {
    const r = planStack(rt, p);
    if (!r.ok) return r;
    const un = checkStations(rt, [{ actor: p.actor, p: r.program.at }]);
    return un ? { ok: false, diagnostic: { ...un, code: 'offcut.unreachable' } } : r;
  },
  start: (_rt, p, prog, id) => ({ p, prog, id, t: -1 }),
  step(rt, ex, dt) {
    const w = rt.world;
    const a = w.entities[ex.p.actor], e = w.entities[ex.p.piece];
    if (ex.t < 0) {
      if (!ex.walk) {
        const r = walkCrew(rt, ex.id, [{ actor: a.id, p: ex.prog.at, yaw: ex.prog.yaw }]);
        if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'offcut.unreachable' } };
        ex.walk = r;
      }
      const s = childrenState(ex.walk);
      if (s === 'running') return { status: 'running', phase: 'approach' };
      if (s !== 'done') return { status: 'failed', diagnostic: s };
      ex.t = 0;
      ex.from = { ...e.pose, p: [...e.pose.p] as Vec3 };
      e.phase = 'carried';
      e.support = { kind: 'held', by: [a.id] };
    }
    ex.t += dt;
    const k = Math.min(1, Math.max(0, (ex.t - STACK_S.crouch) / STACK_S.place));
    const f = ex.from!;
    e.pose = { ...f, p: [f.p[0] + (ex.prog.top[0] - f.p[0]) * k, f.p[1] + (ex.prog.top[1] - f.p[1]) * k, f.p[2] + (ex.prog.top[2] - f.p[2]) * k] };
    const h: Vec3 = [e.pose.p[0], e.pose.p[1] + def(e.def).size[1], e.pose.p[2]];
    Object.assign(a.human!, { activity: ex.t < STACK_S.crouch ? 'crouch' : 'lift', task: ex.id, grip: { entity: e.id, slot: 'stack' } });
    setHands(a, [h, h]);
    if (ex.t < STACK_S.crouch + STACK_S.place - 1e-9) return { status: 'running', phase: 'stack' };
    const pile = w.entities[ex.p.pile];
    pile.contents = bundleContents(pile.def, (bundleCount(pile) ?? 0) + 1);
    delete w.entities[ex.p.piece];
    canonicalEntityOrder(w);
    Object.assign(a.human!, { activity: 'idle', task: undefined, grip: undefined });
    setHands(a, undefined);
    return { status: 'completed', outputs: { pile: ex.p.pile, count: bundleCount(pile) } };
  },
  cancel(rt, ex) {
    const e = rt.world.entities[ex.p.piece];
    if (e?.phase === 'carried') return { ok: false, diagnostic: { code: 'offcut.cancel-unsafe', message: `${e.id} is in ${ex.p.actor}'s hands`, subjects: [e.id] } };
    for (const r of ex.walk?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
    return { ok: true };
  },
};

export const MOVES_B: ActionDef[] = [climbStair, leaveStair, stepOntoBeam, stackOffcut];
