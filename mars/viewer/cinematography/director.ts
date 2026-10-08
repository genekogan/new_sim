import type {
  Observation,
  Policy,
  Shot,
  OperatorIntent,
  Decision,
  Reply,
  Request,
} from './types.ts';
import { feasibleShotSteps,trackSelectedShot,drain } from './shots.ts';
import {renderProgram,type RenderProbe} from './types.ts';
import { execute, withObservationWorlds } from './physical.ts';
import type { CameraPose, SubjectPose } from '../engine/camera/shots.ts';
export const POLICY = {
  clear: { hold: 4, threshold: 0.65 },
  restrained: { hold: 9, threshold: 1.1 },
  continuous: { hold: Infinity, threshold: Infinity },
};
export function rankShot(
  s: Shot,
  o: Observation,
  policy: Policy,
  recent: string[],
): number {
  let score = s.quality * 2;
  const focus = o.activity.focus ?? o.activity.speaker;
  const floorActive = [
    'presenting',
    'question',
    'conversing',
    'working',
  ].includes(o.activity.phase);
  if (policy === 'continuous')
    return (
      s.quality * 2 +
      (s.intention === 'follow' &&
      s.subjects[0] === (focus ?? o.activity.members[0])
        ? 10
        : 0)
    );
  if (policy === 'clear') {
    if (s.intention === 'questioner' && s.subjects[0] === focus && floorActive)
      score += 4;
    else if (
      s.intention === 'speaker-display' &&
      s.subjects[0] === focus &&
      floorActive
    )
      score += 3;
    else if (
      s.intention === 'speaker' &&
      s.subjects[0] === focus &&
      floorActive
    )
      score += 2.5;
    else if (
      s.intention === 'follow' &&
      s.subjects[0] === focus &&
      o.activity.phase === 'walking'
    )
      score += 3;
    else if (s.intention === 'establishing') score += 1;
  } else {
    if (
      s.intention === 'two-person' &&
      s.subjects.includes(focus ?? '') &&
      floorActive
    )
      score += 4;
    else if (s.intention === 'establishing') score += 2.6;
    else if (s.intention === 'speaker-display') score += 1.7;
  }
  if (o.activity.phase === 'arriving' || o.activity.phase === 'departing') {
    if (s.intention === 'establishing') score += 3;
  }
  if (focus && s.subjects.includes(focus)) score += 0.5;
  if (recent.slice(-2).includes(s.id)) score -= 0.25;
  return score;
}
/** Outcome of one decision's candidate search (see Director.search). */
type Search = { shots: Shot[]; ok: (s: Shot) => boolean; relaxed: boolean; strict: boolean };
/** A decision search in progress across display frames (Director.advance). */
type Pending = { o: Observation; epoch: number; policy: Policy; started: number; restarts: number; steps: Generator<void, Search, void> };
/** A search (even restarted for a newer activity) completes within this many
 * seconds of simulation time from its first start, or after this many
 * restarts, so neither a long search nor activity churn starves selection. */
const PENDING_MAX_SECONDS = 0.15, PENDING_MAX_RESTARTS = 3;
/** Recovery reuses a completed search at most this old (decisions run at 10 Hz). */
const RECOVER_MAX_SECONDS = 0.35;
/** Choices re-solved per selection before deciding afresh. */
const SELECT_TRIES = 3;
/** Look this far ahead when a held framing is lost to a moving subject. */
const AHEAD_SECONDS = 0.6;
/** Subjects of `now` moved on by their velocity since `before` (only those
 * that moved; undefined when nothing moved or the interval is too short). */
function ahead(before: Observation, now: Observation): Record<string, SubjectPose> | undefined {
  const span = now.time - before.time;
  if (!(span >= 0.04)) return;
  let moved = false;
  const out: Record<string, SubjectPose> = {};
  for (const [id, s] of Object.entries(now.subjects)) {
    const b = before.subjects[id];
    const d = b ? [0, 1, 2].map((k) => ((s.p[k] - b.p[k]) / span) * AHEAD_SECONDS) : [0, 0, 0];
    if (Math.hypot(d[0], d[2]) > 0.05) moved = true;
    const shift = (q: readonly number[]) => q.map((v, k) => v + d[k]) as [number, number, number];
    out[id] = { ...s, p: shift(s.p), ...(s.points ? { points: s.points.map(shift) } : {}),
      ...(s.framingPoints ? { framingPoints: s.framingPoints.map(shift) } : {}) };
  }
  return moved ? out : undefined;
}
export class Director {
  policy: Policy;
  session = '';
  epoch = 0;
  current?: Shot;
  pose?: CameraPose;
  since = 0;
  lastTime = 0;
  operator?: OperatorIntent;
  recent: string[] = [];
  decisions: Decision[] = [];
  diagnostics: string[] = [];
  selectedId?: string;
  shots: Shot[] = [];
  observation?: Observation;
  external?: { reply: Reply; request: Request };
  autoFollow?: string;
  note(message: string) {
    if (this.diagnostics.at(-1) !== message) this.diagnostics.push(message);
    if (this.diagnostics.length > 128) this.diagnostics.shift();
  }
  private visibility?:RenderProbe;
  // Subject-side score only: used while no shot passes the full program rule
  // (relaxed), so held framing is not re-searched on every display frame.
  private relaxed=false;
  private subjectSide?:RenderProbe;
  private probe(){return this.relaxed?this.subjectSide:this.visibility;}
  constructor(policy: Policy = 'clear',visibility?:RenderProbe) {
    this.policy = policy;this.visibility=visibility;
    this.subjectSide=visibility&&((pose,ids,subjects)=>visibility(pose,ids,subjects));
  }
  reset(session: string) {
    this.session = session;
    this.epoch++;
    this.current = undefined;
    this.selectedId = undefined;
    this.pose = undefined;
    this.since = 0;
    this.lastTime = 0;
    this.operator = undefined;
    this.recent = [];
    this.decisions = [];
    this.diagnostics = [];
    this.external = undefined;
    this.autoFollow = undefined;
    this.relaxed = false;
    this.pending = undefined;
    this.lastSearch = undefined;
  }
  takeover(intent: OperatorIntent) {
    this.operator = structuredClone(intent);
    this.epoch++;
    this.pending = undefined;
    this.external = undefined;
  }
  release() {
    this.operator = undefined;
    this.epoch++;
    this.external = undefined;
    this.since = -Infinity;
    this.pending = undefined;
  }
  request(): Request | undefined {
    const o = this.observation;
    if (
      !o ||
      this.operator ||
      this.shots.length === 0 ||
      this.policy === 'continuous'
    )
      return;
    return {
      session: this.session,
      version: o.semanticVersion,
      epoch: this.epoch,
      time: o.time,
      policy: this.policy,
      current: this.current?.id,
      heldSeconds: o.time - this.since,
      canCut: o.time - this.since >= POLICY[this.policy].hold,
      recent: [...this.recent],
      activity: structuredClone(o.activity),
      candidates: this.shots
        .slice(0, 12)
        .map(({ id, intention, subjects, quality, reasons }) => ({
          id,
          intention,
          subjects: [...subjects],
          quality,
          reasons: [...reasons],
        })),
    };
  }
  accept(reply: Reply, request: Request) {
    this.external = { reply, request };
  }
  /** Between unchanged causal ticks, advance the selected safe shot only.
   * Selection, advisory acceptance and editorial holds stay on update(). */
  track(o: Observation, movementDt: number) {
    return withObservationWorlds(o, () => this.trackNow(o, movementDt));
  }
  /** live: recover from the latest completed search (advance) rather than
   * a full decision on this frame. */
  private trackNow(o: Observation, movementDt: number, live = false) {
    if (!this.current || this.operator) return this.update(o, movementDt);
    const dt = Number.isFinite(movementDt) ? Math.min(0.1, Math.max(0, movementDt)) : 0;
    const held=trackSelectedShot(o,this.current,this.probe());
    const recover = () => live ? this.recover(o, movementDt) : this.update(o, movementDt);
    if(!held)return recover();
    const outcome = execute(o, this.pose, held.pose, false, dt, held.subjects,this.probe());
    // Recovery must use the ordinary selection/logging path, including cuts.
    if (!outcome.pose || outcome.cut) return recover();
    this.current=held;
    this.pose = outcome.pose;
    return { ...outcome, shot: this.selectedId };
  }
  /** Time-sliced decision for a live display (one call per frame).
   * `start` asks for a new decision on this frame (`restart` also drops a
   * search begun on an older activity). The candidate search runs in slices
   * while `more()` allows (at least one slice per call); until it completes
   * the selected shot keeps tracking every frame (track). On completion the
   * choice made from the search's observation is re-solved and fully
   * re-validated on this frame's observation before it is applied.
   * Without a held shot, under an operator, or on any session/aspect change,
   * this is exactly update(). */
  advance(o: Observation, movementDt: number, start: boolean, restart: boolean, more: () => boolean) {
    return withObservationWorlds(o, () => this.advanceNow(o, movementDt, start, restart, more));
  }
  /** A candidate search is in progress (started by advance). */
  get searching() { return !!this.pending; }
  private pending?: Pending;
  /** The latest completed search, for recovery between decisions. */
  private lastSearch?: { o: Observation; epoch: number; policy: Policy; search: Search };
  /** The held framing failed on this frame (live): select again over the
   * latest search, every choice re-solved and checked on this frame; a full
   * decision only when none of it holds. Same selection/logging path. */
  private recover(o: Observation, movementDt: number) {
    // A decision already under way completes now and is the one applied, so
    // recovery and that decision never cut twice in a row.
    const pending = this.pending;
    this.pending = undefined;
    if (pending && pending.epoch === this.epoch)
      this.lastSearch = { o: pending.o, epoch: pending.epoch, policy: pending.policy,
        search: withObservationWorlds(pending.o, () => drain(pending.steps)) };
    const last = this.lastSearch, failed = this.current;
    if (!last || last.epoch !== this.epoch || o.time < last.o.time || o.time - last.o.time > RECOVER_MAX_SECONDS)
      return this.update(o, movementDt);
    this.observation = o;
    const dt = this.advanceClock(o, movementDt);
    return this.selectFresh(last.o, o, dt, last.policy, last.search, failed, ahead(last.o, o)) ?? this.update(o, movementDt);
  }
  /** select() on `now` over a search made on `o`. A choice that no longer
   * holds on `now` (or the failed held framing) is replaced by that shot's
   * own framings solved on `now` under the search's rules, so the editorial
   * choice survives a stale variant; then select again (bounded). */
  private selectFresh(o: Observation, now: Observation, dt: number, policy: Policy, search: Search, failed?: Shot,
    future?: Record<string, SubjectPose>) {
    const fresh = new Set<Shot>();
    let shots = search.shots;
    const ok = (s: Shot) => fresh.has(s)
      ? search.relaxed || renderProgram(this.visibility, s.pose, s.subjects, now.subjects)
      : search.ok(s);
    const replace = (bad: Shot) => {
      if (fresh.has(bad)) { shots = shots.filter((s) => s !== bad); return; }
      const own = drain(feasibleShotSteps(now, bad, policy, this.visibility, search.strict, bad.id, future));
      for (const s of own) fresh.add(s);
      shots = [...own, ...shots.filter((s) => s.id !== bad.id)];
    };
    if (failed) replace(failed);
    const external = this.external;
    for (let tries = 0; tries < SELECT_TRIES; tries++) {
      this.stale = undefined;
      const r = this.select(o, now, dt, policy, { ...search, shots, ok });
      // No program pose from earlier work: decide afresh on this frame (the
      // full rules, incl. the strict/relaxed sightline fallback).
      if (r && !r.pose) { this.external = external; return; }
      if (r || !this.stale) return r;
      replace(this.stale);
    }
    return undefined;
  }
  private stale?: Shot;
  private advanceNow(o: Observation, movementDt: number, start: boolean, restart: boolean, more: () => boolean) {
    if (!this.current || this.operator || this.session !== o.session || o.time < this.lastTime ||
      !Number.isFinite(o.aspect) || o.aspect < 0.25 || o.aspect > 4) {
      this.pending = undefined;
      return start || !this.current ? this.update(o, movementDt) : this.trackNow(o, movementDt);
    }
    if (start && (!this.pending || restart)) {
      const started = this.pending?.started ?? o.time, restarts = this.pending ? this.pending.restarts + 1 : 0;
      this.pending = { o, epoch: this.epoch, policy: this.policy, started, restarts, steps: this.search(o, this.policy) };
    }
    const pending = this.pending;
    if (!pending) return this.trackNow(o, movementDt, true);
    // Bounded lag: a search running (or restarted) for too long completes now.
    const finish = o.time - pending.started >= PENDING_MAX_SECONDS || pending.restarts >= PENDING_MAX_RESTARTS;
    let r = withObservationWorlds(pending.o, () => pending.steps.next());
    while (!r.done && (finish || more())) r = withObservationWorlds(pending.o, () => pending.steps.next());
    if (!r.done) return this.trackNow(o, movementDt, true);
    this.pending = undefined;
    if (pending.epoch !== this.epoch) return this.update(o, movementDt);
    this.lastSearch = { o: pending.o, epoch: pending.epoch, policy: pending.policy, search: r.value };
    this.observation = o;
    const dt = this.advanceClock(o, movementDt);
    return this.selectFresh(pending.o, o, dt, pending.policy, r.value) ?? this.update(o, movementDt);
  }
  /** Candidate search for one decision: feasible shots, the camera-side
   * sightline rule (memoised), and the strict re-search when nothing passes. */
  private *search(o: Observation, policy: Policy): Generator<void, Search, void> {
    const visibility = this.visibility;
    let shots = yield* feasibleShotSteps(o, this.current, policy, visibility);
    // Camera-side sightline (single-sided shells) only for shots actually
    // considered for the program, best first; memoised for this decision.
    const seen = new Map<Shot, boolean>();
    let ok = (s: Shot) => {
      if (!seen.has(s)) seen.set(s, renderProgram(visibility, s.pose, s.subjects, o.subjects));
      return seen.get(s)!;
    };
    // Every candidate faces a drawn shell from outside: search again with the
    // camera-side rule per candidate, which also enables indoor alternates.
    let relaxed = false;
    if (visibility?.seen && shots.length && !shots.some(ok)) {
      yield;
      const strict = yield* feasibleShotSteps(o, this.current, policy, visibility, true);
      // Nothing passes either way (e.g. a Soul embedded in scenery): keep
      // the ordinary subject-side choice rather than leaving no program.
      if (strict.some(ok)) { shots = strict; return { shots, ok, relaxed, strict: true }; }
      ok = () => true; relaxed = true;
    }
    return { shots, ok, relaxed, strict: false };
  }
  update(o: Observation, movementDt?: number): {
    pose?: CameraPose;
    cut: boolean;
    shot?: string;
    reason: string;
  } {
    return withObservationWorlds(o, () => this.updateNow(o, movementDt));
  }
  private updateNow(o: Observation, movementDt?: number): {
    pose?: CameraPose;
    cut: boolean;
    shot?: string;
    reason: string;
  } {
    this.pending = undefined;
    if (this.session !== o.session || o.time < this.lastTime)
      this.reset(o.session);
    this.observation = o;
    if (!Number.isFinite(o.aspect) || o.aspect < 0.25 || o.aspect > 4) {
      this.shots = [];
      this.external = undefined;
      const reason =
        'camera.aspect-unsupported: render aspect must be between 0.25 and 4';
      this.note(reason);
      return { cut: false, reason };
    }
    // Editorial holds/expiry use causal simulation time. A live display may
    // advance camera motion between fixed engine ticks using its frame delta;
    // replay callers retain the original deterministic simulation-time path.
    const dt = this.advanceClock(o, movementDt);
    if (this.operator && o.time >= this.operator.expires) this.release();
    const policy = this.operator?.policy ?? this.policy;
    const search = drain(this.search(o, policy));
    this.lastSearch = { o, epoch: this.epoch, policy, search };
    return this.select(o, o, dt, policy, search)!;
  }
  private advanceClock(o: Observation, movementDt?: number) {
    const elapsed = movementDt ?? o.time - this.lastTime;
    this.lastTime = o.time;
    return Number.isFinite(elapsed) ? Math.min(0.1, Math.max(0, elapsed)) : 0;
  }
  /** Editorial selection over a completed search made on observation `o`,
   * applied on observation `now` (the same object for update()). When they
   * differ, the chosen shot is re-solved on `now` with every program check;
   * undefined means it no longer holds there (the caller decides afresh). */
  private select(o: Observation, now: Observation, dt: number, policy: Policy, search: Search): {
    pose?: CameraPose;
    cut: boolean;
    shot?: string;
    reason: string;
  } | undefined {
    const { ok, shots } = search;
    const external = this.external;
    this.relaxed = search.relaxed;
    this.shots = shots;
    let list = shots;
    if (this.operator?.subject)
      list = list.filter((s) => s.subjects.includes(this.operator!.subject!));
    if (this.operator?.shot)
      list = list.filter((s) => s.intention === this.operator!.shot);
    const rank = (s: Shot) =>
      rankShot(s, o, policy, this.recent) +
      (this.operator?.subject && s.subjects[0] === this.operator.subject
        ? 4
        : 0) +
      (this.operator?.subject && s.subjects.length === 1 ? 2 : 0);
    let best = [...list].sort(
      (a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id),
    ).find(ok);
    if (policy === 'continuous' && !this.operator) {
      if (!this.autoFollow || !o.subjects[this.autoFollow])
        this.autoFollow =
          o.activity.focus ?? o.activity.speaker ?? o.activity.members[0];
      best = shots.find((s) => s.id === `follow:${this.autoFollow}` && ok(s)) ?? best;
    }
    if (!best && this.operator && !this.operator.pose) {
      this.note(
        'camera.operator-unavailable: requested framing has no feasible candidate',
      );
    }
    if (!best) best = shots.find((s) => s.id === 'context' && ok(s)) ?? shots.find(ok);
    const current = shots.find((s) => s.id === this.current?.id && ok(s));
    const held = now.time - this.since,
      constraints = POLICY[policy];
    let reason = 'local semantic coverage';
    let source: Decision['source'] = this.operator ? 'operator' : 'local';
    if (
      current &&
      current.valid &&
      !this.operator &&
      policy !== 'continuous' &&
      (held < constraints.hold ||
        !best ||
        rankShot(best, o, policy, this.recent) -
          rankShot(current, o, policy, this.recent) <
          constraints.threshold)
    )
      best = current;
    if (this.external) {
      const { reply, request } = this.external;
      this.external = undefined;
      if (
        request.session !== now.session ||
        request.epoch !== this.epoch ||
        request.version !== now.semanticVersion ||
        this.operator
      )
        this.note('camera.external-stale: obsolete decision discarded');
      else {
        const pick =
          reply.choice === 'HOLD'
            ? current
            : shots.find((s) => s.id === reply.choice && ok(s));
        if (!pick)
          this.note('camera.external-invalid: candidate no longer feasible');
        else if (
          !current ||
          held >= constraints.hold ||
          pick.id === current.id
        ) {
          best = pick;
          source = 'external';
          reason = `accepted ${reply.model} choice`;
        }
      }
    }
    if (o !== now && best && !this.operator) {
      // Searched on an earlier frame: the same shot and variant, solved and
      // checked (safety, readability, visibility, clearance, sightline) on now.
      const fresh = trackSelectedShot(now, best, this.probe());
      if (!fresh) { this.external = external; this.stale = best; return; }
      best = fresh;
    }
    const desired =
      this.operator?.pose ??
      (this.operator?.movement === 'still' && this.pose
        ? this.pose
        : best?.pose);
    if (!desired)
      return {
        cut: false,
        reason: 'camera.no-feasible-view: retain view with explicit limitation',
      };
    const selectedId = this.operator?.pose ? 'manual-pose' : best?.id;
    const changed = selectedId !== this.selectedId;
    const outcome = execute(
      now,
      this.pose,
      desired,
      changed,
      dt,
      this.operator?.pose ? [] : (best?.subjects ?? []),
      this.probe(),
    );
    if (!outcome.pose) {
      this.note(outcome.reason);
      return outcome;
    }
    if (changed || outcome.cut || source === 'external') {
      this.decisions.push({
        time: now.time,
        tick: now.tick,
        session: now.session,
        semanticVersion: now.semanticVersion,
        epoch: this.epoch,
        shot: selectedId ?? 'context',
        source,
        reason: `${reason}; ${outcome.reason}`,
        cut: outcome.cut,
        pose: structuredClone(outcome.pose),
      });
      if (changed || outcome.cut) this.since = now.time;
      if (changed) {
        this.recent.push(selectedId ?? 'context');
        this.recent = this.recent.slice(-8);
      }
    }
    if (this.decisions.length > 2048) this.decisions.shift();
    this.current = best;
    this.selectedId = selectedId;
    this.pose = outcome.pose;
    return { ...outcome, shot: selectedId };
  }
}
