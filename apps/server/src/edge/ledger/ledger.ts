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
import {CATALOG} from '../../../../../mars/viewer/engine/world/catalog.ts';
import {PlaceIndex, centroid, derivePlaceData, happenings, validatePlaceData, type PlaceData} from './places.ts';
const area = (p: [number, number][]) => Math.abs(p.reduce((s, [x, z], i) => {const [x2, z2] = p[(i + 1) % p.length]; return s + x * z2 - x2 * z;}, 0)) / 2;
import {resolveCapability, tokens, placeMatch, type VocabContext} from './vocabulary.ts';
import {activityCapabilities, loadSpots, ACTIVITY_SECONDS_MAX, type SpotsData} from './activities.ts';
import {Together, PAIRED, type TogetherPlan} from './together.ts';
import {Intents, attentionWords, type IntentInput} from '../intents/intents.ts';
import {strictCheck} from '../intents/strict.ts';
import {bodyEnd} from '../perception/here.ts';

type Resolved = {from: string; to: string; note: string};
const WAIT_CODES = new Set(['program.safe-stop-required', 'program.safe-stop-pending']);
const WAIT_LIMIT_TICKS = 20 * 60;   // a waiting receipt that cannot start within a minute fails
const NEAR_RADIUS = 20, GO_NEAR_RADIUS = 60;
const OPEN: EdgeReceipt['phase'][] = ['waiting', 'started'];
type Row = {created_at: number; receipt_id: string; soul_id: string; capability: string; phase: EdgeReceipt['phase']; accepted_tick: number; started_tick: number | null; ended_tick: number | null; code: string | null; reason: string | null; program_id: string | null; client_ref: string | null; plan?: string | null; detail?: string | null};
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
    // intents/1 auto-face: conversation members turn their heads to whoever speaks (default on)
    try {(c as unknown as {onSpectator?(l: (m: {kind: string; conversation?: string; turn?: {from?: {soulId: string}}}) => void): void}).onSpectator?.(m => {
      if (m.kind !== 'conversation.turn' || !m.conversation || !m.turn?.from) return;
      const members = this.coreA.conversations().find(x => x.id === m.conversation)?.members ?? [];
      try {this.intents.onTurn(m.conversation, m.turn.from.soulId, members);} catch {/* attention is best effort */}
    });} catch {/* no spectator hook: auto-face off */}
    // C9 body effects (fading itself only runs when Comms' fading flag is on — Gene has not approved it).
    const fading = (c as unknown as {fading?: {onFade?(l: (e: {soulId: string; change: string}) => void): void; gone?(): string[]}}).fading;
    const fadeOut = (soulId: string) => {
      const m = this.host.minds.get(soulId); if (!m) return;
      this.faded.add(soulId); this.pending.delete(soulId);
      // Not replaced by the Soul's own act: its open receipts end failed, so agents can tell why.
      for (const r of this.openReceipts(soulId)) this.update(r.id, {phase: 'failed', code: 'soul.faded', reason: 'This Soul faded out after an hour without an accepted action; act again to come back.'});
      try { if (this.host.engine.programOf(m.entityId)) void this.host.enqueue('edge-stop', `edge:${soulId}`, {soulId, entityId: m.entityId, why: 'faded'}).catch(() => {/* best effort */}); } catch { /* clock not ready: ambient skips faded Souls anyway */ }
    };
    fading?.onFade?.(e => {
      if (e.change === 'removed') fadeOut(e.soulId);
      // Reclaimed by speech/converse/object acts (not through act()): land at a starting place like act() does.
      else if (e.change === 'reclaimed' && this.faded.delete(e.soulId)) {
        const m = this.host.minds.get(e.soulId);
        try { if (m) void this.host.enqueue('edge-relocate', `edge:${e.soulId}`, {soulId: e.soulId, entityId: m.entityId, to: this.startingPoint(e.soulId), why: 'reclaimed after fading'}).catch(() => {/* best effort */}); } catch { /* clock not ready */ }
        this.capCache.delete(e.soulId);
      }
    });
    // `faded` is memory: after a restart re-learn the durable fade roster, or absent Souls look alive
    // (listed in here.souls, animated by ambient life, invitable) until they act again.
    try { for (const soulId of fading?.gone?.() ?? []) fadeOut(soulId); } catch { /* fading table not ready: learned on next change */ }
  }
  /** Souls faded out (removed at 60 min idle); their next act lands them at a starting place. */
  readonly faded = new Set<string>();
  private startingPoint(soulId: string): [number, number] {
    // Only starting places on admitted native ground (an engine region of the same id); W1 scenery (e.g. region-*) is never a landing spot.
    const ground = (this.host.engine.world as {regions?: Record<string, unknown>}).regions ?? {};
    const all = [...this.places.byId.values()].filter(p => p.starting && p.parent !== null), native = all.filter(p => p.id in ground);
    const starts = native.length ? native : all;
    const pick = starts.length ? starts[[...soulId].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % starts.length] : [...this.places.byId.values()][0];
    // CN5: on clear ground near its centre (a park's centre is its pond, a harbour's is the sea); the centre if none is known
    const clear = (this.host.engine as unknown as {clearSpotsV1?: (p: [number, number][], n: number) => [number, number][]}).clearSpotsV1?.(pick.polygon, 1)?.[0];
    return clear ?? centroid(pick.polygon);
  }
  readonly host: WorldHost; readonly db: Db;
  /** together/1 (core-next4): gestures between Souls, invitations, follows, carried items. */
  readonly together: Together;
  /** Ambient life reflex (Gene: Souls visibly alive between agent decisions); the edge server turns it on. */
  readonly ambient: boolean;
  private idleSince = new Map<string, number>();
  /** activities/1: World's activity spots, shelves, interiors and scenery solids (validated; refused entries listed). */
  readonly spots: SpotsData;
  readonly spotsRefused: string[];
  constructor(host: WorldHost, db: Db, placeData?: unknown, options: {ambient?: boolean; spots?: unknown} = {}) {
    this.host = host; this.db = db; this.ambient = options.ambient === true;
    const spots = loadSpots(options.spots); this.spots = spots.data; this.spotsRefused = spots.refused;
    db.db.exec(`CREATE TABLE IF NOT EXISTS edge_receipts_v1 (world_id TEXT NOT NULL, receipt_id TEXT NOT NULL, soul_id TEXT NOT NULL, capability TEXT NOT NULL, phase TEXT NOT NULL,
      accepted_tick INTEGER NOT NULL, started_tick INTEGER, ended_tick INTEGER, code TEXT, reason TEXT, program_id TEXT, client_ref TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (world_id, receipt_id));
      CREATE INDEX IF NOT EXISTS edge_receipts_v1_soul ON edge_receipts_v1 (world_id, soul_id, phase);
      CREATE TABLE IF NOT EXISTS edge_refusals_v1 (world_id TEXT NOT NULL, at INTEGER NOT NULL, tick INTEGER NOT NULL, soul_id TEXT NOT NULL, verb TEXT NOT NULL, capability TEXT NOT NULL, code TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS edge_refusals_v1_at ON edge_refusals_v1 (world_id, at);`);
    // PM-R055: a waiting act's plan is kept with its receipt so a restart re-arms it instead of losing it.
    if (!(db.db.prepare('PRAGMA table_info(edge_receipts_v1)').all() as {name: string}[]).some(c => c.name === 'plan')) db.db.exec('ALTER TABLE edge_receipts_v1 ADD COLUMN plan TEXT');
    // intents/1 + strict/1 (Core-A): receipt detail {channel, chosen, endedAt} (JSON)
    if (!(db.db.prepare('PRAGMA table_info(edge_receipts_v1)').all() as {name: string}[]).some(c => c.name === 'detail')) db.db.exec('ALTER TABLE edge_receipts_v1 ADD COLUMN detail TEXT');
    this.intents = new Intents(this);
    this.places = new PlaceIndex(this.loadPlaces(placeData));
    this.syncCarrierPlaces();
    // together/1: gestures, invitations, follows and items (core-next4)
    this.together = new Together({host, db, places: this.places, spots: this.spots,
      body: id => this.body(id), perceived: (id, r) => this.perceivedBodies(id, r), receipt: (sid, id) => this.receipt(sid, id),
      fail: (id, code, reason) => this.update(id, {phase: 'failed', code, reason}), complete: id => this.update(id, {phase: 'completed'}),
      running: (sid, id) => {const m = this.host.minds.get(sid), r = this.rows('receipt_id=?', id)[0]; return !!m && !!r?.program_id && this.host.engine.programOf(m.entityId) === r.program_id;},
      stop: (sid, entityId, receipt) => {try {void this.host.enqueue('edge-stop', `edge:${sid}`, {soulId: sid, entityId, receipt}).catch(() => {/* best effort */});} catch {/* clock not ready */}},
      aboard: id => this.aboard(id), faded: id => this.faded.has(id), innermostPlace: id => {const m = this.host.minds.get(id); return m ? this.innermostPlace(m) : null;},
      deliver: (sid, kind, body) => {try {(this.comms as unknown as {streams?: {deliver?(s: string, k: string, t: number, b: object): void}} | undefined)?.streams?.deliver?.(sid, kind, this.host.engine.world.tick, body);} catch {/* events are best effort */}},
      spectate: m => {try {(this.comms as unknown as {core?: {spectate(m: object): void}} | undefined)?.core?.spectate({tick: this.host.engine.world.tick, ...m});} catch {/* spectators never break the ledger */}},
      touch: id => this.comms?.fading.touch?.(id),
      decide: (soul, receipt, capability, label, steps) => this.decide(soul, receipt, capability, label, steps)});
    this.receiptListeners.push(r => {this.together.onReceipt(r); if (!OPEN.includes(r.phase)) this.capCache.clear();});
    // Open receipts from a previous process: a started one whose programme the snapshot carries is still followed;
    // a waiting one with its plan is re-armed (fresh one-minute wait); anything else cannot be followed honestly.
    for (const r of this.rows("phase IN ('waiting','started')")) {
      const m = host.minds.get(r.soul_id);
      if (r.phase === 'started' && r.program_id && m && host.engine.programOf(m.entityId) === r.program_id) continue;
      const plan = r.phase === 'waiting' && r.plan ? JSON.parse(r.plan) as {label: string; steps: Program['steps']} : null;
      if (plan && m && !this.pending.has(r.soul_id)) {this.pending.set(r.soul_id, {receipt: r.receipt_id, soul: {soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner}, steps: plan.steps, label: plan.label, deadline: host.engine.world.tick + WAIT_LIMIT_TICKS, capability: r.capability}); continue;}
      this.update(r.receipt_id, {phase: 'failed', code: 'receipt.lost-on-restart', reason: 'The server restarted before this action could be followed to its end.'});
    }
    // Hotfix: in an edge world an engine fault is recovered by attributing it to edge programmes (never a process exit)
    host.recoveryForEdge = true;
    host.listeners.push({
      onApplied: e => this.onRecovery(e),
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
  private view(r: Row): EdgeReceipt {return {id: r.receipt_id, soulId: r.soul_id, capability: r.capability, phase: r.phase, acceptedTick: r.accepted_tick, startedTick: r.started_tick, endedTick: r.ended_tick, code: r.code, reason: r.reason, programId: r.program_id, ...detailOf(r)};}
  receipt(soulId: string, id: string): EdgeReceipt | null {const r = this.rows('receipt_id=? AND soul_id=?', id, soulId)[0]; return r ? this.view(r) : null;}
  openReceipts(soulId: string): EdgeReceipt[] {return this.rows("soul_id=? AND phase IN ('waiting','started') ORDER BY accepted_tick", soulId).map(r => this.view(r));}
  private insert(soul: EdgeSoul, capability: string, phase: EdgeReceipt['phase'], clientRef?: string, keepActivity = false): EdgeReceipt {
    const id = 'r_' + randomUUID(), tick = this.host.engine.world.tick;
    if (!keepActivity) {for (const old of this.openReceipts(soul.soulId)) this.update(old.id, {phase: 'replaced', reason: 'A newer action from this Soul replaced it.'}); this.pending.delete(soul.soulId);}
    this.db.db.prepare('INSERT INTO edge_receipts_v1 (world_id,receipt_id,soul_id,capability,phase,accepted_tick,client_ref,created_at) VALUES (?,?,?,?,?,?,?,?)').run(this.host.worldId, id, soul.soulId, capability, phase, tick, clientRef ?? null, Date.now());
    if (keepActivity || !OPEN.includes(phase)) this.setDetail(id, {...(keepActivity ? {channel: this.nextChannel ?? 'none'} : {}), ...(!OPEN.includes(phase) ? {endedAt: bodyEnd(this, soul.soulId)} : {})});
    const r = this.receipt(soul.soulId, id)!; this.emit(r); return r;
  }
  private update(id: string, patch: Partial<Pick<Row, 'phase' | 'code' | 'reason' | 'program_id' | 'started_tick'>>) {
    const cur = this.rows('receipt_id=?', id)[0]; if (!cur) return;
    if (!OPEN.includes(cur.phase) && patch.phase) return;                  // terminal stays terminal
    const tick = this.host.engine.world.tick, next = {...cur, ...patch};
    if (patch.phase === 'started' && next.started_tick === null) next.started_tick = tick;
    if (patch.phase && !OPEN.includes(patch.phase)) next.ended_tick = tick;
    this.db.db.prepare('UPDATE edge_receipts_v1 SET phase=?,code=?,reason=?,program_id=?,started_tick=?,ended_tick=? WHERE world_id=? AND receipt_id=?').run(next.phase, next.code, next.reason, next.program_id, next.started_tick, next.ended_tick, this.host.worldId, id);
    if (patch.phase && !OPEN.includes(patch.phase)) next.detail = this.setDetail(id, {endedAt: bodyEnd(this, cur.soul_id)});   // strict/1: where the body ended up
    if (patch.phase && patch.phase !== cur.phase) this.emit(this.view(next));
  }
  private emit(r: EdgeReceipt) {for (const l of this.receiptListeners) try {l(r);} catch {/* listener faults never break the ledger */}}
  private onDecision(e: {payload: unknown}, r: {programId?: string; programOk?: boolean; programCode?: string}) {
    const p = e.payload as {trigger?: string}, m = /^edge-act:(r_[0-9a-f-]+)$/.exec(p.trigger ?? ''); if (!m) return;
    if (r.programOk && r.programId) this.update(m[1], {phase: 'started', program_id: r.programId});
    else this.update(m[1], {phase: 'failed', code: r.programCode ?? 'program.refused', reason: humanBlockedExplanationV1(r.programCode, 'That action')});
  }
  /** Hotfix: a recovered engine fault ends the open receipts of the Souls whose programmes were set aside. */
  private onRecovery(e: {kind: string; payload: unknown}) {
    const edge = (e.payload as {recovery?: {edge?: {souls: string[]}}} | null)?.recovery?.edge; if (e.kind !== 'rules' || !edge) return;
    for (const soulId of edge.souls) {
      this.pending.delete(soulId);
      for (const r of this.openReceipts(soulId)) this.update(r.id, {phase: 'failed', code: 'engine.fault-recovered', reason: 'That would have pushed bodies into each other, so the world set it aside and carried on; choose again.'});
    }
    this.capCache.clear();
  }
  private onProgram(ev: {id: string; kind: string; code?: string; message?: string}) {
    if (ev.kind === 'step') return;
    const r = this.rows("program_id=? AND phase IN ('waiting','started')", ev.id)[0]; if (!r) return;
    if (ev.kind === 'completed') {
      // together/1: a follow walks on leg after leg under the same receipt until it is stopped or its target is gone
      const m = this.host.minds.get(r.soul_id);
      if (m && this.together.continueFollow(r.receipt_id, {soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner})) return;
      this.update(r.receipt_id, {phase: 'completed'});
    }
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
    if (tick % 100 === 0) this.unstick(tick);
    if (tick % 20 === 0) try {this.together.sweep();} catch (e) {console.error('[edge] together sweep', e instanceof Error ? e.message : e);}
    if (tick % 10 === 0) this.rideFrames(tick);
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
  /** Open conversations' members (soulId → partner soulIds), straight from the durable comms table. */
  private conversationPartners(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    try {
      for (const r of this.db.db.prepare("SELECT body FROM edge_comms_conversations WHERE world_id=? AND state='open'").all(this.host.worldId) as {body: string}[]) {
        const ids = (JSON.parse(r.body) as {members?: {soulId: string}[]}).members?.map(m => m.soulId) ?? [];
        for (const id of ids) out.set(id, [...(out.get(id) ?? []), ...ids.filter(x => x !== id)]);
      }
    } catch {/* no comms tables: nobody is talking */}
    return out;
  }
  private ambientLife(tick: number) {
    const talking = this.conversationPartners();
    for (const m of this.host.minds.values()) {
      const busy = this.faded.has(m.soulId) || this.pending.has(m.soulId) || !!this.aboard(m.entityId) || !!this.host.engine.programOf(m.entityId) || this.openReceipts(m.soulId).length > 0 || this.together.awaiting(m.soulId);
      const b = this.body(m.entityId), state = stateOf(this.host, m.entityId);
      if (busy || !b || state === 'sleeping' || state === 'absent' || state === 'swimming') {this.idleSince.set(m.soulId, tick); continue;}
      const since = this.idleSince.get(m.soulId); if (since === undefined) {this.idleSince.set(m.soulId, tick); continue;}
      if (tick - since < 400) continue;
      this.idleSince.set(m.soulId, tick);
      const soul: EdgeSoul = {soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner};
      // P0c: in a conversation with someone close by, ambient life only turns towards them (never walks a partner away).
      const partners = (talking.get(m.soulId) ?? []).map(id => this.host.minds.get(id)).filter((x): x is Mind => !!x && !!this.body(x.entityId));
      const near = partners.map(x => ({x, d: Math.hypot(this.body(x.entityId)!.pose.p[0] - b.pose.p[0], this.body(x.entityId)!.pose.p[2] - b.pose.p[2])})).filter(q => q.d <= 6).sort((p, q) => p.d - q.d)[0];
      if (partners.length && !near) continue;                      // partner further away: stay put rather than wander off
      const pick = near ? {id: 'face:' + near.x.soulId, label: `Turn towards ${near.x.name}`, steps: [{verb: 'wave', params: {at: near.x.entityId, seconds: 1}}] as Program['steps']} : ambientChoice(this, soul, b, tick);
      if (!pick) continue;
      this.ambientAt.set(soul.soulId, Date.now());
      void this.host.enqueue('decision', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, option: pick.id, label: pick.label, steps: pick.steps, reevalTicks: 1e9, fallback: false, trigger: 'edge-ambient'}).catch(() => {/* best effort */});
    }
  }
  private unstuckAt = new Map<string, number>();
  /** nav/1: an idle body standing inside a solid (e.g. it was mid-walk through a house when the footprints were admitted)
   *  steps out to the nearest clear spot, as a logged edge-relocate (deterministic in replay). At most once a minute each. */
  private unstick(tick: number) {
    const engine = this.host.engine as unknown as {clearanceAtV1?: (x: number, z: number) => number; nearestStandableV1?: (at: [number, number], except?: string) => [number, number] | null};
    if (!engine.clearanceAtV1 || !engine.nearestStandableV1 || !(this.host.engine.world as {navV1?: unknown}).navV1) return;
    for (const m of this.host.minds.values()) {
      const b = this.body(m.entityId), h = b?.human; if (!b || !h || (h.level ?? 0) !== 0 || h.shore || h.carrier || h.sleepPose || h.activity === 'sit' || h.baseActivity === 'sit' || this.host.engine.programOf(m.entityId)) continue;
      // CN5: below the walk planner's body radius a body cannot start a walk (route.start-blocked), so it steps out
      if ((this.unstuckAt.get(m.soulId) ?? -1e9) > tick - 1200 || engine.clearanceAtV1(b.pose.p[0], b.pose.p[2]) >= 0.27) continue;
      const to = engine.nearestStandableV1([b.pose.p[0], b.pose.p[2]], m.entityId); if (!to) continue;
      this.unstuckAt.set(m.soulId, tick);
      try {void this.host.enqueue('edge-relocate', `edge:${m.soulId}`, {soulId: m.soulId, entityId: m.entityId, to, why: 'stepped out of a solid footprint'}).catch(() => {/* best effort */});} catch {/* clock not ready */}
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
    // CN5 (acceptance): go near anyone in sight within 60 m (a gesture to someone farther off offers this first)
    for (const o of this.perceivedBodies(soul.soulId, GO_NEAR_RADIUS)) {
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
    // CN5 (acceptance): a solo wave, with nobody in particular near (or facing someone/something: {"to": …})
    caps.push({id: 'wave:here', verb: 'wave', label: 'Wave (to nobody in particular, or {"to": a name} to face someone)', available: true, params: {to: {type: 'string', optional: true, description: 'a Soul, place or thing to face'}}});
    plans.set('wave:here', {label: 'Wave', steps: [{verb: 'mars:pose_v1', params: {activity: 'wave', seconds: 3}}]});
    caps.push({id: 'wander:here', verb: 'wander', label: 'Stroll around nearby', available: true, params: secondsOf(60, 300)});
    plans.set('wander:here', {label: 'Stroll around nearby', steps: [{verb: 'ambient_wander', params: {seconds: 60, radius: 8}}], seconds: true});
    for (const o of this.perceivedBodies(soul.soulId, NEAR_RADIUS)) {
      caps.push({id: 'wave:' + o.soulId, verb: 'wave', label: `Wave to ${o.name}`, target: {id: o.soulId, kind: 'soul'}, available: true});
      // P0b: a real wave (body activity 'wave' for 3 s, facing them) once within a couple of metres.
      const ob = this.body(o.entityId);
      plans.set('wave:' + o.soulId, {label: `Wave to ${o.name}`, steps: [{verb: 'walk_to', params: {to: o.entityId, standoff: 1.6}}, {verb: 'wave', params: {at: o.entityId, seconds: 0.5}}, {verb: 'mars:pose_v1', params: {activity: 'wave', seconds: 3, ...(ob ? {face: [ob.pose.p[0], ob.pose.p[2]]} : {})}}]});
      caps.push({id: 'face:' + o.soulId, verb: 'face', label: `Turn towards ${o.name}`, target: {id: o.soulId, kind: 'soul'}, available: true});
      plans.set('face:' + o.soulId, {label: `Turn towards ${o.name}`, steps: [{verb: 'wave', params: {at: o.entityId, seconds: 1}}]});
    }
    const me = this.body(soul.entityId), w = this.host.engine.world as NativeWorld;
    if (me) {
      for (const e of Object.values(w.entities)) {
        // CN5 (acceptance): 150 m, so the fire is offered from the pond and the shore too
        if (e.def !== 'campfire' || Math.hypot(e.pose.p[0] - me.pose.p[0], e.pose.p[2] - me.pose.p[2]) > 150) continue;
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
    // Strolls: a real path through a big walkable place (waypoints on clear ground inside it), not one straight line.
    if (me) for (const c of [...caps]) {
      if (c.verb !== 'walk' || !c.available || c.target?.kind !== 'place') continue;
      const place = this.places.byId.get(c.target.id), region = (w.regions as Record<string, {polygon: [number, number][]}>)[c.target.id];
      if (!place || !region || area(region.polygon) < 250 || place.enclosed || ['sleeping-mat', 'venue', 'building', 'room', 'water'].includes(place.kind)) continue;
      const route = this.strollRoute(c.target.id, region.polygon, [me.pose.p[0], me.pose.p[2]]); if (route.length < 2) continue;
      const id = 'stroll:' + c.target.id, label = `Stroll through ${place.name} (a loop of ${route.length} stops)`;
      caps.unshift({id, verb: 'stroll', label, target: c.target, available: true, params: {pause: {type: 'integer', min: 0, max: 60, default: 4}, via: {type: 'array', items: 'place name', maxItems: 4, optional: true}}});
      plans.set(id, {label, steps: route.flatMap((p, i) => [{verb: 'walk_to', params: {to: p}}, ...(i < route.length - 1 ? [{verb: 'rest', params: {seconds: 4}}] : [])])});
    }
    // activities/1: sit/lie/nap/read anywhere, plus World's activity spots (play-piano:<spot>, paint:<spot>…).
    if (me) try {
      const act = activityCapabilities(this.spots, this.activityWorld(soul, me, caps, plans));
      // Activities lead the list (agents and the CLI read the first entries first).
      for (const c of [...act.caps].reverse()) {const i = caps.findIndex(x => x.id === c.id); if (i >= 0) caps.splice(i, 1); caps.unshift(c); plans.set(c.id, act.plans.get(c.id)!);}
    } catch (e) {if (this.activityErrors++ < 20) console.error('[edge] activity capabilities', soul.soulId, e instanceof Error ? e.stack?.split('\n').slice(0, 3).join(' | ') : e);/* activities never hide the rest */}
    // together/1: gestures, follows, items; invitations to me lead the list
    if (me) try {
      this.together.capabilities(soul, caps, plans as Map<string, TogetherPlan>);
      const lead = caps.filter(c => c.verb === 'accept' || c.verb === 'decline'); for (const c of lead.reverse()) {caps.splice(caps.indexOf(c), 1); caps.unshift(c);}
    } catch (e) {console.error('[edge] together capabilities', e instanceof Error ? e.message : e);}
    // carrier/1: a rider in the air can talk and use objects, but its body stays in the basket until it lands.
    const ride = this.aboard(soul.entityId);
    if (ride) for (const c of caps) if (c.verb === 'make' || (ride.phase === 'aloft' && !['rest:here', 'stand:here'].includes(c.id) && !['accept', 'decline', 'ask-to-stop'].includes(c.verb))) {c.available = false; c.blocked = {code: 'ride.aboard', reason: ride.phase === 'aloft' ? `You are aloft in ${ride.label}; it lands by itself and you step out then.` : `You are in ${ride.label}; leave it first.`};}
    for (const p of this.providers) try {caps.push(...p(soul));} catch {/* a provider fault hides only its own entries */}
    const value = {caps, plans}; this.capCache.set(soul.soulId, {tick, value}); return value;
  }
  capabilities(soul: EdgeSoul): EdgeCapability[] {return this.binds(soul).caps;}
  private activityErrors = 0;
  private strollSpots = new Map<string, {key: string; spots: [number, number][]}>();
  /** Up to 5 clear stops spread over a place (cached until the static scene changes), visited from the nearest as a loop. */
  private strollRoute(placeId: string, polygon: [number, number][], from: [number, number]): [number, number][] {
    const key = JSON.stringify((this.host.engine.world as {navV1?: unknown}).navV1 ?? null).length + ':' + Object.keys(this.host.engine.world.regions).length;
    let hit = this.strollSpots.get(placeId);
    if (!hit || hit.key !== key) {const spots = (this.host.engine as unknown as {clearSpotsV1?: (p: [number, number][], n: number) => [number, number][]}).clearSpotsV1?.(polygon, 5) ?? []; hit = {key, spots}; this.strollSpots.set(placeId, hit);}
    const left = [...hit.spots], out: [number, number][] = []; let at = from;
    while (left.length) {left.sort((a, b) => Math.hypot(a[0] - at[0], a[1] - at[1]) - Math.hypot(b[0] - at[0], b[1] - at[1]) || a[0] - b[0] || a[1] - b[1]); at = left.shift()!; out.push(at);}
    return out;
  }
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
  async act(soul: EdgeSoul, input: {capability?: unknown; params?: unknown; clientRef?: unknown; verb?: unknown; target?: unknown}): Promise<{accepted: true; receipt: EdgeReceipt; resolved?: Resolved; result?: unknown} | {accepted: false; code: string; reason: string; capability: string; retry_after?: number; did_you_mean?: {id: string; label: string}[]; resolved?: Resolved}> {
    // intents/1 (Core-A): {verb, target} is resolved now and acted on as the concrete choice it reports
    if (input.capability === undefined && input.verb !== undefined) {const out = await this.intents.act(soul, input as IntentInput); if (out.accepted) this.capCache.clear(); return out;}
    const out = await this.actOnce(soul, input);
    if (out.accepted) this.capCache.clear();     // invitations, items and follows change what others can do this tick
    return out;
  }
  private async actOnce(soul: EdgeSoul, input: {capability?: unknown; params?: unknown; clientRef?: unknown}): Promise<{accepted: true; receipt: EdgeReceipt; resolved?: Resolved; result?: unknown} | {accepted: false; code: string; reason: string; capability: string; retry_after?: number; did_you_mean?: {id: string; label: string}[]; resolved?: Resolved}> {
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
    let params = (input.params && typeof input.params === 'object' && !Array.isArray(input.params) ? {...input.params as Record<string, unknown>} : {}) as Record<string, unknown>;
    // intents/1: plain words for the attention channel ("look at the fire", "turn to Bill") and face:<soul> never touch the body
    if (!caps.some(c => c.id === asked)) {const plain = attentionWords(asked); if (plain) return this.intents.act(soul, {...plain, ...(clientRef ? {clientRef} : {})});}
    if (asked.startsWith('face:') && caps.some(c => c.id === asked && c.target?.kind === 'soul')) return this.intents.act(soul, {verb: 'turn', face: caps.find(c => c.id === asked)!.target!.id, ...(clientRef ? {clientRef} : {})});
    // strict/1: an id-shaped target that names nothing in this world is refused, never swapped for something else
    {const strict = strictCheck(this, soul, asked, caps); if (strict) return {...refuse(strict.code, strict.reason), did_you_mean: strict.did_you_mean};}
    // together/1: social phrasing first (accept/decline, "hug Tamsin", "give her the book", "dance with Roger", "invite X to …")
    let social: {note: string} | null = null, text = asked;
    if (!caps.some(c => c.id === asked)) {
      const r = this.together.resolve(soul, asked, caps);
      if (r && 'code' in r) return {...refuse(r.code, r.reason), did_you_mean: r.did_you_mean};
      if (r) {social = {note: r.note}; params = {...params, ...(r.params ?? {})}; text = r.capability || r.rest || asked;}
    }
    // PM-R057: exact ids first; an unambiguous natural name is accepted and reported back as `resolved`;
    // anything else is refused with the closest offered capabilities.
    const v = caps.some(c => c.id === text) ? {kind: 'exact' as const, cap: caps.find(c => c.id === text)!} : resolveCapability(text, this.vocabulary(soul, caps));
    if (v.kind === 'unknown') return {...refuse(v.code ?? 'capability.unknown', v.reason), did_you_mean: v.didYouMean};
    let cap = v.cap; capability = cap.id;
    if (v.kind === 'alias' && v.params) params = {...v.params, ...params};   // CN5: "A, then B" walks become via legs
    const note = [social?.note, v.kind === 'alias' ? v.note : null].filter(Boolean).join('; ');
    // together/1: doing a paired gesture back to someone who offered it is accepting their invitation
    if (cap.target?.kind === 'soul' && cap.verb in PAIRED) {const back = this.together.reciprocal(soul.soulId, cap.target.id, cap.verb), acc = back ? caps.find(c => c.id === 'accept:' + back.id) : undefined; if (acc) {cap = acc; capability = acc.id;}}
    const resolved: {resolved?: Resolved} = capability !== asked ? {resolved: {from: asked, to: cap.id, note: note || `${asked} is ${cap.id}.`}} : {};
    if (cap.verb === 'accept') return this.acceptInvite(soul, cap, plans, caps, clientRef, resolved, refuse);
    if (cap.verb === 'object' && cap.object && cap.action && this.comms?.objects.act) {
      // Object actions listed in capabilities may be acted on here too (same effect as POST /objects/:id/act);
      // an accepted one gets a completed receipt (like make:mark) and never interrupts the body.
      const {with: invited, ...objParams} = params;
      if (invited !== undefined && cap.action !== 'join') return {...refuse('capability.params', 'with (inviting others) works with a ride\'s join, activities and walks.'), ...resolved};
      const out = this.comms.objects.act(cap.object, soul, {action: cap.action, params: objParams}) as {accepted: boolean; code?: string; reason?: string; result?: unknown};
      if (!out.accepted) {
        // Out of reach: point at the walk that gets there.
        const placeId = out.code === 'object.out-of-reach' ? this.comms.objects.all().find(o => o.id === cap.object)?.placeId : undefined, go = placeId ? caps.find(c => c.id === 'walk:' + placeId) : undefined;
        return {...refuse(out.code ?? 'object.refused', out.reason ?? 'The object refused that action.'), ...(go ? {did_you_mean: [{id: go.id, label: go.label}]} : {}), ...resolved};
      }
      this.comms.fading.touch?.(soul.soulId);
      // An object action that moves the body (a ride's join/leave/start) is an ordinary logged decision with a normal receipt.
      const bodies = (out as {bodies?: {label: string; steps: Program['steps']}[]}).bodies;
      if (bodies?.length) {
        let steps = bodies[0].steps, commit: ((r: string) => void) | undefined;
        if (invited !== undefined) {
          // together/1: a ride with companions keeps their places and waits for them
          const prep = this.together.prepare(soul, cap, {label: bodies[0].label, steps}, {with: invited}, steps);
          if ('code' in prep) return {...refuse(prep.code, prep.reason), ...resolved};
          steps = prep.steps; commit = prep.commit;
        }
        const b = await this.performBodies(soul, capability, bodies[0].label, steps, clientRef);
        if (!b.accepted) return {...refuse(b.code, b.reason), ...resolved};
        commit?.(b.receipt.id);
        return {accepted: true, receipt: {...this.receipt(soul.soulId, b.receipt.id)!, object: cap.object} as EdgeReceipt, ...(out.result ? {result: out.result} : {}), ...resolved};
      }
      const r = this.insert(soul, capability, 'completed', clientRef, true);
      return {accepted: true, receipt: {...this.receipt(soul.soulId, r.id)!, object: cap.object} as EdgeReceipt, ...(out.result ? {result: out.result} : {}), ...resolved};
    }
    const plan = plans.get(capability) as TogetherPlan & {stop?: boolean} | undefined;
    if (!plan) return refuse('capability.unknown', 'That capability is not offered to this Soul right now; read capabilities again.');
    let steps = structuredClone(plan.steps);
    if (steps.length > 40) return refuse('capability.params', 'that plan is too long; act in shorter legs.');
    // CN5 (acceptance): a capability that takes no seconds (a swim) ignores them instead of refusing
    if (params.seconds !== undefined && !plan.seconds) delete params.seconds;
    if (params.seconds !== undefined) {
      const posed = steps.some(s => s.verb === 'mars:pose_v1'), max = posed ? ACTIVITY_SECONDS_MAX : 600;
      if (!plan.seconds || !Number.isInteger(params.seconds) || (params.seconds as number) < 1 || (params.seconds as number) > max) return refuse('capability.params', `seconds must be an integer 1..${max} for this capability.`);
      // an activity's own pose takes the seconds (not the short shelf visits); otherwise the resting/strolling step does
      if (posed) {for (const s of steps) if (s.verb === 'mars:pose_v1' && s.params.activity !== 'browse') s.params.seconds = params.seconds;}
      else if (cap.verb !== 'follow') for (const s of steps) if (s.verb === 'rest' || s.verb === 'ambient_wander' || s.verb === 'gather') s.params.seconds = params.seconds;
    }
    if (params.pause !== undefined && cap.verb === 'stroll') {
      if (!Number.isInteger(params.pause) || (params.pause as number) < 0 || (params.pause as number) > 60) return refuse('capability.params', 'pause must be an integer 0..60 seconds.');
      steps = steps.filter(s => s.verb !== 'rest' || params.pause !== 0); for (const s of steps) if (s.verb === 'rest') s.params.seconds = params.pause;
    }
    // together/1: solo gestures face whoever or whatever they are for (params.to / params.at)
    if ((params.to !== undefined || params.at !== undefined) && steps.some(s => s.verb === 'mars:pose_v1') && cap.id.endsWith(':here')) {
      const where = this.pointOf(soul, String(params.to ?? params.at ?? ''));
      if (!where) return {...refuse('capability.params', `Nothing called "${String(params.to ?? params.at)}" is in sight.`), ...resolved};
      for (const s of steps) if (s.verb === 'mars:pose_v1') s.params.face = where;
    }
    // Multi-leg walks: via (≤4 place names or ids) are walked first, in order; a strollable place is strolled through.
    if (params.via !== undefined) {
      if (!['walk', 'stroll', 'hang-out', 'gather', 'warm-by-fire'].includes(cap.verb) || !Array.isArray(params.via) || params.via.length > 4 || !params.via.every(v => typeof v === 'string' && v.length <= 100)) return refuse('capability.params', 'via must be a list of up to 4 place names or ids, on a walk, stroll, hang-out, gather or warm-by-fire capability.');
      const vocab = this.vocabulary(soul, caps), legs: Program['steps'] = [];
      for (const v of params.via as string[]) {
        const asStroll = caps.find(c => c.id === v && (c.verb === 'stroll' || c.verb === 'walk')) ?? (() => {const r = resolveCapability(v.includes(':') ? v : 'stroll:' + v, vocab); return r.kind === 'unknown' ? null : r.cap;})() ?? (() => {const r = resolveCapability(v.includes(':') ? v : 'walk:' + v, vocab); return r.kind === 'unknown' ? null : r.cap;})();
        const leg = asStroll ? plans.get(asStroll.id) : undefined;
        if (!asStroll || !leg) return {...refuse('capability.params', `via: "${v}" is not a place you can walk to from here.`), did_you_mean: caps.filter(c => c.verb === 'walk' && c.available).slice(0, 5).map(c => ({id: c.id, label: c.label})), ...resolved};
        legs.push(...structuredClone(leg.steps).filter(s => s.verb === 'walk_to' || (s.verb === 'rest' && asStroll.verb === 'stroll')));
      }
      const standing = steps[0]?.verb === 'stand' ? [steps.shift()!] : [];
      steps = [...standing, ...legs, ...steps];
    }
    const make = (plan as {make?: 'mark' | 'project'}).make;
    if (make && this.aboard(soul.entityId)) return refuse('ride.aboard', 'You are in a ride; make marks on the ground.');
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
      const program = this.host.engine.programOf(soul.entityId), h = this.body(soul.entityId)?.human;
      // Seated with nothing running (a seat stays held after its act ends): stand up for real.
      if (!program && h && (h.activity === 'sit' || h.baseActivity === 'sit')) {
        const r = this.insert(soul, capability, 'waiting', clientRef);
        await this.decide(soul, r.id, capability, 'Stand up', [{verb: 'stand', params: {}}]);
        return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
      }
      const r = this.insert(soul, capability, program ? 'started' : 'completed', clientRef);
      if (program) await this.host.enqueue('edge-stop', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, receipt: r.id});
      if (program) this.update(r.id, {phase: 'completed'});
      return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
    }
    // together/1: invitations (params.with), paired gestures, gifts, follows and items check and adjust their plan here
    const prep = this.together.prepare(soul, cap, plan, params, steps);
    if ('code' in prep) return {...refuse(prep.code, prep.reason), ...resolved};
    steps = prep.steps;
    if (prep.noBody) {
      // answering someone (decline, ask to stop following) never interrupts what the body is doing
      const r = this.insert(soul, capability, 'completed', clientRef, true); prep.commit?.(r.id); this.comms?.fading.touch?.(soul.soulId);
      return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
    }
    if (!cap.available && cap.blocked && !WAIT_CODES.has(cap.blocked.code) && !this.host.quietBarrier) return {...refuse(cap.blocked.code, cap.blocked.reason), ...resolved};
    return this.launch(soul, capability, plan.label, this.standIfSeated(soul, steps), clientRef, resolved, refuse, prep.commit);
  }
  /** CN5 (acceptance: reservation.conflict on the Soul's own seat): a seated body that is going somewhere or doing
   *  something with its whole body gets up first; overlays done on the seat (read, eat, wave…) keep it. */
  private standIfSeated(soul: EdgeSoul, steps: Program['steps']): Program['steps'] {
    const first = steps[0]?.verb; if (!first || ['stand', 'mars:pose_v1', 'wave', 'face', 'rest'].includes(first) || !this.seatOf(soul.entityId)) return steps;
    return [{verb: 'stand', params: {}}, ...steps];
  }
  /** Start a body plan as the Soul's act: queued through a quiet renewal or a safe stop, else decided now. */
  private async launch(soul: EdgeSoul, capability: string, label: string, steps: Program['steps'], clientRef: string | undefined, resolved: {resolved?: Resolved}, refuse: (code: string, reason: string) => {accepted: false; code: string; reason: string; capability: string}, commit?: (receipt: string) => void) {
    if (this.host.quietBarrier) {
      // Quiet renewal is brief and always ends (stall release): accept and start at first light, receipt 'waiting'.
      const r = this.insert(soul, capability, 'waiting', clientRef); commit?.(r.id);
      this.arm({receipt: r.id, soul, steps, label, deadline: this.host.engine.world.tick + WAIT_LIMIT_TICKS, capability});
      return {accepted: true as const, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
    }
    let issue = this.host.engine.canPerform({actor: soul.entityId, label, steps});
    // CN5 (acceptance: stuck at the pond bank / after a landing): a body standing where no walk can start steps to the
    // nearest clear spot within 4 m first (a logged edge-relocate), then starts
    if (issue?.code === 'route.start-blocked') {
      const engine = this.host.engine as unknown as {nearestStandableV1?: (at: [number, number], except?: string, min?: number, rings?: number) => [number, number] | null}, b = this.body(soul.entityId);
      const to = b && engine.nearestStandableV1 ? engine.nearestStandableV1([b.pose.p[0], b.pose.p[2]], soul.entityId, 0.33, 8) : null;
      if (to && b && Math.hypot(to[0] - b.pose.p[0], to[1] - b.pose.p[2]) <= 4) {
        await this.host.enqueue('edge-relocate', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, to, why: 'stepped clear to start'});
        issue = this.host.engine.canPerform({actor: soul.entityId, label, steps});
      }
    }
    if (issue && !WAIT_CODES.has(issue.code)) return {...refuse(issue.code, issue.code.startsWith('carrier.') ? issue.message : humanBlockedExplanationV1(issue.code, label)), ...resolved};
    if (issue) {
      // Asleep or mid-step: stop safely first, then start (receipt `waiting`).
      const r = this.insert(soul, capability, 'waiting', clientRef); commit?.(r.id);
      this.arm({receipt: r.id, soul, steps, label, deadline: this.host.engine.world.tick + WAIT_LIMIT_TICKS, capability});
      if (issue.code === 'program.safe-stop-required') await this.host.enqueue('edge-stop', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, receipt: r.id});
      return {accepted: true as const, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
    }
    const r = this.insert(soul, capability, 'waiting', clientRef); commit?.(r.id);
    await this.decide(soul, r.id, capability, label, steps);
    return {accepted: true as const, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
  }
  /** together/1: accept:<invite> — join the host (its own plan, or the ride with the kept place). */
  private async acceptInvite(soul: EdgeSoul, cap: EdgeCapability, plans: Map<string, {label: string; steps: Program['steps']}>, caps: EdgeCapability[], clientRef: string | undefined, resolved: {resolved?: Resolved}, refuse: (code: string, reason: string) => {accepted: false; code: string; reason: string; capability: string}) {
    const plan = this.together.acceptPlan(soul, cap.id.slice('accept:'.length), caps, plans as Map<string, TogetherPlan>);
    if ('code' in plan) return {...refuse(plan.code, plan.reason), ...resolved};
    this.comms?.fading.touch?.(soul.soulId);
    if (plan.ride) {
      if (!this.comms?.objects.act) return {...refuse('invite.gone', 'Rides are not available here.'), ...resolved};
      const out = this.comms.objects.act(plan.ride.object, soul, {action: 'join', params: {}}) as {accepted: boolean; code?: string; reason?: string; bodies?: {label: string; steps: Program['steps']}[]};
      if (!out.accepted || !out.bodies?.length) return {...refuse(out.code ?? 'ride.refused', out.reason ?? 'The ride refused.'), ...resolved};
      const steps = structuredClone(out.bodies[0].steps); for (const s of steps) if (s.verb === 'mars:carrier_ride') s.params.reserved = true;
      const b = await this.performBodies(soul, cap.id, out.bodies[0].label, steps, clientRef);
      if (!b.accepted) return {...refuse(b.code, b.reason), ...resolved};
      plan.commit(b.receipt.id);
      return {accepted: true as const, receipt: {...this.receipt(soul.soulId, b.receipt.id)!, object: plan.ride.object} as EdgeReceipt, ...resolved};
    }
    return this.launch(soul, cap.id, plan.label, plan.steps, clientRef, resolved, refuse, plan.commit);
  }
  /** together/1: where a Soul, place, object or ride named in plain words is (for facing / pointing). */
  private pointOf(soul: EdgeSoul, name: string): [number, number] | null {
    const w = name.trim().toLowerCase(); if (!w) return null;
    const seen = this.perceivedBodies(soul.soulId, 60), q = tokens(w);
    const o = seen.find(x => x.soulId === name) ?? seen.find(x => x.name.toLowerCase() === w) ?? seen.find(x => tokens(x.name).length > 0 && tokens(x.name).every(t => q.includes(t))) ?? seen.find(x => tokens(x.name).some(t => t.length > 2 && q.includes(t)));
    if (o) {const b = this.body(o.entityId); if (b) return [b.pose.p[0], b.pose.p[2]];}
    const world = this.host.engine.world as NativeWorld, ride = this.carriersNative().find(c => c.id === name || tokens(c.label + ' ' + c.id).some(t => tokens(w).includes(t) && t.length > 3) || /balloon/.test(w) && c.def.includes('balloon'));
    if (ride) {const e = world.entities[ride.id]; if (e) return [e.pose.p[0], e.pose.p[2]];}
    const place = this.places.byId.get(name) ?? placeMatch(tokens(w), this.vocabulary(soul, []).places)[0];
    if (place) return centroid((this.places.byId.get(place.id) ?? {polygon: [[0, 0]] as [number, number][]}).polygon);
    const e = world.entities[name]; if (e) return [e.pose.p[0], e.pose.p[2]];
    return null;
  }

  /** Body steps requested by an object action (OBJECT-CONTRACT §7): performed like `act` — refused with a genuine code, or
   *  accepted with a receipt (waiting → started → completed/failed) for a logged decision with trigger edge-act. */
  async performBodies(soul: EdgeSoul, capability: string, label: string, steps: Program['steps'], clientRef?: string): Promise<{accepted: true; receipt: EdgeReceipt} | {accepted: false; code: string; reason: string}> {
    if (clientRef) {const old = this.rows('soul_id=? AND client_ref=?', soul.soulId, clientRef)[0]; if (old) return {accepted: true, receipt: this.view(old)};}
    const refuse = (code: string, reason: string) => {this.recordRefusal(soul.soulId, 'object', capability, code); return {accepted: false as const, code, reason};};
    if (this.faded.has(soul.soulId)) return refuse('soul.faded', 'This Soul has faded; act once (e.g. stand:here) to come back first.');
    if (this.host.quietBarrier) {const r = this.insert(soul, capability, 'waiting', clientRef); this.arm({receipt: r.id, soul, steps, label, deadline: this.host.engine.world.tick + WAIT_LIMIT_TICKS, capability}); return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!};}
    const issue = this.host.engine.canPerform({actor: soul.entityId, label, steps});
    if (issue && !WAIT_CODES.has(issue.code)) return refuse(issue.code, issue.code.startsWith('carrier.') ? issue.message : humanBlockedExplanationV1(issue.code, label));
    const r = this.insert(soul, capability, 'waiting', clientRef);
    if (issue) {
      this.arm({receipt: r.id, soul, steps, label, deadline: this.host.engine.world.tick + WAIT_LIMIT_TICKS, capability});
      if (issue.code === 'program.safe-stop-required') await this.host.enqueue('edge-stop', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, receipt: r.id});
      return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!};
    }
    await this.decide(soul, r.id, capability, label, steps);
    return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!};
  }

  // ---------------------------------------------------------------- rides (carrier/1)
  private carriersNative(): {id: string; def: string; label: string; pose: {p: number[]; yaw: number}; state: {phase: string; home: number[]; yaw: number; seats: Record<string, string | null>; route: {id: string; keys: {t: number; p: number[]}[]}; elapsed: number; departAtTick: number | null; flights: number; holding: boolean; waitTicks: number; phaseTick: number; hold?: {by: string; seats: number; filled: number; untilTick: number}}}[] {
    return (this.host.engine as unknown as {carriers?: () => never[]}).carriers?.() ?? [];
  }
  /** The ride this body is boarding, seated in or leaving. */
  aboard(entityId: string): {id: string; slot: string; riderPhase: string; phase: string; label: string} | null {
    return (this.host.engine as unknown as {carrierOf?: (a: string) => ReturnType<EdgeLedger['aboard']>}).carrierOf?.(entityId) ?? null;
  }
  private carrierCount = -1;
  /** A carrier with no declared carrier place gets one derived from its native seats (`<entity>-basket`, enclosed). */
  private syncCarrierPlaces() {
    const all = this.carriersNative(); if (all.length === this.carrierCount) return; this.carrierCount = all.length;
    for (const c of all) {
      if (this.places.carrierPlaces.has(c.id)) continue;
      const seats = (CATALOG[c.def]?.capabilities?.carrier?.seats ?? []).map(s => s.id), size = CATALOG[c.def]?.size ?? [1.5, 1, 1.2];
      const parent = this.places.containing(c.state.home[0], c.state.home[2], 0)[0]?.id ?? [...this.places.byId.values()].find(p => p.parent === null)!.id;
      const hx = size[0] / 2, hz = size[2] / 2, id = `${c.id}-basket`;
      this.places.add({id, name: `${c.label} basket`, kind: 'vehicle', parent, level: 0, enclosed: true, capacity: seats.length, starting: false,
        polygon: [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]], carrier: {entity: c.id, frame: 'local'},
        occupiers: seats.map(s => ({id: `${c.id}-${s}`, fixture: c.id, slot: s, kind: 'seat'})),
        description: `The basket of ${c.label}. Room for ${seats.length}. Speech inside stays inside; it carries its riders on a flight and back.`});
    }
  }
  /** Public ride state (World draws it; agents read it through the ride object). No owner data. */
  carrierView(entityId: string) {
    const c = this.carriersNative().find(x => x.id === entityId); if (!c) return null;
    const def = CATALOG[c.def]?.capabilities?.carrier, tick = this.host.engine.world.tick, place = this.places.carrierPlaces.get(c.id);
    const rot = (l: [number, number]) => {const cs = Math.cos(c.pose.yaw), sn = Math.sin(c.pose.yaw); return [Math.round((c.state.home[0] + l[0] * cs - l[1] * sn) * 100) / 100, Math.round((c.state.home[2] + l[0] * sn + l[1] * cs) * 100) / 100];};
    const riders = Object.entries(c.state.seats).flatMap(([seat, entity]) => {
      if (!entity) return []; const m = this.host.mindByEntity?.get(entity) ?? [...this.host.minds.values()].find(x => x.entityId === entity), b = this.aboard(entity);
      const exit = def?.seats.find(s => s.id === seat)?.exit;
      return [{seat, entityId: entity, soulId: m?.soulId ?? null, name: m?.name ?? null, phase: b?.riderPhase ?? 'boarding', ...(exit ? {exit: rot(exit)} : {})}];
    });
    const end = c.state.route.keys[c.state.route.keys.length - 1].t;
    return {id: c.id, def: c.def, label: c.label, place: place?.id ?? null, phase: c.state.phase, holding: c.state.holding,
      position: c.pose.p.map(v => Math.round(v * 1000) / 1000), yaw: c.pose.yaw, home: c.state.home, door: def ? rot(def.door) : null,
      // together/1: places kept for invited companions are not free to others
      capacity: def?.seats.length ?? 0, seatsFree: Math.max(0, Object.values(c.state.seats).filter(v => !v).length - (c.state.hold ? Math.max(0, c.state.hold.seats - c.state.hold.filled) : 0)), riders,
      ...(c.state.hold ? {hold: {seats: c.state.hold.seats, boarded: c.state.hold.filled, secondsLeft: Math.max(0, Math.round((c.state.hold.untilTick - tick) / 20)), for: this.together.rideGuests(c.id)}} : {}),
      departsInSeconds: c.state.phase === 'boarding' && c.state.departAtTick !== null ? Math.max(0, Math.round((c.state.departAtTick - tick) / 20)) : null,
      departsAtTick: c.state.phase === 'boarding' ? c.state.departAtTick : null, returnsAtTick: c.state.phase === 'aloft' ? tick + Math.max(0, Math.round(end * 20) - c.state.elapsed) : null,
      route: {id: c.state.route.id, seconds: end, elapsedSeconds: Math.round(c.state.elapsed / 2) / 10, keys: c.state.route.keys, interpolation: 'eden-rides/1 hermite'},
      flights: c.state.flights, phaseTick: c.state.phaseTick, tick};
  }
  rides() {return this.carriersNative().map(c => this.carrierView(c.id)!);}
  private rideKey = new Map<string, string>();
  /** Spectator frames (EDGE-CONTRACT §7, kind `ride`): every 0.5 s while aloft, and at once on any phase or rider change. */
  private rideFrames(tick: number) {
    if (tick % 200 === 0) this.syncCarrierPlaces();
    const all = this.carriersNative(); if (!all.length) return;
    if (all.length !== this.carrierCount) this.syncCarrierPlaces();
    let changed = false;
    for (const c of all) {
      const key = JSON.stringify([c.state.phase, c.state.seats, c.state.holding, Object.values(c.state.seats).map(a => a ? this.aboard(a)?.riderPhase : null), c.state.hold ?? null]);
      const moved = c.state.phase === 'aloft', fresh = this.rideKey.get(c.id) !== key;
      if (fresh) {this.rideKey.set(c.id, key); changed = true;}
      if (moved || fresh) try {(this.comms as unknown as {core?: {spectate(m: object): void}} | undefined)?.core?.spectate({kind: 'ride', tick, ride: (() => {const v = this.carrierView(c.id)!; return fresh ? v : {...v, route: {...v.route, keys: undefined}};})()});} catch {/* spectators never break the ledger */}
    }
    if (changed) try {(this.comms?.objects as unknown as {sweep?(): void} | undefined)?.sweep?.();} catch {/* object events catch up on the next read */}
  }

  /** activities/1: the world facts activity capabilities need, for one Soul. */
  private activityWorld(soul: EdgeSoul, me: NonNullable<ReturnType<EdgeLedger['body']>>, caps: EdgeCapability[], plans: Map<string, {label: string; steps: Program['steps']; seconds?: boolean}>) {
    const engine = this.host.engine as unknown as {clearanceAtV1?: (x: number, z: number) => number; nearestStandableV1?: (at: [number, number], except?: string, min?: number, rings?: number) => [number, number] | null};
    const w = this.host.engine.world as NativeWorld, here: [number, number] = [me.pose.p[0], me.pose.p[2]];
    const others = Object.values(w.entities).filter(e => e.kind === 'human' && e.id !== soul.entityId).map(e => [e.pose.p[0], e.pose.p[2]] as [number, number]);
    const claimed = new Set<string>();
    for (const m of this.host.minds.values()) if (m.soulId !== soul.soulId) for (const r of this.openReceipts(m.soulId)) claimed.add(r.capability.slice(r.capability.indexOf(':') + 1));
    const navIds = new Set(((w as {navV1?: {solids: {id: string}[]}}).navV1?.solids ?? []).map(x => x.id));
    const enclosingBuilding = (place: string | undefined) => {let out: string | null = null; for (let p = place ? this.places.byId.get(place) : undefined; p; p = p.parent ? this.places.byId.get(p.parent) : undefined) if (p.enclosed && (p.level ?? 0) === 0) out = p.id; return out;};
    const level = me.human?.level ?? 0, h = me.human;
    return {me: here, seated: !!h && (h.activity === 'sit' || h.baseActivity === 'sit'),
      clearance: (x: number, z: number) => level === 0 && engine.clearanceAtV1 ? engine.clearanceAtV1(x, z) : 0,
      open: (at: [number, number], min: number, rings: number) => level === 0 && engine.nearestStandableV1 ? engine.nearestStandableV1(at, soul.entityId, min, rings) : null,
      taken: (at: [number, number], spotId?: string) => others.some(o => Math.hypot(o[0] - at[0], o[1] - at[1]) < 0.7) || (!!spotId && claimed.has(spotId)),
      // a spot inside a building is offered only when that building's interior was admitted (its walls are a shell, nav/1)
      enterable: (place: string | undefined) => {const b = enclosingBuilding(place); return !b || !!w.regions[b] || [...navIds].some(id => id.startsWith('nav-solid:' + b + '#w'));},
      seat: (radius: number) => {
        const free = caps.filter(c => c.verb === 'sit' && c.available && c.target && c.id !== 'sit:here').map(c => {const e = w.entities[(this.host.kernel.things[c.target!.id]?.traits.entity as string | undefined) ?? c.target!.id]; return e ? {c, d: Math.hypot(e.pose.p[0] - here[0], e.pose.p[2] - here[1])} : null;}).filter((x): x is {c: EdgeCapability; d: number} => !!x && x.d <= radius).sort((a, b) => a.d - b.d || a.c.id.localeCompare(b.c.id));
        const pick = free[0]; return pick && plans.get(pick.c.id) ? {cap: pick.c, plan: plans.get(pick.c.id)!, distance: pick.d} : null;
      },
      placeName: (id: string | undefined) => id ? this.places.byId.get(id)?.name ?? null : null,
      ancestors: (id: string) => {const out: string[] = []; for (let p = this.places.byId.get(id); p?.parent; p = this.places.byId.get(p.parent)) {const q = this.places.byId.get(p.parent); if (q?.enclosed) out.push(q.id);} return out;},
      groupSize: (group: string) => Object.values(w.entities).filter(e => e.kind === 'human' && e.human?.together?.group === group).length,
    };
  }

  /** CN5: a choreographed game this body is playing, in names (who is playing, whose turn, ends won at pétanque). */
  private gameView(b: ReturnType<EdgeLedger['body']> | undefined): {game?: unknown} {
    const g = b?.human?.game; if (!g) return {};
    const name = (id: string | null | undefined) => id ? this.host.mindByEntity?.get(id)?.name ?? [...this.host.minds.values()].find(m => m.entityId === id)?.name ?? id : null;
    return {game: {kind: g.kind, players: g.players.map(name), ...(g.waiting ? {waiting: 'for someone to join'} : {turn: g.turn, throwing: name(g.from), to: g.to ? name(g.to) : null}),
      ...(g.kind === 'petanque' ? {end: g.end ?? 0, lastEndWonBy: name(g.lastWinner), boulesThisEnd: g.boules?.length ?? 0} : {}), myWins: g.wins ?? 0, untrusted: true}};
  }
  /** What each capability answers to, for PM-R057 natural names (built only when an id is not exact). */
  private vocabulary(soul: EdgeSoul, caps: EdgeCapability[]): VocabContext {
    const w = this.host.engine.world as NativeWorld, me = this.body(soul.entityId), all = [...this.places.byId.values()], root = all.find(p => p.parent === null);
    const objects = new Map((this.comms?.objects.all() ?? []).map(o => [o.id, o]));
    const around = (x: number, z: number) => {const p = this.places.containing(x, z, 0).find(q => q.parent !== null); return p ? [p.id, p.name] : [];};
    return {caps, me: me ? [me.pose.p[0], me.pose.p[2]] : null, root: root ? [...tokens(root.id), ...tokens(root.name)] : [],
      places: all.filter(p => p.parent !== null).map(p => ({id: p.id, name: p.name, center: centroid(p.polygon), parent: p.parent, kind: p.kind, description: p.description, walkable: !!(w.regions as Record<string, unknown>)[p.id]})),
      target: c => {
        const t = c.target; if (!t) return {names: [], around: [], at: null};
        if (t.kind === 'spot') {
          // CN5: a game's extra place `<spot>.pN` answers to its spot; a spot answers to its instrument too
          const sp = this.spots.spots.find(x => x.id === t.id) ?? this.spots.spots.find(x => x.id === t.id.replace(/\.p\d+$/, '')), pl = sp?.place ? this.places.byId.get(sp.place) : undefined;
          return {names: [...(sp?.label ? [sp.label] : []), ...(sp?.instrument ? [sp.instrument] : [])], around: pl ? [pl.id, pl.name] : [], at: sp ? sp.at : null};
        }
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
    const ride = this.aboard(m.entityId), basket = ride ? this.places.carrierPlaces.get(ride.id) : undefined;
    if (basket) {const occ = this.places.occupierOf.get(ride!.id + '#' + ride!.slot); return [...(occ ? [{id: occ.occ.id, name: `${basket.name} (${ride!.slot})`, kind: 'occupier'}] : []), this.places.ref(basket), ...path];}
    const seat = this.seatOf(m.entityId), occ = seat ? this.places.occupierOf.get(seat) : undefined;
    return occ ? [{id: occ.occ.id, name: `${occ.place.name} seat`, kind: 'occupier'}, ...path] : path;
  }
  private innermostPlace(m: Mind): string | null {const b = this.body(m.entityId); if (!b) return null; const ride = this.aboard(m.entityId), basket = ride ? this.places.carrierPlaces.get(ride.id) : undefined; if (basket) return basket.id; return this.places.containing(b.pose.p[0], b.pose.p[2], b.human?.level ?? 0)[0]?.id ?? null;}
  enclosureOf(soulId: string): string | null {
    const m = this.host.minds.get(soulId), b = m ? this.body(m.entityId) : undefined; if (!b) return null;
    const ride = this.aboard(m!.entityId), basket = ride ? this.places.carrierPlaces.get(ride.id) : undefined;
    if (basket?.enclosed) return basket.id;
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
  /** EVENTS-v1: position and heading of a Soul's body (null when it has none or faded). */
  poseOf(soulId: string): {x: number; z: number; yaw: number} | null {
    const m = this.host.minds.get(soulId), b = m && !this.faded.has(soulId) ? this.body(m.entityId) : undefined;
    return b ? {x: b.pose.p[0], z: b.pose.p[2], yaw: b.pose.yaw} : null;
  }
  /** EVENTS-v1 fade-by-abandonment: an activity in progress (open receipt with its programme running), a ride, or a resting
   *  posture (seated, lying, sleeping, swimming) the Soul's own latest act chose and ambient life has not changed since. */
  postureHold(soulId: string): string | null {
    const m = this.host.minds.get(soulId); if (!m || this.faded.has(soulId) || !this.body(m.entityId)) return null;
    const program = this.host.engine.programOf(m.entityId), open = this.openReceipts(soulId);
    const running = open.find(r => r.phase === 'started' && r.programId && r.programId === program);
    if (running) return 'activity ' + running.capability;
    if (open.some(r => r.phase === 'waiting')) return 'starting ' + open[0]!.capability;
    if (this.aboard(m.entityId)) return 'riding';
    const state = stateOf(this.host, m.entityId);
    if (!['seated', 'lying', 'sleeping', 'swimming'].includes(state)) return null;
    // the latest act that moved the body (lasting marks, object moves and answers leave the body as it was)
    const last = this.rows('soul_id=? ORDER BY created_at DESC LIMIT 8', soulId).find(r => {const v = r.capability.split(':')[0]!; return !['make', 'decline', 'ask-to-stop'].includes(v) && !(v === 'object' && r.program_id === null);});
    if (!last || last.phase === 'failed' || (this.ambientAt.get(soulId) ?? 0) > last.created_at) return null;
    return POSTURE_VERBS.has(last.capability.split(':')[0]!) ? state : null;
  }
  /** Last ambient-life decision per Soul (ms): a posture ambient life chose is not the Soul's own choice. */
  private ambientAt = new Map<string, number>();
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
  map() {const regions = (this.host.engine.world as NativeWorld).regions ?? {}; return [...this.places.byId.values()].map(p => ({id: p.id, name: p.name, kind: p.kind, enclosed: p.enclosed, capacity: p.capacity, parent: p.parent, walkable: p.id in regions, center: (p.carrier ? (() => {const e = (this.host.engine.world as NativeWorld).entities[p.carrier!.entity]; return e ? [e.pose.p[0], e.pose.p[2]] : [0, 0];})() : centroid(p.polygon)).map(v => Math.round(v * 10) / 10), ...(p.carrier ? {carrier: p.carrier.entity} : {}), starting: p.starting, ...(p.description ? {description: p.description} : {}), schedule: (p.schedule ?? []).map(s => ({id: s.id, cron: s.cron, durationMinutes: s.durationMinutes ?? null, ticketed: !!s.ticketed, label: s.label ?? null}))}));}

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
    // A neighbour idle 30+ min (yellow/red) may have no agent behind it: say so, so nobody waits on silence.
    const social = (() => {try {return this.together.observe(soul);} catch {return {holding: null, following: null, followedBy: [], invites: [], invited: [], items: []};}})();
    const awayOf = (id: string) => {const f = this.comms?.fading.status(id) as {colour: string; idleSeconds: number} | null | undefined; return f && (f.colour === 'yellow' || f.colour === 'red') ? {away: {idleMinutes: Math.floor(f.idleSeconds / 60), note: 'idle a long while; may not answer'}} : {};};
    const out: Record<string, unknown> = {
      tick, at: Date.now(),
      world: {id: this.host.worldId, ...(this.host.extra.continuousDayV1 ? {} : {quiet: this.host.quietBarrier}), ...(c ? {time: {day: c.day, phase: Math.round(c.phase * 1000) / 1000, label: timeLabel(c.phase), clock: `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`}} : {})},
      // PM-R055 spread: reasons to go somewhere else, first. Scheduled place activities on now or soon (with the walk
      // that gets there), then a few other places nearby: quiet ones, ones with lasting marks/projects or something on.
      happening: spread.happening, elsewhere: spread.elsewhere,
      self: {soulId: soul.soulId, name: soul.name, entityId: soul.entityId, placePath: this.placePathOf(soul.soulId), position: b ? b.pose.p.map(v => Math.round(v * 100) / 100) : null, facing: b ? Math.round(b.pose.yaw * 100) / 100 : null,
        state: this.faded.has(soul.soulId) ? 'faded' : stateOf(this.host, m.entityId), activity: String(b?.human?.activity ?? 'idle'), reflex: action && action.actor === m.entityId ? {verb: action.action.verb, phase: action.action.phase ?? action.action.status} : null,
        receipts: this.openReceipts(soul.soulId), fade: this.comms?.fading.status(soul.soulId) ?? null,
        holding: social.holding, following: social.following, followedBy: social.followedBy, ...this.gameView(b)},
      // together/1: invitations to me (accept:<id> / decline:<id>) and my own open ones
      ...(social.invites.length ? {invites: social.invites} : {}), ...(social.invited.length ? {invited: social.invited} : {}),
      here: {souls: this.perceivedBodies(soul.soulId, NEAR_RADIUS).map(o => ({soulId: o.soulId, name: o.name, state: o.state, activity: o.activity, distance: o.distance, placeId: o.placeId, ...awayOf(o.soulId)})), objects: this.comms?.objects.visibleTo(soul) ?? [], items: social.items, untrusted: true},
      ...(this.comms ? {streamCursor: this.comms.streams.headCursor(soul.soulId)} : {}),
    };
    // activities/1: a compact "things you can do right here" list (the full list is in capabilities).
    try {
      const caps = this.capabilities(soul).filter(c => c.available), pick: EdgeCapability[] = [], seen = new Set<string>();
      const take = (c: EdgeCapability | undefined) => {if (c && !seen.has(c.id) && pick.length < 14) {seen.add(c.id); pick.push(c);}};
      // together/1: answers first, then what to do with what I hold, then things to do with the nearest Soul
      for (const c of caps) if (c.verb === 'accept') take(c);
      if (social.holding) for (const c of caps) if (c.id === 'put-down:here' || c.id === 'eat:held' || c.id === 'drink:held' || c.verb === 'give') take(c);
      const nearby = this.perceivedBodies(soul.soulId, 8);
      // Prefer an ongoing conversation partner when proposing consent gestures; another bystander may be nearer.
      const partners = new Set(this.coreA.conversations().filter(c => c.members.includes(soul.soulId)).flatMap(c => c.members));
      const nearest = nearby.find(o => partners.has(o.soulId)) ?? nearby[0];
      if (nearest) for (const v of ['hug', 'high-five', 'dance-with', 'follow']) take(caps.find(c => c.id === `${v}:${nearest.soulId}`));
      for (const id of ['sit:here', 'read:here', 'lie:here', 'nap:here', 'sit-ground:here', 'wander:here']) take(caps.find(c => c.id === id));
      for (const verb of ['warm-by-fire', 'stroll', 'play-piano', 'paint', 'play-music', 'sing', 'listen', 'use-computer', 'play-frisbee', 'play-petanque', 'play-volleyball', 'lift-weights', 'bench-press', 'pull-ups',
        'write', 'cook', 'eat', 'drink', 'play-game', 'craft', 'post-letter', 'gather', 'swim']) take(caps.find(c => c.verb === verb));
      for (const c of caps) if (c.verb === 'object') take(c);
      for (const c of caps) if (c.verb === 'pick-up') take(c);
      out.doHere = pick.map(c => ({id: c.id, label: c.label}));
    } catch {/* the summary never breaks observe */}
    if (include.has('capabilities')) out.capabilities = this.capabilities(soul);
    if (include.has('map')) out.map = {places: this.map()};
    if (include.has('eyes')) out.eyes = {status: 'unavailable'};
    return out;
  }

  // ---------------------------------------------------------------- Core-A hooks (perception/1, intents/1, strict/1)
  /** intents/1: affordance intents, dry runs and the attention channel. */
  readonly intents!: Intents;
  private nextChannel: string | null = null;
  /** Merge into a receipt's detail {channel, chosen, endedAt}; returns the stored JSON. */
  private setDetail(id: string, patch: Record<string, unknown>): string | null {
    const row = this.db.db.prepare('SELECT detail FROM edge_receipts_v1 WHERE world_id=? AND receipt_id=?').get(this.host.worldId, id) as {detail: string | null} | undefined; if (!row) return null;
    const next = JSON.stringify({...(row.detail ? JSON.parse(row.detail) : {}), ...patch});
    this.db.db.prepare('UPDATE edge_receipts_v1 SET detail=? WHERE world_id=? AND receipt_id=?').run(next, this.host.worldId, id);
    return next;
  }
  /** @internal for edge/perception and edge/intents (Core-A modules): read access and two narrow write paths. */
  get coreA() {
    const self = this;
    return {
      binds: (s: EdgeSoul) => self.binds(s),
      body: (entityId: string) => self.body(entityId),
      resolveText: (s: EdgeSoul, text: string, caps: EdgeCapability[]) => caps.some(c => c.id === text) ? {kind: 'exact' as const, cap: caps.find(c => c.id === text)!} : resolveCapability(text, self.vocabulary(s, caps)),
      isAncestor: (ancestor: string, id: string) => {for (let p = self.places.byId.get(id), n = 0; p?.parent && n < 20; p = self.places.byId.get(p.parent), n++) if (p.parent === ancestor) return true; return false;},
      targetPoint: (s: EdgeSoul, c: EdgeCapability) => self.vocabulary(s, [c]).target(c).at,
      detail: (id: string): Record<string, unknown> | null => {const r = self.rows('receipt_id=?', id)[0]; try {return r?.detail ? JSON.parse(r.detail) : null;} catch {return null;}},
      byClientRef: (soulId: string, ref: string) => {const r = self.rows('soul_id=? AND client_ref=?', soulId, ref)[0]; return r ? self.view(r) : null;},
      setDetail: (id: string, patch: Record<string, unknown>) => {const r = self.rows('receipt_id=?', id)[0]; if (!r) return null; self.setDetail(id, patch); return self.view(self.rows('receipt_id=?', id)[0]);},
      /** A completed receipt that never touches the body's act (attention, settings). */
      insertDone: (s: EdgeSoul, capability: string, clientRef: string | undefined, detail: Record<string, unknown>) => {
        self.nextChannel = String(detail.channel ?? 'none');
        try {const r = self.insert(s, capability, 'completed', clientRef, true); self.setDetail(r.id, detail); return self.receipt(s.soulId, r.id)!;} finally {self.nextChannel = null;}
      },
      /** Body steps chosen by an intent, launched exactly like an offered capability (receipt waiting → started → …). */
      launchPlan: async (s: EdgeSoul, capability: string, label: string, steps: Program['steps'], clientRef?: string) => {
        if (steps.length > 80) return {accepted: false as const, code: 'capability.params', reason: 'that plan is too long; act in shorter legs.', capability};
        if (self.aboard(s.entityId)?.phase === 'aloft') return {accepted: false as const, code: 'ride.aboard', reason: 'You are aloft; it lands by itself and you step out then.', capability};
        const refuse = (code: string, reason: string) => {self.recordRefusal(s.soulId, 'intent', capability, code); return {accepted: false as const, code, reason, capability};};
        const out = await self.launch(s, capability, label, steps, clientRef, {}, refuse); if (out.accepted) self.capCache.clear(); return out;
      },
      /** A faded Soul's next act lands it at a starting place first (C9), as act() does. */
      reclaim: async (s: EdgeSoul) => {
        if (!self.faded.has(s.soulId)) return;
        self.faded.delete(s.soulId);
        await self.host.enqueue('edge-relocate', `edge:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: self.startingPoint(s.soulId), why: 'reclaimed after fading'});
        self.capCache.delete(s.soulId);
      },
      /** Open conversations (ids and member Soul ids only; never turns). */
      conversations: (): {id: string; members: string[]}[] => {
        try {return (self.db.db.prepare("SELECT id, body FROM edge_comms_conversations WHERE world_id=? AND state='open' ORDER BY id").all(self.host.worldId) as {id: string; body: string}[]).map(r => ({id: r.id, members: ((JSON.parse(r.body) as {members?: {soulId: string}[]}).members ?? []).map(m => m.soulId)}));}
        catch {return [];}
      },
    };
  }
}

/** Receipt detail (Core-A): channel (body | attention | none), chosen (what an intent picked), endedAt (terminal). */
function detailOf(r: Row): {channel?: string; chosen?: unknown; endedAt?: unknown; alternatives?: unknown} {
  if (!r.detail) return {};
  try {const d = JSON.parse(r.detail) as {channel?: string; chosen?: unknown; endedAt?: unknown; alternatives?: unknown}; return {...(d.channel ? {channel: d.channel} : {}), ...(d.chosen ? {chosen: d.chosen} : {}), ...(d.endedAt ? {endedAt: d.endedAt} : {}), ...(d.alternatives ? {alternatives: d.alternatives} : {})};}
  catch {return {};}
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
  if (h.carrier) return 'riding';
  const a = String(h.activity ?? 'idle');
  if (a === 'sit' || a.startsWith('sit') || h.baseActivity === 'sit') return 'seated';
  if (a === 'lie' || a === 'nap') return 'lying';
  if (a === 'walk') return 'walking';
  if (a === 'swim' || a === 'tread' || a === 'wade') return 'swimming';
  if (a === 'wait') return 'waiting';
  if (a === 'idle') return host.engine.programOf(entityId) ? 'busy' : 'standing';
  return 'busy';
}
/** Verbs whose resting posture is a chosen activity (fade-by-abandonment holds the Soul while the body keeps it). */
const POSTURE_VERBS = new Set(['sit', 'sit-ground', 'lie', 'nap', 'read', 'rest', 'warm-by-fire', 'gather', 'swim', 'accept', 'object', 'paint', 'play-piano', 'play-music', 'write', 'play-game', 'craft', 'eat', 'drink', 'cook', 'dance-with']);
export function timeLabel(phase: number) {return phase < .2 ? 'morning' : phase < .45 ? 'day' : phase < .55 ? 'evening' : phase < .75 ? 'dusk' : 'night';}
