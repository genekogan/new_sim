// WorldHost: the sequencer. Owns the engine, the event log, the tick loop,
// snapshots, and the per-batch broadcast. The fold (doc 11):
//   events logged with tick T are applied when world.tick == T, then the engine steps to T+1.
import type { Engine, EngineFactory, PathCommit, ChangeEvent, ProgramEvent, EngineSnapshot, RuntimeEvent } from '@sim/engine-contract';
import { hashOf } from '@sim/engine-contract';
import { kernelHash, sweep, type KState } from '@sim/kernel';
import { ClockFrontiers,type ClockFrontierV1 } from './clock-frontier.ts';
import {
  describeIntent, publicIntent, viewHashOf, viewRow,
  isStationFactV1,
  stationSourceFromRulesV1,stationPhysicalTransitionV1,stationRulesEraV1Schema,foldStationRulesEraV1,initialStationPhysicalHeadV1,acceptStationPhysicalHeadV1,
  type StationEraFoldStateV1,type StationPhysicalHeadV1,
  INTENT_V2, intentHistoryFactV2, intentReceivedPayloadV2Schema, intentReferenceV2Schema, intentAdmissionFactV2, intentControllerFactV2,
  type IntentAdmissionPayloadV2, type IntentControllerPayloadV2,
  type AgendaStep, type Batch, type BirthPayload, type DecisionPayload, type EventKind, type Heartbeat, type IntentPayload, type KernelView, type LogEvent,
  type PlayPayload, type PlayView, type PublicSoul, type ScenePayload, type Snapshot, type WireIntent,
} from '@sim/protocol';
import type { Db } from './db.ts';
import { advanceNeeds, newLife, type Life } from '@sim/brain';
import { arrivalPlace, baseVocabulary, codeVocabulary, foldEvent, initKernel, pinnedVocabulary, soulThing, type Vocabulary, type FoldResult } from './fold.ts';
import { frontier, stepIndex } from './deck.ts';
import {mandateOf,MANDATE_STATE} from './mandate.ts';
import { emptyIntentHistoryV2, foldIntentHistoryV2, type IntentHistoryV2 } from './intent-history.ts';
import { IntentObservations } from './intent-observations.ts';
import { foldStationFactV1, stationGenesisIdV1, type StationHistoryV1 } from './station-history.ts';
import { initialStationHistoryV2,foldStationFactV2,type StationHistoryV2 } from './station-history-v2.ts';
export { replayFromGenesis, replayKernel } from './fold.ts';


/** A Soul's mind: everything about it that is not the engine's body state. */
export type Mind = {
  soulId: string; entityId: string; name: string; description: string; owner: string; native: boolean;
  life?: Life;
  intent: WireIntent | null; intentVersion: number;
  activeRule?: string;
  mood: string; energy: number; wantsCompany: number;
  recent: string[]; doing: string;
  nextEvalTick: number; evalTrigger: string; lastEnergyTick: number; lastFingerprint: string;
  nudge: { text: string; untilTick: number } | null;
  /** The intent's agenda (cards to favour, in order) and how far along it is. */
  agenda: AgendaStep[]; agendaPos: number;
  /** Something that was just tried and could not be done: not offered again for a minute, so a Soul never retries the impossible in a loop. */
  avoid?: { id: string; untilTick: number };
  /** Tick since which the plan has had no playable step (to give up eventually). */
  planBlockedSince?: number;
  /** The card whose depiction is running and whose effects have not applied yet. */
  pending: { program: string; card: string; hash: string; target: string | null; option?: string; manner?: string; approachLen: number; applied: boolean } | null;
};
export type RecoveryRecipe = { baseline: SnapshotBody; events: LogEvent[]; untilTick: number; faults: Record<string,number>; excluded: string[]; reason: string };
/** A synchronous, read-only acceptance check. Throw to refuse before logging. */
export type AcceptanceGuard = () => true;
export function checkAcceptanceGuard(guard: AcceptanceGuard): void {
  if (guard() !== true) throw new TypeError('acceptance guard must synchronously return true');
}
/** Synchronous writes to this host's Db, in the event acceptance transaction. */
export type AcceptanceJournal = (event: LogEvent) => true;
type PurposeRef = { intentId: string; version: number };
type ActivityBinding = { admissionSeq:number; payload:Extract<IntentAdmissionPayloadV2,{phase:'accepted'}> };
export class StaleIntentAttempt extends Error { constructor() { super('purpose attempt became stale'); } }
export class IntentAdmissionDeferred extends Error { constructor() { super('purpose admission needs a resumable checkpoint'); } }
export class PersistedIntentAdmissionFault extends Error {
  readonly decisionSeq: number;
  constructor(decisionSeq:number) { super('decision and admission persisted; physical application requires reconciliation'); this.decisionSeq=decisionSeq; }
}
type Pending = { kind: EventKind; author: string; payload: any; resolve?: (e: LogEvent) => void; guard?: AcceptanceGuard; journal?: AcceptanceJournal; reject?: (error: unknown) => void; purpose?: PurposeRef; stationEra?:boolean };
export type SnapshotBody = { runtime: EngineSnapshot; minds: Mind[]; seq: number; extra: Record<string, unknown>; kernel?: KState; counts?: Record<string, number> };
export type HostListener = {
  onBatch?(b: Batch): void;
  onHeartbeat?(h: Heartbeat): void;
  onApplied?(e: LogEvent): void;
  onRuntimeEvent?(e: RuntimeEvent): void;
  onProgram?(e: ProgramEvent, m: Mind): void;
  /** A card's effects were applied (or refused). Not called during replay. */
  onPlay?(p: PlayView, m: Mind | undefined): void;
  onKernel?(v: KernelView): void;
  afterTick?(tick: number): void;
  onClockUnavailable?():void;
};

const TICK_MS = 50;
const BATCH_TICKS = 10;      // 500 ms at rate 1
const HEARTBEAT_TICKS = 100; // 5 s at rate 1
const RING_BATCHES = 600;

export class WorldHost {
  engine!: Engine;
  /** Meaning: things, links, vocabulary, decks. Replays from the log without the engine. */
  kernel!: KState;
  counts: Record<string, number> = {};       // successful plays per card
  recentPlays: PlayView[] = [];
  private kernelDirty = true;
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
  private intentControllerFaults = new Set<string>();
  private intentObservations: IntentObservations;
  private acc = { paths: [] as PathCommit[], changes: [] as ChangeEvent[], log: [] as LogEvent[], dirty: new Set<string>(), removed: [] as string[], plays: [] as PlayView[], fromTick: 0 };
  private batchSeq = 0;
  private timer: NodeJS.Timeout | null = null;
  private recoveryBaseline: SnapshotBody | null = null;
  private last = 0;
  private carry = 0;
  private overruns = 0;
  private calm = 0;
  /** The rate an admin set (persisted). `clockRate` is the effective rate, lower while dilated. */
  baseRate = 1;
  private kfCursor = 0;
  db: Db; factory: EngineFactory; seed: string; snapshotEvery: number;
  readonly worldId: string;
  private clockFrontiers:ClockFrontiers;
  private durableClockV1:boolean;
  private clockFailure:unknown;
  get clockAvailable(){return !this.clockFailure;}
  assertClockReady():void {if(this.clockFailure)throw new Error('clock-frontier.unavailable');}

  constructor(db: Db, factory: EngineFactory, seed: string, snapshotEvery: number, worldId = 'toy-1',options?:{durableClockV1?:boolean}) {
    this.worldId = worldId;
    this.db = db; this.factory = factory; this.seed = seed; this.snapshotEvery = snapshotEvery;
    this.clockFrontiers=new ClockFrontiers(db);this.durableClockV1=options?.durableClockV1===true;
    this.intentObservations = new IntentObservations(db, worldId);
  }

  // ------------------------------------------------------------ boot
  /** Load the latest snapshot and fast-forward through later log events, or start from genesis. */
  boot(): { from: 'genesis' | 'snapshot'; replayed: number } {
    let w = this.db.world(this.worldId);
    if (!w) {
      this.db.createWorld({ id: this.worldId, schema: 'pending', rules_version: this.factory.rulesVersion, dt: 1 / 20, seed: this.seed });
      w = this.db.world(this.worldId)!;
    }
    this.clockRate = this.baseRate = w.clock_rate;
    const clock=this.clockFrontiers.read(this.worldId);
    if(clock&&!this.durableClockV1)throw new Error('clock-frontier.reader-required');
    if(clock&&this.factory.canReplayHistory?.(clock.rulesVersion)===false)throw new Error('clock-frontier.rules-incompatible');
    const snap = this.db.latestSnapshot(this.worldId);
    // Snapshot rejection is not permission to reinterpret history from genesis.
    // Check both durable identities before constructing or stepping any engine.
    for(const version of [w.rules_version,...(snap?[snap.rulesVersion]:[])])
      if(this.factory.canReplayHistory?.(version)===false)throw new Error(`history rules are incompatible with the configured engine: ${version} -> ${this.factory.rulesVersion}`);
    let from: 'genesis' | 'snapshot' = 'genesis';
    if (snap && (snap.rulesVersion === this.factory.rulesVersion || this.factory.canRestoreSnapshot?.(snap.rulesVersion))) {
      const body = snap.body as SnapshotBody;
      this.engine = this.factory.restore(body.runtime);
      for (const m of body.minds) this.addMind({ ...m, agenda: m.agenda ?? [], agendaPos: m.agendaPos ?? 0, pending: m.pending ?? null });
      this.extra = body.extra ?? {};
      this.counts = body.counts ?? {};
      // A snapshot from before the kernel existed: build the kernel from the Souls that are there.
      this.kernel = body.kernel ?? this.bootstrapKernel();
      // (a kernel bootstrapped by an earlier build recorded every Soul as born at tick 0; a replay says otherwise)
      if (body.kernel) { const born = this.db.birthTicks(this.worldId); for (const t of Object.values(this.kernel.things)) if (t.kind === 'soul' && t.born === 0 && born[t.id]) t.born = born[t.id]; }
      this.seq = body.seq;
      this.lastSnapshotTick = snap.tick;
      from = 'snapshot';
    } else {
      this.engine = this.factory.create(this.factory.genesis(w.seed));
      this.kernel = initKernel(this.engine, pinnedVocabulary(this.db.rulesEvents(this.worldId)));
    }
    // fast-forward: replay events logged after the snapshot, stepping the engine to their ticks
    let later = this.db.events(this.worldId, this.seq);
    let checkedClock=false;
    if(clock&&this.seq>clock.throughSeq){
      if(this.engine.world.tick<clock.tick)throw new Error('clock-frontier.snapshot-prefix-differs');
      checkedClock=true; // A later exact durable snapshot supersedes this prefix.
    }
    const stepReplay=()=>{
      const before=this.engine.runtime.violations.length;
      const out=this.engine.step();this.advanceLives();
      if(this.durableClockV1){
        if(this.engine.runtime.violations.length>before)throw new Error('clock-frontier.replay-violates');
        this.kernel.tick=this.engine.world.tick;sweep(this.kernel);
      }
      this.afterPrograms(out.programs,true);
    };
    const verifyClock=()=>{
      if(!clock||checkedClock)return;
      if(this.seq!==clock.throughSeq||this.engine.world.tick>clock.tick)throw new Error('clock-frontier.prefix-differs');
      while(this.engine.world.tick<clock.tick)stepReplay();
      this.kernel.tick=this.engine.world.tick;sweep(this.kernel);
      if(this.engine.rulesVersion!==clock.rulesVersion||this.engine.dt!==clock.dtSeconds
        ||this.engine.stateHash()!==clock.engineHash||kernelHash(this.kernel)!==clock.kernelHash)
        throw new Error('clock-frontier.replay-differs');
      checkedClock=true;
    };
    let repaired = -1; for (let i=0;i<later.length;i++) if (later[i].kind === 'rules' && later[i].payload?.recovery) repaired=i;
    if (repaired >= 0) {
      const repair=later[repaired];this.apply(repair,true);this.seq=repair.seq;
      if(clock&&repair.seq>clock.throughSeq){
        if(this.engine.world.tick<clock.tick)throw new Error('clock-frontier.recovery-regression');
        checkedClock=true; // Explicit logged recovery supersedes its old prefix.
      }
      later=later.slice(repaired+1);
    }
    for (const e of later) {
      if(clock&&!checkedClock&&e.seq>clock.throughSeq)verifyClock();
      while (this.engine.world.tick < e.tick) stepReplay();
      this.apply(e, true);
      this.seq = e.seq;
    }
    verifyClock();
    this.factory.validateHistoryHead?.(this.engine,this.db.world(this.worldId)!.rules_version);
    if(this.extra.stationV1)this.stationPhysicalHeadV1();
    this.acc.fromTick = this.engine.world.tick;
    this.resetAcc();
    if (snap) this.recoveryBaseline = structuredClone(snap.body as SnapshotBody);
    else if (!this.engine.canSnapshot || this.engine.canSnapshot()) this.recoveryBaseline = this.captureBody();
    // Write this world's starting vocabulary into its log once, so its history never depends on what the code's set becomes.
    if (!this.db.hasVocabulary(this.worldId)) void this.enqueue('rules', 'system', { vocabulary: structuredClone(baseVocabulary(this.kernel)), why: 'the vocabulary this world began with' });
    if (this.pendingBootstrap) { void this.enqueue('rules', 'system', { kernelBootstrap: this.pendingBootstrap, why: 'the kernel begins here for a world that predates it' }); this.pendingBootstrap = null; }
    return { from, replayed: later.length };
  }

  /** Adopt the code's current starting vocabulary in this world (base cards, kinds, link kinds, manners), as a logged change of rules. */
  adoptVocabulary(author: string) { return this.enqueue('rules', author, { vocabulary: codeVocabulary(), why: 'adopted the current base vocabulary' } satisfies { vocabulary: Vocabulary; why: string }); }
  /** Trusted internal checkpoint only. No REST/MCP permission is introduced.
   * Carry is explicitly isolated; existing callers retain the station refusal. */
  adoptCommons(author:string,options?:{stationEraV1?:boolean}):Promise<LogEvent> {
    if(this.stationHistoryV1()&&!options?.stationEraV1)return Promise.reject(new Error('commons-transition.station-carry-forward-required'));
    const preview=this.engine.previewCommonsTransition?.();
    if(!preview?.ok)return Promise.reject(new Error(preview?`${preview.diagnostic.code}: ${preview.diagnostic.message}`:'commons-transition.reader-unavailable'));
    const previous=new Set(this.engine.anchors().map(a=>a.id));
    const collision=preview.anchors.find(a=>!previous.has(a.id)&&this.kernel.things[a.id]);
    if(collision)return Promise.reject(new Error(`commons-transition.kernel-collision:${collision.id}`));
    const expected=preview.transition;
    const guard:AcceptanceGuard=()=>{
      if(this.db.world(this.worldId)?.dt!==this.engine.dt)throw new Error('commons-transition.header-dt-moved');
      if(this.stationHistoryV1()&&!options?.stationEraV1)throw new Error('commons-transition.station-carry-forward-required');
      const current=this.engine.previewCommonsTransition?.();
      if(!current?.ok||JSON.stringify(current.transition)!==JSON.stringify(expected))throw new Error('commons-transition.source-moved');
      const oldAnchors=new Set(this.engine.anchors().map(a=>a.id));
      for(const a of current.anchors)if(!oldAnchors.has(a.id)&&this.kernel.things[a.id])throw new Error(`commons-transition.kernel-collision:${a.id}`);
      if(this.factory.canReplayHistory?.(expected.toRulesVersion)!==true)throw new Error('commons-transition.reader-unavailable');
      return true;
    };
    const journal:AcceptanceJournal=()=>{
      const result=this.db.db.prepare('UPDATE worlds SET rules_version=? WHERE id=? AND rules_version=?')
        .run(expected.toRulesVersion,this.worldId,expected.fromRulesVersion);
      if(result.changes!==1)throw new Error('commons-transition.header-moved');return true;
    };
    return new Promise((resolve,reject)=>this.queue.push({kind:'rules',author,payload:{commonsTransition:expected},guard,journal,
      stationEra:options?.stationEraV1===true,resolve,reject}));
  }
  private stationEraEvent(source:LogEvent):LogEvent|undefined {
    const old=this.stationHistoryV1();if(!old)return undefined;
    const physical=stationSourceFromRulesV1(this.worldId,source);
    const previous=this.stationPhysicalHeadV1()!;
    const payload=stationRulesEraV1Schema.parse({contract:'station-rules-era/1',worldId:this.worldId,epoch:old.station.epoch,
      revision:previous.revision+1,previousRevision:previous.revision,fromRulesVersion:previous.rulesVersion,
      toRulesVersion:stationPhysicalTransitionV1(physical).toRulesVersion,dtSeconds:this.engine.dt,effectiveTick:source.tick,
      source:{seq:source.seq,tick:source.tick,transitionHash:hashOf(stationPhysicalTransitionV1(physical))}});
    const fact={seq:source.seq+1,tick:source.tick,payload};
    foldStationRulesEraV1(this.extra.stationEraV1 as StationEraFoldStateV1|undefined,fact,physical,old.station);
    return {...fact,kind:'station-rules-era-v1',author:'world:station',at:source.at};
  }
  /** Trusted internal physical infrastructure edit. Existing station histories
   * explicitly refuse until a corresponding atomic era producer is qualified. */
  adoptCampExpansion(author:string,options?:{stationEraV1?:boolean}):Promise<LogEvent>{
    if(this.stationHistoryV1()&&!options?.stationEraV1)return Promise.reject(new Error('camp-expansion.station-era-reader-required'));
    const row=this.db.db.prepare("SELECT seq FROM events WHERE world_id=? AND kind='rules' AND json_extract(payload,'$.campExpansion.contract')='camp-ground-expansion/1' ORDER BY seq DESC LIMIT 1").get(this.worldId) as {seq:number}|undefined;
    if(row){const old=this.db.events(this.worldId,row.seq-1,1)[0],t=old?.payload?.campExpansion;
      if(t?.toRulesVersion===this.engine.rulesVersion&&hashOf(t.toBase)===hashOf(this.engine.world.base))return Promise.resolve(old);
    }
    const preview=this.engine.previewCampExpansionV1?.();
    if(!preview?.ok)return Promise.reject(new Error(preview?preview.diagnostic.code+': '+preview.diagnostic.message:'camp-expansion.reader-unavailable'));
    const previous=new Set(this.engine.anchors().map(a=>a.id));
    const collision=preview.anchors.find(a=>!previous.has(a.id)&&this.kernel.things[a.id]);
    if(collision)return Promise.reject(new Error('camp-expansion.kernel-collision:'+collision.id));
    const expected=preview.transition;
    const guard:AcceptanceGuard=()=>{
      if(this.stationHistoryV1()&&!options?.stationEraV1)throw new Error('camp-expansion.station-era-reader-required');
      if(this.db.world(this.worldId)?.dt!==this.engine.dt)throw new Error('camp-expansion.header-dt');
      const current=this.engine.previewCampExpansionV1?.();
      if(!current?.ok||hashOf(current.transition)!==hashOf(expected))throw new Error('camp-expansion.source-moved');
      const known=new Set(this.engine.anchors().map(a=>a.id));
      for(const a of current.anchors)if(!known.has(a.id)&&this.kernel.things[a.id])throw new Error('camp-expansion.kernel-collision:'+a.id);
      if(this.factory.canReplayHistory?.(expected.toRulesVersion)!==true)throw new Error('camp-expansion.reader-unavailable');
      return true;
    };
    const journal:AcceptanceJournal=()=>{
      const result=this.db.db.prepare('UPDATE worlds SET rules_version=? WHERE id=? AND rules_version=?').run(expected.toRulesVersion,this.worldId,expected.fromRulesVersion);
      if(result.changes!==1)throw new Error('camp-expansion.header-moved');return true;
    };
    return new Promise((resolve,reject)=>this.queue.push({kind:'rules',author,payload:{campExpansion:expected},guard,journal,stationEra:options?.stationEraV1===true,resolve,reject}));
  }
  private pendingBootstrap: { at: Record<string, string | null> } | null = null;
  /** For worlds snapshotted before the kernel existed: places from the engine, a Soul thing and deck per mind. */
  private bootstrapKernel(): KState {
    const k = initKernel(this.engine), at: Record<string, string | null> = {}, born = this.db.birthTicks(this.worldId);
    for (const m of this.minds.values()) {
      // as a replay from genesis would have it (arrived, never moved); the logged bootstrap event then places each Soul where it stands
      soulThing(k, { soulId: m.soulId, entityId: m.entityId, name: m.name, description: m.description, owner: m.owner }, arrivalPlace(k));
      k.things[m.soulId].born = born[m.soulId] ?? 0;
      at[m.soulId] = this.engine.world.entities[m.entityId] ? this.nearestPlace(k, m.entityId) : arrivalPlace(k);
    }
    this.pendingBootstrap = { at };
    return k;
  }
  /** The place Thing an entity is physically at: a place within 5 m, else its region. */
  nearestPlace(k: KState, entityId: string): string | null {
    const e = this.engine.world.entities[entityId]; if (!e) return null;
    let best: string | null = null, bd = 5;
    for (const t of Object.values(k.things)) { if (t.kind !== 'place') continue; const pe = this.engine.world.entities[t.traits.entity as string]; if (!pe) continue; const d = Math.hypot(pe.pose.p[0] - e.pose.p[0], pe.pose.p[2] - e.pose.p[2]); if (d < bd) { bd = d; best = t.id; } }
    return best ?? this.engine.regionAt(e.pose.p);
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
    this.assertClockReady();
    const t0 = performance.now();
    const tick = this.engine.world.tick;
    // 1. apply queued inputs at this tick, logging them
    this.drainInputs();
    // 2. step the engine
    let out: ReturnType<Engine['step']>;
    const previousViolations = this.engine.runtime.violations.length;
    try { out = this.engine.step(); if (this.engine.runtime.violations.length > previousViolations) throw new Error(JSON.stringify(this.engine.runtime.violations.slice(previousViolations))); }
    catch (error) { this.recoverFault(error); return; }
    this.advanceLives();
    this.kernel.tick = this.engine.world.tick;
    sweep(this.kernel);
    this.acc.paths.push(...out.paths);
    this.acc.changes.push(...out.changes);
    for (const c of out.changes) { const m = this.mindByEntity.get(c[1]); if (m) this.acc.dirty.add(m.soulId); }
    this.reconcileIntentObservations();
    this.observeIntentActions();
    this.afterPrograms(out.programs, false);
    if(this.durableClockV1){
      // Derived effects become durable before this elapsed body tick is sent.
      // Listener-generated next inputs retain their ordinary queue semantics.
      this.drainInputs();this.persistClockFrontier();
    }
    for (const ev of out.events) for (const l of this.listeners) l.onRuntimeEvent?.(ev);
    const now = this.engine.world.tick;
    for (const l of this.listeners) l.afterTick?.(now);
    // 3. broadcast
    if (now % BATCH_TICKS === 0) this.flush();
    if (now % HEARTBEAT_TICKS === 0) this.heartbeat();
    if (now - this.lastSnapshotTick >= this.snapshotEvery) this.saveSnapshot(false);
    this.tickMs.push(performance.now() - t0);
    if (this.tickMs.length > 400) this.tickMs.splice(0, 200);
  }

  /** Accept queued inputs without advancing the engine or starting new mind work. */
  drainInputs() {
    this.assertClockReady();
    const tick = this.engine.world.tick;
    const pending = this.queue.splice(0);
    for (const p of pending) {
      // Live request authority is checked immediately before the acceptance
      // point. Refusals are not simulation faults and consume no log sequence.
      // Accepted events replay as facts, without consulting these closures.
      if (p.guard && !p.journal) {
        try { checkAcceptanceGuard(p.guard); }
        catch (error) { p.reject!(error); continue; }
      }
      const e: LogEvent = { seq: this.seq + 1, tick, kind: p.kind, author: p.author, payload: p.payload, at: Date.now() };
      if(e.kind==='station-rules-era-v1'){
        p.reject?.(new Error('station era must be committed with its physical checkpoint'));continue;
      }
      if(isStationFactV1(e.kind)){
        try {
          if(this.extra.stationEraV1||this.extra.stationV2)throw new Error('V1 station producer is unavailable after a versioned station checkpoint');
          foldStationFactV1(this.stationHistoryV1(),e,this.stationBindingV1()); }
        catch(error){p.reject?.(error);continue;}
      }
      if(e.kind==='station-cue-v2'||e.kind==='station-anchor-v2'){
        try{foldStationFactV2(this.stationHistoryV2()!,this.stationHistoryV1()!,e,this.stationPhysicalHeadV1()!);}
        catch(error){p.reject?.(error);continue;}
      }
      let admission: LogEvent | undefined;
      let stationEra:LogEvent|undefined;
      let preview: FoldResult | undefined;
      if (p.journal) {
        // Accepted log fact and its private request reference either both exist
        // or neither does. Check current DB authority under the same write lock.
        try {
          this.db.db.exec('BEGIN IMMEDIATE');
          try {
            checkAcceptanceGuard(p.guard!);
            if(p.stationEra)stationEra=this.stationEraEvent(e);
            if (p.purpose) {
              preview = this.previewIntentAdmission(e);
              admission = this.intentAdmissionEvent(e, p.purpose, preview);
            }
            this.db.appendEvent(this.worldId, e);
            if (admission) this.db.appendEvent(this.worldId, admission);
            if(stationEra)this.db.appendEvent(this.worldId,stationEra);
            if (p.journal(e) !== true) throw new TypeError('acceptance journal must synchronously return true');
            this.db.db.exec('COMMIT');
          } catch (error) { this.db.db.exec('ROLLBACK'); throw error; }
        } catch (error) { p.reject!(error); continue; }
      } else this.db.appendEvent(this.worldId, e);
      this.seq = stationEra?.seq ?? admission?.seq ?? e.seq;
      let recovered = false;
      let result: FoldResult | undefined;
      try {
        result = this.apply(e, false);
        if (preview && (!result || result.programId !== preview.programId || result.programOk !== preview.programOk || result.programCode !== preview.programCode))
          throw new Error('purpose admission preview differs from live fold');
        if (admission) this.apply(admission, false);
        if(stationEra)this.apply(stationEra,false);
      } catch (error) {
        if(stationEra){
          // A committed structural pair cannot be attributed to an unrelated
          // card or filtered out by card-fault recovery. Restore exact history.
          try{
            this.minds.clear();this.mindByEntity.clear();this.seq=0;this.extra={};this.counts={};
            this.boot();this.ring=[];recovered=true;
          }catch(restartError){this.stop();p.reject?.(restartError);throw restartError;}
        }else {this.recoverFault(error, e.kind === 'decision' ? e.payload.card : undefined); recovered = true;}
      }
      const accepted=[e,...(admission?[admission]:[]),...(stationEra?[stationEra]:[])];
      if (!recovered||stationEra) this.acc.log.push(...accepted);
      // No listener can observe a physical event before its committed era fold.
      for (const fact of accepted) for (const l of this.listeners) l.onApplied?.(fact);
      if (admission && recovered) { p.reject?.(new PersistedIntentAdmissionFault(e.seq)); continue; }
      p.resolve?.(e);
    }
  }

  /** React to the engine's progress on depiction programs: apply a card's effects when its approach is done. */
  private afterPrograms(events: ProgramEvent[], replay: boolean) {
    for (const ev of events) {
      if(!replay)this.observeIntentTerminal(ev);
      const m = this.mindByEntity.get(ev.actor); if (!m) continue;
      const mine = m.pending && m.pending.program === ev.id ? m.pending : null;
      const playNow = () => {
        if (!mine || mine.applied) return;
        mine.applied = true;
        // during replay the play is already in the log
        if (!replay) void this.enqueue('play', `soul:${m.soulId}`, { soulId: m.soulId, card: mine.card, hash: mine.hash, target: mine.target, ...(mine.manner ? { manner: mine.manner } : {}) } satisfies PlayPayload);
      };
      if (ev.kind === 'step') { if (mine && ev.step >= mine.approachLen) playNow(); }
      else {
        if (ev.kind === 'completed') playNow();
        const outcome = ev.kind === 'completed' ? 'done' : ev.kind === 'failed' ? `could not: ${ev.code}` : 'interrupted';
        // a program replaced by a newer decision, or stopped because its card was refused, is not news
        if (ev.kind === 'failed' || (ev.kind === 'completed' && !mine) || (ev.kind === 'cancelled' && mine && ev.code !== 'program.stopped')) m.recent = [...m.recent.slice(-3), `${shorten(m.doing)} (${outcome})`];
        if (mine) m.pending = null;
        if (mine && ev.kind === 'failed') m.avoid = { id: mine.option ?? (mine.target ? `${mine.card}@${mine.target}` : mine.card), untilTick: ev.tick + 1200 };
        if (mine && ev.kind === 'failed' && m.agendaPos < m.agenda.length) m.planBlockedSince ??= ev.tick;
        if (ev.kind !== 'cancelled') {
          m.doing = 'standing around';
          // re-evaluate shortly after an activity ends; jitter by soul so they do not all think on the same tick
          m.nextEvalTick = Math.min(m.nextEvalTick, ev.tick + 10 + (hash32(m.soulId) % 30));
          m.evalTrigger = ev.kind === 'completed' ? 'activity-ended' : 'activity-failed';
        }
        this.acc.dirty.add(m.soulId);
      }
      if (!replay) for (const l of this.listeners) l.onProgram?.(ev, m);
    }
  }

  // ------------------------------------------------------------ inputs
  /** Queue an input; it is logged and applied at the next tick. Resolves with the logged event. */
  enqueue(kind: EventKind, author: string, payload: unknown): Promise<LogEvent> {
    this.assertClockReady();
    return new Promise((resolve) => this.queue.push({ kind, author, payload, resolve }));
  }

  /** Opt-in live request check at the sequencer, before any durable event/effect.
   * The guard is never serialized or replayed. It must not enqueue or mutate.
   * An optional journal writes to this Db atomically with the accepted event.
   * Queued requests remain ephemeral; this does not provide durable retries. */
  enqueueChecked(kind: EventKind, author: string, payload: unknown, guard: AcceptanceGuard, journal?: AcceptanceJournal): Promise<LogEvent> {
    this.assertClockReady();
    return new Promise((resolve, reject) => this.queue.push({ kind, author, payload, guard, journal, resolve, reject }));
  }

  /** Internal opt-in choice producer. No wire operation accepts a purpose ref
   * or activity claim. The original caller fence still owns final authority. */
  enqueueIntentDecision(author: string, payload: DecisionPayload, raw: PurposeRef, guard: AcceptanceGuard): Promise<LogEvent> {
    this.assertClockReady();
    const purpose = intentReferenceV2Schema.parse(raw), mind = this.minds.get(payload.soulId);
    if (!mind || payload.entityId !== mind.entityId || payload.continue || !payload.steps.length)
      return Promise.reject(new Error('purpose attempt requires its current body and an actual program'));
    const decision = structuredClone(payload);
    const legacyVersion = mind.intentVersion;
    const current = () => {
      checkAcceptanceGuard(guard);
      const row = this.db.soul(decision.soulId), entry = this.intentHistoryOf(decision.soulId).intents[purpose.intentId];
      if (this.minds.get(decision.soulId) !== mind || mind.intentVersion !== legacyVersion || this.quietBarrier
        || !row || row.retired_at !== null || row.world_id !== this.worldId
        || row.owner !== mind.owner || row.entity_id !== decision.entityId
        || this.kernel.things[decision.soulId]?.traits.body !== decision.entityId || !this.engine.world.entities[decision.entityId]
        || !entry || entry.status !== 'active' || entry.revision.version !== purpose.version || entry.revision.source.ownerId !== row.owner)
        throw new StaleIntentAttempt();
      return true as const;
    };
    // Under the writer lock, use the engine's read-only admission calculation
    // (or a detached exact checkpoint for adapters without that capability).
    // The ordinary decision and named private fact commit before live effects.
    return new Promise((resolve, reject) => this.queue.push({ kind:'decision', author, payload:decision,
      guard:current, journal:()=>true, purpose, resolve, reject }));
  }

  private previewIntentAdmission(decision: LogEvent): FoldResult {
    const p = decision.payload as DecisionPayload;
    const program = structuredClone({ actor:p.entityId, label:p.label, steps:p.steps });
    let result;
    if (this.engine.previewAdmission) result = this.engine.previewAdmission(program);
    else {
      if (this.engine.canSnapshot?.() === false) throw new IntentAdmissionDeferred();
      const snapshot = this.engine.snapshot(), trial = this.factory.restore(structuredClone(snapshot));
      if (trial === this.engine || trial.world === this.engine.world || trial.world.tick !== decision.tick
        || trial.stateHash() !== snapshot.stateHash || this.engine.stateHash() !== snapshot.stateHash)
        throw new IntentAdmissionDeferred();
      result = trial.perform(program);
    }
    return { programId:result.id, programOk:result.ok, programCode:result.diagnostic?.code };
  }

  private intentAdmissionEvent(decision: LogEvent, intent: PurposeRef, result: FoldResult): LogEvent {
    if (decision.kind !== 'decision' || !result.programId || result.programOk === undefined)
      throw new Error('purpose attempt lacks an admission result');
    const p = decision.payload as DecisionPayload;
    const body = { contract:INTENT_V2, worldId:this.worldId, soulId:p.soulId, intent,
      attemptId:`a_${decision.seq}`, activityId:result.programId,
      decision:{ seq:decision.seq, tick:decision.tick, entityId:p.entityId } };
    const payload: IntentAdmissionPayloadV2 = result.programOk ? { ...body, phase:'accepted' }
      : { ...body, phase:'blocked', reason:result.programCode ?? 'program refused' };
    const e: LogEvent = { seq:decision.seq+1, tick:decision.tick, kind:'intent-admission-v2',
      author:'world:intent-admission', payload, at:Date.now() };
    // Validate before committing either fact. Live fold must match this exact
    // result; replay uses the durable pair without models or current authority.
    const fact = intentAdmissionFactV2(e);
    foldIntentHistoryV2(this.intentHistoryOf(p.soulId), fact);
    return e;
  }

  private intentBindings():Record<string,ActivityBinding> {
    return this.extra.intentActivityBindingsV2 as Record<string,ActivityBinding> ?? {};
  }
  private controllerScope(binding:ActivityBinding) {
    const p=binding.payload;
    return {contract:INTENT_V2,worldId:this.worldId,soulId:p.soulId,intent:p.intent,attemptId:p.attemptId,
      activityId:p.activityId,admissionSeq:binding.admissionSeq};
  }
  private observeIntentActions() {
    if(!this.engine.programAction)return;
    for(const binding of Object.values(this.intentBindings())) {
      const p=binding.payload,history=(this.extra.intentHistoriesV2 as Record<string,IntentHistoryV2>|undefined)?.[p.soulId];
      const out=history?.attempts[p.attemptId],entry=history?.intents[p.intent.intentId];
      if(out?.phase!=='accepted' || entry?.status!=='active' || entry.revision.version!==p.intent.version)continue;
      const observed=this.engine.programAction(p.activityId);
      if(!observed || observed.programId!==p.activityId || observed.actor!==p.decision.entityId || observed.action.status!=='executing')continue;
      this.recordIntentController({...this.controllerScope(binding),phase:'started',
        observation:{tick:observed.tick,actor:observed.actor,action:{...observed.action,status:'executing'}}});
    }
  }
  private observeIntentTerminal(ev:ProgramEvent) {
    if(ev.kind==='step')return;
    for(const binding of Object.values(this.intentBindings())) {
      const p=binding.payload;
      if(p.activityId!==ev.id || p.decision.entityId!==ev.actor)continue;
      const previous=(this.extra.intentHistoriesV2 as Record<string,IntentHistoryV2>|undefined)?.[p.soulId]?.attempts[p.attemptId];
      if(previous?.phase!=='accepted' && previous?.phase!=='started')continue;
      const scope=this.controllerScope(binding),observation={tick:ev.tick,actor:ev.actor};
      if(ev.kind==='completed') {
        // Wait-only/no-op programs have no executing-action observation. Do not
        // manufacture a start to make their completion fit the ledger.
        let capturedStart=previous.phase==='started';
        try { capturedStart ||= this.intentObservations.hasCapturedStart(p.attemptId); }
        catch { this.intentControllerNotice(p.attemptId); }
        if(capturedStart)this.recordIntentController({...scope,phase:'completed',observation:{...observation,programKind:'completed'}});
      }else if(ev.kind==='failed')this.recordIntentController({...scope,phase:'blocked',reason:ev.code??'program failed',
        observation:{...observation,programKind:'failed',...(ev.code?{code:ev.code}:{})}});
      else this.recordIntentController({...scope,phase:'interrupted',reason:ev.code??'program cancelled',
        observation:{...observation,programKind:'cancelled',...(ev.code?{code:ev.code}:{})}});
    }
  }
  private recordIntentController(payload:IntentControllerPayloadV2) {
    try {
      this.intentObservations.capture(payload);
      this.reconcileIntentObservations();
    }catch {
      this.intentControllerNotice(payload.attemptId);
    }
  }
  private intentControllerNotice(attemptId:string) {
    // Persistence failure is not a physical controller fault. Report once per
    // process; keep captured evidence, without reissuing or guessing progress.
    if(this.intentControllerFaults.has(attemptId))return;
    this.intentControllerFaults.add(attemptId);
    console.error('[world] controller history requires reconciliation');
  }
  /** Publish at most 20 captured observations at or before current world time.
   * Explicitly callable while paused; boot itself remains read-only for these
   * facts. Earlier capture tick is retained in the observation, not rewritten. */
  reconcileIntentObservations():number {
    if(Object.keys(this.intentBindings()).length===0)return 0;
    let pending:IntentControllerPayloadV2[];
    try {pending=this.intentObservations.pending(this.engine.world.tick);}
    catch {this.intentControllerNotice('journal');return 0;}
    let published=0;
    for(const payload of pending) {
      try {
        const e:LogEvent={seq:this.seq+1,tick:this.engine.world.tick,kind:'intent-controller-v2',author:'world:intent-controller',payload,at:Date.now()};
        const fact=intentControllerFactV2(e);
        this.intentObservations.publish(payload,e,()=>{foldIntentHistoryV2(this.intentHistoryOf(payload.soulId),fact);});
        this.seq=e.seq;this.apply(e,false);this.acc.log.push(e);published++;
        for(const l of this.listeners)l.onApplied?.(e);
      }catch {this.intentControllerNotice(payload.attemptId);break;}
    }
    return published;
  }

  /** Apply a logged event: the fold moves the engine and the kernel; this adds the minds' bookkeeping. */
  apply(e: LogEvent, replay: boolean) {
    const tick = e.tick;
    // where the actor's plan stood just before this play (a play further down the plan must not skip a step that was possible)
    const pm = e.kind === 'play' ? this.minds.get((e.payload as PlayPayload).soulId) : undefined;
    const reach = pm && pm.agendaPos < pm.agenda.length ? frontier(this, pm) : -1;
    const matchedStep = pm ? stepIndex(this, pm, (e.payload as PlayPayload).card, (e.payload as PlayPayload).target) : -1;
    if (e.kind === 'rules' && e.payload?.recovery) { this.restoreRecovery(e.payload.recovery as RecoveryRecipe); this.seq = e.seq; return; }
    const r = foldEvent(this.engine, this.kernel, e, this.counts);
    if(isStationFactV1(e.kind))this.extra.stationV1=foldStationFactV1(this.stationHistoryV1(),e,this.stationBindingV1());
    if(e.kind==='station-rules-era-v1'){
      const old=this.extra.stationV1 as StationHistoryV1|undefined;
      if(!old)throw new Error('station era has no original station');
      const source=this.db.events(this.worldId,e.payload.source.seq-1,1)[0];
      if(!source||source.kind!=='rules'||source.seq!==e.payload.source.seq||Object.keys(source.payload).length!==1||(!source.payload.commonsTransition&&!source.payload.campExpansion))
        throw new Error('station era lacks exact canonical physical source');
      const physical=stationSourceFromRulesV1(this.worldId,source);
      const folded=foldStationRulesEraV1(this.extra.stationEraV1 as StationEraFoldStateV1|undefined,
        {seq:e.seq,tick:e.tick,payload:e.payload},physical,old.station);
      acceptStationPhysicalHeadV1(folded.head,old.station,this.stationBindingV1());
      this.extra.stationEraV1=folded;
      this.extra.stationV2={...(this.extra.stationV2 as StationHistoryV2|undefined??initialStationHistoryV2(old)),lastFactSeq:e.seq};
    }
    if(e.kind==='station-cue-v2'||e.kind==='station-anchor-v2')
      this.extra.stationV2=foldStationFactV2(this.stationHistoryV2()!,this.stationHistoryV1()!,e,this.stationPhysicalHeadV1()!);
    switch (e.kind) {
      case 'intent-request-v2': {
        const p = intentReceivedPayloadV2Schema.parse(e.payload);
        if (p.worldId !== this.worldId) throw new Error('private request belongs to another world');
        break;
      }
      case 'intent-v2': {
        const fact = intentHistoryFactV2(e);
        if (fact.worldId !== this.worldId) throw new Error('private purpose belongs to another world');
        const histories = (this.extra.intentHistoriesV2 ??= {}) as Record<string, IntentHistoryV2>;
        histories[fact.soulId] = foldIntentHistoryV2(this.intentHistoryOf(fact.soulId), fact);
        // Publication records understanding, not an admitted physical activity.
        // Choice/preemption integration remains behind the behavioral checkpoint.
        break;
      }
      case 'intent-admission-v2': {
        const fact = intentAdmissionFactV2(e), payload = e.payload as IntentAdmissionPayloadV2;
        if (fact.worldId !== this.worldId) throw new Error('private admission belongs to another world');
        const source = this.db.events(this.worldId, payload.decision.seq - 1, 1)[0];
        if (!source || source.seq !== payload.decision.seq || source.tick !== payload.decision.tick || source.kind !== 'decision'
          || source.payload.soulId !== fact.soulId || source.payload.entityId !== payload.decision.entityId || source.payload.continue)
          throw new Error('private admission lacks its canonical decision');
        const histories = (this.extra.intentHistoriesV2 ??= {}) as Record<string, IntentHistoryV2>;
        histories[fact.soulId] = foldIntentHistoryV2(this.intentHistoryOf(fact.soulId), fact);
        if(payload.phase==='accepted') {
          const bindings=(this.extra.intentActivityBindingsV2??={}) as Record<string,ActivityBinding>;
          bindings[payload.attemptId]={admissionSeq:e.seq,payload:structuredClone(payload)};
        }
        break;
      }
      case 'intent-controller-v2': {
        const fact=intentControllerFactV2(e),payload=e.payload as IntentControllerPayloadV2;
        if(fact.worldId!==this.worldId)throw new Error('private controller fact belongs to another world');
        const source=this.db.events(this.worldId,payload.admissionSeq-1,1)[0];
        if(!source || source.seq!==payload.admissionSeq || source.kind!=='intent-admission-v2')throw new Error('controller fact lacks canonical admission');
        const admitted=source.payload as IntentAdmissionPayloadV2;
        if(admitted.phase!=='accepted' || admitted.worldId!==this.worldId || admitted.soulId!==payload.soulId
          || admitted.activityId!==payload.activityId || admitted.attemptId!==payload.attemptId
          || admitted.intent.intentId!==payload.intent.intentId || admitted.intent.version!==payload.intent.version
          || admitted.decision.entityId!==payload.observation.actor)throw new Error('controller fact admission association changed');
        const histories=(this.extra.intentHistoriesV2??={}) as Record<string,IntentHistoryV2>;
        histories[fact.soulId]=foldIntentHistoryV2(this.intentHistoryOf(fact.soulId),fact);
        if(payload.phase!=='started')delete this.intentBindings()[payload.attemptId];
        break;
      }
      case 'birth': {
        const p = e.payload as BirthPayload;
        if (!this.minds.has(p.soulId)) this.addMind({
          soulId: p.soulId, entityId: p.entityId, name: p.name, description: p.description, owner: p.owner, native: p.owner === 'system',
          intent: null, intentVersion: 0, mood: 'curious', energy: 80, wantsCompany: 0.5, recent: ['arrived (done)'], doing: 'standing around',
          nextEvalTick: tick + 20 + (hash32(p.soulId) % 40), evalTrigger: 'birth', lastEnergyTick: tick, lastFingerprint: '', nudge: null,
          agenda: [], agendaPos: 0, pending: null,
          ...(this.extra.living ? { life: newLife(tick) } : {}),
        });
        this.acc.dirty.add(p.soulId); this.kernelDirty = true;
        break;
      }
      case 'mandate': {
        const p=e.payload,m=this.minds.get(p.soulId);if(!m)break;
        const rule=mandateOf(this.kernel,m.soulId).find(r=>r.id===(p.ruleId??p.rule?.id));
        if(p.op==='upsert'&&rule?.trigger.kind==='now'){
          m.activeRule=rule.id;m.intent={agenda:rule.agenda,text:rule.words};m.agenda=rule.agenda;m.agendaPos=0;m.planBlockedSince=undefined;
        }else if(m.activeRule===(p.ruleId??p.rule?.id)&&(p.op==='remove'||rule?.status!=='active'||p.op==='upsert')){
          m.activeRule=undefined;m.intent=null;m.agenda=[];m.agendaPos=0;m.planBlockedSince=undefined;
        }
        m.intentVersion++;m.nextEvalTick=tick+1;m.evalTrigger=p.op==='upsert'&&rule?.trigger.kind==='now'?'mandate-now':p.op==='wake'?'mandate-trigger':'mandate-changed';m.lastFingerprint='';
        this.acc.dirty.add(m.soulId);this.kernelDirty=true;break;
      }
      case 'intent': {
        const p = e.payload as IntentPayload; const m = this.minds.get(p.soulId);
        if (m) { m.intent = p.intent; m.agenda = p.intent.agenda ?? []; m.agendaPos = 0; m.planBlockedSince = undefined; m.intentVersion++; m.nextEvalTick = tick + 1; m.evalTrigger = 'new-intent'; m.lastFingerprint = ''; this.acc.dirty.add(m.soulId); }
        break;
      }
      case 'decision': {
        const p = e.payload as DecisionPayload; const m = this.minds.get(p.soulId);
        if (!m) break;
        if (p.continue) { if (p.mood) m.mood = p.mood; m.nextEvalTick = tick + p.reevalTicks; m.evalTrigger = 'timer'; this.acc.dirty.add(m.soulId); break; }
        if (r.programId === undefined) break;
        if (p.mood) m.mood = p.mood;
        m.doing = r.programOk ? p.label : 'standing around';
        m.nextEvalTick = tick + (r.programOk ? p.reevalTicks : 40);
        m.evalTrigger = r.programOk ? 'timer' : 'activity-failed';
        if (!r.programOk) { m.recent = [...m.recent.slice(-3), `${shorten(p.label)} (could not: ${r.programCode})`]; m.pending = null; m.avoid = { id: p.option, untilTick: tick + 1200 }; if (m.agendaPos < m.agenda.length) m.planBlockedSince ??= tick; }
        else if (p.card) {
          const card = this.kernel.vocab.cards[p.card];
          m.pending = { program: r.programId, card: p.card, hash: card?.hash ?? '', target: p.target ?? null, option: p.option, ...(p.manner ? { manner: p.manner } : {}), approachLen: p.approachLen ?? 0, applied: false };
        } else m.pending = null;
        this.acc.dirty.add(m.soulId);
        break;
      }
      case 'play': {
        const view = r.play!; const m = this.minds.get(view.soulId);
        this.kernelDirty = true;
        this.recentPlays.push(view); if (this.recentPlays.length > 200) this.recentPlays.shift();
        if (m) {
          const what = `${view.card}${view.targetName ? ` → ${view.targetName}` : ''}`;
          if (view.ok) {
            m.recent = [...m.recent.slice(-3), `${what} (done)`];
            if (m.life) { m.life.acts.push(what); if (m.life.acts.length > 100) m.life.acts.shift(); }
            const idx = matchedStep;
            if (idx >= 0 && idx <= Math.max(reach, m.agendaPos)) {
              m.agendaPos = idx + 1; m.planBlockedSince = undefined;
              if(m.activeRule&&m.agendaPos>=m.agenda.length&&!replay)void this.enqueue('mandate','world',{soulId:m.soulId,ruleId:m.activeRule,op:'status',patch:{status:'done',report:'The cards played and their objective changes are logged.'}});
              // the plan moved on: think again now, rather than sitting out the rest of this activity
              if (m.agendaPos < m.agenda.length) { m.nextEvalTick = Math.min(m.nextEvalTick, tick + 15); m.evalTrigger = 'plan-advanced'; m.lastFingerprint = ''; }
            }
            // anyone spoken to re-thinks soon: this is how asking and answering chain together
            // (small talk does not: the exchange has already happened, and waking the listener would only provoke a reply to the reply)
            for (const c of view.changes) if (c.op === 'say' && c.act !== 'chat' && c.act !== 'tell') { const o = this.minds.get(c.to); if (o) { o.nextEvalTick = Math.min(o.nextEvalTick, tick + 8 + (hash32(o.soulId) % 20)); o.evalTrigger = 'spoken-to'; o.lastFingerprint = ''; } }
          } else {
            m.recent = [...m.recent.slice(-3), `${what} (did not happen: ${view.reason})`];
            m.pending = null; m.doing = 'standing around'; m.avoid = { id: view.target ? `${view.card}@${view.target}` : view.card, untilTick: tick + 1200 };
            if (m.agendaPos < m.agenda.length) m.planBlockedSince ??= tick;
            m.nextEvalTick = Math.min(m.nextEvalTick, tick + 20); m.evalTrigger = 'activity-failed';
          }
          this.acc.dirty.add(m.soulId);
        }
        this.acc.plays.push(view);
        if (!replay) for (const l of this.listeners) l.onPlay?.(view, m);
        break;
      }
      case 'mint': case 'deck': this.kernelDirty = true; break;
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
        if (m) { this.minds.delete(m.soulId); this.mindByEntity.delete(m.entityId); this.acc.removed.push(m.soulId); }
        this.kernelDirty = true;
        break;
      }
      case 'rules': {
        const p = e.payload;
        if (p?.kernelBootstrap || p?.vocabulary || p?.adoptCamp || p?.commonsTransition || p?.campExpansion) this.kernelDirty = true;
        if(p?.commonsTransition||p?.campExpansion)for(const m of this.minds.values()){
          m.nextEvalTick=Math.min(m.nextEvalTick,tick+1+hash32(m.soulId)%20);
          m.evalTrigger='world-event';m.lastFingerprint='';
        }
        if (p?.dayConfig) { this.extra.living = { ...p.dayConfig, lastDay: -1, event: 'a new place', quiet: false }; for (const m of this.minds.values()) m.life ??= newLife(tick); }
        if(p?.runtimePolicy)this.extra.runtimePolicy=structuredClone(p.runtimePolicy);
        const day = this.living;
        if (p?.quiet && day) { day.quiet = true; day.quietDay = p.day; }
        if (p?.compact && day) { day.quiet = false; day.lastDay = p.day; if (p.firstLight) day.event = 'first light'; }
        if (p?.worldEvent && day) {
          day.event = p.worldEvent.text;
          if (p.worldEvent.day !== undefined) ((this.extra.moments ??= {}) as Record<string, number>)[p.worldEvent.id] = p.worldEvent.day;
          for (const m of this.minds.values()) { m.nextEvalTick = Math.min(m.nextEvalTick, tick + 1 + hash32(m.soulId) % 20); m.evalTrigger = 'world-event'; m.lastFingerprint = ''; }
        }
        if (p?.reflection) { const m = this.minds.get(p.soulId); if (m?.life) { m.life.journal = String(p.reflection.journal).slice(0, 1200); m.life.reflectedDay = p.reflection.day; m.life.acts = []; this.acc.dirty.add(m.soulId); } }
        if (p?.character) { const m = this.minds.get(p.soulId); if (m) { m.description = p.character; this.kernel.things[m.soulId].traits.about = p.character; if (!replay) this.db.db.prepare('UPDATE souls SET description = ? WHERE id = ?').run(p.character, m.soulId); this.kernelDirty = true; } }
        break;
      }
      case 'admin': break;
    }
    return r;
  }

  addMind(m: Mind) { this.minds.set(m.soulId, m); this.mindByEntity.set(m.entityId, m); }

  get living(): { origin: number; dayTicks: number; customs: string[]; lastDay: number; event: string; quiet: boolean; quietDay?: number } | undefined { return this.extra.living as any; }
  get quietBarrier() { return !!this.living?.quiet; }
  private advanceLives() {
    const tick = this.engine.world.tick;
    for (const m of this.minds.values()) {
      if (!m.life) continue;
      const e = this.engine.world.entities[m.entityId]; if (!e?.human) continue;
      const floater=(e as unknown as {body?:{family:string}}).body?.family==='floater';
      const nearby = [...this.mindByEntity.values()].some(other => { const b = this.engine.world.entities[other.entityId]; return other !== m && b && (!floater || Math.abs(e.pose.p[1]-b.pose.p[1])<2) && Math.hypot(e.pose.p[0] - b.pose.p[0], e.pose.p[2] - b.pose.p[2]) < 4; });
      const resting=floater&&!!this.engine.bodyResting?.(m.entityId),recharging=resting&&/bask|recharge/.test(m.doing);
      advanceNeeds(m.life, tick, resting?'rest':e.human.activity, nearby, recharging, floater); m.energy = m.life.needs.energy;
    }
  }

  private captureBody(runtime = this.engine.snapshot()): SnapshotBody {
    return { runtime, minds: structuredClone([...this.minds.values()]), seq: this.seq, extra: structuredClone(this.extra), kernel: structuredClone(this.kernel), counts: {...this.counts} };
  }
  private restoreBody(body: SnapshotBody) {
    this.engine = this.factory.restore(structuredClone(body.runtime)); this.minds.clear(); this.mindByEntity.clear();
    for (const m of structuredClone(body.minds)) this.addMind(m);
    this.kernel = structuredClone(body.kernel!); this.extra = structuredClone(body.extra); this.counts = {...body.counts};
    this.seq = body.seq;
  }
  private restoreRecovery(recipe: RecoveryRecipe) {
    this.restoreBody(recipe.baseline);
    const historicViolations=this.engine.runtime.violations.length;
    // The baseline may contain a resumable program whose later tick proved faulty.
    for (const m of this.minds.values()) if (m.pending && recipe.excluded.includes(m.pending.card)) { this.engine.stop(m.pending.program); m.pending=null; }
    for (const e of recipe.events) {
      while (this.engine.world.tick < e.tick) { const out=this.engine.step(); this.advanceLives(); this.afterPrograms(out.programs,true); }
      this.apply(e,true); this.seq=e.seq;
    }
    while (this.engine.world.tick < recipe.untilTick) { const out=this.engine.step(); this.advanceLives(); this.afterPrograms(out.programs,true); }
    if (this.engine.runtime.violations.length > historicViolations) throw new Error('recovery replay still violates the engine');
    this.extra.cardFaults = {...recipe.faults};
    this.extra.cardCooldown = {...this.extra.cardCooldown as Record<string,number>, ...Object.fromEntries(recipe.excluded.map(card=>[card,recipe.untilTick+1200]))};
    for (const m of this.minds.values()) { m.nextEvalTick=this.engine.world.tick+1; m.evalTrigger='activity-failed'; m.lastFingerprint=''; if (m.pending && recipe.excluded.includes(m.pending.card)) m.pending=null; }
    this.kernel.tick=this.engine.world.tick; sweep(this.kernel); this.kernelDirty=true;
  }
  private recoverFault(error: unknown, cardHint?: string) {
    const baseline=this.recoveryBaseline; if (!baseline) throw new Error(`No resumable recovery baseline: ${String(error)}`);
    const untilTick=this.engine.world.tick, originalSeq=this.seq, all=this.db.events(this.worldId,baseline.seq);
    const pending=[...this.minds.values()].filter(m=>m.pending).map(m=>m.pending!.card);
    const latest=[...all].reverse().find(e=>e.kind==='decision' && pending.includes(e.payload.card));
    const excluded=cardHint ? [cardHint] : latest?.payload.card ? [latest.payload.card as string] : [...new Set(pending)];
    if (!excluded.length) throw new Error(`Engine fault has no attributable card: ${String(error)}`);
    const faults={...this.extra.cardFaults as Record<string,number>};
    for (let attempt=0;attempt<2;attempt++) {
      for (const card of excluded) faults[card]=(faults[card]??0)+1;
      const events=all.filter(e=>!(['decision','play'].includes(e.kind) && excluded.includes(e.payload?.card)));
      const recipe: RecoveryRecipe={baseline:structuredClone(baseline),events,untilTick,faults:{...faults},excluded:[...excluded],reason:String(error).slice(0,800)};
      try { this.restoreRecovery(recipe); }
      catch (replayError) { if (attempt===1) throw replayError; for (const card of pending) if (!excluded.includes(card)) excluded.push(card); continue; }
      this.seq=originalSeq;
      const e: LogEvent={seq:++this.seq,tick:untilTick,kind:'rules',author:'world:recovery',payload:{recovery:recipe},at:Date.now()};
      this.db.appendEvent(this.worldId,e); this.resetAcc(); this.acc.log.push(e); this.ring=[];
      if(this.durableClockV1)this.persistClockFrontier();
      for (const m of this.minds.values()) this.acc.dirty.add(m.soulId);
      for (const l of this.listeners) l.onApplied?.(e);
      this.flush(); this.heartbeat(); return;
    }
  }

  setClockRate(rate: number, author: string, why: string) {
    this.clockRate = this.baseRate = rate; this.db.setClockRate(this.worldId, rate);
    void this.enqueue('rules', author, { clockRate: rate, why });
  }
  setPaused(p: boolean, author: string) {
    if (p) { void this.enqueue('admin', author, { action: 'pause' }); this.tickOnceForQueue(); this.paused = true; this.flush(); this.heartbeat(); }   // tell clients now: no tick will
    else { this.paused = false; this.last = performance.now(); this.carry = 0; void this.enqueue('admin', author, { action: 'resume' }); }
  }
  private tickOnceForQueue() { if (!this.paused) this.tickOnce(); }

  // ------------------------------------------------------------ views
  publicSoul(m: Mind): PublicSoul {
    const nameOf = (id: string) => this.nameOf(id);
    return {
      id: m.soulId, entityId: m.entityId, name: m.name, description: m.description, owner: ownerShort(m.owner), native: m.native,
      intent: publicIntent(m.intent), intentText: describeIntent(publicIntent(m.intent), nameOf), mood: m.mood, energy: energyWord(m.energy), doing: m.doing,
    };
  }
  /** A human-readable name for a kernel thing id, an engine entity id or a region id. */
  nameOf(id: string): string { return this.kernel.things[id]?.name ?? this.engine.world.entities[id]?.label ?? this.engine.world.regions[id]?.label ?? id; }
  private stationGenesisV1?:string;
  stationBindingV1(){
    this.assertClockReady();
    this.stationGenesisV1??=stationGenesisIdV1(this.worldId,this.seed,this.factory.genesis(this.seed));
    return {worldId:this.worldId,genesisId:this.stationGenesisV1,rulesVersion:this.engine.rulesVersion,dtSeconds:this.engine.dt};
  }
  stationHistoryV1():StationHistoryV1|undefined {
    const state=this.extra.stationV1 as StationHistoryV1|undefined;
    if(state){const binding=this.stationBindingV1();
      if(state.station.worldId!==binding.worldId||state.station.genesisId!==binding.genesisId||state.station.dtSeconds!==binding.dtSeconds)
        throw new Error('station snapshot belongs to another world or history');}
    if(state)this.stationPhysicalHeadV1();
    return state?structuredClone(state):undefined;
  }
  stationPhysicalHeadV1():StationPhysicalHeadV1|undefined {
    const old=this.extra.stationV1 as StationHistoryV1|undefined;if(!old)return undefined;
    if(this.db.world(this.worldId)?.dt!==this.engine.dt)throw new Error('station world header dt differs from native history');
    const era=this.extra.stationEraV1 as StationEraFoldStateV1|undefined;
    if(era&&hashOf(era.station)!==hashOf(old.station))throw new Error('station era original snapshot differs');
    const head=acceptStationPhysicalHeadV1(era?.head??initialStationPhysicalHeadV1(old.station),old.station,this.stationBindingV1());
    if(head.era){
      const source=this.db.events(this.worldId,head.source!.seq-1,1)[0],fact=this.db.events(this.worldId,head.era.seq-1,1)[0];
      if(!source||source.kind!=='rules'||Object.keys(source.payload).length!==1||!fact||fact.kind!=='station-rules-era-v1'
        ||hashOf(stationSourceFromRulesV1(this.worldId,source))!==hashOf(head.source)
        ||hashOf({seq:fact.seq,tick:fact.tick,payload:fact.payload})!==hashOf(head.era))throw new Error('station head lacks canonical physical/era pair');
    }
    return head;
  }
  stationHistoryV2():StationHistoryV2|undefined {
    const old=this.stationHistoryV1();if(!old)return undefined;
    return structuredClone(this.extra.stationV2 as StationHistoryV2|undefined??initialStationHistoryV2(old));
  }
  /** Trusted internal projection; authorization belongs to its caller. Detached
   * copies prevent card look-ahead and consumers from mutating private truth. */
  intentHistoryOf(soulId: string): IntentHistoryV2 {
    const histories = this.extra.intentHistoriesV2 as Record<string, IntentHistoryV2> | undefined;
    return histories && Object.hasOwn(histories, soulId)
      ? structuredClone(histories[soulId]) : emptyIntentHistoryV2(this.worldId, soulId);
  }
  /** Owner-will changes, excluding observations of work already admitted. */
  intentWillSeqOf(soulId:string):number {
    const history=(this.extra.intentHistoriesV2 as Record<string,IntentHistoryV2>|undefined)?.[soulId];
    return history?Object.values(history.intents).reduce((seq,entry)=>Math.max(seq,entry.statusSeq),0):0;
  }
  kernelView(): KernelView {
    const k = this.kernel; k.tick = this.engine.world.tick;
    const links = Object.fromEntries(Object.entries(k.links).filter(([, l]) => l.until === undefined || l.until >= k.tick));
    const things=Object.fromEntries(Object.entries(k.things).map(([id,t])=>[id,{...t,states:Object.fromEntries(Object.entries(t.states).filter(([key])=>key!==MANDATE_STATE))}]));
    return { tick: k.tick, things, links, decks: k.decks, vocab: k.vocab, hash: kernelHash({...k,things}).slice(0, 16), plays: this.counts };
  }
  viewHash(): string {
    const w = this.engine.world;
    return viewHashOf(Object.keys(w.entities).filter((id) => w.entities[id].kind === 'human').map((id) => viewRow(w.entities[id], this.engine.poseSampleOf(id))));
  }
  snapshotView(): Snapshot {
    this.assertClockReady();
    const w = this.engine.world;
    const paths: PathCommit[] = [];
    for (const id of Object.keys(w.entities)) { const p = this.engine.currentPath(id); if (p) paths.push(p); }
    return {
      tick: w.tick, seq: this.batchSeq, viewHash: this.viewHash(),
      entities: structuredClone(w.entities), regions: w.regions, env: w.env, paths,
      souls: [...this.minds.values()].map((m) => this.publicSoul(m)),
    };
  }

  private kernelSentTick = -1000;
  private resetAcc() { this.acc = { paths: [], changes: [], log: [], dirty: new Set(), removed: [], plays: [], fromTick: this.engine.world.tick }; }
  private flush() {
    const b: Batch = {
      seq: ++this.batchSeq, fromTick: this.acc.fromTick, toTick: this.engine.world.tick,
      paths: this.acc.paths, changes: this.acc.changes, log: this.acc.log, removedSouls: this.acc.removed,
      souls: [...this.acc.dirty].map((id) => this.minds.get(id)).filter((m): m is Mind => !!m).map((m) => this.publicSoul(m)),
    };
    const plays = this.acc.plays;
    this.resetAcc();
    this.ring.push(b); if (this.ring.length > RING_BATCHES) this.ring.shift();
    for (const l of this.listeners) l.onBatch?.(b);
    // links such as "just said" lapse with time, so the view also refreshes periodically
    // the whole kernel is large; what changed is already in the plays, so the full view goes out at most every two seconds
    if (plays.length) this.kernelDirty = true;
    if ((this.kernelDirty && this.engine.world.tick - this.kernelSentTick >= 40) || this.engine.world.tick % 200 === 0) { this.kernelDirty = false; this.kernelSentTick = this.engine.world.tick; const v = this.kernelView(); for (const l of this.listeners) l.onKernel?.(v); }
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
    this.assertClockReady();
    this.drainInputs();
    if(this.durableClockV1)this.persistClockFrontier();
    if (this.engine.canSnapshot && !this.engine.canSnapshot()) {
      // A graceful close still needs a durable replay destination when the
      // controller cannot serialize. Periodic retries must not log every tick.
      if (sync) {
        void this.enqueue('rules', 'world', { checkpoint: 'unsnappable-head' });
        this.drainInputs();
      }
      return { pending: true, tick: this.lastSnapshotTick };
    }
    const t0 = performance.now();
    const runtime = this.engine.snapshot();
    const body = this.captureBody(runtime);
    this.recoveryBaseline = structuredClone(body);
    const meta = { tick: runtime.tick, seq: this.seq, stateHash: runtime.stateHash, physicalHash: this.engine.physicalHash(), rulesVersion: this.engine.rulesVersion, body };
    this.snapshotMs.capture = performance.now() - t0;
    this.lastSnapshotTick = runtime.tick;
    const persist = () => { const t1 = performance.now(); this.db.saveSnapshot(this.worldId, meta); this.snapshotMs.persist = performance.now() - t1; };
    if (sync) persist(); else setImmediate(persist);
    return { tick: runtime.tick, stateHash: runtime.stateHash };
  }
  private persistClockFrontier():void {
    try{
      const frontier:ClockFrontierV1={contract:'durable-clock-frontier/1',worldId:this.worldId,
        seedHash:hashOf(this.db.world(this.worldId)!.seed),rulesVersion:this.engine.rulesVersion,dtSeconds:this.engine.dt,
        tick:this.engine.world.tick,throughSeq:this.seq,headEventHash:this.clockFrontiers.headHash(this.worldId,this.seq),
        engineHash:this.engine.stateHash(),kernelHash:kernelHash(this.kernel)};
      this.clockFrontiers.write(frontier);
    }catch(error){
      this.clockFailure=error;this.paused=true;this.stop();
      for(const listener of this.listeners)try{listener.onClockUnavailable?.();}catch{/* The durable fault remains the cause. */}
      throw error;
    }
  }
}

export const hash32 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const ownerShort = (owner: string) => (owner === 'system' ? 'world' : `u${hash32(owner).toString(36)}`);
export const energyWord = (e: number) => (e > 75 ? 'energetic' : e > 45 ? 'fine' : e > 20 ? 'tired' : 'exhausted');
const shorten = (s: string) => (s.length > 70 ? s.slice(0, 67) + '...' : s);
