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
import {PlaceIndex, centroid, derivePlaceData, validatePlaceData, type PlaceData} from './places.ts';

const WAIT_CODES = new Set(['program.safe-stop-required', 'program.safe-stop-pending']);
const WAIT_LIMIT_TICKS = 20 * 60;   // a waiting receipt that cannot start within a minute fails
const NEAR_RADIUS = 20;
const OPEN: EdgeReceipt['phase'][] = ['waiting', 'started'];
type Row = {receipt_id: string; soul_id: string; capability: string; phase: EdgeReceipt['phase']; accepted_tick: number; started_tick: number | null; ended_tick: number | null; code: string | null; reason: string | null; program_id: string | null; client_ref: string | null};
type Pending = {receipt: string; soul: EdgeSoul; steps: Program['steps']; label: string; deadline: number; capability: string};

export class EdgeLedger implements EdgeLedgerHooks {
  places: PlaceIndex;
  private receiptListeners: ((r: EdgeReceipt) => void)[] = [];
  private placeListeners: ((e: {soulId: string; from: string | null; to: string | null; tick: number}) => void)[] = [];
  private providers: ((s: EdgeSoul) => EdgeCapability[])[] = [];
  private pending = new Map<string, Pending>();           // soulId → waiting act
  private lastPlace = new Map<string, string | null>();
  private capCache = new Map<string, {tick: number; value: {caps: EdgeCapability[]; plans: Map<string, {label: string; steps: Program['steps']; seconds?: boolean; stop?: boolean}>}}>();
  comms?: {streams: {headCursor(soulId: string): string}; fading: {status(soulId: string): unknown}; objects: {visibleTo(soul: EdgeSoul): unknown[]}; close(): void};
  attachComms(c: NonNullable<EdgeLedger['comms']>) {this.comms = c;}
  readonly host: WorldHost; readonly db: Db;
  constructor(host: WorldHost, db: Db, placeData?: unknown) {
    this.host = host; this.db = db;
    db.db.exec(`CREATE TABLE IF NOT EXISTS edge_receipts_v1 (world_id TEXT NOT NULL, receipt_id TEXT NOT NULL, soul_id TEXT NOT NULL, capability TEXT NOT NULL, phase TEXT NOT NULL,
      accepted_tick INTEGER NOT NULL, started_tick INTEGER, ended_tick INTEGER, code TEXT, reason TEXT, program_id TEXT, client_ref TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (world_id, receipt_id));
      CREATE INDEX IF NOT EXISTS edge_receipts_v1_soul ON edge_receipts_v1 (world_id, soul_id, phase);
      CREATE TABLE IF NOT EXISTS edge_refusals_v1 (world_id TEXT NOT NULL, at INTEGER NOT NULL, tick INTEGER NOT NULL, soul_id TEXT NOT NULL, verb TEXT NOT NULL, capability TEXT NOT NULL, code TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS edge_refusals_v1_at ON edge_refusals_v1 (world_id, at);`);
    this.places = new PlaceIndex(this.loadPlaces(placeData));
    // Receipts left open by a previous process cannot be followed honestly.
    for (const r of this.rows("phase IN ('waiting','started')")) {
      const m = host.minds.get(r.soul_id);
      if (r.phase === 'started' && r.program_id && m && host.engine.programOf(m.entityId) === r.program_id) continue;
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
  private insert(soul: EdgeSoul, capability: string, phase: EdgeReceipt['phase'], clientRef?: string): EdgeReceipt {
    const id = 'r_' + randomUUID(), tick = this.host.engine.world.tick;
    for (const old of this.openReceipts(soul.soulId)) this.update(old.id, {phase: 'replaced', reason: 'A newer action from this Soul replaced it.'});
    this.pending.delete(soul.soulId);
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
    else if (ev.kind === 'cancelled' && (ev.code === 'program.replaced' || ev.code === 'program.stopped')) this.update(r.receipt_id, {phase: 'replaced', code: ev.code, reason: 'Stopped or replaced before it finished.'});
    else this.update(r.receipt_id, {phase: 'failed', code: ev.code ?? 'action.failed', reason: ev.message ?? humanBlockedExplanationV1(ev.code, 'That action')});
  }
  private afterTick(tick: number) {
    for (const [soulId, p] of this.pending) {
      if (this.host.quietBarrier) {p.deadline = Math.max(p.deadline, tick + WAIT_LIMIT_TICKS); continue;}   // the wait clock pauses during renewal
      if (tick > p.deadline) {this.pending.delete(soulId); this.update(p.receipt, {phase: 'failed', code: 'state.safe-stop-timeout', reason: 'The body could not reach a safe stop within a minute.'}); continue;}
      if (this.host.quietBarrier) continue;
      const issue = this.host.engine.canPerform({actor: p.soul.entityId, label: p.label, steps: p.steps});
      if (issue && WAIT_CODES.has(issue.code)) continue;
      this.pending.delete(soulId);
      if (issue) {this.update(p.receipt, {phase: 'failed', code: issue.code, reason: humanBlockedExplanationV1(issue.code, p.label)}); continue;}
      void this.decide(p.soul, p.receipt, p.capability, p.label, p.steps).catch(() => this.update(p.receipt, {phase: 'failed', code: 'ledger.unavailable', reason: 'The world could not record this action.'}));
    }
    if (tick % 10 === 0) for (const m of this.host.minds.values()) {
      const to = this.innermostPlace(m), from = this.lastPlace.has(m.soulId) ? this.lastPlace.get(m.soulId)! : to;
      this.lastPlace.set(m.soulId, to);
      if (from !== to) for (const l of this.placeListeners) try {l({soulId: m.soulId, from, to, tick});} catch {/* ignore */}
    }
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
      refusalsByCode: Object.fromEntries(q('SELECT verb||\' \'||code k, COUNT(*) n FROM edge_refusals_v1 WHERE world_id=? AND at>=? GROUP BY verb, code ORDER BY n DESC', since).map(r => [r.k, r.n])),
      activeSouls: count('SELECT COUNT(DISTINCT soul_id) n FROM edge_receipts_v1 WHERE world_id=? AND created_at>=?', since),
      speech: has('edge_comms_speech') ? count('SELECT COUNT(*) n FROM edge_comms_speech WHERE world_id=? AND at>=?', since) : null,
      conversationTurns: has('edge_comms_turns') ? count('SELECT COUNT(*) n FROM edge_comms_turns WHERE world_id=? AND at>=?', since) : null,
      worldModelCalls: count('SELECT COUNT(*) n FROM brain_calls WHERE world_id=? AND at>=?', since),
      tick: this.host.engine.world.tick};
  }

  // ---------------------------------------------------------------- act
  async act(soul: EdgeSoul, input: {capability?: unknown; params?: unknown; clientRef?: unknown}): Promise<{accepted: true; receipt: EdgeReceipt} | {accepted: false; code: string; reason: string; capability: string; retry_after?: number}> {
    const capability = typeof input.capability === 'string' ? input.capability : '';
    if (!capability || capability.length > 200) throw new EdgeError(400, 'invalid', 'body must be {capability, params?, clientRef?}');
    const clientRef = typeof input.clientRef === 'string' && input.clientRef.length <= 100 ? input.clientRef : undefined;
    if (clientRef) {const old = this.rows('soul_id=? AND client_ref=?', soul.soulId, clientRef)[0]; if (old) return {accepted: true, receipt: this.view(old)};}
    const refuse = (code: string, reason: string, extra?: {retry_after?: number}) => {this.recordRefusal(soul.soulId, 'act', capability, code); return {accepted: false as const, code, reason, capability, ...extra};};
    const {caps, plans} = this.binds(soul), cap = caps.find(c => c.id === capability), plan = plans.get(capability);
    if (!cap || !plan) return refuse('capability.unknown', 'That capability is not offered to this Soul right now; read capabilities again.');
    const params = (input.params && typeof input.params === 'object' ? input.params : {}) as Record<string, unknown>;
    let steps = structuredClone(plan.steps);
    if (params.seconds !== undefined) {
      if (!plan.seconds || !Number.isInteger(params.seconds) || (params.seconds as number) < 1 || (params.seconds as number) > 600) return refuse('capability.params', 'seconds must be an integer 1..600 for this capability.');
      for (const s of steps) if (s.verb === 'rest') s.params.seconds = params.seconds;
    }
    if (plan.stop) {
      const program = this.host.engine.programOf(soul.entityId);
      const r = this.insert(soul, capability, program ? 'started' : 'completed', clientRef);
      if (program) await this.host.enqueue('edge-stop', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, receipt: r.id});
      if (program) this.update(r.id, {phase: 'completed'});
      return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!};
    }
    if (this.host.quietBarrier) {
      // Quiet renewal is brief and always ends (stall release): accept and start at first light, receipt 'waiting'.
      const r = this.insert(soul, capability, 'waiting', clientRef);
      this.pending.set(soul.soulId, {receipt: r.id, soul, steps, label: plan.label, deadline: this.host.engine.world.tick + WAIT_LIMIT_TICKS, capability});
      return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!};
    }
    if (!cap.available && cap.blocked && !WAIT_CODES.has(cap.blocked.code)) return refuse(cap.blocked.code, cap.blocked.reason);
    const issue = this.host.engine.canPerform({actor: soul.entityId, label: plan.label, steps});
    if (issue && !WAIT_CODES.has(issue.code)) return refuse(issue.code, humanBlockedExplanationV1(issue.code, plan.label));
    if (issue) {
      // Asleep or mid-step: stop safely first, then start (receipt `waiting`).
      const r = this.insert(soul, capability, 'waiting', clientRef);
      this.pending.set(soul.soulId, {receipt: r.id, soul, steps, label: plan.label, deadline: this.host.engine.world.tick + WAIT_LIMIT_TICKS, capability});
      if (issue.code === 'program.safe-stop-required') await this.host.enqueue('edge-stop', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, receipt: r.id});
      return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!};
    }
    const r = this.insert(soul, capability, 'waiting', clientRef);
    await this.decide(soul, r.id, capability, plan.label, steps);
    return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!};
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
      if (o.soulId === soulId) continue; const ob = this.body(o.entityId); if (!ob) continue;
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

  observe(soul: EdgeSoul, include: Set<string>) {
    const m = this.mind(soul), b = this.body(m.entityId), tick = this.host.engine.world.tick, day = this.host.living;
    const program = this.host.engine.programOf(m.entityId), action = program ? this.host.engine.programAction?.(program) : null;
    const c = day ? clockAt(tick, day.origin, day.dayTicks) : null;
    const out: Record<string, unknown> = {
      tick, at: Date.now(),
      world: {id: this.host.worldId, quiet: this.host.quietBarrier, ...(c ? {time: {day: c.day, phase: Math.round(c.phase * 1000) / 1000, label: timeLabel(c.phase), clock: `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`}} : {})},
      self: {soulId: soul.soulId, name: soul.name, entityId: soul.entityId, placePath: this.placePathOf(soul.soulId), position: b ? b.pose.p.map(v => Math.round(v * 100) / 100) : null, facing: b ? Math.round(b.pose.yaw * 100) / 100 : null,
        state: stateOf(this.host, m.entityId), activity: String(b?.human?.activity ?? 'idle'), reflex: action && action.actor === m.entityId ? {verb: action.action.verb, phase: action.action.phase ?? action.action.status} : null,
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
