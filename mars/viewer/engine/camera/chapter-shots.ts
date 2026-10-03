// Event-driven shot lists for long build takes (W39; the 2022 A+B chapter takes). CAMERA.md "Chapter shot lists".
// The recorder's first chapter planner (W31 `workShots`) cut on a fixed 90–300 s rhythm and framed the people who
// worked at the house for most of a window, so a shot could hold 1–4 people for five minutes, frame a group standing
// idle while someone else worked, and never showed the yard after the opening wide. This planner reads the TAKE:
//   - an activity grid (per person, per camera sample: the recorded `activity` — idle / wait = idle — and the pose);
//   - the step timeline (the take's own lifecycle events) and each step's actors (the crew ids in its bound params).
// It walks the chapter on the camera grid and, at each cut, frames the actors of the most telling step in progress
// (house work before a cut at the station before a carry; the first of a verb in the chapter first), plus whoever
// else is active next to them. A shot ends at the next telling event after `minShot`, after `maxShot`, when its people
// drift apart, or `idleMax` s after all of them went idle while someone else works. Every `wideEvery` s the next cut
// is a wide from the yard side (the piles, the cutting station and the house in one frame). Moments (studio jump points)
// are the first of each telling event (a beam by how it went up: "first hand-up", "first relay"). Pure and deterministic: core/math only, sorted iteration, no clocks.
import { datan2, hypot, type Vec2, type Vec3 } from '../core/math.ts';
import { interpSample } from '../take/replay.ts';
import { POS_Q, type PoseSample, type Take } from '../take/types.ts';
import type { CameraWorld } from './geom.ts';
import { placement, readability } from './quality.ts';
import { evaluateShot, shotSubjects, type Region, type Sampler, type ShotSpec } from './shots.ts';

/** A plan step as it ran in the take (seconds from the take start; null = never started / ended in this take). */
export type StepTime = { id: string; verb: string; start: number | null; end: number | null; label?: string };
/** The house: footprint centre (x, z), half extents along its axes, yaw, ground height. */
export type ChapterSite = { origin: Vec2; half?: Vec2; yaw?: number; groundY: number };
/** A shot list entry as the recorder takes it (t0 = the previous entry's t1). */
export type ChapterShot = { label: string; t1: number; spec: ShotSpec };

/** Recorded activities that count as not working (the camera must not dwell on them while someone else works). */
export const IDLE_ACTIVITIES: ReadonlySet<string> = new Set(['idle', 'wait']);

const DEG = Math.PI / 180;

/** A step's moment name: a beam by how it went up (the step label: handed up, through the relay), a stair part by kind. */
function eventName(s: { verb: string; label?: string }): string {
  if (s.verb === 'hang_beam' && s.label) {
    if (/relay/.test(s.label)) return 'first relay';
    if (/handed up/.test(s.label)) return 'first hand-up';
  }
  if (s.verb === 'install_stair_part' && s.label) {
    if (/handrail|rail /.test(s.label)) return 'first handrail';
    if (/post/.test(s.label)) return 'first post';
  }
  return STEP_INTEREST[s.verb]?.name ?? s.verb;
}

/**
 * How telling a step is on screen (0 = never a reason to cut). Work at the house > a cut at the station > fetching.
 * `name` is the moment key for the first one in a chapter ("first raise"); steps without a name make no moment.
 */
export const STEP_INTEREST: Record<string, { score: number; name?: string }> = {
  raise_upright: { score: 5, name: 'first raise' },
  hang_beam: { score: 4, name: 'first beam' },
  pass_up: { score: 5, name: 'first pass-up' },
  install_wall: { score: 5, name: 'first wall' },
  install_stringer: { score: 5, name: 'first stringer' },
  install_stair_part: { score: 5, name: 'first tread' },
  install_rail: { score: 5, name: 'first rail' },
  install_panel: { score: 5, name: 'first panel' },
  install_plywood: { score: 5, name: 'first sheet' },
  install_joist: { score: 4, name: 'first joist' },
  connect_beam: { score: 4, name: 'first beam' },
  install_tread: { score: 5, name: 'first tread' },
  climb_frame: { score: 3, name: 'up the frame' },
  climb_stair: { score: 3 },
  hold_frame: { score: 3 },
  release_support: { score: 2 },
  climb_stance: { score: 3 },
  beam_walk: { score: 2 },
  cut: { score: 3, name: 'first cut' },
  stack_offcut: { score: 1 },
  carry: { score: 1 },
  take_from_bundle: { score: 1 },
};

export type ActivityGrid = {
  /** Grid step (s) and sample count: sample k is at t = k·dt. */
  dt: number;
  n: number;
  crew: string[];
  /** Per crew member (same order): 1 = working at sample k (recorded activity not in IDLE_ACTIVITIES). */
  active: Uint8Array[];
  /** Per crew member: feet position at sample k (x, y, z interleaved). */
  pos: Float64Array[];
};

/** Step value of a change field at `tick` (the last change ≤ tick), per entity. */
function fieldSeries(take: Take, field: string, ids: ReadonlySet<string>): Map<string, [number, unknown][]> {
  const out = new Map<string, [number, unknown][]>();
  for (const [t, id, f, v] of take.changes) {
    if (f !== field || !ids.has(id)) continue;
    const l = out.get(id);
    if (l) l.push([t, v]);
    else out.set(id, [[t, v]]);
  }
  return out;
}

function trackAt(s: PoseSample[], tick: number): PoseSample {
  if (tick <= s[0][0]) return s[0];
  if (tick >= s[s.length - 1][0]) return s[s.length - 1];
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid][0] <= tick) lo = mid;
    else hi = mid;
  }
  return interpSample(s[lo], s[hi], tick);
}

/**
 * The crew's activity and position on a `dt` grid over the take. A person counts as working in sample k when their
 * recorded activity at any tick of [k·dt, (k+1)·dt) is not idle / wait (so a 1-tick `release` is not lost between
 * samples).
 */
export function activityGrid(take: Take, crew: readonly string[], dt: number): ActivityGrid {
  const duration = take.ticks * take.dt;
  const n = Math.floor(duration / dt + 1e-9) + 1;
  const perSample = dt / take.dt;
  const ids = [...crew].sort();
  const acts = fieldSeries(take, 'activity', new Set(ids));
  const active: Uint8Array[] = [], pos: Float64Array[] = [];
  for (const id of ids) {
    const a = new Uint8Array(n), p = new Float64Array(3 * n);
    const series = acts.get(id) ?? [];
    let j = -1;
    for (let k = 0; k < n; k++) {
      const t0 = Math.round(k * perSample), t1 = Math.round((k + 1) * perSample);
      while (j + 1 < series.length && series[j + 1][0] <= t0) j++;
      const busy = (v: unknown) => typeof v === 'string' && !IDLE_ACTIVITIES.has(v);
      let on = j >= 0 && busy(series[j][1]);
      for (let i = j + 1; !on && i < series.length && series[i][0] < t1; i++) on = busy(series[i][1]);
      a[k] = on ? 1 : 0;
      const tr = take.tracks[id];
      if (tr?.length) {
        const s = trackAt(tr, Math.min(t0, take.ticks));
        p[3 * k] = s[1] / POS_Q;
        p[3 * k + 1] = s[2] / POS_Q;
        p[3 * k + 2] = s[3] / POS_Q;
      }
    }
    active.push(a);
    pos.push(p);
  }
  return { dt, n, crew: ids, active, pos };
}

/** The crew ids a step's bound params name (in crew order). */
export function stepActors(params: unknown, crew: readonly string[]): string[] {
  const text = JSON.stringify(params ?? {});
  return crew.filter((c) => text.includes(`"${c}"`));
}

export type ChapterShotOpts = {
  take: Take;
  steps: StepTime[];
  /** Plan steps (id + bound params), for each step's actors. */
  planSteps: { id: string; params?: unknown }[];
  crew: string[];
  site: ChapterSite;
  /** Region of the yard (piles, cutting station) and the house, for the opening, closing and yard wides. */
  yard: Region;
  /** Where the yard is (its centre, x/z): the yard wides look over it at the house. */
  yardCentre: Vec2;
  /** Words for labels: "the skeleton", "the walls". */
  what: string;
  /** Camera grid (Hz); shot boundaries fall on it. */
  hz: number;
  open?: number;
  close?: number;
  minShot?: number;
  maxShot?: number;
  /** Seconds a shot may keep framing only idle people while someone else works, before it cuts. */
  idleMax?: number;
  wideEvery?: number;
  wideLen?: number;
  /** Other working people within this distance (m) of the focus join the shot. */
  cluster?: number;
  /** A shot ends when one of its people is this far (m) from the group's centre. */
  spreadMax?: number;
  padding?: number;
  /**
   * Rates a candidate shot over [t0, t1) (0–1; `shotRater`). With it, each frameGroup shot takes the first of its
   * candidate angles (preferred side first) rated ≥ `rateOk`, else the best; without it, the preferred angle.
   */
  rate?: (spec: ShotSpec, t0: number, t1: number) => number;
  rateOk?: number;
  /** A shot whose best candidate rates below this is split in two (each ≥ `minPiece` s) and each half re-rated. */
  splitBelow?: number;
  minPiece?: number;
};

/** `ends`: how many frameGroup shots ended for each reason (long = maxShot, idle, apart = spreadMax, event, end). */
export type ChapterShotPlan = { shots: ChapterShot[]; moments: Record<string, number>; grid: ActivityGrid; ends: Record<string, number> };

/** The event-driven shot list and moments of one chapter take (see the header). */
export function chapterShots(o: ChapterShotOpts): ChapterShotPlan {
  const g = 1 / o.hz;
  const open = o.open ?? 12, close = o.close ?? 20, minShot = o.minShot ?? 40, maxShot = o.maxShot ?? 90;
  const idleMax = o.idleMax ?? 12, wideEvery = o.wideEvery ?? 300, wideLen = o.wideLen ?? 12;
  const cluster = o.cluster ?? 6, spreadMax = o.spreadMax ?? 9, padding = o.padding ?? 1.8;
  const rateOk = o.rateOk ?? 0.8, splitBelow = o.splitBelow ?? 0.6, minPiece = o.minPiece ?? 12;
  const grid = activityGrid(o.take, o.crew, g);
  const duration = o.take.ticks * o.take.dt;
  const snap = (t: number) => Math.round(t / g) * g;
  const K = (t: number) => Math.min(grid.n - 1, Math.max(0, Math.round(t / g)));
  const idx = new Map(grid.crew.map((c, i) => [c, i]));
  const at = (id: string, t: number): Vec3 => { const p = grid.pos[idx.get(id)!], k = K(t); return [p[3 * k], p[3 * k + 1], p[3 * k + 2]]; };
  const busy = (id: string, t: number) => grid.active[idx.get(id)!][K(t)] === 1;
  const params = new Map(o.planSteps.map((s) => [s.id, s.params]));
  // steps that ran in this take, with actors and interest, in start order (ties by id: deterministic)
  const firstOf = new Set<string>();
  const seen = new Set<string>();
  const ran = o.steps
    .filter((s) => s.start !== null && s.end !== null)
    .map((s) => ({ ...s, start: s.start as number, end: s.end as number, actors: stepActors(params.get(s.id), grid.crew), score: STEP_INTEREST[s.verb]?.score ?? 0 }))
    .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const s of ran) { const k = eventName(s); if (!seen.has(k)) { seen.add(k); firstOf.add(s.id); } }
  type Ran = (typeof ran)[number];
  const interest = (s: Ran) => s.score + (firstOf.has(s.id) && s.score >= 3 ? 2 : 0);

  const c = o.site.origin;
  const half = o.site.half ?? [6, 6];
  const r = hypot(half[0], half[1]);
  const house: Region = { min: [c[0] - r - 2, c[1] - r - 2], max: [c[0] + r + 2, c[1] + r + 2], y: o.site.groundY };
  const yardAz = datan2(o.yardCentre[1] - c[1], o.yardCentre[0] - c[0]);
  const shots: ChapterShot[] = [];
  // a shot identical to the one before (the house wide for both halves of a split) extends it: no cut to the same frame
  const push = (label: string, t1: number, spec: ShotSpec) => {
    const last = shots[shots.length - 1];
    if (last && last.label === label && stableJson(last.spec) === stableJson(spec)) last.t1 = t1;
    else shots.push({ label, t1, spec });
  };
  const end = Math.floor((duration - close) / g) * g;
  push(`establishing: ${o.what} from the yard`, snap(open), { kind: 'establishing', region: o.yard, azimuth: yardAz + 25 * DEG, elevation: 32 * DEG });

  /** The group to frame from t: the most telling step in progress (or starting within 6 s) whose actors work now. */
  const pick = (t: number): { subjects: string[]; focus: Ran | null } | null => {
    const working = grid.crew.filter((p) => busy(p, t) || busy(p, t + g));
    if (!working.length) return null;
    let best: Ran | null = null, bestScore = 0, seed: string[] = [];
    for (const s of ran) {
      if (s.start > t + 6) break;
      if (s.end <= t || !s.score) continue;
      const w = s.actors.filter((a) => working.includes(a));
      if (!w.length) continue;
      const sc = interest(s);
      if (sc > bestScore) { best = s; bestScore = sc; seed = w; }
    }
    if (!seed.length) seed = [working[0]];
    const m = centre(seed.map((p) => at(p, t)));
    const subjects = working.filter((p) => seed.includes(p) || hypot(at(p, t)[0] - m[0], at(p, t)[2] - m[2]) <= cluster);
    return { subjects: subjects.sort(), focus: best };
  };
  /** Why the last `extend` ended its shot (ChapterShotPlan.ends). */
  let why = 'end';
  /** How long a shot of `subjects` from t may run. */
  const extend = (subjects: string[], t: number, focus: Ran | null): number => {
    let idle = 0;
    for (let s = t + g; s < end; s += g) {
      if (s - t >= maxShot) return (why = 'long'), s;
      const on = subjects.some((p) => busy(p, s));
      const others = !on && grid.crew.some((p) => !subjects.includes(p) && busy(p, s));
      idle = on ? 0 : others ? idle + g : idle;
      if (idle >= idleMax) return (why = 'idle'), s;
      const m = centre(subjects.map((p) => at(p, s)));
      if (subjects.some((p) => hypot(at(p, s)[0] - m[0], at(p, s)[2] - m[2]) > spreadMax)) return (why = 'apart'), Math.max(t + g, s - g);
      if (s - t >= minShot) {
        // cut to a telling step that starts now and is not this shot's (a new group, or the next piece of the same work)
        const next = ran.find((x) => x.start > s - g && x.start <= s && x !== focus && interest(x) >= 3 && x.actors.some((a) => busy(a, s) || busy(a, s + g)));
        if (next) return (why = 'event'), s;
      }
    }
    return (why = 'end'), end;
  };

  let flip = 0;
  const ends: Record<string, number> = {};
  /** One frameGroup over [t0, t1): the first candidate angle rated ≥ rateOk (else the best); a window whose best rates
   *  below `splitBelow` is split in two (down to `minPiece` s), each half choosing again (people move, walls go up). */
  /** Heading from the house centre to the group (the side a wide or a close shot looks from). */
  const base0 = (subjects: string[], t0: number, t1: number): number => {
    const m = centre(subjects.map((q) => at(q, t0 + (t1 - t0) / 2)));
    const d: Vec2 = [m[0] - c[0], m[2] - c[1]];
    return hypot(d[0], d[1]) > 0.5 ? datan2(d[1], d[0]) : yardAz;
  };
  const choose = (subjects: string[], t0: number, t1: number, again: boolean): { spec: ShotSpec; r: number } => {
    const m = centre(subjects.map((q) => at(q, t0 + (t1 - t0) / 2)));
    const d: Vec2 = [m[0] - c[0], m[2] - c[1]];
    const base = hypot(d[0], d[1]) > 0.5 ? datan2(d[1], d[0]) : yardAz;
    const side = flip % 2 ? 1 : -1;
    const el0 = m[1] < 1 ? 10 : m[1] < 3.5 ? 22 : 30;
    // candidates in order of preference: this shot's side of the line from the house centre, the other side, wider
    // off the line, then other heights (people under a deck read only from low down: 10° and 5° before steeper
    // angles); the same people as the last shot start wider off the line (no jump cut)
    const cands: ShotSpec[] = [];
    for (const el of new Set([el0, 10, 5, 22, el0 + 15]))
      for (const off of again ? [65, -65, 30, -30, 0, 105, -105, 145, -145, 180] : [30, -30, 0, 65, -65, 105, -105, 145, -145, 180])
        cands.push({ kind: 'frameGroup', subjects, padding, azimuth: base + side * off * DEG, elevation: el * DEG });
    let spec = cands[0], best = 1;
    if (o.rate) {
      best = -1;
      for (const x of cands) {
        const r = o.rate(x, t0, t1);
        if (r > best) { best = r; spec = x; }
        if (r >= rateOk) break;
      }
    }
    return { spec, r: best };
  };
  const frame = (subjects: string[], t0: number, t1: number, label: string, again: boolean): void => {
    flip++;
    const { spec, r: best } = choose(subjects, t0, t1, again);
    const mid = snap((t0 + t1) / 2);
    if (best < splitBelow && mid - t0 >= minPiece && t1 - mid >= minPiece) {
      frame(subjects, t0, mid, label, again);
      frame(subjects, mid, t1, label, true);
      return;
    }
    if (best < 0.6 && subjects.length > 1 && o.rate) {
      // no angle reads the whole group here (one on each side of a wall or deck): the most readable one of them
      // (among the readable ones, the one who works most of the window: one of them, or someone working elsewhere)
      let alt: { spec: ShotSpec; r: number; who: string; w: number } | null = null;
      const pool = [...subjects, ...grid.crew.filter((q) => !subjects.includes(q) && busy(q, t0))];
      for (const who of pool) {
        const one = choose([who], t0, t1, again);
        let on = 0, n = 0;
        for (let x = t0; x < t1 - 1e-9; x += g, n++) on += busy(who, x) ? 1 : 0;
        const w = one.r >= 0.6 ? 1 + on / Math.max(1, n) : one.r;
        if (one.r > best && (!alt || w > alt.w)) alt = { ...one, who, w };
      }
      if (alt && alt.w >= 1.5) { push(subjects.includes(alt.who) ? `${label} (${alt.who})` : `${o.what}: at work — ${alt.who}`, t1, alt.spec); return; }
      // the only readable ones mostly wait: the house wide, the work in context (a wide scores no subjects)
      push(`${o.what}: the house (${subjects.join(' ')} out of sight)`, t1, { kind: 'establishing', region: house, azimuth: base0(subjects, t0, t1), elevation: 30 * DEG });
      return;
    }
    push(label, t1, spec);
  };
  let t = shots[0].t1, lastWide = 0;
  let prevSubjects = '';
  while (t < end - 1e-9) {
    if (t - lastWide >= wideEvery && end - t >= wideLen + g) {
      const t1 = Math.min(end, snap(t + wideLen));
      push(`${o.what}: wide from the yard`, t1, { kind: 'establishing', region: o.yard, azimuth: yardAz + (flip % 2 ? -25 : 25) * DEG, elevation: 28 * DEG });
      lastWide = t;
      t = t1;
      continue;
    }
    const p = pick(t);
    if (!p) {
      // nobody works: the house, until someone does (at most maxShot)
      let s = t + g;
      while (s < end && s - t < maxShot && !grid.crew.some((q) => busy(q, s))) s += g;
      push(`${o.what}: the house`, s, { kind: 'establishing', region: house, azimuth: yardAz + 150 * DEG, elevation: 30 * DEG });
      t = s;
      continue;
    }
    let t1 = Math.min(end, Math.max(t + g, extend(p.subjects, t, p.focus)));
    // people who part at once (a giver walking back to the yard): frame fewer rather than cut after a moment — drop
    // the one farthest from the others (the focus's actors last) until the shot holds `minPiece` s
    while (t1 - t < minPiece && t1 < end && p.subjects.length > 1) {
      const m = centre(p.subjects.map((q) => at(q, t1 + g)));
      const far = [...p.subjects].sort((a, b) => {
        const fa = p.focus?.actors.includes(a) ? 1 : 0, fb = p.focus?.actors.includes(b) ? 1 : 0;
        if (fa !== fb) return fa - fb;
        const da = hypot(at(a, t1 + g)[0] - m[0], at(a, t1 + g)[2] - m[2]), db = hypot(at(b, t1 + g)[0] - m[0], at(b, t1 + g)[2] - m[2]);
        return db - da || (a < b ? -1 : 1);
      })[0];
      const rest = p.subjects.filter((q) => q !== far);
      if (!rest.some((q) => busy(q, t) || busy(q, t + g))) break;
      p.subjects = rest;
      t1 = Math.min(end, Math.max(t + g, extend(p.subjects, t, p.focus)));
    }
    ends[why] = (ends[why] ?? 0) + 1;
    const key = p.subjects.join(' ');
    const what = p.focus?.label ? shorten(p.focus.label) : p.focus ? p.focus.verb.replace(/_/g, ' ') : 'at work';
    frame(p.subjects, t, t1, `${o.what}: ${what} — ${key}`, key === prevSubjects);
    prevSubjects = key;
    t = t1;
  }
  push(`${o.what}: done`, duration, { kind: 'establishing', region: house, azimuth: -Math.PI / 4, elevation: 30 * DEG });

  // moments: the first of each named telling step (at most 4, in time order), then the end
  const moments: Record<string, number> = {};
  for (const s of ran) {
    const name = STEP_INTEREST[s.verb]?.name ? eventName(s) : undefined;
    if (!name || !firstOf.has(s.id) || name in moments) continue;
    if (Object.keys(moments).length >= 4) break;
    moments[name] = Math.min(snap(duration) - g, snap(s.start + Math.min(6, (s.end - s.start) / 2)));
  }
  moments.done = Math.floor(duration / 2) * 2;
  return { shots, moments, grid, ends };
}

/**
 * A `ChapterShotOpts.rate` over a take: the shot's desired pose (`evaluateShot`) every `1/hz` s of [t0, t1), each
 * scored 0 when the camera position is invalid (`placement`) else by `readability` of the shot's subjects; the minimum.
 * The camera planner can still correct a desired pose; this only picks the angle that needs it least.
 */
export function shotRater(world: CameraWorld, sampler: Sampler, o: { hz: number; safeBottom?: number; minClear?: number; aspect?: number }): (spec: ShotSpec, t0: number, t1: number) => number {
  const dt = 1 / o.hz;
  return (spec, t0, t1) => {
    const ids = shotSubjects(spec);
    let worst = 1;
    for (let t = t0; t < t1 - 1e-9; t += dt) {
      const pose = evaluateShot(spec, sampler, t, { aspect: o.aspect, safeBottom: o.safeBottom });
      if (!placement(world, pose.position, o.minClear).valid) return 0;
      const r = ids.length ? readability(world, pose, sampler(t), ids, { aspect: o.aspect, safeBottom: o.safeBottom }).score : 1;
      if (r < worst) worst = r;
      if (worst === 0) break;
    }
    return worst;
  };
}

const stableJson = (x: unknown): string => JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));

function centre(ps: Vec3[]): Vec3 {
  const m: Vec3 = [0, 0, 0];
  for (const p of ps) { m[0] += p[0] / ps.length; m[1] += p[1] / ps.length; m[2] += p[2] / ps.length; }
  return m;
}
function shorten(s: string, n = 64): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export type ShotActivityReport = {
  shots: number;
  /** Mid-chapter wides (establishing shots other than the first and the last). */
  wides: number;
  /** Longest stretch (s) without a wide, from the end of the opening to the closing shot. */
  maxWideGap: number;
  /** Longest frameGroup shot (s) and the mean. */
  maxShot: number;
  meanShot: number;
  /** Stretches > `limit` s in which every framed person is idle while someone else works, and the longest such run. */
  idleStretches: number;
  maxIdleRun: number;
  /** frameGroup shots shorter than 10 s. */
  shortShots: number;
};

/**
 * Activity audit of a planned shot list against the take (for any planner: the shipped W31 shots too). A frameGroup
 * sample is "idle framing" when none of its subjects works and someone outside the shot does.
 */
export function shotActivityReport(shots: { t0: number; t1: number; spec: ShotSpec }[], grid: ActivityGrid, limit = 20): ShotActivityReport {
  const K = (t: number) => Math.min(grid.n - 1, Math.max(0, Math.round(t / grid.dt)));
  const idx = new Map(grid.crew.map((c, i) => [c, i]));
  let short = 0, wides = 0, maxGap = 0, lastWide = shots.length ? shots[0].t1 : 0, maxShot = 0, sumShot = 0, nShot = 0, stretches = 0, maxRun = 0;
  shots.forEach((s, i) => {
    if (s.spec.kind === 'establishing' && i > 0 && i < shots.length - 1) {
      wides++;
      maxGap = Math.max(maxGap, s.t0 - lastWide);
      lastWide = s.t1;
    }
    if (i === shots.length - 1) maxGap = Math.max(maxGap, s.t0 - lastWide);
    if (s.spec.kind !== 'frameGroup') return;
    const len = s.t1 - s.t0;
    if (len < 10) short++;
    maxShot = Math.max(maxShot, len);
    sumShot += len;
    nShot++;
    const subj = s.spec.subjects.map((p) => idx.get(p)).filter((x): x is number => x !== undefined);
    const others = grid.crew.map((_, j) => j).filter((j) => !subj.includes(j));
    let run = 0;
    for (let k = K(s.t0); k < K(s.t1); k++) {
      const idle = !subj.some((j) => grid.active[j][k]) && others.some((j) => grid.active[j][k]);
      run = idle ? run + grid.dt : 0;
      if (idle && run > limit && run - grid.dt <= limit) stretches++;
      maxRun = Math.max(maxRun, run);
    }
  });
  return { shots: shots.length, wides, maxWideGap: maxGap, maxShot, meanShot: nShot ? Math.round((sumShot / nShot) * 10) / 10 : 0, idleStretches: stretches, maxIdleRun: maxRun, shortShots: short };
}
