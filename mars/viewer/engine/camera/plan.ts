// Lookahead camera planner for pre-known futures (takes). Samples the whole
// shot at `hz`, builds the candidate table for every instant, and chooses a
// key per sample by dynamic programming (Viterbi) over:
//   per-sample cost  = 2·deviation + 4·(1 − readability) + max badness in the
//                      next `lead` seconds (so alternates are taken BEFORE an
//                      occlusion/collision window starts),
//   transition cost  = 0 for a continuous move of the same key, 0.5 for a
//                      small continuous blend to another key, `cutCost`·hz for
//                      a cut. A move is continuous only if it respects speed /
//                      turn limits and its swept segment crosses no solid.
// The result is plain data (CameraPlan) and never touches world state.
import { q6, type Vec3 } from '../core/math.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { CameraWorld, raycast, solidName, type CameraPolicy } from './geom.ts';
import { evaluateShot, shotSubjects, type CameraPose, type Sampler, type ShotSpec } from './shots.ts';
import { badness, candidates, VARIANT_KEYS, type Candidate, type SolveOpts } from './solve.ts';
import { placement, readability, temporal, type Temporal } from './quality.ts';

export type PlanOpts = SolveOpts & {
  duration: number;
  hz?: number; // default 10
  lead?: number; // lookahead seconds (default 1.0)
  cutCost?: number; // seconds-equivalent cost of a cut (default 1.5)
  maxSpeed?: number; // m/s for continuous moves (default 6)
  maxTurn?: number; // deg/s for continuous moves (default 120)
  policy?: CameraPolicy;
};

export type PlannedSample = { t: number; position: Vec3; target: Vec3; fov: number; key: string; cut: boolean; valid: boolean; readability: number };
export type Cut = { t: number; from: string; to: string; reason: string };
export type Correction = { t0: number; t1: number; key: string; reason: string };
export type PlanReport = {
  samples: number;
  invalidSamples: number;
  sweptCrossings: number;
  minReadability: number;
  meanReadability: number;
  readableFraction: number;
  cuts: Cut[];
  corrections: Correction[];
  reasons: string[];
  desired: { invalidSamples: number; unreadableSamples: number; sweptCrossings: number };
  temporal: Temporal;
  rejected: boolean;
  cutaway: boolean;
};
export type CameraPlan = { spec: ShotSpec; hz: number; duration: number; samples: PlannedSample[]; report: PlanReport };

const INF = 1e12;
const DEG = Math.PI / 180;
const fmt = (t: number) => t.toFixed(1);
const q3 = (v: Vec3): Vec3 => [q6(v[0]), q6(v[1]), q6(v[2])];

function viewAngle(a: CameraPose, b: CameraPose): number {
  const da = [a.target[0] - a.position[0], a.target[1] - a.position[1], a.target[2] - a.position[2]];
  const db = [b.target[0] - b.position[0], b.target[1] - b.position[1], b.target[2] - b.position[2]];
  const la = Math.hypot(da[0], da[1], da[2]) || 1, lb = Math.hypot(db[0], db[1], db[2]) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (da[0] * db[0] + da[1] * db[1] + da[2] * db[2]) / (la * lb))));
}

type Desired = { pose: CameraPose; valid: boolean; read: number; reasons: string[] };

export function planCameraTrack(spec: ShotSpec, sampler: Sampler, scene: SpatialScene | CameraWorld, opts: PlanOpts): CameraPlan {
  const world = scene instanceof CameraWorld ? scene : new CameraWorld(scene, opts.policy);
  const hz = opts.hz ?? 10, dt = 1 / hz;
  const N = Math.round(opts.duration * hz) + 1;
  const L = Math.round((opts.lead ?? 1.0) * hz);
  const cutUnits = (opts.cutCost ?? 1.5) * hz;
  const devW = opts.deviationWeight ?? 2;
  const maxStep = (opts.maxSpeed ?? 6) * dt, maxTurn = (opts.maxTurn ?? 120) * DEG * dt;
  const minRead = opts.minReadability ?? 0.6;
  const cutaway = !!(opts.cutaway ?? spec.cutaway);
  const sopts: SolveOpts = { ...opts, cutaway };
  const ids = shotSubjects(spec);
  const K = VARIANT_KEYS.length;

  // 1. candidate table + desired-shot analysis
  const table: (Candidate | null)[][] = [];
  const desired: Desired[] = [];
  for (let i = 0; i < N; i++) {
    const t = i * dt;
    const subjects = sampler(t);
    const pose = evaluateShot(spec, sampler, t);
    const row: (Candidate | null)[] = new Array(K).fill(null);
    for (const c of candidates(world, pose, subjects, ids, sopts)) row[VARIANT_KEYS.indexOf(c.key)] = c;
    table.push(row);
    const d = row[0]!;
    const place = d.pushed ? placement(world, pose.position, opts.minClear) : d.place;
    const read = d.pushed ? readability(world, pose, subjects, ids, { aspect: opts.aspect, minSize: opts.minSize, cutaway }) : d.read;
    desired.push({ pose, valid: place.valid, read: read.score, reasons: [...(place.reason ? [place.reason] : []), ...read.reasons] });
  }

  // 2. costs with lookahead badness
  const bad = table.map((row) => row.map((c) => (c ? badness(c, minRead) : INF)));
  const cost: number[][] = table.map((row, i) =>
    row.map((c, k) => {
      if (!c) return INF;
      let ahead = 0;
      for (let j = i; j <= Math.min(N - 1, i + L); j++) ahead = Math.max(ahead, bad[j][k]);
      return devW * c.deviation + 4 * (1 - c.read.score) + ahead;
    }),
  );

  const crossing = (a: Candidate, b: Candidate) => raycast(world, a.pose.position, b.pose.position, 'collide');
  const continuous = (a: Candidate, b: Candidate) => {
    const d = Math.hypot(b.pose.position[0] - a.pose.position[0], b.pose.position[1] - a.pose.position[1], b.pose.position[2] - a.pose.position[2]);
    if (d > maxStep || viewAngle(a.pose, b.pose) > maxTurn || Math.abs(b.pose.fov - a.pose.fov) > 30 * dt) return false;
    return !crossing(a, b);
  };

  // 3. Viterbi (ties → lower key index = VARIANTS priority)
  const D: number[][] = [cost[0].slice()];
  const back: number[][] = [new Array(K).fill(-1)];
  for (let i = 1; i < N; i++) {
    const di = new Array(K).fill(INF), bi = new Array(K).fill(-1);
    for (let k2 = 0; k2 < K; k2++) {
      const c2 = table[i][k2];
      if (!c2) continue;
      for (let k1 = 0; k1 < K; k1++) {
        const c1 = table[i - 1][k1];
        if (!c1 || D[i - 1][k1] >= INF) continue;
        const lower = D[i - 1][k1] + (k1 === k2 ? 0 : 0.5);
        if (lower + cost[i][k2] >= di[k2]) continue; // cannot win even if continuous
        const tr = continuous(c1, c2) ? (k1 === k2 ? 0 : 0.5) : cutUnits;
        const v = D[i - 1][k1] + tr + cost[i][k2];
        if (v < di[k2]) { di[k2] = v; bi[k2] = k1; }
      }
    }
    D.push(di); back.push(bi);
  }
  const keys = new Array(N).fill(0);
  for (let k = 1; k < K; k++) if (D[N - 1][k] < D[N - 1][keys[N - 1]]) keys[N - 1] = k;
  for (let i = N - 1; i > 0; i--) keys[i - 1] = Math.max(0, back[i][keys[i]]);

  // 4. samples
  const chosen = keys.map((k, i) => table[i][k] ?? table[i][0]!);
  const samples: PlannedSample[] = chosen.map((c, i) => ({
    t: q6(i * dt),
    position: q3(c.pose.position),
    target: q3(c.pose.target),
    fov: q6(c.pose.fov),
    key: c.key,
    cut: i > 0 && !continuous(chosen[i - 1], c),
    valid: c.valid,
    readability: q6(c.read.score),
  }));

  // 5. report
  const describe = (c: Candidate) => c.place.reason ?? c.read.reasons[0] ?? `readability ${c.read.score.toFixed(2)}`;
  const cuts: Cut[] = [];
  let sweptCrossings = 0;
  for (let i = 1; i < N; i++) {
    const a = chosen[i - 1], b = chosen[i];
    if (!samples[i].cut) { if (crossing(a, b)) sweptCrossings++; continue; }
    let reason = '';
    if (a.key === b.key) {
      const h = crossing(a, b);
      reason = `discontinuous move of '${a.key}'${h ? ` would cross ${solidName(h.solid)}` : ''}`;
    } else {
      const k1 = VARIANT_KEYS.indexOf(a.key);
      const stay = table[i][k1];
      if (stay && !continuous(a, stay)) {
        const h = crossing(a, stay);
        reason = `'${a.key}' cannot continue at t=${fmt(i * dt)} s: ${h ? `its move crosses ${solidName(h.solid)}` : 'discontinuous jump'}`;
      }
      // first future failure of the key we left: unavailable, invalid/unreadable, or a move crossing a solid
      for (let j = i; j < N && !reason; j++) {
        const cj = table[j][k1], prev = table[j - 1][k1];
        const when = `${j === i ? 'at' : 'ahead:'} t=${fmt(j * dt)} s`;
        if (!cj) reason = `${when} '${a.key}' unavailable`;
        else if (bad[j][k1] > 0) reason = `${when} '${a.key}': ${describe(cj)}`;
        else if (j > i && prev && !continuous(prev, cj)) {
          const h = crossing(prev, cj);
          reason = `${when} '${a.key}' ${h ? `would cross ${solidName(h.solid)}` : 'would jump'}`;
        }
      }
      if (!reason) reason = `better framing with '${b.key}'`;
    }
    cuts.push({ t: samples[i].t, from: a.key, to: b.key, reason });
  }

  const corrections: Correction[] = [];
  for (let i = 0; i < N; ) {
    if (chosen[i].key === 'desired' && !chosen[i].pushed) { i++; continue; }
    const key = chosen[i].pushed && chosen[i].key === 'desired' ? 'desired(pushed)' : chosen[i].key;
    let j = i;
    const same = (c: Candidate) => (c.pushed && c.key === 'desired' ? 'desired(pushed)' : c.key) === key;
    while (j + 1 < N && same(chosen[j + 1])) j++;
    const why = desired.slice(i, j + 1).find((d) => d.reasons.length)?.reasons[0] ?? desired.slice(j + 1, j + 1 + L).find((d) => d.reasons.length)?.reasons[0] ?? 'better framing';
    corrections.push({ t0: samples[i].t, t1: samples[j].t, key, reason: why });
    i = j + 1;
  }

  const reasons: string[] = [];
  let dInvalid = 0, dUnread = 0, dCross = 0;
  for (let i = 0; i < N; ) {
    const badD = (d: Desired) => !d.valid || d.read < minRead;
    if (!badD(desired[i])) { i++; continue; }
    let j = i, worst = i;
    while (j + 1 < N && badD(desired[j + 1])) { j++; if (!desired[j].valid && desired[worst].valid || desired[j].read < desired[worst].read) worst = j; }
    reasons.push(`t ${fmt(i * dt)}–${fmt(j * dt)} s: desired shot: ${desired[worst].reasons[0] ?? `readability ${desired[worst].read.toFixed(2)}`}`);
    i = j + 1;
  }
  for (let i = 0; i < N; i++) {
    if (!desired[i].valid) dInvalid++;
    if (desired[i].read < minRead) dUnread++;
    if (i > 0) {
      const h = raycast(world, desired[i - 1].pose.position, desired[i].pose.position, 'collide');
      if (h) { dCross++; reasons.push(`t ${fmt(i * dt)} s: desired camera move crosses ${solidName(h.solid)}`); }
    }
  }
  const reads = samples.map((s) => s.readability);
  const invalidSamples = samples.filter((s) => !s.valid).length;
  if (invalidSamples) reasons.push(`REJECTED: ${invalidSamples} samples have no valid camera placement`);
  if (sweptCrossings) reasons.push(`REJECTED: ${sweptCrossings} continuous moves cross solid geometry`);
  if (cutaway) reasons.push('cutaway: occluders ignored for readability (inspection mode)');

  return {
    spec,
    hz,
    duration: opts.duration,
    samples,
    report: {
      samples: N,
      invalidSamples,
      sweptCrossings,
      minReadability: ids.length ? Math.min(...reads) : 1,
      meanReadability: ids.length ? q6(reads.reduce((a, b) => a + b, 0) / N) : 1,
      readableFraction: q6(reads.filter((r) => r >= minRead).length / N),
      cuts,
      corrections,
      reasons,
      desired: { invalidSamples: dInvalid, unreadableSamples: dUnread, sweptCrossings: dCross },
      temporal: temporal(samples),
      rejected: invalidSamples > 0 || sweptCrossings > 0,
      cutaway,
    },
  };
}
