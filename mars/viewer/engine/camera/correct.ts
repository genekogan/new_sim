// Self-correction of computed shots (OWNER_FEEDBACK_2026-09-28 §11 layer 3, docs/engineering/CAMERA_DIRECT.md §7).
// A synthesized shot is simulated against the take (solve.ts `scoreShot`: people and parts per tick, the sun, the
// motion caps). If any sample fails, explicit strategies are tried in a fixed rank — raise, widen, swing, re-route,
// shorten, split, cut — each with a fixed ladder of magnitudes, each candidate re-synthesized and re-simulated; the
// first candidate that is valid on every sample wins. The chosen fix, the failure that triggered it and everything
// tried before it are recorded, so a director can read why a shot changed; if nothing works the shot is refused with
// the full list. Deterministic; the camera never mutates the world.
import type { Diagnostic } from '../actions/types.ts';
import { datan2, q6, type Vec3 } from '../core/math.ts';
import { sunBehindWindow } from '../env/sun.ts';
import type { Obstacle } from '../spatial/types.ts';
import type { ShotIntent } from './direct.ts';
import { FAILURE_ORDER, scoreShot, type FailureKind, type MotionCapsIn, type ShotScore, type ShotSim } from './solve.ts';
import type { Key } from './shots.ts';
import type { PrevPose, SynthContext, SynthOverrides, SynthResult, SynthShot, SynthValidation } from './synth.ts';

export type CorrectionStrategy = 'raise' | 'widen' | 'swing' | 'reroute' | 'shorten' | 'split' | 'cut';
/** The rank: cheapest / least intrusive first. */
export const STRATEGY_ORDER: CorrectionStrategy[] = ['raise', 'widen', 'swing', 'reroute', 'shorten', 'split', 'cut'];
/** Magnitudes tried per strategy, in order (raise m, widen × distance, swing deg of the start bearing, re-route camera radius m). */
export const LADDERS = {
  raise: [0.5, 1, 1.5, 2.5, 4],
  widen: [1.15, 1.3, 1.5, 1.8],
  swing: [10, -10, 20, -20, 30, -30, 45, -45, 60, -60, 90, -90],
  reroute: [0.3, 0.45],
} as const;
/** Failure kinds each strategy can address (a strategy is tried when it addresses at least one failure present). */
export const ADDRESSES: Record<CorrectionStrategy, readonly FailureKind[]> = {
  raise: ['collision', 'squeeze', 'foreground', 'occluded'],
  widen: ['collision', 'squeeze', 'foreground', 'frame', 'occluded', 'horizon', 'motion'],
  swing: ['collision', 'squeeze', 'foreground', 'flare', 'occluded'],
  reroute: ['collision', 'squeeze'],
  shorten: ['collision', 'squeeze', 'foreground', 'flare', 'frame', 'occluded', 'horizon'],
  split: FAILURE_ORDER,
  cut: FAILURE_ORDER,
};
/** shorten keeps at least this fraction of the shot (less is a cut, not a shortening); split / cut keep parts of at least these lengths (s). */
export const KEEP = { shortenFraction: 0.5, splitPart: 1, cutShot: 2 } as const;
/** Synthesis refusals a correction may address (the route / viewpoint search); everything else is the director's constraint. */
export const CORRECTABLE_REFUSAL = /^camera\.(nav\.|direct\.no-viewpoint$)/;

export type ScoreSummary = { valid: boolean; failingSamples: number; penalty: number; failures: FailureSummary[] } | { refused: string; message: string };
export type TriedStrategy = { strategy: CorrectionStrategy; outcome: 'chosen' | 'failed' | 'n/a'; why: string; attempts?: { magnitude?: number; result: string }[] };
export type DirectCorrection = {
  /** The failure that triggered the correction (the first failing kind in FAILURE_ORDER), or 'refused' when synthesis itself failed. */
  failure: FailureKind | 'refused';
  /** Its failing samples (take seconds). */
  samples: { count: number; t0: number; t1: number };
  strategy: CorrectionStrategy;
  before: ScoreSummary;
  after: ScoreSummary;
  reason: string;
  params: Record<string, number>;
  /** Take seconds the corrected shot covers. */
  t0: number;
  t1: number;
  /** Every strategy considered before this one (n/a with the reason, or failed with each attempt's result). */
  tried: TriedStrategy[];
  /** The chosen strategy's own ladder up to the winning magnitude (e.g. swing +10° → flare ×2, then +20° → valid). */
  attempts: { magnitude?: number; result: string }[];
};
export type FailureSummary = { kind: FailureKind; samples: number; t0: number; t1: number; worst: number; detail: string };
/** The phase-2 simulation of the final shot, in the report. */
export type ShotSimulation = { valid: boolean; samples: number; failingSamples: number; penalty: number; worst: ShotScore['worst']; failures: FailureSummary[] };

export type CorrectDeps = {
  synthesize: (intent: ShotIntent, ctx: SynthContext, prev?: PrevPose, over?: SynthOverrides) => SynthResult;
  validate: (world: SynthContext['world'], keys: Key[]) => SynthValidation;
  caps: { viewOmegaDeg: number; viewAlphaDeg: number; speedExterior: number; speedInterior: number; accel: number };
};
export type CorrectResult = { ok: true; shots: SynthShot[] } | { ok: false; diagnostic: Diagnostic };

const r2 = (x: number) => Math.round(x * 100) / 100;
const wrap = (a: number) => { const T = 2 * Math.PI; let x = (a + Math.PI) % T; if (x < 0) x += T; return x - Math.PI; };
const DEG = Math.PI / 180;

function capsOf(intent: ShotIntent, deps: CorrectDeps): MotionCapsIn {
  const c = deps.caps;
  return { viewOmegaDeg: c.viewOmegaDeg, viewAlphaDeg: c.viewAlphaDeg, speed: intent.interior ? c.speedInterior : c.speedExterior, accel: c.accel };
}

/** The phase-2 simulation of a synthesized shot against the take. */
export function simulate(shot: SynthShot, intent: ShotIntent, ctx: SynthContext, deps: CorrectDeps, keys: Key[] = shot.keys, t0 = shot.t0, focus = shot.focus?.points): ShotScore {
  const s = intent.subject;
  const sim: ShotSim = {
    world: ctx.world, sampler: ctx.sampler, keys, t0, hz: ctx.hz, fov: shot.fov, aspect: ctx.aspect, safeBottom: ctx.safeBottom, groundY: ctx.groundY,
    subjects: shot.subjects.filter((id) => !id.startsWith('focus:')),
    ...(focus ? { focus } : {}),
    ...(s.kind === 'assembly' && !s.dynamic && s.members && s.box ? { growing: { members: s.members, min: s.box.min, max: s.box.max } } : {}),
    sunDir: ctx.sun?.direction ?? null,
    caps: capsOf(intent, deps),
    frame: shot.verb !== 'fly_through',
  };
  return scoreShot(sim);
}

const failuresOf = (sc: ShotScore) => sc.failures.map((f) => ({ kind: f.kind, samples: f.samples, t0: f.t0, t1: f.t1, worst: f.worst, detail: f.detail }));
export const summarize = (sc: ShotScore): ScoreSummary => ({ valid: sc.valid, failingSamples: sc.failingSamples, penalty: sc.penalty, failures: failuresOf(sc) });
export const simulationOf = (sc: ShotScore): ShotSimulation => ({ valid: sc.valid, samples: sc.samples.length, failingSamples: sc.failingSamples, penalty: sc.penalty, worst: sc.worst, failures: failuresOf(sc) });
const resultText = (sc: ShotScore) => (sc.valid ? 'valid' : sc.failures.map((f) => `${f.kind} ×${f.samples}`).join(', '));

/** Take-part boxes (as axis-aligned collision prisms) near a route during [t0, t1], sampled at 1 Hz: what re-route avoids. */
function partPrisms(ctx: SynthContext, t0: number, t1: number, around: Vec3[], pad = 6): Obstacle[] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of around) { x0 = Math.min(x0, p[0] - pad); x1 = Math.max(x1, p[0] + pad); z0 = Math.min(z0, p[2] - pad); z1 = Math.max(z1, p[2] + pad); }
  const out = new Map<string, Obstacle>();
  for (let t = t0; t <= t1 + 1e-9; t += 1) {
    const now = ctx.sampler(t);
    for (const id of Object.keys(now).sort()) (now[id].occluders ?? []).forEach((b, k) => {
      if (b.max[0] < x0 || b.min[0] > x1 || b.max[2] < z0 || b.min[2] > z1) return;
      const key = `take-part:${id}#${k}@${Math.round(b.min[0] * 10)},${Math.round(b.min[2] * 10)},${Math.round(b.min[1] * 10)}`;
      if (!out.has(key)) out.set(key, { id: key, kind: 'component', label: `take part ${id}`, obb: { c: [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2], half: [(b.max[0] - b.min[0]) / 2, (b.max[2] - b.min[2]) / 2], yaw: 0 }, y0: b.min[1], y1: b.max[1] });
    });
  }
  return [...out.values()];
}

/** Points a route for this intent will pass near (subject box corners, the explicit fly-through start). */
function aroundOf(intent: ShotIntent): Vec3[] {
  const out: Vec3[] = [];
  const b = intent.subject.box ?? intent.interior?.box;
  if (b) out.push(b.min, b.max);
  const m = intent.direction.motion;
  if (m.verb === 'fly_through' && m.from) out.push(m.from as Vec3);
  return out.length ? out : [[0, 0, 0]];
}

/** Resample a polyline of keys (by index) onto n+1 evenly spaced samples, `t` from 0 at 1/hz. */
function resample<T>(src: T[], n: number, lerp: (a: T, b: T, u: number) => T): T[] {
  const out: T[] = [];
  for (let i = 0; i <= n; i++) {
    const x = n ? (i * (src.length - 1)) / n : 0, j = Math.min(src.length - 2, Math.floor(x));
    out.push(src.length === 1 ? src[0] : lerp(src[j], src[j + 1], x - j));
  }
  return out;
}
const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

/** Is the camera heading (subject → camera, mid-shot) inside the sun-behind band for this lens? Returns the band when the sun is up. */
function sunBand(ctx: SynthContext, shot: SynthShot): { centre: number; half: number; heading: number } | null {
  if (!ctx.sun || ctx.sun.direction[1] <= 0) return null;
  const w = sunBehindWindow(ctx.sun.datetime, { vfovDeg: shot.fov, aspect: ctx.aspect });
  const k = shot.keys[Math.floor(shot.keys.length / 2)];
  return { centre: w.cameraHeading.centre, half: w.cameraHeading.halfWidth, heading: datan2(k.position[2] - k.target[2], k.position[0] - k.target[0]) };
}

/**
 * Synthesize one intent and self-correct it. Returns one shot (possibly corrected), two shots (a split), or a
 * refusal listing every strategy tried. `prev` is the previous shot's last pose (continuity and the hold a cut leaves).
 */
export function correctShot(intent: ShotIntent, ctx: SynthContext, prev: PrevPose | undefined, deps: CorrectDeps): CorrectResult {
  const first = deps.synthesize(intent, ctx, prev);
  const tried: TriedStrategy[] = [];
  const verb = intent.verb;
  const routed = verb === 'fly_through';
  // --- synthesis refused: only the route / viewpoint search is ours to correct
  if (!first.ok) {
    if (!CORRECTABLE_REFUSAL.test(first.diagnostic.code)) return first;
    const before: ScoreSummary = { refused: first.diagnostic.code, message: first.diagnostic.message };
    const attempt = (over: SynthOverrides, c2: SynthContext = ctx) => { const r = deps.synthesize(intent, c2, prev, over); if (!r.ok) return { r, sc: null }; return { r, sc: simulate(r.shot, intent, c2, deps) }; };
    for (const strategy of STRATEGY_ORDER) {
      const attempts: { magnitude?: number; result: string }[] = [];
      let win: { shot: SynthShot; sc: ShotScore; magnitude: number; params: Record<string, number> } | null = null;
      if (strategy === 'raise') for (const m of LADDERS.raise) { const a = attempt({ heightOffset: m }); attempts.push({ magnitude: m, result: a.sc ? resultText(a.sc) : `refused: ${(a.r as { diagnostic: Diagnostic }).diagnostic.code}` }); if (a.sc?.valid && a.r.ok) { win = { shot: a.r.shot, sc: a.sc, magnitude: m, params: { heightOffset: m } }; break; } }
      else if (strategy === 'reroute' && routed) for (const m of LADDERS.reroute) { const a = attempt({ navRadius: m, avoid: partPrisms(ctx, intent.t0, Math.min(ctx.duration, intent.t0 + 60), aroundOf(intent)) }); attempts.push({ magnitude: m, result: a.sc ? resultText(a.sc) : `refused: ${(a.r as { diagnostic: Diagnostic }).diagnostic.code}` }); if (a.sc?.valid && a.r.ok) { win = { shot: a.r.shot, sc: a.sc, magnitude: m, params: { cameraRadius: m } }; break; } }
      else if (strategy === 'widen' || strategy === 'swing') { tried.push({ strategy, outcome: 'n/a', why: routed ? `a routed move has no ${strategy === 'widen' ? 'subject distance' : 'start bearing'} to change` : `does not address a refused ${first.diagnostic.code}` }); continue; }
      else if (strategy === 'reroute') { tried.push({ strategy, outcome: 'n/a', why: 'not a routed move' }); continue; }
      else { tried.push({ strategy, outcome: 'n/a', why: 'no track to trim: the synthesis itself was refused' }); continue; }
      if (win) {
        const corr: DirectCorrection = { failure: 'refused', samples: { count: 0, t0: intent.t0, t1: intent.t0 }, strategy, before, after: summarize(win.sc), reason: `${first.diagnostic.code}: ${first.diagnostic.message} → ${strategy} ${JSON.stringify(win.params)} gives a valid shot`, params: win.params, t0: win.shot.t0, t1: win.shot.t1, tried: [...tried], attempts };
        tried.push({ strategy, outcome: 'chosen', why: corr.reason, attempts });
        corr.tried = tried.slice(0, -1);
        return { ok: true, shots: [{ ...win.shot, corrections: [corr], simulation: simulationOf(win.sc) }] };
      }
      tried.push({ strategy, outcome: 'failed', why: `no ${strategy} magnitude gives a valid shot`, attempts });
    }
    return { ok: false, diagnostic: { ...first.diagnostic, message: `${first.diagnostic.message} — self-correction tried ${STRATEGY_ORDER.join(', ')}: none gives a valid shot`, details: { ...first.diagnostic.details, corrections: { failure: 'refused', tried } } } };
  }
  // --- simulate; valid → done
  const shot0 = first.shot;
  const sc0 = simulate(shot0, intent, ctx, deps);
  if (sc0.valid) return { ok: true, shots: [{ ...shot0, simulation: simulationOf(sc0) }] };
  const target = sc0.failures[0];
  const kinds = new Set(sc0.failures.map((f) => f.kind));
  const before = summarize(sc0);
  const hz = ctx.hz, N = shot0.keys.length - 1;
  const failAt = new Set<number>();
  for (const f of sc0.failures) for (let i = f.i0; i <= f.i1; i++) failAt.add(i);
  const ia = Math.min(...failAt), ib = Math.max(...failAt);
  const band = sunBand(ctx, shot0);
  const done = (strategy: CorrectionStrategy, shots: SynthShot[], sc: ShotScore, params: Record<string, number>, why: string, attempts: { magnitude?: number; result: string }[]): CorrectResult => {
    const t1 = shots[shots.length - 1].t1;
    const reason = `${target.kind} on ${target.samples} sample${target.samples === 1 ? '' : 's'} (${target.detail}); ${why}`;
    const corr: DirectCorrection = { failure: target.kind, samples: { count: target.samples, t0: target.t0, t1: target.t1 }, strategy, before, after: summarize(sc), reason, params, t0: shots[0].t0, t1, tried: [...tried], attempts };
    tried.push({ strategy, outcome: 'chosen', why, attempts });
    const notes = shots.length > 1 ? [`${strategy}: part ${1} of 2`, `${strategy}: part 2 of 2 (after the cut at ${shots[1].t0} s)`] : [];
    return { ok: true, shots: shots.map((s, i) => ({ ...s, corrections: i === 0 ? [corr] : [], notes: notes.length ? [...s.notes, notes[i]] : s.notes, simulation: simulationOf(i === 0 || shots.length === 1 ? sc : simulate(s, intent, ctx, deps)) })) };
  };
  for (const strategy of STRATEGY_ORDER) {
    const addressed = ADDRESSES[strategy].filter((k) => kinds.has(k));
    if (!addressed.length) { tried.push({ strategy, outcome: 'n/a', why: `does not address ${[...kinds].join(' / ')}` }); continue; }
    const attempts: { magnitude?: number; result: string }[] = [];
    const resynth = (over: SynthOverrides, magnitude?: number): { shot: SynthShot; sc: ShotScore } | null => {
      const mag = magnitude ?? (Object.values(over).find((v) => typeof v === 'number') as number | undefined);
      const r = deps.synthesize(intent, ctx, prev, { ...(shot0.searchedHeading !== undefined ? { heading: shot0.searchedHeading } : {}), ...over });
      if (!r.ok) { attempts.push({ magnitude: mag, result: `refused: ${r.diagnostic.code}` }); return null; }
      const sc = simulate(r.shot, intent, ctx, deps);
      attempts.push({ magnitude: mag, result: resultText(sc) });
      return { shot: r.shot, sc };
    };
    if (strategy === 'raise') {
      for (const m of LADDERS.raise) { const c = resynth({ heightOffset: m }); if (c?.sc.valid) return done(strategy, [c.shot], c.sc, { heightOffset: m }, `raised the camera ${m} m (the ladder ${LADDERS.raise.join(', ')} m, first valid)`, attempts); }
    } else if (strategy === 'widen') {
      if (routed) { tried.push({ strategy, outcome: 'n/a', why: 'a routed move keeps the fixture distance; re-route changes its path' }); continue; }
      for (const m of LADDERS.widen) { const c = resynth({ distanceScale: m }); if (c?.sc.valid) return done(strategy, [c.shot], c.sc, { distanceScale: m }, `widened the camera distance ×${m} (ladder ${LADDERS.widen.join(', ')}, first valid)`, attempts); }
    } else if (strategy === 'swing') {
      if (routed) { tried.push({ strategy, outcome: 'n/a', why: 'a routed move has no start bearing' }); continue; }
      // with the sun up and the shot backlit, flare is swung only within the sun-behind band (the sun stays in frame)
      const inBand = band && Math.abs(wrap(band.heading - band.centre)) <= band.half + 1e-9;
      const ladder = LADDERS.swing.filter((d) => !(kinds.has('flare') && inBand && band && Math.abs(wrap(band.heading + d * DEG - band.centre)) > band.half + 1e-9));
      for (const d of ladder) {
        const c = resynth({ bearingOffset: d * DEG }, d);
        if (c?.sc.valid) return done(strategy, [c.shot], c.sc, { bearingOffsetDeg: d }, `swung the bearing ${d > 0 ? '+' : ''}${d}° (ladder ±10…±90°${inBand && kinds.has('flare') ? `, limited to the sun-behind band ±${r2(band!.half / DEG)}° about ${r2(band!.centre / DEG)}° so the sun stays in frame` : ''}; first valid)`, attempts);
      }
    } else if (strategy === 'reroute') {
      if (!routed) { tried.push({ strategy, outcome: 'n/a', why: 'not a routed move: its path is computed from the subject (raise / widen / swing move it)' }); continue; }
      // block the squeezed / colliding stretch itself (a 0.6 m cell per failing sample) and route around it, also
      // avoiding the take's parts; then again with a wider camera radius
      const parts = partPrisms(ctx, shot0.t0, shot0.t1, shot0.keys.map((k) => k.position));
      // a vertical slot between two static solids (a hatch between a half wall and the panel above) is blocked whole:
      // the overlap of their footprints, from the lower top to the upper bottom
      const slots = new Map<string, Obstacle>();
      for (const f of sc0.failures) for (const smp of sc0.samples.slice(f.i0, f.i1 + 1)) {
        if (f.kind !== 'squeeze' || !smp.slot) continue;
        const a = ctx.world.solids.find((q) => q.o.id === smp.slot!.below), b = ctx.world.solids.find((q) => q.o.id === smp.slot!.above);
        if (!a || !b) continue;
        const x0 = Math.max(a.minX, b.minX), x1 = Math.min(a.maxX, b.maxX), z0 = Math.max(a.minZ, b.minZ), z1 = Math.min(a.maxZ, b.maxZ);
        if (x1 <= x0 || z1 <= z0 || b.y0 <= a.y1) continue;
        const key = `${a.o.id}|${b.o.id}`;
        if (!slots.has(key)) slots.set(key, { id: `slot:${key}`, kind: 'solid', label: `the ${r2(b.y0 - a.y1)} m slot between '${a.o.label ?? a.o.id}' and '${b.o.label ?? b.o.id}'`, obb: { c: [(x0 + x1) / 2, (z0 + z1) / 2], half: [(x1 - x0) / 2 + 0.05, (z1 - z0) / 2 + 0.05], yaw: 0 }, y0: a.y1, y1: b.y0 });
      }
      const blocks: Obstacle[] = [...slots.values(), ...sc0.failures.filter((f) => f.kind === 'squeeze' || f.kind === 'collision').flatMap((f) => sc0.samples.slice(f.i0, f.i1 + 1).map((smp, q) => ({ id: `squeeze:${f.i0 + q}`, kind: 'solid' as const, label: `the ${f.kind} at t=${smp.t} s`, obb: { c: [smp.position[0], smp.position[2]] as [number, number], half: [0.3, 0.3] as [number, number], yaw: 0 }, y0: smp.position[1] - 0.4, y1: smp.position[1] + 0.4 })))];
      const avoid = [...parts, ...blocks];
      for (const m of LADDERS.reroute) {
        const c = resynth({ navRadius: m, avoid });
        if (c?.sc.valid) return done(strategy, [c.shot], c.sc, { cameraRadius: m, blockedSamples: blocks.length, avoidedParts: parts.length }, `re-routed through the camera navmesh around the ${target.kind} (${slots.size ? `${[...slots.values()].map((o) => o.label).join(', ')} blocked, ` : ''}its failing samples blocked${parts.length ? `, the take's ${parts.length} part boxes as obstacles` : ''}, camera radius ${m} m)`, attempts);
      }
    } else if (strategy === 'shorten') {
      const T0 = N / hz, T = (ia - 1) / hz;
      if (ia < 1 || T < KEEP.shortenFraction * T0) { tried.push({ strategy, outcome: 'n/a', why: `the first failure is at ${r2(ia / hz)} s of ${r2(T0)} s: shortening would keep < ${KEEP.shortenFraction * 100}% of the shot` }); continue; }
      const c = resynth({ duration: q6(T) });
      if (c?.sc.valid) return done(strategy, [c.shot], c.sc, { duration: q6(T), was: r2(T0) }, `shortened to ${r2(T)} s (from ${r2(T0)} s) so the whole move ends before the first failure at ${r2(ia / hz)} s`, attempts);
    } else if (strategy === 'split') {
      const m = ia - 1, part = Math.round(KEEP.splitPart * hz);
      if (m < part || N - ib < part) { tried.push({ strategy, outcome: 'n/a', why: `the failing interval ${r2(ia / hz)}–${r2(ib / hz)} s does not leave ≥ ${KEEP.splitPart} s valid on both sides` }); continue; }
      // part A: the valid lead [0, m]; part B: the path after the failing interval, re-timed to fill [m, N] (take time runs on)
      const keysA = shot0.keys.slice(0, m + 1);
      const src = shot0.keys.slice(ib + 1);
      const posB = resample(src.map((k) => k.position), N - m, lerp3), tgtB = resample(src.map((k) => k.target), N - m, lerp3);
      const keysB: Key[] = posB.map((p, i) => ({ t: q6(i / hz), position: p, target: tgtB[i] }));
      const focA = shot0.focus?.points.slice(0, m + 1);
      const focB = shot0.focus ? resample(shot0.focus.points.slice(ib + 1), N - m, (a, b, u) => a.map((p, j) => lerp3(p, b[j], u))) : undefined;
      const tB = q6(shot0.t0 + m / hz);
      const A: SynthShot = { ...shot0, keys: keysA, t1: tB, ...(focA ? { focus: { id: shot0.focus!.id, points: focA } } : {}), validation: deps.validate(ctx.world, keysA), params: { ...shot0.params, duration: r2(m / hz) } };
      const B: SynthShot = { ...shot0, label: `${shot0.label} (after the cut)`, keys: keysB, t0: tB, t1: shot0.t1, ...(focB ? { focus: { id: `${shot0.focus!.id}b`, points: focB } } : {}), subjects: shot0.focus ? [...shot0.subjects.filter((x) => x !== shot0.focus!.id), `${shot0.focus.id}b`] : shot0.subjects, validation: deps.validate(ctx.world, keysB), params: { ...shot0.params, duration: r2((N - m) / hz) } };
      const sa = simulate(A, intent, ctx, deps), sb = simulate(B, intent, ctx, deps);
      attempts.push({ result: `part A ${resultText(sa)}; part B ${resultText(sb)}` });
      if (sa.valid && sb.valid) return done(strategy, [A, B], sa, { cutAt: tB, skipped: r2((ib - m) / hz) }, `split into two shots with a cut at ${tB} s: the ${r2((ib - m) / hz)} s of path through the failure is skipped and the rest of the move re-timed to end on time`, attempts);
    } else if (strategy === 'cut') {
      // keep the longest valid run (ties → the earliest); the dropped time is a hold of the previous frame
      let best: [number, number] | null = null;
      for (let i = 0; i <= N;) {
        if (failAt.has(i)) { i++; continue; }
        let j = i;
        while (j + 1 <= N && !failAt.has(j + 1)) j++;
        if (!best || j - i > best[1] - best[0]) best = [i, j];
        i = j + 1;
      }
      if (!best || (best[1] - best[0]) / hz < KEEP.cutShot) { tried.push({ strategy, outcome: 'failed', why: `no valid stretch of ≥ ${KEEP.cutShot} s`, attempts }); continue; }
      const [a, b] = best;
      const keys = shot0.keys.slice(a, b + 1).map((k) => ({ ...k, t: q6(k.t - a / hz) }));
      const foc = shot0.focus?.points.slice(a, b + 1);
      const C: SynthShot = { ...shot0, keys, t0: q6(shot0.t0 + a / hz), t1: q6(shot0.t0 + b / hz), ...(foc ? { focus: { id: shot0.focus!.id, points: foc } } : {}), validation: deps.validate(ctx.world, keys), params: { ...shot0.params, duration: r2((b - a) / hz) } };
      const sc = simulate(C, intent, ctx, deps);
      // the dropped lead (if any) is held on the previous frame: it must be valid too
      let gapOk = true, gapText = '';
      if (a > 0) {
        const hold = prev ?? { position: keys[0].position, target: keys[0].target };
        const gk: Key[] = Array.from({ length: a + 1 }, (_, i) => ({ t: q6(i / hz), position: hold.position, target: hold.target }));
        const gs = simulate({ ...shot0, keys: gk, verb: 'hold' }, intent, ctx, deps, gk, shot0.t0, foc ? gk.map(() => foc[0]) : undefined);
        gapOk = gs.valid; gapText = `; the ${r2(a / hz)} s held before it: ${resultText(gs)}`;
      }
      attempts.push({ result: `kept ${r2(a / hz)}–${r2(b / hz)} s: ${resultText(sc)}${gapText}` });
      if (sc.valid && gapOk) return done(strategy, [C], sc, { kept0: r2(a / hz), kept1: r2(b / hz), dropped: r2((N - (b - a)) / hz) }, `cut: kept the valid ${r2(a / hz)}–${r2(b / hz)} s of the move and dropped ${r2((N - (b - a)) / hz)} s`, attempts);
    }
    tried.push({ strategy, outcome: 'failed', why: `no ${strategy} candidate is valid on every sample`, attempts });
  }
  return {
    ok: false,
    diagnostic: {
      code: 'camera.direct.uncorrectable',
      message: `direction ${intent.index}: ${target.kind} on ${target.samples} samples (${target.detail}) — self-correction tried ${STRATEGY_ORDER.join(', ')}: none gives a shot valid on every sample`,
      subjects: target.subjects,
      details: { before, corrections: { failure: target.kind, tried } },
    },
  };
}
