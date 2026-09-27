// Fixed-step authoritative runtime. The same class runs rehearsals (in Node
// tests or a forked room), official execution (Durable Object) and local
// previews — there is no second "fast path" implementation (spec §16).
import type { ActionDef, ActionRecord, ActionStatus, Diagnostic, Reservation } from '../actions/types.ts';
import { TERMINAL } from '../actions/types.ts';
import type { WorldState } from '../world/types.ts';
import { hashOf } from '../core/hash.ts';

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

type Live = { rec: ActionRecord; def: ActionDef; exec: unknown; program: unknown; cancelling?: boolean };

export class Runtime {
  readonly records = new Map<string, ActionRecord>();
  readonly events: RuntimeEvent[] = [];
  readonly violations: Violation[] = [];
  private live = new Map<string, Live>();
  private owners = new Map<string, { action: string; mode: 'exclusive' | 'shared' }[]>();
  private nextId = 1;
  observers: RuntimeObserver[] = [];

  world: WorldState;
  registry: Map<string, ActionDef>;
  services: Record<string, any>;
  invariants: Invariant[];
  constructor(world: WorldState, registry: Map<string, ActionDef>, services: Record<string, any>, invariants: Invariant[] = []) {
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

  /** requested → validated → reserved → executing, or a diagnostic failure. */
  submit(verb: string, params: unknown, opts: { id?: string } = {}): ActionRecord {
    const id = opts.id ?? `a${this.nextId++}`;
    const rec: ActionRecord = { id, verb, params, status: 'requested', history: [], requestedTick: this.tick };
    this.records.set(id, rec);
    this.emit(rec, 'requested');
    const def = this.registry.get(verb);
    if (!def) return this.fail(rec, { code: 'action.unknown-verb', message: `no action verb "${verb}"` });
    const parsed = def.schema.safeParse(params);
    if (!parsed.success)
      return this.fail(rec, {
        code: 'action.invalid-params',
        message: `invalid parameters for ${verb}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      });
    rec.params = parsed.data;
    const plan = def.plan(this, parsed.data);
    if (!plan.ok) return this.fail(rec, plan.diagnostic);
    this.emit(rec, 'validated');
    const res = def.reservations(this.world, parsed.data);
    const conflict = this.reservationConflict(res);
    if (conflict) return this.fail(rec, conflict);
    for (const r of res) {
      const list = this.owners.get(r.resource) ?? [];
      list.push({ action: id, mode: r.mode });
      this.owners.set(r.resource, list);
    }
    this.emit(rec, 'reserved');
    const exec = def.start(this, parsed.data, plan.program, id);
    this.live.set(id, { rec, def, exec, program: plan.program });
    this.emit(rec, 'executing');
    return rec;
  }

  cancel(id: string): ActionRecord {
    const l = this.live.get(id);
    const rec = this.records.get(id);
    if (!rec) throw new Error(`unknown action ${id}`);
    if (!l) return rec;
    const r = l.def.cancel(this, l.exec);
    if (!r.ok) {
      rec.diagnostic = r.diagnostic;
      this.emit(rec, rec.status, r.diagnostic);
      return rec;
    }
    if (r.deferred) {
      // controlled stop in progress (e.g. set-down); the action finishes as 'cancelled'
      l.cancelling = true;
      this.emit(rec, rec.status, undefined, 'cancelling');
      return rec;
    }
    this.finish(l, 'cancelled');
    return rec;
  }

  /** Advance one fixed tick: step live actions in submission order, then check invariants. */
  step() {
    this.world.tick++;
    for (const l of [...this.live.values()]) {
      const r = l.def.step(this, l.exec, DT);
      if (r.status === 'running') {
        if (l.rec.status !== 'executing' || r.phase !== l.rec.phase) {
          l.rec.diagnostic = undefined;
          this.emit(l.rec, 'executing', undefined, r.phase);
        }
      } else if (r.status === 'completed') {
        l.rec.outputs = r.outputs;
        this.finish(l, l.cancelling ? 'cancelled' : 'completed');
      } else if (r.status === 'blocked') {
        if (l.rec.status !== 'blocked' || l.rec.diagnostic?.code !== r.diagnostic.code) this.emit(l.rec, 'blocked', r.diagnostic);
        l.rec.diagnostic = r.diagnostic;
      } else {
        l.rec.diagnostic = r.diagnostic;
        this.finish(l, 'failed', r.diagnostic);
      }
    }
    for (const inv of this.invariants)
      for (const d of inv(this)) {
        this.violations.push({ ...d, tick: this.tick });
        this.events.push({ tick: this.tick, type: 'violation', code: d.code, message: d.message, subjects: d.subjects });
      }
    for (const o of this.observers) o.onTick?.(this);
  }

  /** Step until all given (or all) actions are terminal, or a tick budget is exhausted. */
  runUntilIdle(maxTicks = 20 * 60 * 30, ids?: string[]) {
    const pending = () => (ids ? ids.some((i) => this.live.has(i)) : this.live.size > 0);
    let n = 0;
    while (pending() && n++ < maxTicks) this.step();
    return !pending();
  }

  isActive(id: string) {
    return this.live.has(id);
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

  private reservationConflict(res: Reservation[]): Diagnostic | null {
    for (const r of res) {
      for (const o of this.owners.get(r.resource) ?? []) {
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

  private finish(l: Live, status: ActionStatus, d?: Diagnostic) {
    this.live.delete(l.rec.id);
    for (const [k, list] of this.owners) {
      const kept = list.filter((o) => o.action !== l.rec.id);
      if (kept.length) this.owners.set(k, kept);
      else this.owners.delete(k);
    }
    l.rec.endedTick = this.tick;
    this.emit(l.rec, status, d);
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
