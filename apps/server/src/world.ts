// WorldHost: the sequencer. Owns the engine, the event log, the tick loop,
// snapshots, and the per-batch broadcast. The fold (doc 11):
//   events logged with tick T are applied when world.tick == T, then the engine steps to T+1.
import type { Engine, EngineFactory, PathCommit, ChangeEvent, RuntimeSnapshot, RuntimeEvent } from '@sim/engine-contract';
import {
  describeIntent, viewHashOf, viewRow,
  type Batch, type BirthPayload, type DecisionPayload, type EventKind, type Heartbeat, type IntentPayload, type LogEvent,
  type PublicSoul, type ScenePayload, type Snapshot, type WireIntent,
} from '@sim/protocol';
import type { Db } from './db.ts';

export const WORLD_ID = 'toy-1';

/** A Soul's mind: everything about it that is not the engine's body state. */
export type Mind = {
  soulId: string; entityId: string; name: string; description: string; owner: string; native: boolean;
  intent: WireIntent | null; intentVersion: number;
  mood: string; energy: number; wantsCompany: number;
  recent: string[]; doing: string;
  nextEvalTick: number; evalTrigger: string; lastEnergyTick: number; lastFingerprint: string;
  nudge: { text: string; untilTick: number } | null;
};
type Pending = { kind: EventKind; author: string; payload: any; resolve?: (e: LogEvent) => void };
export type SnapshotBody = { runtime: RuntimeSnapshot; minds: Mind[]; seq: number; extra: Record<string, unknown> };
export type HostListener = {
  onBatch?(b: Batch): void;
  onHeartbeat?(h: Heartbeat): void;
  onApplied?(e: LogEvent): void;
  onRuntimeEvent?(e: RuntimeEvent): void;
  afterTick?(tick: number): void;
};

const TICK_MS = 50;
const BATCH_TICKS = 10;      // 500 ms at rate 1
const HEARTBEAT_TICKS = 100; // 5 s at rate 1
const RING_BATCHES = 600;

export class WorldHost {
  engine!: Engine;
  minds = new Map<string, Mind>();          // by soulId
  mindByEntity = new Map<string, Mind>();
  seq = 0;
  clockRate = 1;
  paused = false;
  listeners: HostListener[] = [];
  ring: Batch[] = [];
  lastSnapshotTick = 0;
  extra: Record<string, unknown> = {};       // module state persisted with snapshots (narrator schedule etc.)
  tickMs: number[] = [];
  private queue: Pending[] = [];
  private acc = { paths: [] as PathCommit[], changes: [] as ChangeEvent[], log: [] as LogEvent[], dirty: new Set<string>(), removed: [] as string[], fromTick: 0 };
  private batchSeq = 0;
  private timer: NodeJS.Timeout | null = null;
  private last = 0;
  private carry = 0;
  private overruns = 0;
  private calm = 0;
  /** The rate an admin set (persisted). `clockRate` is the effective rate, lower while dilated. */
  baseRate = 1;
  private kfCursor = 0;
  db: Db; factory: EngineFactory; seed: string; snapshotEvery: number;

  constructor(db: Db, factory: EngineFactory, seed: string, snapshotEvery: number) {
    this.db = db; this.factory = factory; this.seed = seed; this.snapshotEvery = snapshotEvery;
  }

  // ------------------------------------------------------------ boot
  /** Load the latest snapshot and fast-forward through later log events, or start from genesis. */
  boot(): { from: 'genesis' | 'snapshot'; replayed: number } {
    let w = this.db.world(WORLD_ID);
    if (!w) {
      this.db.createWorld({ id: WORLD_ID, schema: 'pending', rules_version: this.factory.rulesVersion, dt: 1 / 20, seed: this.seed });
      w = this.db.world(WORLD_ID)!;
    }
    this.clockRate = this.baseRate = w.clock_rate;
    const snap = this.db.latestSnapshot(WORLD_ID);
    let from: 'genesis' | 'snapshot' = 'genesis';
    if (snap && snap.rulesVersion === this.factory.rulesVersion) {
      const body = snap.body as SnapshotBody;
      this.engine = this.factory.restore(body.runtime);
      for (const m of body.minds) this.addMind(m);
      this.extra = body.extra ?? {};
      this.seq = body.seq;
      this.lastSnapshotTick = snap.tick;
      from = 'snapshot';
    } else {
      this.engine = this.factory.create(this.factory.genesis(w.seed));
    }
    // fast-forward: replay events logged after the snapshot, stepping the engine to their ticks
    const later = this.db.events(WORLD_ID, this.seq);
    for (const e of later) {
      while (this.engine.world.tick < e.tick) { const out = this.engine.step(); this.afterStep(out.events, true); }
      this.apply(e, true);
      this.seq = e.seq;
    }
    this.acc.fromTick = this.engine.world.tick;
    this.resetAcc();
    return { from, replayed: later.length };
  }

  start() {
    this.last = performance.now();
    this.timer = setInterval(() => this.frame(), TICK_MS);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  // ------------------------------------------------------------ the loop
  private frame() {
    const now = performance.now();
    const elapsed = Math.min(1000, now - this.last);
    this.last = now;
    if (this.paused) return;
    this.carry += (elapsed * this.clockRate) / TICK_MS;
    let due = Math.floor(this.carry);
    this.carry -= due;
    if (due > 40) {
      due = 40; this.carry = 0; this.calm = 0;
      // EVE-style time dilation: if we cannot keep up, slow the world clock instead of dropping inputs.
      // Dilation is temporary: it is not persisted, and the clock recovers once the loop keeps up again.
      if (++this.overruns >= 3 && this.clockRate > this.baseRate / 4) { this.overruns = 0; this.clockRate = Math.max(this.baseRate / 4, this.clockRate / 2); void this.enqueue('rules', 'system', { clockRate: this.clockRate, why: 'dilation' }); }
    } else {
      this.overruns = 0;
      if (this.clockRate < this.baseRate && ++this.calm >= 200) { this.calm = 0; this.clockRate = Math.min(this.baseRate, this.clockRate * 2); void this.enqueue('rules', 'system', { clockRate: this.clockRate, why: 'recovered' }); }
    }
    for (let i = 0; i < due; i++) this.tickOnce();
  }

  tickOnce() {
    const t0 = performance.now();
    const tick = this.engine.world.tick;
    // 1. apply queued inputs at this tick, logging them
    const pending = this.queue.splice(0);
    for (const p of pending) {
      const e: LogEvent = { seq: ++this.seq, tick, kind: p.kind, author: p.author, payload: p.payload, at: Date.now() };
      this.db.appendEvent(WORLD_ID, e);
      this.apply(e, false);
      this.acc.log.push(e);
      for (const l of this.listeners) l.onApplied?.(e);
      p.resolve?.(e);
    }
    // 2. step the engine
    const out = this.engine.step();
    this.acc.paths.push(...out.paths);
    this.acc.changes.push(...out.changes);
    for (const c of out.changes) { const m = this.mindByEntity.get(c[1]); if (m) this.acc.dirty.add(m.soulId); }
    this.afterStep(out.events, false);
    const now = this.engine.world.tick;
    for (const l of this.listeners) l.afterTick?.(now);
    // 3. broadcast
    if (now % BATCH_TICKS === 0) this.flush();
    if (now % HEARTBEAT_TICKS === 0) this.heartbeat();
    if (now - this.lastSnapshotTick >= this.snapshotEvery) this.saveSnapshot(false);
    this.tickMs.push(performance.now() - t0);
    if (this.tickMs.length > 400) this.tickMs.splice(0, 200);
  }

  private afterStep(events: RuntimeEvent[], replay: boolean) {
    for (const ev of events) {
      if (ev.type === 'action' && ev.verb === 'do_activity' && (ev.status === 'completed' || ev.status === 'failed' || ev.status === 'cancelled')) {
        const rec = this.engine.runtime.records.get(ev.id);
        const actor = (rec?.params as { actor?: string; label?: string } | undefined)?.actor;
        const m = actor ? this.mindByEntity.get(actor) : undefined;
        if (m) {
          const label = (rec!.params as { label: string }).label;
          const outcome = ev.status === 'completed' ? 'done' : ev.status === 'failed' ? `could not: ${ev.code}` : 'interrupted';
          m.recent = [...m.recent.slice(-3), `${shorten(label)} (${outcome})`];
          if (ev.status !== 'cancelled') {
            m.doing = 'standing around';
            // re-evaluate shortly after an activity ends; jitter by soul so they do not all think on the same tick
            m.nextEvalTick = Math.min(m.nextEvalTick, ev.tick + 10 + (hash32(m.soulId) % 30));
            m.evalTrigger = ev.status === 'completed' ? 'activity-ended' : 'activity-failed';
          }
          this.acc.dirty.add(m.soulId);
        }
      }
      if (!replay) for (const l of this.listeners) l.onRuntimeEvent?.(ev);
    }
  }

  // ------------------------------------------------------------ inputs
  /** Queue an input; it is logged and applied at the next tick. Resolves with the logged event. */
  enqueue(kind: EventKind, author: string, payload: unknown): Promise<LogEvent> {
    return new Promise((resolve) => this.queue.push({ kind, author, payload, resolve }));
  }

  /** Apply a logged event to the engine and minds. Shared by the live loop, boot fast-forward and replay. */
  apply(e: LogEvent, replay: boolean) {
    const tick = e.tick;
    switch (e.kind) {
      case 'birth': {
        const p = e.payload as BirthPayload;
        this.engine.spawnHuman({ id: p.entityId, label: p.name, soul: p.soulId });
        if (!this.minds.has(p.soulId)) this.addMind({
          soulId: p.soulId, entityId: p.entityId, name: p.name, description: p.description, owner: p.owner, native: p.owner === 'system',
          intent: null, intentVersion: 0, mood: 'curious', energy: 80, wantsCompany: 0.5, recent: ['arrived at the gate (done)'], doing: 'standing around',
          nextEvalTick: tick + 20 + (hash32(p.soulId) % 40), evalTrigger: 'birth', lastEnergyTick: tick, lastFingerprint: '', nudge: null,
        });
        this.acc.dirty.add(p.soulId);
        break;
      }
      case 'intent': {
        const p = e.payload as IntentPayload; const m = this.minds.get(p.soulId);
        if (m) { m.intent = p.intent; m.intentVersion++; m.nextEvalTick = tick + 1; m.evalTrigger = 'new-intent'; m.lastFingerprint = ''; this.acc.dirty.add(m.soulId); }
        break;
      }
      case 'decision': {
        const p = e.payload as DecisionPayload; const m = this.minds.get(p.soulId);
        if (!this.engine.world.entities[p.entityId]) break;
        const r = this.engine.submit('do_activity', { actor: p.entityId, label: p.label, option: p.option, steps: p.steps }, { preempt: true });
        if (m) {
          if (p.mood) m.mood = p.mood;
          m.doing = r.status === 'failed' ? 'standing around' : p.label;
          m.nextEvalTick = tick + (r.status === 'failed' ? 40 : p.reevalTicks);
          m.evalTrigger = r.status === 'failed' ? 'activity-failed' : 'timer';
          if (r.status === 'failed') m.recent = [...m.recent.slice(-3), `${shorten(p.label)} (could not: ${r.diagnostic?.code})`];
          this.acc.dirty.add(m.soulId);
        }
        break;
      }
      case 'scene': {
        const p = e.payload as ScenePayload; const b = p.beat;
        const until = tick + 20 * 120;
        const text = `${b.directive}${b.targets.length ? ` (${b.targets.join(', ')})` : ''}: ${b.flavor}`;
        for (const m of this.minds.values()) {
          const ent = this.engine.world.entities[m.entityId]; if (!ent) continue;
          const inRegion = this.engine.regionAt(ent.pose.p) === p.region;
          const named = b.kind !== 'scene' && b.targets.includes(m.name);
          if ((b.kind === 'scene' && inRegion && b.directive !== 'quiet') || named) {
            m.nudge = { text, untilTick: until };
            m.nextEvalTick = Math.min(m.nextEvalTick, tick + 5 + (hash32(m.soulId) % 60)); m.evalTrigger = 'narrator-beat';
          }
        }
        break;
      }
      case 'retire': {
        const p = e.payload as { soulId: string; entityId: string }; const m = this.minds.get(p.soulId);
        if (m) { this.engine.removeEntity(m.entityId); this.minds.delete(m.soulId); this.mindByEntity.delete(m.entityId); this.acc.removed.push(m.soulId); }
        break;
      }
      case 'rules': case 'admin': break; // clock rate, pause, dilation: recorded, no world effect
    }
    void replay;
  }

  addMind(m: Mind) { this.minds.set(m.soulId, m); this.mindByEntity.set(m.entityId, m); }

  setClockRate(rate: number, author: string, why: string) {
    this.clockRate = this.baseRate = rate; this.db.setClockRate(WORLD_ID, rate);
    void this.enqueue('rules', author, { clockRate: rate, why });
  }
  setPaused(p: boolean, author: string) {
    if (p) { void this.enqueue('admin', author, { action: 'pause' }); this.tickOnceForQueue(); this.paused = true; }
    else { this.paused = false; this.last = performance.now(); this.carry = 0; void this.enqueue('admin', author, { action: 'resume' }); }
  }
  private tickOnceForQueue() { if (!this.paused) this.tickOnce(); }

  // ------------------------------------------------------------ views
  publicSoul(m: Mind): PublicSoul {
    const nameOf = (id: string) => this.engine.world.entities[id]?.label ?? this.engine.world.regions[id]?.label ?? id;
    return {
      id: m.soulId, entityId: m.entityId, name: m.name, description: m.description, owner: ownerShort(m.owner), native: m.native,
      intent: m.intent ? { goal: m.intent.goal, target: m.intent.target ?? null } : null, intentText: describeIntent(m.intent ? { ...m.intent, note: undefined } : null, nameOf), mood: m.mood, energy: energyWord(m.energy), doing: m.doing,
    };
  }
  viewHash(): string {
    const w = this.engine.world;
    return viewHashOf(Object.keys(w.entities).filter((id) => w.entities[id].kind === 'human').map((id) => viewRow(w.entities[id], this.engine.poseSampleOf(id))));
  }
  snapshotView(): Snapshot {
    const w = this.engine.world;
    const paths: PathCommit[] = [];
    for (const id of Object.keys(w.entities)) { const p = this.engine.currentPath(id); if (p) paths.push(p); }
    return {
      tick: w.tick, seq: this.batchSeq, viewHash: this.viewHash(),
      entities: structuredClone(w.entities), regions: w.regions, env: w.env, paths,
      souls: [...this.minds.values()].map((m) => this.publicSoul(m)),
    };
  }

  private resetAcc() { this.acc = { paths: [], changes: [], log: [], dirty: new Set(), removed: [], fromTick: this.engine.world.tick }; }
  private flush() {
    const b: Batch = {
      seq: ++this.batchSeq, fromTick: this.acc.fromTick, toTick: this.engine.world.tick,
      paths: this.acc.paths, changes: this.acc.changes, log: this.acc.log, removedSouls: this.acc.removed,
      souls: [...this.acc.dirty].map((id) => this.minds.get(id)).filter((m): m is Mind => !!m).map((m) => this.publicSoul(m)),
    };
    this.resetAcc();
    this.ring.push(b); if (this.ring.length > RING_BATCHES) this.ring.shift();
    for (const l of this.listeners) l.onBatch?.(b);
  }
  markDirty(soulId: string) { this.acc.dirty.add(soulId); }
  get currentBatchSeq() { return this.batchSeq; }

  private heartbeat() {
    // A rotating handful of authoritative pose keyframes lets clients check individual entities.
    const humans = Object.keys(this.engine.world.entities).filter((id) => this.engine.world.entities[id].kind === 'human').sort();
    const keyframes: Heartbeat['keyframes'] = {};
    for (let i = 0; i < Math.min(8, humans.length); i++) { const id = humans[(this.kfCursor + i) % humans.length]; keyframes[id] = this.engine.poseSampleOf(id); }
    this.kfCursor += 8;
    const h: Heartbeat = { tick: this.engine.world.tick, seq: this.batchSeq, viewHash: this.viewHash(), keyframes, clients: 0, clockRate: this.clockRate, paused: this.paused };
    for (const l of this.listeners) l.onHeartbeat?.(h);
  }

  // ------------------------------------------------------------ snapshots
  snapshotMs = { capture: 0, persist: 0 };
  /** Capture is synchronous (it must see one consistent tick); the database write is deferred past the current tick. */
  saveSnapshot(sync = true) {
    const t0 = performance.now();
    const runtime = this.engine.snapshot();
    const body: SnapshotBody = { runtime, minds: structuredClone([...this.minds.values()]), seq: this.seq, extra: structuredClone(this.extra) };
    const meta = { tick: runtime.tick, seq: this.seq, stateHash: runtime.stateHash, physicalHash: this.engine.physicalHash(), rulesVersion: this.engine.rulesVersion, body };
    this.snapshotMs.capture = performance.now() - t0;
    this.lastSnapshotTick = runtime.tick;
    const persist = () => { const t1 = performance.now(); this.db.saveSnapshot(WORLD_ID, meta); this.snapshotMs.persist = performance.now() - t1; };
    if (sync) persist(); else setImmediate(persist);
    return { tick: runtime.tick, stateHash: runtime.stateHash };
  }
}

export const hash32 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const ownerShort = (owner: string) => (owner === 'system' ? 'world' : `u${hash32(owner).toString(36)}`);
export const energyWord = (e: number) => (e > 75 ? 'energetic' : e > 45 ? 'fine' : e > 20 ? 'tired' : 'exhausted');
const shorten = (s: string) => (s.length > 70 ? s.slice(0, 67) + '...' : s);

/** Pure replay of the log from genesis: the fold. Used by the replay test and available for verification. */
export function replayFromGenesis(factory: EngineFactory, seed: string, events: LogEvent[], untilTick: number): Engine {
  const engine = factory.create(factory.genesis(seed));
  let i = 0;
  while (engine.world.tick < untilTick) {
    while (i < events.length && events[i].tick === engine.world.tick) {
      const e = events[i++];
      if (e.kind === 'birth') { const p = e.payload as BirthPayload; engine.spawnHuman({ id: p.entityId, label: p.name, soul: p.soulId }); }
      else if (e.kind === 'decision') { const p = e.payload as DecisionPayload; if (engine.world.entities[p.entityId]) engine.submit('do_activity', { actor: p.entityId, label: p.label, option: p.option, steps: p.steps }, { preempt: true }); }
      else if (e.kind === 'retire') { const p = e.payload as { entityId: string }; engine.removeEntity(p.entityId); }
    }
    engine.step();
  }
  return engine;
}
