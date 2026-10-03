// WorldHost: the sequencer. Owns the engine, the event log, the tick loop,
// snapshots, and the per-batch broadcast. The fold (doc 11):
//   events logged with tick T are applied when world.tick == T, then the engine steps to T+1.
import type { Engine, EngineFactory, PathCommit, ChangeEvent, ProgramEvent, EngineSnapshot, RuntimeEvent } from '@sim/engine-contract';
import { kernelHash, sweep, type KState } from '@sim/kernel';
import {
  describeIntent, publicIntent, viewHashOf, viewRow,
  type AgendaStep, type Batch, type BirthPayload, type DecisionPayload, type EventKind, type Heartbeat, type IntentPayload, type KernelView, type LogEvent,
  type PlayPayload, type PlayView, type PublicSoul, type ScenePayload, type Snapshot, type WireIntent,
} from '@sim/protocol';
import type { Db } from './db.ts';
import { advanceNeeds, newLife, type Life } from '@sim/brain';
import { arrivalPlace, baseVocabulary, codeVocabulary, foldEvent, initKernel, pinnedVocabulary, soulThing, type Vocabulary } from './fold.ts';
import { frontier, stepIndex } from './deck.ts';
import {mandateOf,MANDATE_STATE} from './mandate.ts';
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
type Pending = { kind: EventKind; author: string; payload: any; resolve?: (e: LogEvent) => void };
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

  constructor(db: Db, factory: EngineFactory, seed: string, snapshotEvery: number, worldId = 'toy-1') {
    this.worldId = worldId;
    this.db = db; this.factory = factory; this.seed = seed; this.snapshotEvery = snapshotEvery;
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
    const snap = this.db.latestSnapshot(this.worldId);
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
    let repaired = -1; for (let i=0;i<later.length;i++) if (later[i].kind === 'rules' && later[i].payload?.recovery) repaired=i;
    if (repaired >= 0) { this.apply(later[repaired], true); this.seq = later[repaired].seq; later = later.slice(repaired + 1); }
    for (const e of later) {
      while (this.engine.world.tick < e.tick) { const out = this.engine.step(); this.advanceLives(); this.afterPrograms(out.programs, true); }
      this.apply(e, true);
      this.seq = e.seq;
    }
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
    this.afterPrograms(out.programs, false);
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

  /** Finish already accepted inputs without advancing the engine or starting new mind work. */
  drainInputs() {
    const tick = this.engine.world.tick;
    const pending = this.queue.splice(0);
    for (const p of pending) {
      const e: LogEvent = { seq: ++this.seq, tick, kind: p.kind, author: p.author, payload: p.payload, at: Date.now() };
      this.db.appendEvent(this.worldId, e);
      let recovered = false;
      try { this.apply(e, false); } catch (error) { this.recoverFault(error, e.kind === 'decision' ? e.payload.card : undefined); recovered = true; }
      if (!recovered) this.acc.log.push(e);
      for (const l of this.listeners) l.onApplied?.(e);
      p.resolve?.(e);
    }
  }

  /** React to the engine's progress on depiction programs: apply a card's effects when its approach is done. */
  private afterPrograms(events: ProgramEvent[], replay: boolean) {
    for (const ev of events) {
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
    return new Promise((resolve) => this.queue.push({ kind, author, payload, resolve }));
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
    switch (e.kind) {
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
        if (p?.kernelBootstrap || p?.vocabulary || p?.adoptCamp) this.kernelDirty = true;
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
    this.drainInputs();
    if (this.engine.canSnapshot && !this.engine.canSnapshot()) return { pending: true, tick: this.lastSnapshotTick };
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
}

export const hash32 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const ownerShort = (owner: string) => (owner === 'system' ? 'world' : `u${hash32(owner).toString(36)}`);
export const energyWord = (e: number) => (e > 75 ? 'energetic' : e > 45 ? 'fine' : e > 20 ? 'tired' : 'exhausted');
const shorten = (s: string) => (s.length > 70 ? s.slice(0, 67) + '...' : s);
