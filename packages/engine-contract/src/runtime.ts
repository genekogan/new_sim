// Runtime: the action scheduler, mirroring Mars viewer/engine/runtime/runtime.ts.
// Deterministic: no Date.now, no Math.random; rng lives in world.rng.
import type { ActionDef, ActionRecord, ActionStatus, Diagnostic, Reservation } from './actions.ts';
import { TERMINAL } from './actions.ts';
import type { WorldState } from './world.ts';
import { hashOf } from './hash.ts';

export const DT = 1 / 20; // seconds per tick; changing this is a rules-version change

export type Violation = Diagnostic & { tick: number };
export type RuntimeEvent =
  | { tick: number; type: 'action'; id: string; verb: string; status: ActionStatus; phase?: string; code?: string; message?: string }
  | { tick: number; type: 'violation'; code: string; message: string; subjects?: string[] }
  | { tick: number; type: 'mark'; name: string; data?: unknown };
export type Invariant = (rt: Runtime) => Diagnostic[];
export type RuntimeServices = Record<string, any>;
export interface RuntimeObserver { onTick?(rt: Runtime): void; onEvent?(rt: Runtime, e: RuntimeEvent): void }

export class ActionAdmissionError extends Error {
  readonly diagnostic: Diagnostic;
  constructor(diagnostic: Diagnostic) { super(diagnostic.message); this.diagnostic = diagnostic; }
}

export const SNAPSHOT_FORMAT = 'sim-runtime-snapshot/1';
export type RuntimeSnapshot = {
  format: typeof SNAPSHOT_FORMAT;
  tick: number;
  stateHash: string;
  world: WorldState;
  nextId: number;
  eventCursor: number;
  violations: Violation[];
  records: ActionRecord[];
  live: { id: string; exec: unknown; reservations: Reservation[] }[];
};

type Live = { record: ActionRecord; def: ActionDef; exec: unknown; reservations: Reservation[] };

export class Runtime {
  readonly records = new Map<string, ActionRecord>();
  readonly events: RuntimeEvent[] = [];
  readonly violations: Violation[] = [];
  observers: RuntimeObserver[] = [];
  private live = new Map<string, Live>();
  private holders = new Map<string, Set<string>>(); // resource -> action ids
  private nextId = 1;

  world: WorldState;
  registry: Map<string, ActionDef>;
  services: RuntimeServices;
  invariants: Invariant[];
  constructor(world: WorldState, registry: Map<string, ActionDef>, services: RuntimeServices = {}, invariants: Invariant[] = []) {
    this.world = world; this.registry = registry; this.services = services; this.invariants = invariants;
  }

  get tick() { return this.world.tick; }
  get time() { return this.world.tick * DT; }

  submit(verb: string, params: unknown, opts: { id?: string; parent?: string; preempt?: boolean } = {}): ActionRecord {
    const def = this.registry.get(verb);
    const id = opts.id ?? `a${this.nextId++}`;
    if (this.records.has(id)) throw new ActionAdmissionError({ code: 'action.duplicate-id', message: `action id ${id} already exists` });
    const record: ActionRecord = { id, verb, params, status: 'requested', history: [], requestedTick: this.tick, parent: opts.parent };
    this.records.set(id, record);
    this.transition(record, 'requested');
    if (!def) return this.fail(record, { code: 'verb.unknown', message: `unknown verb ${verb}` });
    const parsed = def.schema.safeParse(params);
    if (!parsed.success) return this.fail(record, { code: 'params.invalid', message: parsed.error.message });
    record.params = parsed.data;
    this.transition(record, 'validated');
    const reservations = def.reservations(this.world, parsed.data);
    const conflict = this.conflicts(reservations, id);
    if (conflict.length) {
      if (opts.preempt) for (const c of conflict) this.cancel(c, { code: 'action.preempted', message: `preempted by ${id}` });
      else return this.fail(record, { code: 'reservation.conflict', message: `resources held by ${conflict.join(',')}`, subjects: conflict });
    }
    const plan = def.plan(this, parsed.data);
    if (!plan.ok) return this.fail(record, plan.diagnostic);
    this.reserve(reservations, id);
    this.transition(record, 'reserved');
    const exec = def.start(this, parsed.data, plan.program, id);
    this.live.set(id, { record, def, exec, reservations });
    this.transition(record, 'executing');
    return record;
  }

  cancel(id: string, reason?: Diagnostic): ActionRecord {
    const rec = this.records.get(id);
    if (!rec) throw new ActionAdmissionError({ code: 'action.unknown', message: `no action ${id}` });
    const l = this.live.get(id);
    if (l) {
      l.def.cancel(this, l.exec);
      this.release(l.reservations, id);
      this.live.delete(id);
    }
    if (!TERMINAL.has(rec.status)) {
      rec.diagnostic = reason;
      this.transition(rec, 'cancelled', reason?.code, reason?.message);
      rec.endedTick = this.tick;
    }
    return rec;
  }

  /** Advance one tick: world.tick++, step live actions in id order, run invariants. */
  step() {
    this.world.tick++;
    const ids = [...this.live.keys()].sort();
    for (const id of ids) {
      const l = this.live.get(id);
      if (!l) continue;
      const r = l.def.step(this, l.exec, DT);
      if (r.status === 'running') {
        if (r.phase && r.phase !== l.record.phase) { l.record.phase = r.phase; this.transition(l.record, 'executing', undefined, undefined, r.phase); }
        continue;
      }
      this.release(l.reservations, id);
      this.live.delete(id);
      l.record.endedTick = this.tick;
      if (r.status === 'completed') { l.record.outputs = r.outputs; this.transition(l.record, 'completed'); }
      else { l.record.diagnostic = r.diagnostic; this.transition(l.record, r.status, r.diagnostic.code, r.diagnostic.message); }
    }
    for (const inv of this.invariants) for (const d of inv(this)) {
      const v = { ...d, tick: this.tick };
      this.violations.push(v);
      this.emit({ tick: this.tick, type: 'violation', code: d.code, message: d.message, subjects: d.subjects });
    }
    for (const o of this.observers) o.onTick?.(this);
  }

  runUntilIdle(maxTicks = 20 * 60 * 30, ids?: string[]): boolean {
    for (let i = 0; i < maxTicks; i++) {
      const active = ids ? ids.some((id) => this.isActive(id)) : this.live.size > 0;
      if (!active) return true;
      this.step();
    }
    return false;
  }

  isActive(id: string) { return this.live.has(id); }
  holder(resource: string): string[] { return [...(this.holders.get(resource) ?? [])].sort(); }
  liveIds(): string[] { return [...this.live.keys()].sort(); }
  mark(name: string, data?: unknown) { this.emit({ tick: this.tick, type: 'mark', name, data }); }
  stateHash() { return hashOf(this.world); }

  snapshot(): RuntimeSnapshot {
    return structuredClone({
      format: SNAPSHOT_FORMAT,
      tick: this.tick,
      stateHash: this.stateHash(),
      world: this.world,
      nextId: this.nextId,
      eventCursor: this.events.length,
      violations: this.violations,
      records: [...this.records.values()],
      live: [...this.live.entries()].map(([id, l]) => ({ id, exec: l.def.serializeExec(l.exec), reservations: l.reservations })),
    });
  }

  static restore(snap: RuntimeSnapshot, registry: Map<string, ActionDef>, services: RuntimeServices = {}, invariants: Invariant[] = []): Runtime {
    if (snap.format !== SNAPSHOT_FORMAT) throw new Error(`bad snapshot format ${snap.format}`);
    const s = structuredClone(snap);
    const rt = new Runtime(s.world, registry, services, invariants);
    rt.nextId = s.nextId;
    rt.violations.push(...s.violations);
    for (const r of s.records) rt.records.set(r.id, r);
    for (const l of s.live) {
      const record = rt.records.get(l.id)!;
      const def = registry.get(record.verb)!;
      const exec = def.restoreExec(rt, record.params, l.exec, l.id);
      rt.reserve(l.reservations, l.id);
      rt.live.set(l.id, { record, def, exec, reservations: l.reservations });
    }
    if (rt.stateHash() !== s.stateHash) throw new Error('snapshot stateHash mismatch');
    return rt;
  }

  // --- internals
  private conflicts(res: Reservation[], self: string): string[] {
    const out = new Set<string>();
    for (const r of res) {
      const hs = this.holders.get(r.resource);
      if (!hs) continue;
      for (const h of hs) if (h !== self && r.mode === 'exclusive') out.add(h);
      if (r.mode === 'shared') for (const h of hs) { const l = this.live.get(h); if (l?.reservations.some((x) => x.resource === r.resource && x.mode === 'exclusive')) out.add(h); }
    }
    return [...out].sort();
  }
  private reserve(res: Reservation[], id: string) { for (const r of res) { if (!this.holders.has(r.resource)) this.holders.set(r.resource, new Set()); this.holders.get(r.resource)!.add(id); } }
  private release(res: Reservation[], id: string) { for (const r of res) { const s = this.holders.get(r.resource); s?.delete(id); if (s && s.size === 0) this.holders.delete(r.resource); } }
  private fail(record: ActionRecord, d: Diagnostic): ActionRecord {
    record.diagnostic = d; record.endedTick = this.tick;
    this.transition(record, 'failed', d.code, d.message);
    return record;
  }
  private transition(rec: ActionRecord, status: ActionStatus, code?: string, message?: string, phase?: string) {
    rec.status = status;
    rec.history.push({ tick: this.tick, status, phase, code });
    this.emit({ tick: this.tick, type: 'action', id: rec.id, verb: rec.verb, status, phase, code, message });
  }
  private emit(e: RuntimeEvent) { this.events.push(e); for (const o of this.observers) o.onEvent?.(this, e); }
}
