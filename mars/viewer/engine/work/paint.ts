// paint (owner feedback 2026-09-28 §8), Mars work model v1, approximate. A person stands in front of a
// paintable panel (catalog `paintable` faces: plywood sheets / wall panels) and paints it:
//   walk to a standing spot facing the face, PAINT_STAND m out, on their own floor (one spot per column
//   of ≤ COLUMN_MAX m of the face; a sidestep walk between columns) → paint: the brush hand sweeps the
//   face row by row (rows = the face's BAND_H slices, top down, alternating direction) over the band being
//   painted, at SWEEP m/s; the other hand holds the pot at the hip.
// Reach rule (engine rule, plan time): the arm reaches REACH_LO…REACH_HI m above the floor the painter
// stands on; a band outside that needs them standing on a deck / beam — refused (`paint.out-of-reach`,
// naming the band), never interpolated. Progress is state on the panel entity (`paint`: colour or texture,
// coverage 0..1 of the face and per band), recorded in the take (take/recorder.ts FIELDS) and published
// per tick; the brush point is in the painter's grip slot (`paint:<face>:<u>:<h>`), so `paintHands`
// rebuilds both hand points from a take exactly as `human.hands` publishes them.
import { z } from 'zod';
import { datan2, dist2, type Vec2, type Vec3 } from '../core/math.ts';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, PaintState } from '../world/types.ts';
import { def, type PaintFace } from '../world/catalog.ts';
import { clearanceAt } from '../spatial/grid.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import type { Spatial } from '../spatial/service.ts';
import { toWorld } from '../carry/formation.ts';
import { holdingDiagnostic } from '../construction/rules.ts';
import { checkStations, childrenState, walkCrew, type Children } from '../construction/children.ts';
import { BODY_MODEL, postureGap } from '../body/model.ts';

export const REACH_LO = BODY_MODEL.lowReach; // m above the floor: lowest the brush reaches standing (lower: not modelled)
export const REACH_HI = BODY_MODEL.overheadMax; // m above the floor: highest, 2.06 (above: stand on a deck / beam)
export const PAINT_STAND = 0.4; // m from the face to the painter's feet
export const COLUMN_MAX = 1.0; // m of face width painted from one spot (a 0.62 m arm reaches the column's top corners at 2.03 m from PAINT_STAND; 1.3 m did not)
export const BAND_H = 0.2; // m: the face's rows / bands (from its bottom edge)
export const SWEEP = 0.8; // m/s brush speed along a row (and down to the next row)
export const BRUSH_OFF = 0.03; // m the brush hand stays off the surface
export const STATION_TOL = 0.05; // m a painter may drift from their spot before `paint.moved`
/** Painting posture: shoulder height range above the feet, horizontal lean, arm length (BODY_MODEL, as handup.ts envelopes). */
export const PAINT_POSTURE = { ...BODY_MODEL.posture.painting, arm: BODY_MODEL.armLength } as const;
const round2 = (x: number) => Math.round(x * 100) / 100;
const f2 = (x: number) => x.toFixed(2);

/** How far a hand is outside the painter's reach envelope (≤ 0 = inside). */
export function paintEnvelopeGap(feet: Vec3, hand: Vec3): number {
  return postureGap(BODY_MODEL.posture.painting, feet, hand);
}

// ---------------------------------------------------------------- face geometry

/** A vertical paintable face in world coordinates: bottom-left corner B, right U (horizontal), up V, outward normal N. */
export type Face = { face: PaintFace; B: Vec3; U: Vec3; V: Vec3; N: Vec3; width: number; height: number };
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

export function faceOf(e: Entity, face: PaintFace): Face | Diagnostic {
  const [sx, sy, sz] = def(e.def).size;
  const o = toWorld(e.pose, [0, 0, 0]);
  const dir = (v: Vec3) => sub3(toWorld(e.pose, v), o);
  const N = dir([0, face === 'front' ? 1 : -1, 0]);
  if (Math.abs(N[1]) > 0.2)
    return { code: 'paint.face-not-vertical', message: `the ${face} face of ${e.id} faces ${N[1] > 0 ? 'up' : 'down'}; only upright faces (walls, standing panels) are painted so far`, subjects: [e.id] };
  const ax = dir([1, 0, 0]), az = dir([0, 0, 1]);
  const [up, upLen, side, sideLen] = Math.abs(ax[1]) >= Math.abs(az[1]) ? [ax, sx, az, sz] : [az, sz, ax, sx];
  const V = up[1] >= 0 ? up : mul3(up, -1);
  // right-hand for someone facing the face (looking along −N): (−N) × V
  const f = mul3(N, -1);
  const right: Vec3 = [f[1] * V[2] - f[2] * V[1], f[2] * V[0] - f[0] * V[2], f[0] * V[1] - f[1] * V[0]];
  const U = right[0] * side[0] + right[1] * side[1] + right[2] * side[2] >= 0 ? side : mul3(side, -1);
  const C = toWorld(e.pose, [0, face === 'front' ? sy : 0, 0]);
  const B = sub3(sub3(C, mul3(V, upLen / 2)), mul3(U, sideLen / 2));
  return { face, B, U, V, N, width: sideLen, height: upLen };
}
const facePoint = (F: Face, u: number, h: number): Vec3 => add3(add3(F.B, mul3(F.U, u)), mul3(F.V, h));

/** Both hand points [left, right]: right = the brush at face coords (u, h), left = the pot at the painter's hip. */
export function handsAt(F: Face, feet: Vec3, u: number, h: number): [Vec3, Vec3] {
  const brush = add3(facePoint(F, u, h), mul3(F.N, BRUSH_OFF));
  const pot: Vec3 = [feet[0] - F.U[0] * 0.22 - F.N[0] * 0.15, feet[1] + 0.95, feet[2] - F.U[2] * 0.22 - F.N[2] * 0.15];
  return [pot, brush];
}
export const paintSlot = (face: PaintFace, u: number, h: number) => `paint:${face}:${u.toFixed(3)}:${h.toFixed(3)}`;
/** Rebuild a painter's hands from a take: panel entity at its pose, the painter (feet), grip slot. null = not a paint slot. */
export function paintHands(panel: Entity, painter: Entity, slot: string): [Vec3, Vec3] | null {
  const m = /^paint:(front|back):(-?[\d.]+):(-?[\d.]+)$/.exec(slot);
  if (!m) return null;
  const F = faceOf(panel, m[1] as PaintFace);
  if ('code' in F) return null;
  return handsAt(F, painter.pose.p, Number(m[2]), Number(m[3]));
}

/** Fixed bands of the face (BAND_H from its bottom edge). */
export const faceBands = (height: number) => {
  const out: { from: number; to: number }[] = [];
  for (let y = 0; y < height - 1e-9; y += BAND_H) out.push({ from: round2(y), to: round2(Math.min(height, y + BAND_H)) });
  return out;
};

// ---------------------------------------------------------------- plan

type PaintP = { actor: string; panel: string; color?: string; texture?: string; face?: PaintFace; band?: { from: number; to: number } };
type Pass = { col: number; band: number; h: number; hh: number; u0: number; u1: number };
type Col = { p: Vec2; yaw: number; u0: number; u1: number };
export type PaintProgram = { face: PaintFace; F: Face; floor: number; level: number; cols: Col[]; passes: Pass[]; bands: { from: number; to: number }[]; paint: { color?: string; texture?: string }; walk: boolean };

const bad = (code: string, message: string, subjects: string[], at?: Vec3) => ({ ok: false as const, diagnostic: { code, message, subjects, ...(at ? { at } : {}) } as Diagnostic });

function planPaint(rt: Runtime, p: PaintP): { ok: true; program: PaintProgram } | { ok: false; diagnostic: Diagnostic } {
  const w = rt.world;
  const a = w.entities[p.actor];
  if (!a) return bad('entity.unknown', `no actor "${p.actor}"`, [p.actor]);
  if (a.kind !== 'human' || !a.human) return bad('actor.not-human', `"${p.actor}" is a ${a.kind}, not a person`, [p.actor]);
  const e = w.entities[p.panel];
  if (!e) return bad('entity.unknown', `no panel "${p.panel}"`, [p.panel]);
  const pd = def(e.def).paintable;
  if (!pd) return bad('paint.not-paintable', `${def(e.def).label} ${e.id} has no paintable face (paintable: plywood sheets / wall panels)`, [e.id]);
  const face = p.face ?? pd.faces[0];
  if (!pd.faces.includes(face)) return bad('paint.not-paintable', `the ${face} face of ${e.id} is not paintable (${pd.faces.join(', ')})`, [e.id]);
  if (!!p.color === !!p.texture) return bad('paint.what', `give exactly one of \`color\` or \`texture\``, [e.id]);
  if (e.phase === 'carried' || e.phase === 'raising' || e.support?.kind === 'held' || e.support?.kind === 'forks')
    return bad('paint.panel-moving', `${e.id} is being moved (${e.phase}, support ${e.support?.kind}); paint it once it stands still`, [e.id]);
  // the painter: standing still, free
  if (a.human.activity === 'walk' || a.human.activity === 'climb-up' || a.human.activity === 'climb-down' || a.human.activity === 'beam-walk')
    return bad('paint.while-walking', `${p.actor} is walking (${a.human.activity}${a.human.task ? `, ${a.human.task}` : ''}); nobody paints on the move — stop first`, [p.actor]);
  if (a.human.task) return bad('paint.busy', `${p.actor} is busy (${a.human.task})`, [p.actor]);
  const hd = holdingDiagnostic(w, p.actor);
  if (hd) return { ok: false, diagnostic: hd };
  if (a.human.riding) return bad('paint.busy', `${p.actor} is riding ${a.human.riding}`, [p.actor]);
  const F = faceOf(e, face);
  if ('code' in F) return { ok: false, diagnostic: F };
  const sp = rt.services.spatial as Spatial;
  sp.sync(w);
  const level = a.human.level;
  const g = sp.level(level);
  const floor = a.human.on ? a.pose.p[1] : g ? g.y : a.pose.p[1];
  // the reach band on this face (face heights), and the requested band
  const bottom = F.B[1];
  const lo = Math.max(0, floor + REACH_LO - bottom), hi = Math.min(F.height, floor + REACH_HI - bottom);
  const want = p.band ?? (hi > lo ? { from: lo, to: hi } : { from: 0, to: F.height });
  if (!(want.to > want.from) || want.from < -1e-9 || want.to > F.height + 1e-9)
    return bad('paint.band', `band ${f2(want.from)}–${f2(want.to)} m is not on ${e.id}'s ${face} face (0–${f2(F.height)} m)`, [e.id]);
  if (want.from < lo - 1e-9 || want.to > hi + 1e-9) {
    const where = a.human.on ? `on ${a.human.on}` : level === 0 ? 'on the ground' : `on level ${level}`;
    const higher = want.to > hi + 1e-9;
    return bad('paint.out-of-reach',
      `${p.actor} standing ${where} (floor ${f2(floor)} m) reaches ${f2(floor + REACH_LO)}–${f2(floor + REACH_HI)} m; the band ${f2(want.from)}–${f2(want.to)} m of ${e.id}'s ${face} face (${f2(bottom + want.from)}–${f2(bottom + want.to)} m) is ${higher ? 'above' : 'below'} that${higher ? ' — stand on a deck or beam to paint it' : ''}`,
      [e.id, p.actor], facePoint(F, F.width / 2, higher ? want.to : want.from));
  }
  // columns and their standing spots (on the painter's floor, facing the face)
  const n = Math.max(1, Math.ceil(F.width / COLUMN_MAX - 1e-9));
  const cw = F.width / n;
  const cols: Col[] = [];
  const walk = !a.human.on;
  for (let k = 0; k < n; k++) {
    const u0 = k * cw, u1 = (k + 1) * cw;
    const c = add3(facePoint(F, (u0 + u1) / 2, 0), mul3(F.N, PAINT_STAND));
    const q: Vec2 = [c[0], c[2]];
    if (walk) {
      if (!g || clearanceAt(g, q) < HUMAN_PROFILE.radius - 0.03)
        return bad('paint.no-station', `no room to stand ${PAINT_STAND} m in front of ${e.id}'s ${face} face at (${f2(q[0])}, ${f2(q[1])}) on level ${level}`, [e.id, p.actor], [q[0], floor, q[1]]);
    } else if (dist2(q, [a.pose.p[0], a.pose.p[2]]) > STATION_TOL + 0.1 || n > 1)
      return bad('paint.no-station', `${p.actor} on ${a.human.on} cannot walk to the spot in front of ${e.id} (${f2(q[0])}, ${f2(q[1])}); beam_walk there first`, [e.id, p.actor]);
    cols.push({ p: walk ? q : [a.pose.p[0], a.pose.p[2]], yaw: datan2(-F.N[2], -F.N[0]), u0, u1 });
  }
  if (walk) {
    const r = checkStations(rt, cols.map((c) => ({ actor: p.actor, p: c.p, level })));
    if (r) return { ok: false, diagnostic: { ...r, code: 'paint.no-station' } };
  }
  // passes: per column, bands top-down, the portion inside the wanted band
  const bands = faceBands(F.height);
  const passes: Pass[] = [];
  for (let k = 0; k < n; k++) {
    for (let b = bands.length - 1; b >= 0; b--) {
      const y0 = Math.max(bands[b].from, want.from), y1 = Math.min(bands[b].to, want.to);
      if (y1 - y0 < 1e-6) continue;
      passes.push({ col: k, band: b, h: (y0 + y1) / 2, hh: y1 - y0, u0: cols[k].u0, u1: cols[k].u1 });
    }
  }
  // every brush point inside the envelope from its spot
  for (const ps of passes) {
    const c = cols[ps.col];
    const feet: Vec3 = [c.p[0], floor, c.p[1]];
    for (const u of [ps.u0, ps.u1, (ps.u0 + ps.u1) / 2])
      for (const hnd of handsAt(F, feet, u, ps.h))
        if (paintEnvelopeGap(feet, hnd) > 1e-9)
          return bad('paint.out-of-reach', `${p.actor} cannot reach ${f2(ps.h)} m up ${e.id}'s ${face} face at ${f2(u)} m across from (${f2(c.p[0])}, ${f2(c.p[1])})`, [e.id, p.actor], hnd);
  }
  const paint = p.color ? { color: p.color } : { texture: p.texture! };
  return { ok: true, program: { face, F, floor, level, cols, passes, bands, paint, walk } };
}

// ---------------------------------------------------------------- execute

type PaintExec = { id: string; p: PaintP; prog: PaintProgram; col: number; walk?: Children; walking: boolean; pass: number; s: number; area: number[] };

function initPaint(e: Entity, prog: PaintProgram): number[] {
  const same = e.paint && e.paint.face === prog.face && e.paint.color === prog.paint.color && e.paint.texture === prog.paint.texture;
  const area = prog.bands.map((b, i) => (same ? (e.paint!.bands[i]?.coverage ?? 0) * (b.to - b.from) * prog.F.width : 0));
  publish(e, prog, area);
  return area;
}
function publish(e: Entity, prog: PaintProgram, area: number[]) {
  const W = prog.F.width;
  const total = prog.bands.reduce((s, b) => s + (b.to - b.from) * W, 0);
  const bands = prog.bands.map((b, i) => ({ from: b.from, to: b.to, coverage: round2(Math.min(1, area[i] / ((b.to - b.from) * W))) }));
  const st: PaintState = { face: prog.face, ...prog.paint, coverage: round2(Math.min(1, area.reduce((s, x) => s + x, 0) / total)), bands };
  e.paint = st;
}

function stepPaint(rt: Runtime, ex: PaintExec, dt: number): StepResult {
  const w = rt.world;
  const a = w.entities[ex.p.actor];
  const e = w.entities[ex.p.panel];
  const prog = ex.prog;
  // walk to the column's spot
  if (ex.walking) {
    if (!ex.walk) {
      const c = prog.cols[ex.col];
      if (!prog.walk || dist2([a.pose.p[0], a.pose.p[2]], c.p) <= 0.01) { ex.walking = false; }
      else {
        a.human!.grip = undefined;
        delete a.human!.hands;
        if (a.human!.activity === 'paint') a.human!.activity = 'idle'; // sidestep to the next column: not painting
        const r = walkCrew(rt, ex.id, [{ actor: ex.p.actor, p: c.p, yaw: c.yaw, level: prog.level }]);
        if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'paint.no-station' } };
        ex.walk = r;
      }
    }
    if (ex.walk) {
      const s = childrenState(ex.walk);
      if (typeof s === 'object') return { status: 'failed', diagnostic: s };
      if (s === 'running') return { status: 'running', phase: 'approach' };
      ex.walk = undefined;
      ex.walking = false;
    }
  }
  const col = prog.cols[ex.col];
  if (dist2([a.pose.p[0], a.pose.p[2]], col.p) > STATION_TOL + 1e-9)
    return { status: 'failed', diagnostic: { code: 'paint.moved', message: `${a.id} left their spot in front of ${e.id} while painting (${f2(dist2([a.pose.p[0], a.pose.p[2]], col.p))} m off); nobody paints on the move`, subjects: [a.id, e.id], at: a.pose.p } };
  a.pose.yaw = col.yaw;
  // the brush: along the current pass (alternating direction), then down to the next one
  const ps = prog.passes[ex.pass];
  const len = ps.u1 - ps.u0;
  const prevS = ex.s;
  ex.s = Math.min(len, ex.s + SWEEP * dt);
  ex.area[ps.band] += (ex.s - prevS) * ps.hh;
  const fwd = ex.pass % 2 === 0;
  const u = fwd ? ps.u0 + ex.s : ps.u1 - ex.s;
  const slot = paintSlot(prog.face, u, ps.h);
  Object.assign(a.human!, { activity: 'paint', task: ex.id, grip: { entity: e.id, slot } });
  const hs = paintHands(e, a, slot)!;
  a.human!.hands = { left: hs[0], right: hs[1] };
  publish(e, prog, ex.area);
  if (ex.s < len - 1e-9) return { status: 'running', phase: 'paint' };
  // next pass
  ex.pass++;
  ex.s = 0;
  if (ex.pass >= prog.passes.length) {
    Object.assign(a.human!, { activity: 'idle', task: undefined, grip: undefined });
    delete a.human!.hands;
    return { status: 'completed', outputs: { panel: e.id, face: prog.face, coverage: e.paint!.coverage, bands: e.paint!.bands.filter((b) => b.coverage > 0).map((b) => [b.from, b.to, b.coverage]) } };
  }
  if (prog.passes[ex.pass].col !== ex.col) { ex.col = prog.passes[ex.pass].col; ex.walking = true; }
  return { status: 'running', phase: 'paint' };
}

export const paint: ActionDef<PaintP, PaintProgram, PaintExec> = {
  verb: 'paint',
  description: `Paint a panel's upright face (plywood sheet / wall panel) with a colour or a texture: the painter walks to a spot ${PAINT_STAND} m in front of it (one per ≤ ${COLUMN_MAX} m column) and sweeps the brush row by row (${BAND_H} m bands, top down, ${SWEEP} m/s). The arm reaches ${REACH_LO}–${REACH_HI} m above the floor they stand on; a band outside that is refused (stand on a deck or beam). Progress is the panel's \`paint\` (coverage 0..1, per band).`,
  schema: z.strictObject({
    actor: z.string().max(80),
    panel: z.string().max(80),
    color: z.string().min(1).max(40).optional(),
    texture: z.string().min(1).max(120).optional(),
    face: z.enum(['front', 'back']).optional(),
    band: z.strictObject({ from: z.number().min(0).max(20), to: z.number().min(0).max(20) }).optional(),
  }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }, { resource: `entity:${p.panel}`, mode: 'exclusive' }],
  resumable: 'paint drives child walks and keeps unrounded coverage in its exec; not serialised',
  plan: planPaint,
  start(rt, p, prog, id) {
    const e = rt.world.entities[p.panel];
    const area = initPaint(e, prog);
    return { id, p, prog, col: prog.passes[0]?.col ?? 0, walking: true, pass: 0, s: 0, area };
  },
  step: (rt, ex, dt) => (ex.prog.passes.length ? stepPaint(rt, ex, dt) : { status: 'completed', outputs: { panel: ex.p.panel, coverage: rt.world.entities[ex.p.panel].paint?.coverage ?? 0 } }),
  cancel(rt, ex) {
    const a = rt.world.entities[ex.p.actor];
    if (a.human?.task === ex.id) {
      Object.assign(a.human, { activity: 'idle', task: undefined, grip: undefined });
      delete a.human.hands;
    }
    return { ok: true };
  },
};

export const PAINT_ACTIONS: ActionDef[] = [paint];
