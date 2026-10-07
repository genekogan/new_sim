// Core-Ledger: capabilities v2, direct act with durable receipts, Tier 1 observe, map,
// and the read-only hooks Core-Comms routes events and speech with. No model calls.
import {randomUUID} from 'node:crypto';
import type {Program} from '@sim/engine-contract';
import {clockAt} from '@sim/brain';
import type {WorldState as NativeWorld} from '../../../../../mars/viewer/engine/world/types.ts';
import type {WorldHost, Mind} from '../../world.ts';
import type {Db} from '../../db.ts';
import {readHumanCapabilitiesV1, type HumanBindingV1} from '../../human-capabilities.ts';
import {humanBlockedExplanationV1} from '../../human-wait-condition.ts';
import {EdgeError, type EdgeCapability, type EdgeLedgerHooks, type EdgeReceipt, type EdgeSoul, type NearbyBody, type PlaceRef} from '../contract.ts';
import {PlaceIndex, centroid, derivePlaceData, happenings, validatePlaceData, type PlaceData} from './places.ts';
import {resolveCapability, tokens, type VocabContext} from './vocabulary.ts';

type Resolved = {from: string; to: string; note: string};
const WAIT_CODES = new Set(['program.safe-stop-required', 'program.safe-stop-pending']);
const WAIT_LIMIT_TICKS = 20 * 60;   // a waiting receipt that cannot start within a minute fails
const NEAR_RADIUS = 20;
const OPEN: EdgeReceipt['phase'][] = ['waiting', 'started'];
type Row = {receipt_id: string; soul_id: string; capability: string; phase: EdgeReceipt['phase']; accepted_tick: number; started_tick: number | null; ended_tick: number | null; code: string | null; reason: string | null; program_id: string | null; client_ref: string | null; plan?: string | null};
type Pending = {receipt: string; soul: EdgeSoul; steps: Program['steps']; label: string; deadline: number; capability: string};

export class EdgeLedger implements EdgeLedgerHooks {
  places: PlaceIndex;
  private receiptListeners: ((r: EdgeReceipt) => void)[] = [];
  private placeListeners: ((e: {soulId: string; from: string | null; to: string | null; tick: number}) => void)[] = [];
  private providers: ((s: EdgeSoul) => EdgeCapability[])[] = [];
  private pending = new Map<string, Pending>();           // soulId → waiting act
  private lastPlace = new Map<string, string | null>();
  /** Server start (ms): metrics count world model calls only from here, not copied history. */
  readonly startedAt = Date.now();
  private capCache = new Map<string, {tick: number; value: {caps: EdgeCapability[]; plans: Map<string, {label: string; steps: Program['steps']; seconds?: boolean; stop?: boolean}>}}>();
  comms?: {streams: {headCursor(soulId: string): string}; fading: {status(soulId: string): unknown; touch?(soulId: string): void}; objects: {act?(id: string, soul: EdgeSoul, input: Record<string, unknown>): unknown; visibleTo(soul: EdgeSoul): unknown[]; create(i: {id: string; kind: string; name: string; description?: string; placeId: string; params?: Record<string, unknown>}): {id: string}; all(): {id: string; kind: string; placeId: string; state: unknown}[]}; close(): void};
  attachComms(c: NonNullable<EdgeLedger['comms']>) {
    this.comms = c;
    // C9 body effects (fading itself only runs when Comms' fading flag is on — Gene has not approved it).
    (c as unknown as {fading?: {onFade?(l: (e: {soulId: string; change: string}) => void): void}}).fading?.onFade?.(e => {
      const m = this.host.minds.get(e.soulId); if (!m) return;
      if (e.change === 'removed') {
        this.faded.add(e.soulId); this.pending.delete(e.soulId);
        // Not replaced by the Soul's own act: its open receipts end failed, so agents can tell why.
        for (const r of this.openReceipts(e.soulId)) this.update(r.id, {phase: 'failed', code: 'soul.faded', reason: 'This Soul faded out after an hour without an accepted action; act again to come back.'});
        if (this.host.engine.programOf(m.entityId)) void this.host.enqueue('edge-stop', `edge:${e.soulId}`, {soulId: e.soulId, entityId: m.entityId, why: 'faded'});
      }
    });
  }
  /** Souls faded out (removed at 60 min idle); their next act lands them at a starting place. */
  readonly faded = new Set<string>();
  private startingPoint(soulId: string): [number, number] {
    // Only starting places on admitted native ground (an engine region of the same id); W1 scenery (e.g. region-*) is never a landing spot.
    const ground = (this.host.engine.world as {regions?: Record<string, unknown>}).regions ?? {};
    const all = [...this.places.byId.values()].filter(p => p.starting && p.parent !== null), native = all.filter(p => p.id in ground);
    const starts = native.length ? native : all;
    const pick = starts.length ? starts[[...soulId].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % starts.length] : [...this.places.byId.values()][0];
    return centroid(pick.polygon);
  }
  readonly host: WorldHost; readonly db: Db;
  /** Ambient life reflex (Gene: Souls visibly alive between agent decisions); the edge server turns it on. */
  readonly ambient: boolean;
  private idleSince = new Map<string, number>();
  constructor(host: WorldHost, db: Db, placeData?: unknown, options: {ambient?: boolean} = {}) {
    this.host = host; this.db = db; this.ambient = options.ambient === true;
    db.db.exec(`CREATE TABLE IF NOT EXISTS edge_receipts_v1 (world_id TEXT NOT NULL, receipt_id TEXT NOT NULL, soul_id TEXT NOT NULL, capability TEXT NOT NULL, phase TEXT NOT NULL,
      accepted_tick INTEGER NOT NULL, started_tick INTEGER, ended_tick INTEGER, code TEXT, reason TEXT, program_id TEXT, client_ref TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (world_id, receipt_id));
      CREATE INDEX IF NOT EXISTS edge_receipts_v1_soul ON edge_receipts_v1 (world_id, soul_id, phase);
      CREATE TABLE IF NOT EXISTS edge_refusals_v1 (world_id TEXT NOT NULL, at INTEGER NOT NULL, tick INTEGER NOT NULL, soul_id TEXT NOT NULL, verb TEXT NOT NULL, capability TEXT NOT NULL, code TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS edge_refusals_v1_at ON edge_refusals_v1 (world_id, at);`);
    // PM-R055: a waiting act's plan is kept with its receipt so a restart re-arms it instead of losing it.
    if (!(db.db.prepare('PRAGMA table_info(edge_receipts_v1)').all() as {name: string}[]).some(c => c.name === 'plan')) db.db.exec('ALTER TABLE edge_receipts_v1 ADD COLUMN plan TEXT');
    this.places = new PlaceIndex(this.loadPlaces(placeData));
    // Open receipts from a previous process: a started one whose programme the snapshot carries is still followed;
    // a waiting one with its plan is re-armed (fresh one-minute wait); anything else cannot be followed honestly.
    for (const r of this.rows("phase IN ('waiting','started')")) {
      const m = host.minds.get(r.soul_id);
      if (r.phase === 'started' && r.program_id && m && host.engine.programOf(m.entityId) === r.program_id) continue;
      const plan = r.phase === 'waiting' && r.plan ? JSON.parse(r.plan) as {label: string; steps: Program['steps']} : null;
      if (plan && m && !this.pending.has(r.soul_id)) {this.pending.set(r.soul_id, {receipt: r.receipt_id, soul: {soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner}, steps: plan.steps, label: plan.label, deadline: host.engine.world.tick + WAIT_LIMIT_TICKS, capability: r.capability}); continue;}
      this.update(r.receipt_id, {phase: 'failed', code: 'receipt.lost-on-restart', reason: 'The server restarted before this action could be followed to its end.'});
    }
    host.listeners.push({
      onDecision: (e, r) => this.onDecision(e, r),
      onProgram: ev => this.onProgram(ev),
      afterTick: tick => this.afterTick(tick),
    });
  }
  private loadPlaces(raw: unknown): PlaceData {
    const world = this.host.engine.world as NativeWorld;
    if (raw === undefined) return derivePlaceData(world);
    const errs = validatePlaceData(raw, world);
    if (errs.length) throw new Error('place-data rejected: ' + errs.slice(0, 10).join('; '));
    return raw as PlaceData;
  }

  // ---------------------------------------------------------------- receipts
  private rows(where: string, ...args: (string | number | null)[]): Row[] {return this.db.db.prepare(`SELECT * FROM edge_receipts_v1 WHERE world_id=? AND ${where}`).all(this.host.worldId, ...args) as Row[];}
  private view(r: Row): EdgeReceipt {return {id: r.receipt_id, soulId: r.soul_id, capability: r.capability, phase: r.phase, acceptedTick: r.accepted_tick, startedTick: r.started_tick, endedTick: r.ended_tick, code: r.code, reason: r.reason, programId: r.program_id};}
  receipt(soulId: string, id: string): EdgeReceipt | null {const r = this.rows('receipt_id=? AND soul_id=?', id, soulId)[0]; return r ? this.view(r) : null;}
  openReceipts(soulId: string): EdgeReceipt[] {return this.rows("soul_id=? AND phase IN ('waiting','started') ORDER BY accepted_tick", soulId).map(r => this.view(r));}
  private insert(soul: EdgeSoul, capability: string, phase: EdgeReceipt['phase'], clientRef?: string, keepActivity = false): EdgeReceipt {
    const id = 'r_' + randomUUID(), tick = this.host.engine.world.tick;
    if (!keepActivity) {for (const old of this.openReceipts(soul.soulId)) this.update(old.id, {phase: 'replaced', reason: 'A newer action from this Soul replaced it.'}); this.pending.delete(soul.soulId);}
    this.db.db.prepare('INSERT INTO edge_receipts_v1 (world_id,receipt_id,soul_id,capability,phase,accepted_tick,client_ref,created_at) VALUES (?,?,?,?,?,?,?,?)').run(this.host.worldId, id, soul.soulId, capability, phase, tick, clientRef ?? null, Date.now());
    const r = this.receipt(soul.soulId, id)!; this.emit(r); return r;
  }
  private update(id: string, patch: Partial<Pick<Row, 'phase' | 'code' | 'reason' | 'program_id' | 'started_tick'>>) {
    const cur = this.rows('receipt_id=?', id)[0]; if (!cur) return;
    if (!OPEN.includes(cur.phase) && patch.phase) return;                  // terminal stays terminal
    const tick = this.host.engine.world.tick, next = {...cur, ...patch};
    if (patch.phase === 'started' && next.started_tick === null) next.started_tick = tick;
    if (patch.phase && !OPEN.includes(patch.phase)) next.ended_tick = tick;
    this.db.db.prepare('UPDATE edge_receipts_v1 SET phase=?,code=?,reason=?,program_id=?,started_tick=?,ended_tick=? WHERE world_id=? AND receipt_id=?').run(next.phase, next.code, next.reason, next.program_id, next.started_tick, next.ended_tick, this.host.worldId, id);
    if (patch.phase && patch.phase !== cur.phase) this.emit(this.view(next));
  }
  private emit(r: EdgeReceipt) {for (const l of this.receiptListeners) try {l(r);} catch {/* listener faults never break the ledger */}}
  private onDecision(e: {payload: unknown}, r: {programId?: string; programOk?: boolean; programCode?: string}) {
    const p = e.payload as {trigger?: string}, m = /^edge-act:(r_[0-9a-f-]+)$/.exec(p.trigger ?? ''); if (!m) return;
    if (r.programOk && r.programId) this.update(m[1], {phase: 'started', program_id: r.programId});
    else this.update(m[1], {phase: 'failed', code: r.programCode ?? 'program.refused', reason: humanBlockedExplanationV1(r.programCode, 'That action')});
  }
  private onProgram(ev: {id: string; kind: string; code?: string; message?: string}) {
    if (ev.kind === 'step') return;
    const r = this.rows("program_id=? AND phase IN ('waiting','started')", ev.id)[0]; if (!r) return;
    if (ev.kind === 'completed') this.update(r.receipt_id, {phase: 'completed'});
    // 'replaced' means only "a newer act from this Soul superseded it", and that is recorded at act time (insert),
    // before the old programme is cancelled. A receipt still open here was ended by something else: report it failed.
    else if (ev.kind === 'cancelled' && (ev.code === 'program.replaced' || ev.code === 'program.stopped')) this.update(r.receipt_id, {phase: 'failed', code: 'action.interrupted', reason: 'Something else in the world interrupted this before it finished; choose again.'});
    else this.update(r.receipt_id, {phase: 'failed', code: ev.code ?? 'action.failed', reason: ev.message ?? humanBlockedExplanationV1(ev.code, 'That action')});
  }
  private afterTick(tick: number) {
    for (const [soulId, p] of this.pending) {
      if (this.host.quietBarrier) {p.deadline = Math.max(p.deadline, tick + WAIT_LIMIT_TICKS); continue;}   // the wait clock pauses during renewal
      if (tick > p.deadline) {this.pending.delete(soulId); this.update(p.receipt, {phase: 'failed', code: 'state.safe-stop-timeout', reason: 'The body could not reach a safe stop within a minute.'}); continue;}
      if (this.host.quietBarrier) continue;
      const issue = this.host.engine.canPerform({actor: p.soul.entityId, label: p.label, steps: p.steps});
      if (issue && WAIT_CODES.has(issue.code)) continue;
      this.pending.delete(soulId); this.db.db.prepare('UPDATE edge_receipts_v1 SET plan=NULL WHERE world_id=? AND receipt_id=?').run(this.host.worldId, p.receipt);
      if (issue) {this.update(p.receipt, {phase: 'failed', code: issue.code, reason: humanBlockedExplanationV1(issue.code, p.label)}); continue;}
      void this.decide(p.soul, p.receipt, p.capability, p.label, p.steps).catch(() => this.update(p.receipt, {phase: 'failed', code: 'ledger.unavailable', reason: 'The world could not record this action.'}));
    }
    if (this.ambient && tick % 20 === 0) this.ambientLife(tick);
    if (tick % 10 === 0) for (const m of this.host.minds.values()) {
      const to = this.innermostPlace(m), from = this.lastPlace.has(m.soulId) ? this.lastPlace.get(m.soulId)! : to;
      this.lastPlace.set(m.soulId, to);
      if (from !== to) for (const l of this.placeListeners) try {l({soulId: m.soulId, from, to, tick});} catch {/* ignore */}
    }
  }
  /** Ambient life reflex: a Soul with nothing running for 20 s (no programme, no open or waiting receipt, awake,
   *  not faded) gets one small native thing to do near where it is: warm by a fire within 15 m, sit on a free seat
   *  within 10 m, turn towards someone within 6 m, or a short stroll. Chosen deterministically (Soul id + tick),
   *  logged as an ordinary decision (trigger edge-ambient) so replay is exact; no receipt, not an accepted action
   *  for fading or metrics. Any agent act simply replaces it. Never model calls. */
  private ambientLife(tick: number) {
    for (const m of this.host.minds.values()) {
      const busy = this.faded.has(m.soulId) || this.pending.has(m.soulId) || !!this.host.engine.programOf(m.entityId) || this.openReceipts(m.soulId).length > 0;
      const b = this.body(m.entityId), state = stateOf(this.host, m.entityId);
      if (busy || !b || state === 'sleeping' || state === 'absent' || state === 'swimming') {this.idleSince.set(m.soulId, tick); continue;}
      const since = this.idleSince.get(m.soulId); if (since === undefined) {this.idleSince.set(m.soulId, tick); continue;}
      if (tick - since < 400) continue;
      this.idleSince.set(m.soulId, tick);
      const soul: EdgeSoul = {soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner}, pick = ambientChoice(this, soul, b, tick);
      if (!pick) continue;
      void this.host.enqueue('decision', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, option: pick.id, label: pick.label, steps: pick.steps, reevalTicks: 1e9, fallback: false, trigger: 'edge-ambient'}).catch(() => {/* best effort */});
    }
  }
  /** @internal ambient helper: the capability plans near this Soul (cached per tick). */
  ambientPlans(soul: EdgeSoul) {return this.binds(soul);}
  private arm(p: Pending) {
    this.pending.set(p.soul.soulId, p);
    this.db.db.prepare('UPDATE edge_receipts_v1 SET plan=? WHERE world_id=? AND receipt_id=?').run(JSON.stringify({label: p.label, steps: p.steps}), this.host.worldId, p.receipt);
  }
  private decide(soul: EdgeSoul, receipt: string, capability: string, label: string, steps: Program['steps']) {
    return this.host.enqueue('decision', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, option: capability, label, steps, reevalTicks: 1e9, fallback: false, trigger: `edge-act:${receipt}`});
  }

  // ---------------------------------------------------------------- capabilities
  private binds(soul: EdgeSoul): {caps: EdgeCapability[]; plans: Map<string, {label: string; steps: Program['steps']; seconds?: boolean; stop?: boolean}>} {
    const tick = this.host.engine.world.tick, hit = this.capCache.get(soul.soulId);
    if (hit && hit.tick === tick) return hit.value;
    const m = this.mind(soul), read = readHumanCapabilitiesV1(this.host, m, {registeredActivitiesV1: true, deferRouteChecks: true, skipRegisteredCards: true});
    const caps: EdgeCapability[] = [], plans = new Map<string, {label: string; steps: Program['steps']; seconds?: boolean; stop?: boolean}>();
    const secondsParam = {seconds: {type: 'integer', min: 1, max: 600, default: 60}};
    for (const b of read.bindings.values()) {
      const {id, verb} = edgeIdOf(b); const seconds = b.goal === 'sit' || b.goal === 'rest' || b.goal === 'hang_out';
      const target = b.targetId ? {id: b.targetId, kind: this.places.byId.has(b.targetId) ? 'place' : this.host.engine.world.entities[b.targetId] ? 'object' : 'place'} : undefined;
      caps.push({id, verb, label: b.label, available: b.available, ...(target ? {target} : {}), ...(b.available ? {} : {blocked: {code: b.blockedCode ?? 'physical.unavailable', reason: humanBlockedExplanationV1(b.blockedCode, b.label)}}), ...(seconds ? {params: secondsParam} : {})});
      plans.set(id, {label: b.label, steps: b.steps, seconds});
    }
    caps.push({id: 'stand:here', verb: 'stand', label: 'Stand up / stop what I am doing', available: true});
    plans.set('stand:here', {label: 'Stand up', steps: [], stop: true});
    for (const o of this.perceivedBodies(soul.soulId, NEAR_RADIUS)) {
      const id = 'go-near:' + o.soulId, steps: Program['steps'] = [{verb: 'walk_to', params: {to: o.entityId, standoff: 1.3}}];
      caps.push({id, verb: 'go-near', label: `Go near ${o.name}`, target: {id: o.soulId, kind: 'soul'}, available: true});   // route checked at act time
      plans.set(id, {label: `Go near ${o.name}`, steps});
    }
    // Lasting marks (objects the Soul authors where it stands): a note/sign/offering, or a shared project.
    if (this.comms) {
      const makeParams = {form: {type: 'string', enum: ['note', 'sign', 'offering', 'proposal'], optional: true}, title: {type: 'string', maxLength: 60}, text: {type: 'string', maxLength: 500}};
      caps.push({id: 'make:mark', verb: 'make', label: 'Leave a note, sign, offering or proposal here (lasting; others can read and respond; the steward may calendar proposals)', available: true, params: makeParams});
      caps.push({id: 'make:project', verb: 'make', label: 'Start a shared project here (others can contribute steps)', available: true, params: {title: {type: 'string', maxLength: 60}, text: {type: 'string', maxLength: 500}}});
      plans.set('make:mark', {label: 'Make a mark', steps: [], make: 'mark'} as never); plans.set('make:project', {label: 'Start a project', steps: [], make: 'project'} as never);
    }
    // Social and expressive native verbs: visible, deterministic, shared by many Souls at once.
    const secondsOf = (def: number, max: number) => ({seconds: {type: 'integer', min: 5, max, default: def}});
    caps.push({id: 'wander:here', verb: 'wander', label: 'Stroll around nearby', available: true, params: secondsOf(60, 300)});
    plans.set('wander:here', {label: 'Stroll around nearby', steps: [{verb: 'ambient_wander', params: {seconds: 60, radius: 8}}], seconds: true});
    for (const o of this.perceivedBodies(soul.soulId, NEAR_RADIUS)) {
      caps.push({id: 'wave:' + o.soulId, verb: 'wave', label: `Wave to ${o.name}`, target: {id: o.soulId, kind: 'soul'}, available: true});
      plans.set('wave:' + o.soulId, {label: `Wave to ${o.name}`, steps: [{verb: 'walk_to', params: {to: o.entityId, standoff: 1.6}}, {verb: 'wave', params: {at: o.entityId, seconds: 3}}]});
      caps.push({id: 'face:' + o.soulId, verb: 'face', label: `Turn towards ${o.name}`, target: {id: o.soulId, kind: 'soul'}, available: true});
      plans.set('face:' + o.soulId, {label: `Turn towards ${o.name}`, steps: [{verb: 'wave', params: {at: o.entityId, seconds: 1}}]});
    }
    const me = this.body(soul.entityId), w = this.host.engine.world as NativeWorld;
    if (me) {
      for (const e of Object.values(w.entities)) {
        if (e.def !== 'campfire' || Math.hypot(e.pose.p[0] - me.pose.p[0], e.pose.p[2] - me.pose.p[2]) > 60) continue;
        const id = 'warm-by-fire:' + e.id, label = 'Warm up by the fire with whoever is there';
        caps.push({id, verb: 'warm-by-fire', label, target: {id: e.id, kind: 'object'}, available: true, params: secondsOf(120, 600)});
        plans.set(id, {label, steps: [{verb: 'mars:campfire_circle', params: {actors: [soul.entityId], fire: e.id}}, {verb: 'rest', params: {seconds: 120}}], seconds: true});
      }
      for (const [rid, r] of Object.entries(w.regions ?? {}) as [string, {polygon: [number, number][]}][]) {
        const [cx, cz] = centroid(r.polygon); if (Math.hypot(cx - me.pose.p[0], cz - me.pose.p[2]) > 60 || !this.places.byId.has(rid)) continue;
        const id = 'gather:' + rid, label = `Gather with others at ${this.places.byId.get(rid)!.name}`;
        caps.push({id, verb: 'gather', label, target: {id: rid, kind: 'place'}, available: true, params: secondsOf(120, 600)});
        plans.set(id, {label, steps: [{verb: 'gather', params: {at: rid, seconds: 120}}], seconds: true});
      }
    }
    for (const p of this.providers) try {caps.push(...p(soul));} catch {/* a provider fault hides only its own entries */}
    const value = {caps, plans}; this.capCache.set(soul.soulId, {tick, value}); return value;
  }
  capabilities(soul: EdgeSoul): EdgeCapability[] {return this.binds(soul).caps;}
  addCapabilityProvider(p: (soul: EdgeSoul) => EdgeCapability[]) {this.providers.push(p);}

  recordRefusal(soulId: string, verb: string, capability: string, code: string) {
    try {this.db.db.prepare('INSERT INTO edge_refusals_v1 (world_id,at,tick,soul_id,verb,capability,code) VALUES (?,?,?,?,?,?,?)').run(this.host.worldId, Date.now(), this.host.engine.world.tick, soulId, verb.slice(0, 40), capability.slice(0, 200), code.slice(0, 100));} catch {/* measurement never breaks acting */}
  }
  /** Counts only (no agent text): acts, receipts by phase, refusals by code, active Souls, speech/conversations when Comms is present. */
  metrics(windowMs = 3600_000) {
    const w = this.host.worldId, since = Date.now() - windowMs, q = (sql: string, ...a: (string | number)[]) => this.db.db.prepare(sql).all(w, ...a) as Record<string, number | string>[];
    const has = (t: string) => !!this.db.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
    const count = (sql: string, ...a: (string | number)[]) => Number((this.db.db.prepare(sql).get(w, ...a) as {n: number}).n);
    const accepted = count('SELECT COUNT(*) n FROM edge_receipts_v1 WHERE world_id=? AND created_at>=?', since), refused = count('SELECT COUNT(*) n FROM edge_refusals_v1 WHERE world_id=? AND at>=?', since);
    const active = count('SELECT COUNT(DISTINCT soul_id) n FROM edge_receipts_v1 WHERE world_id=? AND created_at>=?', since);
    return {window: {ms: windowMs, since}, actsPerActiveSoulPerHour: active ? Math.round(accepted / active / (windowMs / 3600_000) * 10) / 10 : null,
      acts: {accepted, refused, refusalRate: accepted + refused ? Math.round(refused / (accepted + refused) * 1000) / 1000 : null},
      receiptsByPhase: Object.fromEntries(q('SELECT phase k, COUNT(*) n FROM edge_receipts_v1 WHERE world_id=? AND created_at>=? GROUP BY phase', since).map(r => [r.k, r.n])),
      // Finished receipts: completed vs failed (by code) vs replaced by the Soul's own newer act (lasting marks count as completed).
      receiptFailuresByCode: Object.fromEntries(q("SELECT code k, COUNT(*) n FROM edge_receipts_v1 WHERE world_id=? AND created_at>=? AND phase='failed' GROUP BY code ORDER BY n DESC", since).map(r => [r.k, r.n])),
      completedShareOfFinished: (() => {const r = q("SELECT SUM(phase='completed') c, SUM(phase IN ('completed','failed','replaced')) n FROM edge_receipts_v1 WHERE world_id=? AND created_at>=?", since)[0]; return Number(r?.n) ? Math.round(Number(r.c) / Number(r.n) * 1000) / 1000 : null;})(),
      refusalsByCode: Object.fromEntries(q('SELECT verb||\' \'||code k, COUNT(*) n FROM edge_refusals_v1 WHERE world_id=? AND at>=? GROUP BY verb, code ORDER BY n DESC', since).map(r => [r.k, r.n])),
      activeSouls: count('SELECT COUNT(DISTINCT soul_id) n FROM edge_receipts_v1 WHERE world_id=? AND created_at>=?', since),
      speech: has('edge_comms_speech') ? count('SELECT COUNT(*) n FROM edge_comms_speech WHERE world_id=? AND at>=?', since) : null,
      conversationTurns: has('edge_comms_turns') ? count('SELECT COUNT(*) n FROM edge_comms_turns WHERE world_id=? AND at>=?', since) : null,
      worldModelCalls: count('SELECT COUNT(*) n FROM brain_calls WHERE world_id=? AND at>=?', Math.max(since, this.startedAt)),
      worldModelCallsCountedSince: Math.max(since, this.startedAt),
      tick: this.host.engine.world.tick};
  }

  // ---------------------------------------------------------------- act
  async act(soul: EdgeSoul, input: {capability?: unknown; params?: unknown; clientRef?: unknown}): Promise<{accepted: true; receipt: EdgeReceipt; resolved?: Resolved; result?: unknown} | {accepted: false; code: string; reason: string; capability: string; retry_after?: number; did_you_mean?: {id: string; label: string}[]; resolved?: Resolved}> {
    const asked = typeof input.capability === 'string' ? input.capability : '';
    if (!asked || asked.length > 200) throw new EdgeError(400, 'invalid', 'body must be {capability, params?, clientRef?}');
    let capability = asked;
    const clientRef = typeof input.clientRef === 'string' && input.clientRef.length <= 100 ? input.clientRef : undefined;
    if (clientRef) {const old = this.rows('soul_id=? AND client_ref=?', soul.soulId, clientRef)[0]; if (old) return {accepted: true, receipt: this.view(old)};}
    const refuse = (code: string, reason: string, extra?: {retry_after?: number}) => {this.recordRefusal(soul.soulId, 'act', capability, code); return {accepted: false as const, code, reason, capability, ...extra};};
    if (this.faded.has(soul.soulId)) {
      // Reclaim: fall onto feet at a starting place, identity and history intact (C9).
      this.faded.delete(soul.soulId);
      await this.host.enqueue('edge-relocate', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, to: this.startingPoint(soul.soulId), why: 'reclaimed after fading'});
      this.capCache.delete(soul.soulId);
    }
    const {caps, plans} = this.binds(soul);
    // PM-R057: exact ids first; an unambiguous natural name is accepted and reported back as `resolved`;
    // anything else is refused with the closest offered capabilities.
    const v = caps.some(c => c.id === asked) ? {kind: 'exact' as const, cap: caps.find(c => c.id === asked)!} : resolveCapability(asked, this.vocabulary(soul, caps));
    if (v.kind === 'unknown') return {...refuse('capability.unknown', v.reason), did_you_mean: v.didYouMean};
    const cap = v.cap; capability = cap.id;
    const resolved: {resolved?: Resolved} = v.kind === 'alias' ? {resolved: {from: asked, to: cap.id, note: v.note}} : {};
    if (cap.verb === 'object' && cap.object && cap.action && this.comms?.objects.act) {
      // Object actions listed in capabilities may be acted on here too (same effect as POST /objects/:id/act);
      // an accepted one gets a completed receipt (like make:mark) and never interrupts the body.
      const out = this.comms.objects.act(cap.object, soul, {action: cap.action, params: input.params ?? {}}) as {accepted: boolean; code?: string; reason?: string; result?: unknown};
      if (!out.accepted) {
        // Out of reach: point at the walk that gets there.
        const placeId = out.code === 'object.out-of-reach' ? this.comms.objects.all().find(o => o.id === cap.object)?.placeId : undefined, go = placeId ? caps.find(c => c.id === 'walk:' + placeId) : undefined;
        return {...refuse(out.code ?? 'object.refused', out.reason ?? 'The object refused that action.'), ...(go ? {did_you_mean: [{id: go.id, label: go.label}]} : {}), ...resolved};
      }
      this.comms.fading.touch?.(soul.soulId);
      const r = this.insert(soul, capability, 'completed', clientRef, true);
      return {accepted: true, receipt: {...this.receipt(soul.soulId, r.id)!, object: cap.object} as EdgeReceipt, ...(out.result ? {result: out.result} : {}), ...resolved};
    }
    const plan = plans.get(capability);
    if (!plan) return refuse('capability.unknown', 'That capability is not offered to this Soul right now; read capabilities again.');
    const params = (input.params && typeof input.params === 'object' ? input.params : {}) as Record<string, unknown>;
    let steps = structuredClone(plan.steps);
    if (params.seconds !== undefined) {
      if (!plan.seconds || !Number.isInteger(params.seconds) || (params.seconds as number) < 1 || (params.seconds as number) > 600) return refuse('capability.params', 'seconds must be an integer 1..600 for this capability.');
      for (const s of steps) if (s.verb === 'rest' || s.verb === 'ambient_wander' || s.verb === 'gather') s.params.seconds = params.seconds;
    }
    const make = (plan as {make?: 'mark' | 'project'}).make;
    if (make && this.comms) {
      const title = typeof params.title === 'string' ? params.title.trim() : '', text = typeof params.text === 'string' ? params.text.trim() : '';
      if (!title || title.length > 60 || text.length > 500 || (make === 'mark' && !text)) return refuse('capability.params', 'give a title (<=60) and text (<=500)');
      const mine = this.comms.objects.all().filter(o => (o.kind === 'mark' || o.kind === 'project') && ((o.state as {author?: {soulId: string}; creator?: {soulId: string}; removed?: boolean}).author?.soulId === soul.soulId || (o.state as {creator?: {soulId: string}}).creator?.soulId === soul.soulId) && !(o.state as {removed?: boolean}).removed);
      if (mine.length >= 5) return refuse('make.limit', 'you already have 5 lasting marks or projects; take one down first');
      const placeId = this.placePathOf(soul.soulId).find(p => p.kind !== 'occupier')?.id ?? 'world';
      if (this.comms.objects.all().filter(o => o.kind === 'mark' && o.placeId === placeId && !(o.state as {removed?: boolean}).removed).length >= 20) return refuse('place.marks-full', 'this place already holds 20 marks; try somewhere else');
      const b = this.body(soul.entityId), id = `${make}-${randomUUID().slice(0, 8)}`;
      const r = this.insert(soul, capability, 'completed', clientRef, true);   // making a mark does not interrupt the body
      this.comms.objects.create({id, kind: make, name: title, placeId, params: {form: params.form, title, text, author: soul.soulId, at: b ? [b.pose.p[0], b.pose.p[2]] : null}});
      return {accepted: true, receipt: {...this.receipt(soul.soulId, r.id)!, object: id} as EdgeReceipt, ...resolved};
    }
    if (plan.stop) {
      const program = this.host.engine.programOf(soul.entityId);
      const r = this.insert(soul, capability, program ? 'started' : 'completed', clientRef);
      if (program) await this.host.enqueue('edge-stop', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, receipt: r.id});
      if (program) this.update(r.id, {phase: 'completed'});
      return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
    }
    if (this.host.quietBarrier) {
      // Quiet renewal is brief and always ends (stall release): accept and start at first light, receipt 'waiting'.
      const r = this.insert(soul, capability, 'waiting', clientRef);
      this.arm({receipt: r.id, soul, steps, label: plan.label, deadline: this.host.engine.world.tick + WAIT_LIMIT_TICKS, capability});
      return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
    }
    if (!cap.available && cap.blocked && !WAIT_CODES.has(cap.blocked.code)) return {...refuse(cap.blocked.code, cap.blocked.reason), ...resolved};
    const issue = this.host.engine.canPerform({actor: soul.entityId, label: plan.label, steps});
    if (issue && !WAIT_CODES.has(issue.code)) return {...refuse(issue.code, humanBlockedExplanationV1(issue.code, plan.label)), ...resolved};
    if (issue) {
      // Asleep or mid-step: stop safely first, then start (receipt `waiting`).
      const r = this.insert(soul, capability, 'waiting', clientRef);
      this.arm({receipt: r.id, soul, steps, label: plan.label, deadline: this.host.engine.world.tick + WAIT_LIMIT_TICKS, capability});
      if (issue.code === 'program.safe-stop-required') await this.host.enqueue('edge-stop', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, receipt: r.id});
      return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
    }
    const r = this.insert(soul, capability, 'waiting', clientRef);
    await this.decide(soul, r.id, capability, plan.label, steps);
    return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
  }

  /** What each capability answers to, for PM-R057 natural names (built only when an id is not exact). */
  private vocabulary(soul: EdgeSoul, caps: EdgeCapability[]): VocabContext {
    const w = this.host.engine.world as NativeWorld, me = this.body(soul.entityId), all = [...this.places.byId.values()], root = all.find(p => p.parent === null);
    const objects = new Map((this.comms?.objects.all() ?? []).map(o => [o.id, o]));
    const around = (x: number, z: number) => {const p = this.places.containing(x, z, 0).find(q => q.parent !== null); return p ? [p.id, p.name] : [];};
    return {caps, me: me ? [me.pose.p[0], me.pose.p[2]] : null, root: root ? [...tokens(root.id), ...tokens(root.name)] : [],
      places: all.filter(p => p.parent !== null).map(p => ({id: p.id, name: p.name, center: centroid(p.polygon)})),
      target: c => {
        const t = c.target; if (!t) return {names: [], around: [], at: null};
        if (t.kind === 'soul') {const m = this.host.minds.get(t.id), e = m ? this.body(m.entityId) : undefined; return {names: m ? [m.name] : [], around: [], at: e ? [e.pose.p[0], e.pose.p[2]] : null};}
        const place = this.places.byId.get(t.id); if (place) return {names: [place.name], around: [], at: centroid(place.polygon)};
        const e = w.entities[t.id]; if (e) return {names: [], around: around(e.pose.p[0], e.pose.p[2]), at: [e.pose.p[0], e.pose.p[2]]};
        const o = objects.get(t.id), op = o ? this.places.byId.get(o.placeId) : undefined; if (op) return {names: [], around: [op.id, op.name], at: centroid(op.polygon)};
        const r = (w.regions as Record<string, {polygon: [number, number][]}> | undefined)?.[t.id]; return {names: [], around: [], at: r ? centroid(r.polygon) : null};
      }};
  }

  // ---------------------------------------------------------------- perception
  private mind(soul: EdgeSoul): Mind {const m = this.host.minds.get(soul.soulId); if (!m) throw new EdgeError(404, 'not-found', 'this Soul has no body in the world'); return m;}
  private body(entityId: string) {return (this.host.engine.world as NativeWorld).entities[entityId];}
  private seatOf(entityId: string): string | null {
    const live = new Set(this.host.engine.runtime.liveIds());
    for (const r of this.host.engine.runtime.records.values()) {const p = r.params as Record<string, unknown>; if (live.has(r.id) && r.verb === 'sit' && p.actor === entityId && typeof p.slot === 'string') return p.slot;}
    return null;
  }
  placePathOf(soulId: string): PlaceRef[] {
    const m = this.host.minds.get(soulId); if (!m) return [];
    const b = this.body(m.entityId); if (!b) return [];
    const path = this.places.containing(b.pose.p[0], b.pose.p[2], b.human?.level ?? 0).map(p => this.places.ref(p));
    const seat = this.seatOf(m.entityId), occ = seat ? this.places.occupierOf.get(seat) : undefined;
    return occ ? [{id: occ.occ.id, name: `${occ.place.name} seat`, kind: 'occupier'}, ...path] : path;
  }
  private innermostPlace(m: Mind): string | null {const b = this.body(m.entityId); if (!b) return null; return this.places.containing(b.pose.p[0], b.pose.p[2], b.human?.level ?? 0)[0]?.id ?? null;}
  enclosureOf(soulId: string): string | null {
    const m = this.host.minds.get(soulId), b = m ? this.body(m.entityId) : undefined; if (!b) return null;
    return this.places.containing(b.pose.p[0], b.pose.p[2], b.human?.level ?? 0).find(p => p.enclosed)?.id ?? null;
  }
  perceivedBodies(soulId: string, radius: number): NearbyBody[] {
    const me = this.host.minds.get(soulId), mb = me ? this.body(me.entityId) : undefined; if (!me || !mb) return [];
    const myEnc = this.enclosureOf(soulId), out: NearbyBody[] = [];
    for (const o of this.host.minds.values()) {
      if (o.soulId === soulId || this.faded.has(o.soulId)) continue; const ob = this.body(o.entityId); if (!ob) continue;
      const d = Math.hypot(ob.pose.p[0] - mb.pose.p[0], ob.pose.p[2] - mb.pose.p[2]); if (d > radius) continue;
      if (this.enclosureOf(o.soulId) !== myEnc) continue;      // enclosure rule: same enclosure, or both outdoors
      out.push({soulId: o.soulId, entityId: o.entityId, name: o.name, distance: Math.round(d * 10) / 10, placeId: this.innermostPlace(o) ?? '', state: stateOf(this.host, o.entityId), activity: String(ob.human?.activity ?? 'idle')});
    }
    return out.sort((a, b) => a.distance - b.distance);
  }
  onReceipt(l: (r: EdgeReceipt) => void) {this.receiptListeners.push(l);}
  onPlaceChange(l: (e: {soulId: string; from: string | null; to: string | null; tick: number}) => void) {this.placeListeners.push(l);}

  /** G430 public per-Soul page: no owner data, conversation turns, overheard speech or tokens. */
  publicSoul(soulId: string) {
    const row = this.db.soul(soulId) as {id: string; name?: string; description?: string; world_id: string; retired_at: number | null} | undefined;
    if (!row || row.world_id !== this.host.worldId || row.retired_at !== null) throw new EdgeError(404, 'not-found', 'no such Soul');
    const m = this.host.minds.get(soulId), receipts = this.rows('soul_id=? ORDER BY created_at DESC LIMIT 10', soulId).map(r => this.view(r)).map(({programId: _p, ...r}) => r);
    const last = this.db.db.prepare('SELECT MAX(created_at) at FROM edge_receipts_v1 WHERE world_id=? AND soul_id=?').get(this.host.worldId, soulId) as {at: number | null};
    const has = (t: string) => !!this.db.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
    const events: {tick: number; at: number; kind: string; [k: string]: unknown}[] = [];
    if (has('edge_comms_stream')) for (const e of this.db.db.prepare("SELECT tick,at,kind,body FROM edge_comms_stream WHERE world_id=? AND soul_id=? AND kind IN ('arrival','departure','world') ORDER BY seq DESC LIMIT 30").all(this.host.worldId, soulId) as {tick: number; at: number; kind: string; body: string}[]) events.push({tick: e.tick, at: e.at, kind: e.kind, ...JSON.parse(e.body)});
    if (has('edge_comms_speech')) for (const e of this.db.db.prepare('SELECT tick,at,channel,text FROM edge_comms_speech WHERE world_id=? AND soul_id=? ORDER BY tick DESC LIMIT 30').all(this.host.worldId, soulId) as {tick: number; at: number; channel: string; text: string}[]) events.push({tick: e.tick, at: e.at, kind: 'speech', channel: JSON.parse(e.channel), text: e.text, untrusted: true});
    events.sort((a, b) => b.tick - a.tick);
    return {soul: {soulId, name: row.name ?? m?.name ?? soulId, description: row.description ?? null, untrusted: true}, fade: this.comms?.fading.status(soulId) ?? null, lastAcceptedAt: last.at,
      self: m ? {placePath: this.placePathOf(soulId), state: stateOf(this.host, m.entityId), activity: String(this.body(m.entityId)?.human?.activity ?? 'idle')} : null, receipts, events: events.slice(0, 30)};
  }
  map() {return [...this.places.byId.values()].map(p => ({id: p.id, name: p.name, kind: p.kind, enclosed: p.enclosed, capacity: p.capacity, parent: p.parent, center: centroid(p.polygon).map(v => Math.round(v * 10) / 10), starting: p.starting, ...(p.description ? {description: p.description} : {}), schedule: (p.schedule ?? []).map(s => ({id: s.id, cron: s.cron, durationMinutes: s.durationMinutes ?? null, ticketed: !!s.ticketed, label: s.label ?? null}))}));}

  /** PM-R055: happening (with walk capability) and a few inviting places elsewhere. Counts only, never identities;
   *  project titles are listed objects (untrusted), marks are counted. Deterministic for a given world state. */
  private spread(soul: EdgeSoul, me: [number, number] | null, minuteOfDay: number | null) {
    const caps = this.capabilities(soul), walk = new Map(caps.filter(c => c.verb === 'walk' && c.available && c.target?.kind === 'place').map(c => [c.target!.id, c]));
    const happening = (minuteOfDay === null ? [] : happenings(this.places.byId.values(), minuteOfDay, me)).map(h => ({...h, ...(walk.has(h.placeId) ? {capability: walk.get(h.placeId)!.id} : {})}));
    const here = new Set(this.placePathOf(soul.soulId).map(p => p.id)), souls = new Map<string, number>();
    for (const m of this.host.minds.values()) {
      if (m.soulId === soul.soulId || this.faded.has(m.soulId)) continue; const ob = this.body(m.entityId); if (!ob) continue;
      for (const p of this.places.containing(ob.pose.p[0], ob.pose.p[2], ob.human?.level ?? 0)) souls.set(p.id, (souls.get(p.id) ?? 0) + 1);
    }
    const marks = new Map<string, number>(), projects = new Map<string, string[]>();
    for (const o of this.comms?.objects.all() ?? []) {
      const st = o.state as {removed?: boolean; status?: string; title?: string};
      if (o.kind === 'mark' && !st.removed) marks.set(o.placeId, (marks.get(o.placeId) ?? 0) + 1);
      if (o.kind === 'project' && st.status !== 'done' && st.title) projects.set(o.placeId, [...(projects.get(o.placeId) ?? []), st.title]);
    }
    const on = new Map(happening.map(h => [h.placeId, h]));
    const elsewhere = [...walk.entries()].flatMap(([id, cap]) => {
      const p = this.places.byId.get(id); if (!p || here.has(id) || p.parent === null || p.kind === 'sleeping-mat' || /(^|-)mat-\d+$/.test(id)) return [];   // personal sleeping spots are not invitations
      const [cx, cz] = centroid(p.polygon), d = me ? Math.hypot(cx - me[0], cz - me[1]) : 0; if (d > 150) return [];
      const n = souls.get(id) ?? 0, mk = marks.get(id) ?? 0, pj = projects.get(id) ?? [], h = on.get(id);
      const why = [...(h ? [h.now ? `${h.label} is on now` : `${h.label} in ${h.startsInMinutes} min`] : []), ...(n === 0 ? ['quiet: nobody there'] : []), ...(mk ? [`${mk} lasting mark${mk > 1 ? 's' : ''}`] : []), ...(pj.length ? [`${pj.length} open project${pj.length > 1 ? 's' : ''}`] : [])];
      const score = (h ? (h.now ? 6 : 2) : 0) + (n === 0 ? 3 : n === 1 ? 1 : -n) + Math.min(3, mk + pj.length) - d / 30;
      return [{score, item: {placeId: id, place: p.name, kind: p.kind, distance: Math.round(d), souls: n, why, capability: cap.id, ...(pj.length ? {projects: pj.slice(0, 2), untrusted: true} : {})}}];
    }).sort((a, b) => b.score - a.score || a.item.placeId.localeCompare(b.item.placeId)).slice(0, 4).map(x => x.item);
    return {happening, elsewhere};
  }

  observe(soul: EdgeSoul, include: Set<string>) {
    const m = this.mind(soul), b = this.body(m.entityId), tick = this.host.engine.world.tick, day = this.host.living;
    const program = this.host.engine.programOf(m.entityId), action = program ? this.host.engine.programAction?.(program) : null;
    const c = day ? clockAt(tick, day.origin, day.dayTicks) : null;
    const spread = this.spread(soul, b ? [b.pose.p[0], b.pose.p[2]] : null, c ? c.hour * 60 + c.minute : null);
    const out: Record<string, unknown> = {
      tick, at: Date.now(),
      world: {id: this.host.worldId, ...(this.host.extra.continuousDayV1 ? {} : {quiet: this.host.quietBarrier}), ...(c ? {time: {day: c.day, phase: Math.round(c.phase * 1000) / 1000, label: timeLabel(c.phase), clock: `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`}} : {})},
      // PM-R055 spread: reasons to go somewhere else, first. Scheduled place activities on now or soon (with the walk
      // that gets there), then a few other places nearby: quiet ones, ones with lasting marks/projects or something on.
      happening: spread.happening, elsewhere: spread.elsewhere,
      self: {soulId: soul.soulId, name: soul.name, entityId: soul.entityId, placePath: this.placePathOf(soul.soulId), position: b ? b.pose.p.map(v => Math.round(v * 100) / 100) : null, facing: b ? Math.round(b.pose.yaw * 100) / 100 : null,
        state: this.faded.has(soul.soulId) ? 'faded' : stateOf(this.host, m.entityId), activity: String(b?.human?.activity ?? 'idle'), reflex: action && action.actor === m.entityId ? {verb: action.action.verb, phase: action.action.phase ?? action.action.status} : null,
        receipts: this.openReceipts(soul.soulId), fade: this.comms?.fading.status(soul.soulId) ?? null},
      here: {souls: this.perceivedBodies(soul.soulId, NEAR_RADIUS).map(o => ({soulId: o.soulId, name: o.name, state: o.state, activity: o.activity, distance: o.distance, placeId: o.placeId})), objects: this.comms?.objects.visibleTo(soul) ?? [], untrusted: true},
      ...(this.comms ? {streamCursor: this.comms.streams.headCursor(soul.soulId)} : {}),
    };
    if (include.has('capabilities')) out.capabilities = this.capabilities(soul);
    if (include.has('map')) out.map = {places: this.map()};
    if (include.has('eyes')) out.eyes = {status: 'unavailable'};
    return out;
  }
}

const mix = (s: string, n: number) => {let h = 2166136261 ^ n; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0);};
function ambientChoice(ledger: EdgeLedger, soul: EdgeSoul, me: {pose: {p: number[]}}, tick: number): {id: string; label: string; steps: Program['steps']} | null {
  const {caps, plans} = ledger.ambientPlans(soul), world = ledger.host.engine.world as NativeWorld;
  const dist = (id: string | undefined) => {const e = id ? world.entities[id] : undefined; return e ? Math.hypot(e.pose.p[0] - me.pose.p[0], e.pose.p[2] - me.pose.p[2]) : Infinity;};
  const near = (c: EdgeCapability, r: number) => c.available && dist(c.target?.kind === 'soul' ? ledger.host.minds.get(c.target.id)?.entityId : c.target?.id) <= r;
  const options: {id: string; label: string; steps: Program['steps']; weight: number}[] = [];
  const add = (c: EdgeCapability | undefined, weight: number, adjust?: (s: Program['steps']) => void) => {
    const p = c && plans.get(c.id); if (!c || !p) return; const steps = structuredClone(p.steps); adjust?.(steps); options.push({id: c.id, label: p.label, steps, weight});
  };
  const seconds = (n: number) => (s: Program['steps']) => {for (const x of s) if ('seconds' in (x.params ?? {})) x.params.seconds = n;};
  add(caps.find(c => c.verb === 'warm-by-fire' && near(c, 15)), 3, seconds(90));
  add(caps.find(c => c.verb === 'sit' && near(c, 10)), 3, seconds(60));
  for (const c of caps.filter(c => c.verb === 'face' && near(c, 6)).slice(0, 2)) add(c, 2);
  add(caps.find(c => c.id === 'wander:here'), 3, s => {for (const x of s) if (x.verb === 'ambient_wander') {x.params.seconds = 25; x.params.radius = 4;}});
  if (!options.length) return null;
  let r = mix(soul.soulId, tick) % options.reduce((a, o) => a + o.weight, 0);
  for (const o of options) {if (r < o.weight) return o; r -= o.weight;}
  return options[0];
}

export function edgeIdOf(b: HumanBindingV1): {id: string; verb: string} {
  if (b.id === 'activity:swim:shore-water') return {id: 'swim:shore-water', verb: 'swim'};
  if (b.id === 'rest:self') return {id: 'rest:here', verb: 'rest'};
  if (b.goal === 'hang_out') return {id: 'hang-out:' + b.id.slice('hang_out:'.length), verb: 'hang-out'};
  return {id: b.id, verb: b.goal};
}
export function stateOf(host: WorldHost, entityId: string): string {
  const h = (host.engine.world as NativeWorld).entities[entityId]?.human; if (!h) return 'absent';
  if (h.sleepPose) return 'sleeping';
  const a = String(h.activity ?? 'idle');
  if (a === 'sit' || a.startsWith('sit')) return 'seated';
  if (a === 'walk') return 'walking';
  if (a === 'swim' || a === 'tread' || a === 'wade') return 'swimming';
  if (a === 'wait') return 'waiting';
  if (a === 'idle') return host.engine.programOf(entityId) ? 'busy' : 'standing';
  return 'busy';
}
function timeLabel(phase: number) {return phase < .2 ? 'morning' : phase < .45 ? 'day' : phase < .55 ? 'evening' : phase < .75 ? 'dusk' : 'night';}
