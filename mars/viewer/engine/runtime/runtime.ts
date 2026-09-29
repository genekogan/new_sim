// Fixed-step authoritative runtime. The same class runs rehearsals (in Node
// tests or a forked room), official execution (Durable Object) and local
// previews — there is no second "fast path" implementation (spec §16).
import type { ActionDef, ActionRecord, ActionStatus, Diagnostic, Reservation, StepResult } from '../actions/types.ts';
import type { WorldState } from '../world/types.ts';
import { hashOf } from '../core/hash.ts';
import { Profiler } from './profile.ts';
import { deadlockDiagnostics, exhaustedWaitMovers, recoverPersistentWaits } from './waits.ts';
import { applySnapshot, decodeSnapshot, SnapshotError, takeSnapshot, type RuntimeInternals, type RuntimeSnapshot, type SnapshotOptions } from './snapshot.ts';

export const DT = 1 / 20; // seconds per tick; changing this is a rules-version change

export type Violation = Diagnostic & { tick: number };

export interface RuntimeObserver {
  onTick?(rt: Runtime): void;
  onEvent?(rt: Runtime, e: RuntimeEvent): void;
}

export type RuntimeEvent =
  | { tick: number; type: 'action'; id: string; verb: string; status: ActionStatus; phase?: string; code?: string; message?: string }
  | { tick: number; type: 'violation'; code: string; message: string; subjects?: string[] }
  | { tick: number; type: 'mark'; name: string; data?: unknown };

/** Invariant checks run at the end of every tick; violations are recorded, never hidden. */
export type Invariant = (rt: Runtime) => Diagnostic[];
/** The room's service bag: `spatial` plus per-module slots each owner installs and reads back with its own type
 *  (walk.ts walkExecs/traffic/replanBudget, carry loadDiscs/carryExecs, vehicles vehicleLanes, …). Deliberately the one
 *  untyped seam: app/lab code reads `services.spatial` directly while bare-verb tests pass `{}`, so a typed-slot
 *  interface needs those callers changed too (LAST_MILE LM-149 note). */
// oxlint-disable-next-line typescript/no-explicit-any -- heterogeneous per-module slots, see above
export type RuntimeServices = Record<string, any>;

/** `prior`: phase of each reserved entity before start(), restored if the action fails / is cancelled before using it. */
type Phase = WorldState['entities'][string]['phase'];
type Live = { rec: ActionRecord; def: ActionDef; exec: unknown; program: unknown; cancelling?: boolean; prior: Map<string, Phase>; reason?: Diagnostic }; // = snapshot.ts LiveEntry
/** A directed submission parked until the social holds it pre-empted have ended (SOCIAL.md "Pre-emption"). */
type Waiting = { rec: ActionRecord; def: ActionDef; params: unknown; parent?: string; holds: string[] };

export class Runtime {
  readonly records = new Map<string, ActionRecord>();
  readonly events: RuntimeEvent[] = [];
  readonly violations: Violation[] = [];
  private live = new Map<string, Live>();
  private owners = new Map<string, { action: string; mode: 'exclusive' | 'shared' }[]>();
  /** Directed submissions waiting for pre-empted social holds to end (empty unless pre-emption happened). */
  private waiting = new Map<string, Waiting>();
  private nextId = 1;
  observers: RuntimeObserver[] = [];
  /** Opt-in profiler (see `profile`); null when off. Measurement only, never read by the simulation. */
  prof: Profiler | null = null;

  world: WorldState;
  registry: Map<string, ActionDef>;
  services: RuntimeServices;
  invariants: Invariant[];
  constructor(world: WorldState, registry: Map<string, ActionDef>, services: RuntimeServices, invariants: Invariant[] = []) {
    canonicalEntityOrder(world);
    this.world = world;
    this.registry = registry;
    this.services = services;
    this.invariants = invariants;
  }

  get tick() {
    return this.world.tick;
  }
  get time() {
    return this.world.tick * DT;
  }

  /** `rt.profile = true` accumulates wall ms per `<verb>.plan` / `<verb>.step`, `invariants`, and (via
   *  `services.spatial.prof`) per Spatial method. Turning it off drops the profiler. */
  get profile() {
    return this.prof !== null;
  }
  set profile(on: boolean) {
    this.prof = on ? (this.prof ?? new Profiler()) : null;
    const sp = this.services.spatial;
    if (sp && typeof sp === 'object') sp.prof = this.prof ?? undefined;
  }

  /**
   * requested → validated → reserved → executing, or a diagnostic failure.
   * Pre-emption (spec §17, SOCIAL.md): a directed action for someone held by a social action (a def
   * with `yieldTo`) releases that hold first — cancelled with reason `pre-empted by <id>` — and, if
   * the release takes ticks (a seated person's stand-up), waits (status `requested`, phase
   * `pre-empting`) and is planned + started at the end of the tick the hold ends. Opt out with
   * `opts.preempt: false` or a boolean `preempt: false` key in params (stripped before validation):
   * the directive then fails `reservation.conflict` as before.
   */
  submit(verb: string, params: unknown, opts: { id?: string; parent?: string; preempt?: boolean } = {}): ActionRecord {
    const id = opts.id ?? `a${this.nextId++}`;
    const rec: ActionRecord = { id, verb, params, status: 'requested', history: [], requestedTick: this.tick, parent: opts.parent };
    this.records.set(id, rec);
    this.emit(rec, 'requested');
    const def = this.registry.get(verb);
    if (!def) return this.fail(rec, { code: 'action.unknown-verb', message: `no action verb "${verb}"` });
    let preempt = opts.preempt !== false;
    if (params && typeof params === 'object' && !Array.isArray(params) && typeof (params as { preempt?: unknown }).preempt === 'boolean') {
      const { preempt: flag, ...rest } = params as { preempt: boolean };
      preempt &&= flag;
      params = rest;
    }
    const parsed = def.schema.safeParse(params);
    if (!parsed.success)
      return this.fail(rec, {
        code: 'action.invalid-params',
        message: `invalid parameters for ${verb}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      });
    rec.params = parsed.data;
    const holds = preempt ? this.preemptible(def, parsed.data, rec, opts.parent) : null;
    if (holds) {
      const reason: Diagnostic = { code: 'social.pre-empted', message: `pre-empted by ${id} (${verb})`, subjects: [id], details: { reason: `pre-empted by ${id}`, by: id } };
      for (const h of holds) this.cancel(h, reason);
      const refused = holds.find((h) => this.live.has(h) && !this.live.get(h)!.cancelling);
      if (refused) {
        const other = this.records.get(refused)!;
        return this.fail(rec, { code: 'reservation.conflict', message: `${other.verb} ${refused} refused to release its people for ${id}: ${other.diagnostic?.message ?? 'cancel refused'}`, subjects: [refused], details: { holder: refused } });
      }
      const still = holds.filter((h) => this.live.has(h));
      if (still.length) {
        this.waiting.set(id, { rec, def, params: parsed.data, parent: opts.parent, holds: still });
        this.emit(rec, 'requested', undefined, 'pre-empting');
        return rec;
      }
    }
    return this.admit(rec, def, parsed.data, opts.parent);
  }

  /** validated → reserved → executing (plan, reserve, start), or a diagnostic failure. */
  private admit(rec: ActionRecord, def: ActionDef, params: unknown, parent?: string): ActionRecord {
    const id = rec.id, verb = rec.verb, opts = { parent };
    const parsed = { data: params };
    const prof = this.prof;
    const t0 = prof ? prof.now() : 0;
    const plan = def.plan(this, parsed.data);
    if (prof) prof.add(`${verb}.plan`, prof.now() - t0);
    if (!plan.ok) return this.fail(rec, plan.diagnostic);
    this.emit(rec, 'validated');
    const res = def.reservations(this.world, parsed.data);
    const conflict = this.reservationConflict(res, opts.parent);
    if (conflict) return this.fail(rec, conflict);
    for (const r of res) {
      const list = this.owners.get(r.resource) ?? [];
      list.push({ action: id, mode: r.mode });
      this.owners.set(r.resource, list);
    }
    this.emit(rec, 'reserved');
    const prior = new Map<string, Phase>();
    for (const r of res)
      if (r.resource.startsWith('entity:')) {
        const eid = r.resource.slice('entity:'.length);
        if (this.world.entities[eid]) prior.set(eid, this.world.entities[eid].phase);
      }
    const exec = def.start(this, parsed.data, plan.program, id);
    this.live.set(id, { rec, def, exec, program: plan.program, prior });
    this.emit(rec, 'executing');
    return rec;
  }

  /** `reason` (optional) is recorded as the cancelled action's diagnostic and on its events (e.g. `social.pre-empted`). */
  cancel(id: string, reason?: Diagnostic): ActionRecord {
    const l = this.live.get(id);
    const rec = this.records.get(id);
    if (!rec) throw new Error(`unknown action ${id}`);
    if (this.waiting.has(id)) {
      // a directive still waiting for a pre-empted hold: it never started, so nothing to undo
      this.waiting.delete(id);
      rec.diagnostic = reason;
      rec.endedTick = this.tick;
      this.emit(rec, 'cancelled', reason);
      return rec;
    }
    if (!l) return rec;
    const r = l.def.cancel(this, l.exec);
    if (!r.ok) {
      rec.diagnostic = r.diagnostic;
      this.emit(rec, rec.status, r.diagnostic);
      return rec;
    }
    // A successful retry supersedes any earlier unsafe-cancel diagnostic.
    rec.diagnostic = reason;
    if (r.deferred) {
      // controlled stop in progress (e.g. set-down); the action finishes as 'cancelled'
      l.cancelling = true;
      if (reason) l.reason = reason;
      this.emit(rec, rec.status, reason, 'cancelling');
      return rec;
    }
    this.finish(l, 'cancelled', reason);
    return rec;
  }

  /** Advance one fixed tick: step live actions in submission order, then check invariants. */
  step() {
    this.world.tick++;
    const deferred = new Map<Live, StepResult>();
    for (const l of Array.from(this.live.values())) {
      if (!this.live.has(l.rec.id)) continue; // finished earlier this tick (e.g. cancelled with its failed parent)
      const prof = this.prof;
      const t0 = prof ? prof.now() : 0;
      const r = l.def.step(this, l.exec, DT);
      if (prof) prof.add(`${l.rec.verb}.step`, prof.now() - t0);
      // Keep an existing persistent diagnostic stable until every mover has published this tick.
      if (l.rec.diagnostic?.code.startsWith('deadlock.') && (r.status === 'running' || r.status === 'blocked')) {
        deferred.set(l, r);
        continue;
      }
      if (r.status === 'running') {
        if (l.rec.status !== 'executing' || r.phase !== l.rec.phase) {
          l.rec.diagnostic = undefined;
          this.emit(l.rec, 'executing', undefined, r.phase);
        }
      } else if (r.status === 'completed') {
        l.rec.outputs = r.outputs;
        this.finish(l, l.cancelling ? 'cancelled' : 'completed', l.cancelling ? l.reason : undefined);
      } else if (r.status === 'blocked') {
        if (l.rec.status !== 'blocked' || l.rec.diagnostic?.code !== r.diagnostic.code) this.emit(l.rec, 'blocked', r.diagnostic);
        l.rec.diagnostic = r.diagnostic;
      } else {
        l.rec.diagnostic = r.diagnostic;
        this.finish(l, 'failed', r.diagnostic);
      }
    }
    recoverPersistentWaits(this, (owner, mover) => {
      const l = this.live.get(owner);
      return l?.def.recoverWait?.(this, l.exec, mover) ?? { status: 'unavailable', diagnostic: { code: 'deadlock.recovery-unavailable', message: `no safe recovery hook for ${owner}/${mover}`, subjects: [mover] } };
    });
    const deadlocks = deadlockDiagnostics(this);
    for (const [l, r] of deferred) {
      if (!this.live.has(l.rec.id)) continue; // another action may have cancelled it later in this tick
      if (deadlocks.has(l.rec.id)) continue;
      if (r.status === 'running') {
        l.rec.diagnostic = undefined;
        this.emit(l.rec, 'executing', undefined, r.phase);
      } else if (r.status === 'blocked') {
        l.rec.diagnostic = r.diagnostic;
        this.emit(l.rec, 'blocked', r.diagnostic);
      }
    }
    for (const [id, diagnostic] of deadlocks) {
      const rec = this.records.get(id)!;
      if (rec.status !== 'blocked' || rec.diagnostic?.code !== diagnostic.code) this.emit(rec, 'blocked', diagnostic);
      rec.diagnostic = diagnostic;
    }
    if (this.waiting.size) this.admitWaiting();
    const ti = this.prof ? this.prof.now() : 0;
    for (const inv of this.invariants)
      for (const d of inv(this)) {
        this.violations.push({ ...d, tick: this.tick });
        this.events.push({ tick: this.tick, type: 'violation', code: d.code, message: d.message, subjects: d.subjects });
      }
    if (this.prof) this.prof.add('invariants', this.prof.now() - ti);
    for (const o of this.observers) o.onTick?.(this);
  }

  /** Conservative early-stop proof: all live roots, children and ambient actions must certify every internal mover. */
  exhaustedWaitDiagnostics(): Diagnostic[] | null {
    if (!this.live.size || this.waiting.size) return null;
    const movers = exhaustedWaitMovers(this);
    const diagnostics: Diagnostic[] = [];
    for (const l of this.live.values()) {
      if (l.cancelling || !l.rec.diagnostic?.code.startsWith('deadlock.') || !l.def.waitQuiescent?.(this, l.exec, movers)) return null;
      diagnostics.push(l.rec.diagnostic);
    }
    return diagnostics;
  }

  /** Step until all given (or all) actions are terminal, or a tick budget is exhausted. */
  runUntilIdle(maxTicks = 20 * 60 * 30, ids?: string[]) {
    const pending = () => (ids ? ids.some((i) => this.isActive(i)) : this.live.size + this.waiting.size > 0);
    let n = 0;
    while (pending() && n++ < maxTicks) this.step();
    return !pending();
  }

  /** Live, or a directive waiting for a pre-empted social hold to end. */
  isActive(id: string) {
    return this.live.has(id) || this.waiting.has(id);
  }
  holder(resource: string) {
    return this.owners.get(resource)?.map((o) => o.action) ?? [];
  }
  mark(name: string, data?: unknown) {
    const e: RuntimeEvent = { tick: this.tick, type: 'mark', name, data };
    this.events.push(e);
    for (const o of this.observers) o.onEvent?.(this, e);
  }
  stateHash() {
    return hashOf(this.world);
  }

  /**
   * Resumable mid-action checkpoint (runtime/snapshot.ts, spec §22): world, records, live execs,
   * reservations, plain-data services, navigation epoch. Throws a SnapshotError naming every live
   * action that is not resumable, unless `allowDrop` (then they are left out and reported).
   */
  snapshot(opts?: SnapshotOptions): RuntimeSnapshot {
    if (this.waiting.size) {
      const ids = [...this.waiting.keys()];
      throw new SnapshotError('snapshot.pre-empting', `cannot snapshot while ${ids.join(', ')} ${ids.length > 1 ? 'wait' : 'waits'} for pre-empted social holds to end (${[...this.waiting.values()].flatMap((w) => w.holds).join(', ')}); step until they have started`, ids);
    }
    return takeSnapshot(this, this.internals(), opts);
  }

  /** Rebuild a runtime from a snapshot; stepping it matches stepping the paused original tick for tick.
   *  `services` must be this runtime's own (a fresh Spatial for the same base scene). */
  static restore(snap: RuntimeSnapshot, registry: Map<string, ActionDef>, services: RuntimeServices, invariants: Invariant[] = []): Runtime {
    const g = decodeSnapshot(snap);
    const rt = new Runtime(g.world, registry, services, invariants);
    applySnapshot(rt, rt.internals(), snap, g);
    return rt;
  }

  private internals(): RuntimeInternals {
    const getNextId = () => this.nextId;
    const setNextId = (n: number) => {
      this.nextId = n;
    };
    return {
      live: this.live,
      owners: this.owners,
      get nextId() {
        return getNextId();
      },
      set nextId(n: number) {
        setNextId(n);
      },
      forceFinish: (l, status, d) => {
        l.rec.diagnostic = d;
        this.finish(l, status, d);
      },
    };
  }

  /** Resources held by `parent` (or its ancestors) are delegable to child actions (hierarchical tasks). */
  private reservationConflict(res: Reservation[], parent?: string): Diagnostic | null {
    const ancestors = new Set<string>();
    for (let p = parent; p; p = this.records.get(p)?.parent) ancestors.add(p);
    for (const r of res) {
      for (const o of this.owners.get(r.resource) ?? []) {
        if (ancestors.has(o.action)) continue;
        if (r.mode === 'exclusive' || o.mode === 'exclusive') {
          const other = this.records.get(o.action)!;
          return {
            code: 'reservation.conflict',
            message: `${r.resource} is already reserved by action ${o.action} (${other.verb}, ${other.status})`,
            subjects: [r.resource.split(':').slice(1).join(':')],
            details: { resource: r.resource, holder: o.action },
          };
        }
      }
    }
    return null;
  }

  /**
   * Social holds a directed submission would pre-empt (SOCIAL.md "Pre-emption"): the ids to cancel,
   * or null when nothing applies — no live action has `yieldTo` (the fast path every non-social run
   * takes), the submission is itself social (its def or an ancestor has `yieldTo`), or one of its
   * conflicts is not an `actor:` claim held under a social action (then the ordinary
   * reservation.conflict stands). Reservations are read before plan() here, so a verb whose
   * reservations depend on its plan contributes only the ones its params name.
   */
  private preemptible(def: ActionDef, params: unknown, by: ActionRecord, parent?: string): string[] | null {
    if (def.yieldTo) return null;
    let social = false;
    for (const l of this.live.values()) if (l.def.yieldTo) { social = true; break; }
    if (!social) return null;
    const ancestors = new Set<string>();
    for (let p = parent; p; p = this.records.get(p)?.parent) {
      ancestors.add(p);
      if (this.live.get(p)?.def.yieldTo || this.registry.get(this.records.get(p)?.verb ?? '')?.yieldTo) return null;
    }
    let res: Reservation[];
    try {
      res = def.reservations(this.world, params);
    } catch {
      return null;
    }
    const out: string[] = [];
    for (const r of res)
      for (const o of this.owners.get(r.resource) ?? []) {
        if (ancestors.has(o.action) || (r.mode !== 'exclusive' && o.mode !== 'exclusive')) continue;
        if (!r.resource.startsWith('actor:')) return null;
        const unit = this.yieldUnit(o.action, r.resource.slice('actor:'.length), by);
        if (!unit) return null;
        for (const u of unit) if (!out.includes(u)) out.push(u);
      }
    return out.length ? out : null;
  }

  /** The nearest social action at or above `holderId` decides what to cancel to free `actor`. */
  private yieldUnit(holderId: string, actor: string, by: ActionRecord): string[] | null {
    const holder = this.records.get(holderId)!;
    for (let r: ActionRecord | undefined = holder; r; r = r.parent ? this.records.get(r.parent) : undefined) {
      const l = this.live.get(r.id);
      if (!l?.def.yieldTo) continue;
      const ids = l.def.yieldTo(this, r, holder, actor, by).filter((i) => this.live.has(i));
      return ids.length ? ids : null;
    }
    return null;
  }

  /** End of tick: start (plan → reserve → start) every waiting directive whose pre-empted holds have ended, in submission order. */
  private admitWaiting() {
    for (const w of Array.from(this.waiting.values())) {
      if (w.holds.some((h) => this.live.has(h))) continue;
      this.waiting.delete(w.rec.id);
      w.rec.phase = undefined;
      if (w.parent && !this.isActive(w.parent)) {
        this.fail(w.rec, { code: 'action.parent-ended', message: `${w.rec.verb} ${w.rec.id} waited for a pre-empted hold, but its parent ${w.parent} has ended`, subjects: [w.rec.id, w.parent] });
        continue;
      }
      this.admit(w.rec, w.def, w.params, w.parent);
    }
  }

  private finish(l: Live, status: ActionStatus, d?: Diagnostic) {
    if (d && status === 'cancelled') l.rec.diagnostic = d;
    this.live.delete(l.rec.id);
    if (status !== 'completed') this.cleanup(l);
    for (const [k, list] of this.owners) {
      const kept = list.filter((o) => o.action !== l.rec.id);
      if (kept.length) this.owners.set(k, kept);
      else this.owners.delete(k);
    }
    l.rec.endedTick = this.tick;
    this.emit(l.rec, status, d);
  }

  /**
   * A failed or cancelled action leaves no state behind (review H1): its live children are
   * cancelled, entities it reserved but never picked up return to their prior phase, its actors'
   * task and published speed are cleared, and their single-file traffic entries (walk.ts `services.traffic`) released.
   */
  private cleanup(l: Live) {
    const id = l.rec.id;
    for (const r of Array.from(this.records.values())) if (r.parent === id && (this.live.has(r.id) || this.waiting.has(r.id))) this.cancel(r.id);
    const ents = this.world.entities;
    for (const [eid, phase] of l.prior) {
      const e = ents[eid];
      if (!e) continue;
      if (e.phase === 'reserved') e.phase = phase; // never picked up: back to what it was
      if (e.reservedBy === id) e.reservedBy = undefined;
    }
    for (const e of Object.values(ents)) if (e.reservedBy === id && e.phase !== 'carried' && e.phase !== 'raising') e.reservedBy = undefined;
    const traffic = this.services.traffic as Map<string, { actors: Set<string> }> | undefined;
    for (const e of Object.values(ents)) {
      if (!e.human || e.human.task !== id) continue;
      e.human.task = undefined;
      if (!e.human.grip) e.human.activity = 'idle';
      delete e.human.speed; // walk_to's published ground speed ends with the task (MOVEMENT.md §3)
      if (traffic)
        for (const [k, t] of Array.from(traffic)) {
          t.actors.delete(e.id);
          if (!t.actors.size) traffic.delete(k);
        }
    }
  }

  private fail(rec: ActionRecord, d: Diagnostic) {
    rec.diagnostic = d;
    rec.endedTick = this.tick;
    this.emit(rec, 'failed', d);
    return rec;
  }

  private emit(rec: ActionRecord, status: ActionStatus, d?: Diagnostic, phase?: string) {
    rec.status = status;
    if (phase !== undefined) rec.phase = phase;
    rec.history.push({ tick: this.tick, status, phase: rec.phase, code: d?.code });
    const e: RuntimeEvent = {
      tick: this.tick,
      type: 'action',
      id: rec.id,
      verb: rec.verb,
      status,
      phase: rec.phase,
      code: d?.code,
      message: d?.message,
    };
    this.events.push(e);
    for (const o of this.observers) o.onEvent?.(this, e);
  }
}

/**
 * Rebuild `world.entities` with keys in sorted id order (review M6). The state hash ignores key
 * order, so every scan over `Object.values(world.entities)` — encounter/intrusion/bystander
 * searches that act on the first match, invariants, the sequence runner — must see one canonical
 * order, or two worlds with equal hashes could behave differently. Actions never add entities
 * mid-run; anything that does must call this again.
 */
export function canonicalEntityOrder(world: WorldState): WorldState {
  const ids = Object.keys(world.entities);
  let sorted = true;
  for (let i = 1; i < ids.length && sorted; i++) sorted = ids[i - 1] < ids[i];
  if (!sorted) {
    const out: WorldState['entities'] = {};
    for (const id of ids.sort()) out[id] = world.entities[id];
    world.entities = out;
  }
  return world;
}

