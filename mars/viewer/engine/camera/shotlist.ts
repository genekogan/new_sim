// Shot list → one camera track. Each window [t0, t1) is planned by
// `planCameraTrack` against a time-shifted sampler (spec times such as
// `reveal.t0/t1`, `path` keys and `orbit` phase are relative to the window
// start), and the windows are concatenated on one uniform 1/hz grid. The first
// sample of every window after the first is a cut (the editor's cut between
// shots), so `sampleTrack` holds the previous shot up to the cut instead of
// blending through geometry. The merged report keeps every per-shot finding,
// prefixed with the shot label and shifted to take time.
import { q6 } from '../core/math.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { CameraWorld } from './geom.ts';
import { planCameraTrack, type CameraPlan, type Cut, type Correction, type PlanOpts, type PlannedSample, type PlanReport } from './plan.ts';
import { temporal } from './quality.ts';
import { SubjectTrackBuilder, subjectReader } from './track.ts';
import type { Sampler, ShotSpec } from './shots.ts';

export type ShotWindow = { label: string; t0: number; t1: number; spec: ShotSpec };
export type PlannedShot = ShotWindow & { report: Omit<PlanReport, 'temporal'> };
export type ShotListPlan = CameraPlan & { shots: PlannedShot[] };

export function planShotList(shots: ShotWindow[], sampler: Sampler, scene: SpatialScene | CameraWorld, opts: Omit<PlanOpts, 'duration'>): ShotListPlan {
  if (!shots.length) throw new Error('planShotList: empty shot list');
  const hz = opts.hz ?? 10;
  const world = scene instanceof CameraWorld ? scene : new CameraWorld(scene, opts.policy);
  const grid = (t: number) => Math.round(t * hz);
  if (grid(shots[0].t0) !== 0) throw new Error(`planShotList: the first shot must start at t=0 (got ${shots[0].t0})`);
  shots.forEach((s, i) => {
    if (grid(s.t1) <= grid(s.t0)) throw new Error(`planShotList: shot '${s.label}' is empty (${s.t0}–${s.t1} s)`);
    if (i && grid(s.t0) !== grid(shots[i - 1].t1)) throw new Error(`planShotList: shot '${s.label}' does not start where '${shots[i - 1].label}' ends`);
  });
  const samples: PlannedSample[] = [];
  const scored = new SubjectTrackBuilder();
  const cuts: Cut[] = [], corrections: Correction[] = [], reasons: string[] = [];
  const planned: PlannedShot[] = [];
  let invalid = 0, crossings = 0, dInvalid = 0, dUnread = 0, dCross = 0, cutaway = false;
  shots.forEach((shot, i) => {
    const i0 = grid(shot.t0), i1 = grid(shot.t1), last = i === shots.length - 1;
    const off = i0 / hz;
    const plan = planCameraTrack(shot.spec, (t) => sampler(off + t), world, { ...opts, hz, duration: (i1 - i0) / hz });
    const keep = last ? plan.samples : plan.samples.slice(0, -1); // the next shot owns t1
    keep.forEach((s, k) => samples.push({ ...s, t: q6((i0 + k) / hz), cut: k === 0 ? i > 0 : s.cut }));
    const read = subjectReader(plan.subjects);
    keep.forEach((_, k) => { const r = read(k); scored.push(r.ids, r.points); });
    const at = (t: number) => q6(off + t);
    const tag = `[${shot.label}]`;
    if (i) cuts.push({ t: at(0), from: shots[i - 1].label, to: shot.label, reason: `shot list: ${shot.label}` });
    for (const c of plan.report.cuts) cuts.push({ ...c, t: at(c.t), reason: `${tag} ${c.reason}` });
    for (const c of plan.report.corrections) corrections.push({ ...c, t0: at(c.t0), t1: at(c.t1), reason: `${tag} ${c.reason}` });
    for (const r of plan.report.reasons) reasons.push(`${tag} @${off.toFixed(1)} s: ${r}`);
    invalid += plan.report.invalidSamples;
    crossings += plan.report.sweptCrossings;
    dInvalid += plan.report.desired.invalidSamples;
    dUnread += plan.report.desired.unreadableSamples;
    dCross += plan.report.desired.sweptCrossings;
    cutaway ||= plan.report.cutaway;
    const { temporal: _t, ...rest } = plan.report;
    planned.push({ ...shot, report: rest });
  });
  cuts.sort((a, b) => a.t - b.t); // stable: a boundary cut precedes the shot's own cuts at the same t
  const minRead = opts.minReadability ?? 0.6;
  const reads = samples.map((s) => s.readability);
  const report: PlanReport = {
    samples: samples.length,
    invalidSamples: invalid,
    sweptCrossings: crossings,
    minReadability: Math.min(...reads),
    meanReadability: q6(reads.reduce((a, b) => a + b, 0) / reads.length),
    readableFraction: q6(reads.filter((r) => r >= minRead).length / reads.length),
    cuts,
    corrections,
    reasons,
    desired: { invalidSamples: dInvalid, unreadableSamples: dUnread, sweptCrossings: dCross },
    temporal: temporal(samples),
    rejected: invalid > 0 || crossings > 0,
    cutaway,
  };
  const safeBottom = opts.safeArea?.bottom ?? 0;
  return { spec: shots[0].spec, hz, duration: (samples.length - 1) / hz, ...(safeBottom > 0 ? { safeArea: { bottom: safeBottom } } : {}), samples, subjects: scored.track, report, shots: planned };
}
