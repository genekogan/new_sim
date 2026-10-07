// together/1 (core-next4, ACTION-COVERAGE-AUDIT §3/§5 P2; Gene: gestures are "absolutely. critical even"):
// Souls do things with each other, natively and visibly, with light consent. No model calls; deterministic plans.
// - Gestures: hug / high-five / handshake / dance-with <soul> ask first (the other accepts, declines or ignores; an
//   unanswered invitation lapses in 30 s); bow / clap / nod / shake-head / cheer / point are solo (optionally facing
//   someone or something). Paired gestures run as one grouped pose (social/pose.ts together/1): both bodies step in
//   to face each other and share one start and end tick.
// - Invitations to activities: any activity act takes params.with (Souls); invitees accept and join (a shared start
//   for timed activities; walks become walking together; the balloon keeps their places and waits for them).
// - Follow / walk with a Soul until stopped.
// - Items: one hand slot per Soul. Pick up small things where they are found (books at shelves, flowers in gardens, a
//   cup or food at cafés and kitchens, letters at desks, tools in workshops, frisbees in the park), carry them (the
//   body's prop), give them (the other accepts), put them down (a small lasting object others can pick up; capped per
//   place, cleared after a while), eat or drink consumables. Items live in this ledger's table; the body only carries
//   the visible prop (human.holding), changed when a pose completes, so both agree.
import {randomUUID} from 'node:crypto';
import type {Program} from '@sim/engine-contract';
import type {WorldState as NativeWorld} from '../../../../../mars/viewer/engine/world/types.ts';
import type {WorldHost} from '../../world.ts';
import type {Db} from '../../db.ts';
import type {EdgeCapability, EdgeReceipt, EdgeSoul, NearbyBody} from '../contract.ts';
import {centroid, type PlaceIndex} from './places.ts';
import {tokens} from './vocabulary.ts';
import type {SpotsData} from './activities.ts';

type V2 = [number, number];
type Steps = Program['steps'];
export type TogetherPlan = {label: string; steps: Steps; seconds?: boolean;
  /** what this capability does beyond its body steps (invitations, items, follows) */
  together?: Tag};
type Tag =
  | {kind: 'paired'; what: Paired; guest: string}
  | {kind: 'give'; guest: string; item: string}
  | {kind: 'accept'; invite: string}
  | {kind: 'decline'; invite: string}
  | {kind: 'follow'; target: string}
  | {kind: 'unfollow'; follower: string}
  | {kind: 'item'; op: 'pick-up' | 'put-down' | 'consume'; item?: string; source?: string; itemKind?: string};
export type Paired = 'hug' | 'high-five' | 'handshake' | 'dance-with';
export type ItemKind = 'book' | 'flower' | 'cup' | 'food' | 'letter' | 'tool' | 'frisbee';

/** Paired gestures: pose id, distance between body points (m), seconds, invitation lapse (s). */
export const PAIRED: Record<Paired, {activity: string; gap: number; seconds: number; lapse: number; ask: string; label: (n: string) => string}> = {
  hug: {activity: 'hug', gap: 0.52, seconds: 5, lapse: 30, ask: 'a hug', label: n => `Hug ${n} (asks first; they can accept or decline)`},
  'high-five': {activity: 'high-five', gap: 0.75, seconds: 2.5, lapse: 30, ask: 'a high five', label: n => `High-five ${n} (asks first)`},
  handshake: {activity: 'handshake', gap: 0.85, seconds: 3.5, lapse: 30, ask: 'a handshake', label: n => `Shake hands with ${n} (asks first)`},
  'dance-with': {activity: 'dance', gap: 1.0, seconds: 60, lapse: 45, ask: 'a dance', label: n => `Dance with ${n}, facing each other (asks first)`},
};
/** Solo gestures (overlay poses): seconds, whether it can be done seated. */
export const SOLO: Record<string, {seconds: number; seated: boolean; label: string}> = {
  bow: {seconds: 2.5, seated: false, label: 'Bow (params.to: someone to bow to)'},
  clap: {seconds: 4, seated: true, label: 'Clap / applaud (params.to: someone to applaud)'},
  nod: {seconds: 1.5, seated: true, label: 'Nod (params.to: someone)'},
  'shake-head': {seconds: 1.5, seated: true, label: 'Shake your head (params.to: someone)'},
  cheer: {seconds: 3, seated: true, label: 'Cheer (params.to: someone)'},
  point: {seconds: 3, seated: true, label: 'Point at someone, a place or a thing (params.at)'},
};
export const ITEM_NAMES: Record<ItemKind, string> = {book: 'a book', flower: 'a flower', cup: 'a cup of tea', food: 'something to eat', letter: 'a letter', tool: 'a tool', frisbee: 'a frisbee'};
const CONSUMABLE = new Set<ItemKind>(['cup', 'food']);
/** Where things are found: place words (id + name) per item kind. */
const SOURCE_WORDS: [ItemKind, RegExp][] = [
  ['flower', /garden|flower|meadow|orchard|lavender|botanic|allotment/], ['cup', /tea|caf[eé]|kitchen|dining|bakery/], ['food', /kitchen|dining|bakery|market|kiosk|caf[eé]|orchard|vegetable/],
  ['tool', /barn|workshop|woodshop|shed|maker|potting/], ['frisbee', /playground|park|lawn|meadow/], ['book', /library/], ['letter', /post|office|library/],
];
const ITEM_WORDS: [ItemKind, RegExp][] = [['book', /\b(?:book|books|novel)\b/], ['flower', /\b(?:flower|flowers|rose|daisy|posy|bouquet)\b/], ['cup', /\b(?:cup|tea|coffee|mug|drink)\b/],
  ['food', /\b(?:food|snack|bread|apple|fruit|cake|bun|sandwich|something to eat|to eat)\b/], ['letter', /\b(?:letter|card|note|paper|postcard)\b/], ['tool', /\b(?:tool|hammer|trowel|chisel|spade)\b/], ['frisbee', /\b(?:frisbee|disc|disk)\b/]];
/** Bounds (Gene: simple, deterministic, bounded). */
export const ITEM_LIMITS = {perPlace: 12, placedWorld: 150, pickReach: 120, consumableMinutes: 20, keepHours: 4, nearItems: 20};
const INVITE_RADIUS = 60, GESTURE_RADIUS = 8, FOLLOW_RADIUS = 20, FOLLOW_LOST = 45;
/** Activity verbs an invitation may carry (params.with). */
const INVITABLE = new Set(['walk', 'stroll', 'wander', 'hang-out', 'gather', 'warm-by-fire', 'sit', 'sit-ground', 'lie', 'nap', 'read', 'write', 'swim', 'rest',
  'dance', 'jump', 'stretch', 'jumping-jacks', 'yoga', 'pushups', 'situps', 'play-piano', 'play-music', 'paint', 'eat', 'drink', 'cook', 'play-game', 'craft', 'object']);

export type Invite = {id: string; what: string; host: {soulId: string; name: string}; guests: {soulId: string; name: string}[]; capability: string; label: string;
  kind: 'paired' | 'give' | 'activity' | 'ride'; activity?: string; seconds?: number; gap?: number; prop?: string; base?: string;
  createdTick: number; expiresTick: number; state: 'pending' | 'closed'; responses: Record<string, 'accepted' | 'declined' | 'expired' | 'cancelled'>;
  hostReceipt: string | null; guestReceipts: Record<string, string>; item?: {id: string; kind: ItemKind; name: string}; ride?: {object: string; carrier: string}; place?: string | null};
export type Item = {id: string; kind: ItemKind; name: string; holder: string | null; placeId: string | null; at: V2 | null; state: 'held' | 'placed' | 'gone'; claimedBy: string | null; by: string | null; createdAt: number; placedAt: number | null};
type ItemOp = {soulId: string; op: 'pick-up' | 'put-down' | 'consume' | 'give' | 'take'; item?: string; kind?: ItemKind; source?: string; to?: string; invite?: string};
type Follow = {receipt: string; soulId: string; target: string; untilTick: number; withHost?: string};

/** What the ledger lends this module (closures over its internals). */
export type TogetherPort = {
  host: WorldHost; db: Db; places: PlaceIndex; spots: SpotsData;
  body(entityId: string): NativeWorld['entities'][string] | undefined;
  perceived(soulId: string, radius: number): NearbyBody[];
  receipt(soulId: string, id: string): EdgeReceipt | null;
  fail(receiptId: string, code: string, reason: string): void;
  complete(receiptId: string): void;
  /** The receipt's programme, if it is still running for that body. */
  running(soulId: string, receiptId: string): boolean;
  stop(soulId: string, entityId: string, receiptId: string): void;
  aboard(entityId: string): {id: string; phase: string; label: string} | null;
  faded(soulId: string): boolean;
  innermostPlace(soulId: string): string | null;
  deliver(soulId: string, kind: string, body: Record<string, unknown>): void;
  spectate(m: Record<string, unknown>): void;
  touch(soulId: string): void;
  decide(soul: EdgeSoul, receipt: string, capability: string, label: string, steps: Steps): Promise<unknown>;
};

const pose = (activity: string, seconds: number, extra: Record<string, unknown> = {}) => ({verb: 'mars:pose_v1', params: {activity, seconds, ...extra}});
const r2 = (v: number) => Math.round(v * 100) / 100;

export class Together {
  private p: TogetherPort;
  private follows = new Map<string, Follow>();          // receipt id → follow
  constructor(port: TogetherPort) {
    this.p = port;
    port.db.db.exec(`CREATE TABLE IF NOT EXISTS edge_invites_v1 (world_id TEXT NOT NULL, invite_id TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (world_id, invite_id));
      CREATE INDEX IF NOT EXISTS edge_invites_v1_state ON edge_invites_v1 (world_id, state);
      CREATE TABLE IF NOT EXISTS edge_items_v1 (world_id TEXT NOT NULL, item_id TEXT NOT NULL, state TEXT NOT NULL, holder TEXT, place_id TEXT, body TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (world_id, item_id));
      CREATE INDEX IF NOT EXISTS edge_items_v1_holder ON edge_items_v1 (world_id, holder);
      CREATE INDEX IF NOT EXISTS edge_items_v1_state ON edge_items_v1 (world_id, state);
      CREATE TABLE IF NOT EXISTS edge_item_ops_v1 (world_id TEXT NOT NULL, receipt_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (world_id, receipt_id));
      CREATE TABLE IF NOT EXISTS edge_follows_v1 (world_id TEXT NOT NULL, receipt_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (world_id, receipt_id));`);
    // follows survive a restart only while their receipt is still followed (otherwise the receipt itself ended)
    for (const r of port.db.db.prepare('SELECT receipt_id, body FROM edge_follows_v1 WHERE world_id=?').all(port.host.worldId) as {receipt_id: string; body: string}[]) {
      const f = JSON.parse(r.body) as Follow, rec = port.receipt(f.soulId, f.receipt);
      if (rec && (rec.phase === 'started' || rec.phase === 'waiting')) this.follows.set(f.receipt, f); else this.dropFollow(f.receipt);
    }
  }
  private get w() {return this.p.host.engine.world as NativeWorld;}
  private get tick() {return this.p.host.engine.world.tick;}
  private mindOf(soulId: string) {return this.p.host.minds.get(soulId);}
  private posOf(soulId: string): V2 | null {const m = this.mindOf(soulId), b = m ? this.p.body(m.entityId) : undefined; return b ? [b.pose.p[0], b.pose.p[2]] : null;}
  private seated(entityId: string) {const h = this.p.body(entityId)?.human; return !!h && (h.activity === 'sit' || h.baseActivity === 'sit');}
  private standFirst(entityId: string): Steps {return this.seated(entityId) ? [{verb: 'stand', params: {}}] : [];}
  /** A clear straight line between two standing points (nothing solid between two people about to touch). */
  private lineClear(a: V2, b: V2): boolean {
    const e = this.p.host.engine as unknown as {clearanceAtV1?: (x: number, z: number) => number}; if (!e.clearanceAtV1) return true;
    const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1));
    for (let i = 1; i < n; i++) if (e.clearanceAtV1(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) < 0.24) return false;
    return true;
  }
  /** Where to stand to meet someone face to face: within 1.1 m of them with a clear line between (nearest to `from`),
   *  so a hug or a hand-over never reaches across a fire, a bench or a wall. Null when they are already in reach. */
  meetSteps(me: string, other: string, standoff = 1.1): Steps {
    const mb = this.p.body(me), ob = this.p.body(other); if (!mb || !ob) return [{verb: 'walk_to', params: {to: other, standoff}}];
    const from: V2 = [mb.pose.p[0], mb.pose.p[2]], at: V2 = [ob.pose.p[0], ob.pose.p[2]], d = Math.hypot(at[0] - from[0], at[1] - from[1]);
    if (d <= standoff + 0.8 && this.lineClear(from, at)) return [{verb: 'wave', params: {at: other, seconds: 0.2}}];
    const e = this.p.host.engine as unknown as {clearanceAtV1?: (x: number, z: number) => number};
    const people = Object.values(this.w.entities).filter(x => x.kind === 'human' && x.id !== me && x.id !== other).map(x => [x.pose.p[0], x.pose.p[2]] as V2);
    const spots: {p: V2; d: number}[] = [];
    for (let k = 0; k < 16; k++) {
      const ang = k * Math.PI / 8, p: V2 = [r2(at[0] + Math.cos(ang) * standoff), r2(at[1] + Math.sin(ang) * standoff)];
      if ((e.clearanceAtV1?.(p[0], p[1]) ?? 1) < 0.34 || people.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.8) || !this.lineClear(p, at)) continue;
      spots.push({p, d: Math.hypot(p[0] - from[0], p[1] - from[1])});
    }
    spots.sort((a, b) => a.d - b.d || a.p[0] - b.p[0] || a.p[1] - b.p[1]);
    return spots.length ? [{verb: 'walk_to', params: {to: spots[0].p, standoff: 0}}, {verb: 'wave', params: {at: other, seconds: 0.2}}] : [{verb: 'walk_to', params: {to: other, standoff}}];
  }
  private asleep(entityId: string) {const h = this.p.body(entityId)?.human; return !h || !!h.sleepPose || h.activity === 'nap';}

  // ---------------------------------------------------------------- storage
  invite(id: string): Invite | null {const r = this.p.db.db.prepare('SELECT body FROM edge_invites_v1 WHERE world_id=? AND invite_id=?').get(this.p.host.worldId, id) as {body: string} | undefined; return r ? JSON.parse(r.body) as Invite : null;}
  private pending(): Invite[] {return (this.p.db.db.prepare("SELECT body FROM edge_invites_v1 WHERE world_id=? AND state='pending' ORDER BY created_at").all(this.p.host.worldId) as {body: string}[]).map(r => JSON.parse(r.body) as Invite);}
  private saveInvite(i: Invite) {this.p.db.db.prepare('INSERT INTO edge_invites_v1 (world_id,invite_id,state,body,created_at) VALUES (?,?,?,?,?) ON CONFLICT (world_id,invite_id) DO UPDATE SET state=excluded.state, body=excluded.body').run(this.p.host.worldId, i.id, i.state, JSON.stringify(i), Date.now());}
  /** Pending invitations addressed to this Soul that it has not answered. */
  invitesFor(soulId: string): Invite[] {return this.pending().filter(i => i.guests.some(g => g.soulId === soulId) && !i.responses[soulId]);}
  item(id: string): Item | null {const r = this.p.db.db.prepare('SELECT body FROM edge_items_v1 WHERE world_id=? AND item_id=?').get(this.p.host.worldId, id) as {body: string} | undefined; return r ? JSON.parse(r.body) as Item : null;}
  heldBy(soulId: string): Item | null {const r = this.p.db.db.prepare("SELECT body FROM edge_items_v1 WHERE world_id=? AND holder=? AND state='held' LIMIT 1").get(this.p.host.worldId, soulId) as {body: string} | undefined; return r ? JSON.parse(r.body) as Item : null;}
  placed(): Item[] {return (this.p.db.db.prepare("SELECT body FROM edge_items_v1 WHERE world_id=? AND state='placed' ORDER BY updated_at").all(this.p.host.worldId) as {body: string}[]).map(r => JSON.parse(r.body) as Item);}
  private saveItem(i: Item) {
    if (i.state === 'gone') {this.p.db.db.prepare('DELETE FROM edge_items_v1 WHERE world_id=? AND item_id=?').run(this.p.host.worldId, i.id); this.p.spectate({kind: 'item', item: this.publicItem(i)}); return;}
    this.p.db.db.prepare('INSERT INTO edge_items_v1 (world_id,item_id,state,holder,place_id,body,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT (world_id,item_id) DO UPDATE SET state=excluded.state, holder=excluded.holder, place_id=excluded.place_id, body=excluded.body, updated_at=excluded.updated_at')
      .run(this.p.host.worldId, i.id, i.state, i.holder, i.placeId, JSON.stringify(i), Date.now());
    this.p.spectate({kind: 'item', item: this.publicItem(i)});
  }
  publicItem(i: Item) {return {id: i.id, kind: i.kind, name: i.name, state: i.state, holder: i.holder ? {soulId: i.holder, name: this.mindOf(i.holder)?.name ?? 'someone'} : null, placeId: i.placeId, at: i.at, untrusted: true};}
  private saveOp(receipt: string, op: ItemOp) {this.p.db.db.prepare('INSERT OR REPLACE INTO edge_item_ops_v1 (world_id,receipt_id,body) VALUES (?,?,?)').run(this.p.host.worldId, receipt, JSON.stringify(op));}
  private takeOp(receipt: string): ItemOp | null {
    const r = this.p.db.db.prepare('SELECT body FROM edge_item_ops_v1 WHERE world_id=? AND receipt_id=?').get(this.p.host.worldId, receipt) as {body: string} | undefined;
    if (!r) return null; this.p.db.db.prepare('DELETE FROM edge_item_ops_v1 WHERE world_id=? AND receipt_id=?').run(this.p.host.worldId, receipt); return JSON.parse(r.body) as ItemOp;
  }
  private saveFollow(f: Follow) {this.follows.set(f.receipt, f); this.p.db.db.prepare('INSERT OR REPLACE INTO edge_follows_v1 (world_id,receipt_id,body) VALUES (?,?,?)').run(this.p.host.worldId, f.receipt, JSON.stringify(f));}
  private dropFollow(receipt: string) {this.follows.delete(receipt); this.p.db.db.prepare('DELETE FROM edge_follows_v1 WHERE world_id=? AND receipt_id=?').run(this.p.host.worldId, receipt);}
  followingOf(soulId: string) {return [...this.follows.values()].find(f => f.soulId === soulId) ?? null;}
  followersOf(soulId: string) {return [...this.follows.values()].filter(f => f.target === soulId);}
  /** A guest with an unanswered invitation is not idle (ambient life leaves it be while its agent decides). */
  awaiting(soulId: string) {return this.invitesFor(soulId).length > 0;}

  // ---------------------------------------------------------------- item sources
  private sourceCache: {key: string; list: {id: string; kind: ItemKind; label: string; at: V2; face?: V2; place: string | null}[]} | null = null;
  /** Deterministic item sources: shelves (books), writing desks (letters) and walkable places by kind (gardens → flowers…). */
  sources() {
    const nav = (this.w as {navV1?: {solids?: unknown[]; ground?: unknown[]}}).navV1, key = Object.keys(this.w.regions).length + ':' + (nav?.solids?.length ?? -1) + ':' + (nav?.ground?.length ?? -1);
    if (this.sourceCache?.key === key) return this.sourceCache.list;
    const out: {id: string; kind: ItemKind; label: string; at: V2; face?: V2; place: string | null}[] = [];
    const nameOf = (id?: string) => (id ? this.p.places.byId.get(id)?.name : undefined) ?? 'the shelf';
    for (const s of this.p.spots.shelves) out.push({id: 'shelf:' + s.id, kind: 'book', label: `a shelf in ${nameOf(s.place)}`, at: s.at, ...(s.faceTo ? {face: s.faceTo} : {}), place: s.place ?? null});
    for (const s of this.p.spots.spots) if (s.activity === 'write' || s.activity === 'post-letter') out.push({id: 'spot:' + s.id, kind: 'letter', label: s.label ?? 'a writing desk', at: s.at, ...(s.faceTo ? {face: s.faceTo} : {}), place: s.place ?? null});
    const engine = this.p.host.engine as unknown as {nearestStandableV1?: (at: V2, except?: string, min?: number, rings?: number) => V2 | null};
    for (const place of [...this.p.places.byId.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!this.w.regions[place.id] || place.kind === 'water' || place.carrier) continue;
      const text = (place.id + ' ' + place.name).toLowerCase(), kinds = SOURCE_WORDS.filter(([, re]) => re.test(text)).map(([k]) => k);
      if (!kinds.length) continue;
      const at = engine.nearestStandableV1?.(centroid(place.polygon), undefined, 0.6, 24) ?? null; if (!at) continue;
      for (const kind of [...new Set(kinds)]) out.push({id: 'place:' + place.id, kind, label: place.name, at, place: place.id});
    }
    this.sourceCache = {key, list: out}; return out;
  }

  // ---------------------------------------------------------------- capabilities
  /** Gestures, invitations, follows and items for one Soul (added to the ledger's capability list and plans). */
  capabilities(soul: EdgeSoul, caps: EdgeCapability[], plans: Map<string, TogetherPlan>) {
    const me = this.p.body(soul.entityId); if (!me) return;
    const here: V2 = [me.pose.p[0], me.pose.p[2]], add = (c: EdgeCapability, plan: TogetherPlan) => {caps.push(c); plans.set(c.id, plan);};
    const seated = this.seated(soul.entityId), aloft = this.p.aboard(soul.entityId);
    // invitations to me lead (accept / decline)
    for (const inv of this.invitesFor(soul.soulId)) {
      add({id: 'accept:' + inv.id, verb: 'accept', label: `Accept: ${inv.host.name} ${inv.label} (${Math.max(0, Math.round((inv.expiresTick - this.tick) / 20))} s left)`, target: {id: inv.host.soulId, kind: 'soul'}, available: true}, {label: 'Accept the invitation', steps: [], together: {kind: 'accept', invite: inv.id}});
      add({id: 'decline:' + inv.id, verb: 'decline', label: `Decline ${inv.host.name}'s invitation (${inv.what})`, target: {id: inv.host.soulId, kind: 'soul'}, available: true}, {label: 'Decline the invitation', steps: [], together: {kind: 'decline', invite: inv.id}});
    }
    const held = this.heldBy(soul.soulId), mine = this.followingOf(soul.soulId);
    for (const o of this.p.perceived(soul.soulId, FOLLOW_RADIUS)) {
      if (this.p.faded(o.soulId)) continue;
      const om = this.mindOf(o.soulId); if (!om) continue;
      const busy = this.asleep(o.entityId) ? 'asleep' : this.p.aboard(o.entityId) ? 'riding' : null;
      if (o.distance <= GESTURE_RADIUS) {
        for (const g of Object.keys(PAIRED) as Paired[]) {
          const def = PAIRED[g], blocked = busy ? {code: 'gesture.partner-unavailable', reason: `${o.name} is ${busy}.`} : aloft ? {code: 'ride.aboard', reason: 'Not while riding.'} : null;
          add({id: `${g}:${o.soulId}`, verb: g, label: def.label(o.name), target: {id: o.soulId, kind: 'soul'}, available: !blocked, ...(blocked ? {blocked} : {}), ...(g === 'dance-with' ? {params: {seconds: {type: 'integer', min: 5, max: 600, default: 60}}} : {})},
            {label: def.label(o.name).replace(/ \(.*\)$/, ''), seconds: g === 'dance-with', steps: [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: o.entityId, standoff: 1.1}}, pose(def.activity, def.seconds, {gap: def.gap, waitSeconds: 45, alone: 'fail'})], together: {kind: 'paired', what: g, guest: o.soulId}});
        }
        if (held) {
          const blocked = busy ? {code: 'gesture.partner-unavailable', reason: `${o.name} is ${busy}.`} : this.heldBy(o.soulId) ? {code: 'hands.full', reason: `${o.name}'s hands are full.`} : null;
          add({id: 'give:' + o.soulId, verb: 'give', label: `Give ${o.name} ${held.name} you are holding (they accept or decline)`, target: {id: o.soulId, kind: 'soul'}, available: !blocked, ...(blocked ? {blocked} : {})},
            {label: `Give ${o.name} ${held.name}`, steps: [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: o.entityId, standoff: 1.1}}, pose('give', 2.5, {prop: held.kind, gap: 0.8, waitSeconds: 45, alone: 'fail', release: true})], together: {kind: 'give', guest: o.soulId, item: held.id}});
        }
      }
      if (mine?.target !== o.soulId) add({id: 'follow:' + o.soulId, verb: 'follow', label: `Walk with ${o.name}: follow them wherever they go until you do something else`, target: {id: o.soulId, kind: 'soul'}, available: !busy && !aloft, ...(busy || aloft ? {blocked: {code: 'follow.unavailable', reason: busy ? `${o.name} is ${busy}.` : 'Not while riding.'}} : {}), params: {seconds: {type: 'integer', min: 10, max: 3600, default: 600}}},
        {label: `Walk with ${o.name}`, seconds: true, steps: this.followSteps(soul.entityId, o.entityId), together: {kind: 'follow', target: o.soulId}});
    }
    for (const f of this.followersOf(soul.soulId)) {const n = this.mindOf(f.soulId)?.name ?? 'someone'; add({id: 'ask-to-stop:' + f.soulId, verb: 'ask-to-stop', label: `Ask ${n} to stop following you`, target: {id: f.soulId, kind: 'soul'}, available: true}, {label: `Ask ${n} to stop following`, steps: [], together: {kind: 'unfollow', follower: f.soulId}});}
    // solo gestures right here
    for (const [g, def] of Object.entries(SOLO)) {
      add({id: g + ':here', verb: g, label: def.label, available: !aloft || def.seated, params: g === 'point' ? {at: {type: 'string', optional: true, description: 'a Soul, place or thing (name or id)'}} : {to: {type: 'string', optional: true, description: 'a Soul (name or id) to face'}, ...(g === 'clap' ? {seconds: {type: 'integer', min: 1, max: 30, default: 4}} : {})}},
        {label: def.label.replace(/ \(.*\)$/, ''), seconds: g === 'clap', steps: [...(def.seated ? [] : this.standFirst(soul.entityId)), pose(g, def.seconds)]});
    }
    // items: what is in my hand, or what I can pick up
    if (held) {
      add({id: 'put-down:here', verb: 'put-down', label: `Put ${held.name} down here (it stays for others to pick up)`, available: !aloft, ...(aloft ? {blocked: {code: 'ride.aboard', reason: 'Not while riding.'}} : {})},
        {label: `Put down ${held.name}`, steps: [pose('put-down', 1.5, {prop: held.kind, release: true})], together: {kind: 'item', op: 'put-down', item: held.id}});
      if (held.kind === 'food' || held.kind === 'cup') {
        const verb = held.kind === 'food' ? 'eat' : 'drink';
        add({id: verb + ':held', verb, label: held.kind === 'food' ? `Eat ${held.name} you are holding` : `Drink ${held.name} you are holding`, available: true, params: {seconds: {type: 'integer', min: 5, max: 300, default: 30}}},
          {label: verb === 'eat' ? 'Eat' : 'Drink', seconds: true, steps: [pose(verb, 30, {prop: held.kind === 'food' ? 'food' : 'cup', release: true})], together: {kind: 'item', op: 'consume', item: held.id}});
      }
    } else if (!aloft) {
      const best = new Map<ItemKind, {s: ReturnType<Together['sources']>[number]; d: number}>();
      for (const s of this.sources()) {const d = Math.hypot(s.at[0] - here[0], s.at[1] - here[1]); if (d <= ITEM_LIMITS.pickReach && (!best.has(s.kind) || d < best.get(s.kind)!.d)) best.set(s.kind, {s, d});}
      for (const [kind, {s, d}] of [...best].sort((a, b) => a[1].d - b[1].d)) {
        add({id: 'pick-up:' + kind, verb: 'pick-up', label: `Pick up ${ITEM_NAMES[kind]} (${s.label}, ${Math.round(d)} m)`, target: {id: s.id, kind: 'source'}, available: true},
          {label: `Pick up ${ITEM_NAMES[kind]}`, steps: [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: s.at, standoff: 0}}, pose('pick-up', 1.5, {prop: kind, hold: kind, ...(s.face ? {face: s.face} : {})})], together: {kind: 'item', op: 'pick-up', source: s.id, itemKind: kind}});
      }
      for (const it of this.placed()) {
        if (!it.at || it.claimedBy) continue; const d = Math.hypot(it.at[0] - here[0], it.at[1] - here[1]); if (d > ITEM_LIMITS.nearItems) continue;
        add({id: 'pick-up:' + it.id, verb: 'pick-up', label: `Pick up ${it.name} lying here (${Math.round(d)} m)`, target: {id: it.id, kind: 'item'}, available: true},
          {label: `Pick up ${it.name}`, steps: [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: it.at, standoff: 0.45}}, pose('pick-up', 1.5, {prop: it.kind, hold: it.kind, face: it.at})], together: {kind: 'item', op: 'pick-up', item: it.id, itemKind: it.kind}});
      }
    }
  }
  /** One follow leg programme: walk up behind them and pause, repeated; the ledger re-issues it while the follow lasts. */
  private followSteps(me: string, target: string): Steps {
    const legs: Steps = [];
    for (let i = 0; i < 10; i++) legs.push({verb: 'walk_to', params: {to: target, standoff: 1.5}}, {verb: 'rest', params: {seconds: 2}});
    return [...this.standFirst(me), ...legs];
  }

  // ---------------------------------------------------------------- acting
  /** Resolve souls named in params.with (ids or names), live and within reach. */
  private withSouls(soul: EdgeSoul, raw: unknown): {ok: true; souls: {soulId: string; name: string; entityId: string}[]} | {ok: false; code: string; reason: string} {
    const list = typeof raw === 'string' ? raw.split(',') : raw;
    if (!Array.isArray(list) || !list.length || list.length > 6 || !list.every(x => typeof x === 'string' && x.trim() && x.length <= 100)) return {ok: false, code: 'capability.params', reason: 'with must be up to 6 Soul ids or names.'};
    const near = this.p.perceived(soul.soulId, INVITE_RADIUS), out: {soulId: string; name: string; entityId: string}[] = [];
    for (const want of list as string[]) {
      const w = want.trim().toLowerCase(), hit = near.find(o => o.soulId === want.trim()) ?? near.find(o => o.name.toLowerCase() === w) ?? near.find(o => tokens(o.name).includes(w));
      if (!hit) return {ok: false, code: 'invite.not-near', reason: `${want} is not near enough to invite (within ${INVITE_RADIUS} m and able to see each other).`};
      if (this.p.faded(hit.soulId)) return {ok: false, code: 'invite.absent', reason: `${hit.name} is away.`};
      if (!out.some(x => x.soulId === hit.soulId)) out.push({soulId: hit.soulId, name: hit.name, entityId: hit.entityId});
    }
    return {ok: true, souls: out};
  }

  /** Before an act is accepted: validate what it adds, adjust its steps, and say what to record once its receipt exists.
   *  No side effects here (a refusal later in act leaves nothing behind). */
  prepare(soul: EdgeSoul, cap: EdgeCapability, plan: TogetherPlan, params: Record<string, unknown>, steps: Steps): {code: string; reason: string} | {steps: Steps; label?: string; commit?: (receipt: string) => void; noBody?: boolean} {
    const tag = plan.together;
    // an earlier invitation of mine that this act replaces is withdrawn when its receipt ends (onReceipt)
    if (tag?.kind === 'paired' || tag?.kind === 'give') {
      const g = this.mindOf(tag.guest), gb = g ? this.p.body(g.entityId) : undefined, me = this.p.body(soul.entityId);
      if (!g || !gb || !me || this.p.faded(tag.guest)) return {code: 'gesture.partner-unavailable', reason: 'They are not here any more.'};
      if (Math.hypot(gb.pose.p[0] - me.pose.p[0], gb.pose.p[2] - me.pose.p[2]) > GESTURE_RADIUS + 2) return {code: 'gesture.too-far', reason: `${g.name} is too far away; go near them first.`};
      if (tag.kind === 'give' && this.heldBy(tag.guest)) return {code: 'hands.full', reason: `${g.name}'s hands are full.`};
      const held = tag.kind === 'give' ? this.heldBy(soul.soulId) : null;
      if (tag.kind === 'give' && (!held || held.id !== tag.item)) return {code: 'hands.empty', reason: 'You are not holding that any more.'};
      const id = 'inv_' + randomUUID().slice(0, 12), def = tag.kind === 'paired' ? PAIRED[tag.what] : null;
      const seconds = tag.kind === 'paired' && tag.what === 'dance-with' && Number.isInteger(params.seconds) ? params.seconds as number : def?.seconds ?? 2.5;
      // walk to a spot facing them with nothing between (never across a fire or a bench)
      const out = structuredClone(steps).flatMap(s => s.verb === 'walk_to' && s.params.to === g.entityId ? this.meetSteps(soul.entityId, g.entityId) : [s]);
      for (const s of out) if (s.verb === 'mars:pose_v1') {s.params.group = id; s.params.seconds = seconds;}
      return {steps: out, commit: receipt => {
        const inv: Invite = {id, what: tag.kind === 'paired' ? tag.what : 'give', kind: tag.kind, host: {soulId: soul.soulId, name: soul.name}, guests: [{soulId: g.soulId, name: g.name}], capability: cap.id,
          label: tag.kind === 'paired' ? `offers you ${def!.ask}` : `wants to give you ${held!.name}`, activity: def?.activity ?? 'take', seconds, gap: def?.gap ?? 0.8, ...(held ? {item: {id: held.id, kind: held.kind, name: held.name}, prop: held.kind} : {}),
          createdTick: this.tick, expiresTick: this.tick + (def?.lapse ?? 30) * 20, state: 'pending', responses: {}, hostReceipt: receipt, guestReceipts: {}};
        this.saveInvite(inv); this.announce(inv);
        if (held) this.saveOp(receipt, {soulId: soul.soulId, op: 'give', item: held.id, to: g.soulId, invite: id});
      }};
    }
    if (tag?.kind === 'follow') {
      const t = this.mindOf(tag.target); if (!t || this.p.faded(tag.target)) return {code: 'follow.unavailable', reason: 'They are not here any more.'};
      const seconds = Number.isInteger(params.seconds) ? Math.min(3600, Math.max(10, params.seconds as number)) : 600;
      return {steps, commit: receipt => {
        this.saveFollow({receipt, soulId: soul.soulId, target: tag.target, untilTick: this.tick + seconds * 20});
        this.p.deliver(tag.target, 'follow', {from: {soulId: soul.soulId, name: soul.name}, text: `${soul.name} is walking with you. (To ask them to stop: ask-to-stop:${soul.soulId})`, untrusted: true});
      }};
    }
    if (tag?.kind === 'unfollow') {
      const f = this.followingOf(tag.follower); if (!f || f.target !== soul.soulId) return {code: 'follow.none', reason: 'They are not following you.'};
      return {steps: [], noBody: true, commit: () => {this.endFollow(f, 'failed', 'follow.asked-to-stop', `${soul.name} asked you to stop following.`);}};
    }
    if (tag?.kind === 'decline') {
      const inv = this.invite(tag.invite); if (!inv || inv.state !== 'pending' || inv.responses[soul.soulId]) return {code: 'invite.gone', reason: 'That invitation is no longer open.'};
      return {steps: [], noBody: true, commit: () => this.respond(inv.id, soul, 'declined')};
    }
    if (tag?.kind === 'item') {
      const held = this.heldBy(soul.soulId);
      if (tag.op === 'pick-up') {
        if (held) return {code: 'hands.full', reason: `You are holding ${held.name}; put it down or give it away first.`};
        if (tag.item) {const it = this.item(tag.item); if (!it || it.state !== 'placed' || it.claimedBy) return {code: 'item.gone', reason: 'Someone has already taken it.'};}
        return {steps, commit: receipt => {
          if (tag.item) {const it = this.item(tag.item)!; it.claimedBy = soul.soulId; this.saveItem(it);}
          this.saveOp(receipt, {soulId: soul.soulId, op: 'pick-up', ...(tag.item ? {item: tag.item} : {}), kind: tag.itemKind as ItemKind, ...(tag.source ? {source: tag.source} : {})});
        }};
      }
      if (!held || held.id !== tag.item) return {code: 'hands.empty', reason: 'You are not holding that any more.'};
      if (tag.op === 'put-down') {
        const place = this.dropPlace(soul.soulId), placed = this.placed();
        if (placed.filter(i => i.placeId === place).length >= ITEM_LIMITS.perPlace) return {code: 'place.items-full', reason: `${ITEM_LIMITS.perPlace} things are already lying here; put it down somewhere else or give it to someone.`};
        return {steps, commit: receipt => this.saveOp(receipt, {soulId: soul.soulId, op: 'put-down', item: held.id})};
      }
      const out = structuredClone(steps); if (Number.isInteger(params.seconds)) for (const s of out) if (s.verb === 'mars:pose_v1') s.params.seconds = params.seconds;
      return {steps: out, commit: receipt => this.saveOp(receipt, {soulId: soul.soulId, op: 'consume', item: held.id})};
    }
    // invitations to an activity: params.with
    if (params.with !== undefined) {
      if (!INVITABLE.has(cap.verb) || (cap.verb === 'object' && cap.action !== 'join')) return {code: 'capability.params', reason: `with (inviting others) works with activities, walks and rides, not ${cap.verb}.`};
      const w = this.withSouls(soul, params.with); if (!w.ok) return {code: w.code, reason: w.reason};
      const id = 'inv_' + randomUUID().slice(0, 12), out = structuredClone(steps), last = [...out].reverse().find(s => s.verb === 'mars:pose_v1');
      if (last) {last.params.group = id; last.params.waitSeconds = 20; last.params.alone = 'start'; last.params.need = 1;}
      const ride = cap.verb === 'object' ? out.find(s => s.verb === 'mars:carrier_ride') : undefined;
      if (ride) {ride.params.holdSeats = w.souls.length; ride.params.holdSeconds = 90;}
      const what = ride ? 'ride' : cap.verb, label = ride ? `invites you on ${cap.label.replace(/^.*\(/, '').replace(/\)$/, '') || 'the ride'}` : `invites you to join: ${cap.label}`;
      return {steps: out, commit: receipt => {
        const inv: Invite = {id, what, kind: ride ? 'ride' : 'activity', host: {soulId: soul.soulId, name: soul.name}, guests: w.souls.map(s => ({soulId: s.soulId, name: s.name})), capability: cap.id, label,
          ...(last ? {activity: String(last.params.activity), seconds: Number(last.params.seconds), ...(last.params.prop ? {prop: String(last.params.prop)} : {}), ...(last.params.base ? {base: String(last.params.base)} : {})} : {}),
          ...(ride && cap.object ? {ride: {object: cap.object, carrier: String(ride.params.carrier)}} : {}), place: cap.target?.kind === 'place' ? cap.target.id : null,
          createdTick: this.tick, expiresTick: this.tick + (ride ? 90 : 90) * 20, state: 'pending', responses: {}, hostReceipt: receipt, guestReceipts: {}};
        this.saveInvite(inv); this.announce(inv);
      }};
    }
    return {steps};
  }
  private announce(inv: Invite) {
    const secs = Math.round((inv.expiresTick - this.tick) / 20);
    for (const g of inv.guests) this.p.deliver(g.soulId, 'invite', {invite: {id: inv.id, what: inv.what, from: inv.host, label: `${inv.host.name} ${inv.label}`, expiresInSeconds: secs, accept: 'accept:' + inv.id, decline: 'decline:' + inv.id}, untrusted: true});
    this.p.spectate({kind: 'invite', invite: {id: inv.id, what: inv.what, from: inv.host, to: inv.guests, state: 'pending'}, untrusted: true});
  }
  private respond(id: string, soul: EdgeSoul, answer: 'accepted' | 'declined', guestReceipt?: string) {
    const inv = this.invite(id); if (!inv || inv.state !== 'pending') return;
    inv.responses[soul.soulId] = answer; if (guestReceipt) inv.guestReceipts[soul.soulId] = guestReceipt;
    this.p.deliver(inv.host.soulId, 'invite.' + answer, {invite: {id: inv.id, what: inv.what}, from: {soulId: soul.soulId, name: soul.name}, text: `${soul.name} ${answer === 'accepted' ? 'accepted' : 'declined'} (${inv.what}).`, untrusted: true});
    this.p.spectate({kind: 'invite', invite: {id: inv.id, what: inv.what, from: inv.host, to: inv.guests, state: answer, by: {soulId: soul.soulId, name: soul.name}}, untrusted: true});
    const open = inv.guests.filter(g => !inv.responses[g.soulId]);
    if (!open.length || answer === 'accepted' && (inv.kind === 'paired' || inv.kind === 'give')) inv.state = 'closed';
    this.saveInvite(inv);
    // nobody will come: a paired gesture or a gift ends for the host (an activity simply goes on alone)
    if (inv.state === 'closed' && !Object.values(inv.responses).includes('accepted') && (inv.kind === 'paired' || inv.kind === 'give')) this.hostAlone(inv, answer === 'declined' ? 'invite.declined' : 'invite.expired', `${soul.name} declined.`);
  }
  private hostAlone(inv: Invite, code: string, reason: string) {
    const r = inv.hostReceipt, m = this.mindOf(inv.host.soulId); if (!r || !m) return;
    const rec = this.p.receipt(inv.host.soulId, r); if (!rec || (rec.phase !== 'started' && rec.phase !== 'waiting')) return;
    const running = this.p.running(inv.host.soulId, r);
    this.p.fail(r, code, reason);
    if (running) this.p.stop(inv.host.soulId, m.entityId, r);
  }

  /** accept:<invite> → the guest's own plan to join (computed now, from where everyone is). */
  acceptPlan(soul: EdgeSoul, inviteId: string, ownCaps: EdgeCapability[], ownPlans: Map<string, TogetherPlan>): {code: string; reason: string} | {label: string; steps: Steps; capability: string; ride?: {object: string}; commit: (receipt: string) => void} {
    const inv = this.invite(inviteId);
    if (!inv || inv.state !== 'pending' || !inv.guests.some(g => g.soulId === soul.soulId) || inv.responses[soul.soulId]) return {code: 'invite.gone', reason: 'That invitation is no longer open.'};
    const host = this.mindOf(inv.host.soulId), hb = host ? this.p.body(host.entityId) : undefined, me = this.p.body(soul.entityId);
    if (!host || !hb || !me || this.p.faded(inv.host.soulId)) return {code: 'invite.gone', reason: `${inv.host.name} is not here any more.`};
    const commit = (receipt: string) => this.respond(inv.id, soul, 'accepted', receipt);
    const d = Math.hypot(hb.pose.p[0] - me.pose.p[0], hb.pose.p[2] - me.pose.p[2]), go = (standoff: number): Steps => d > standoff + 0.6 ? [{verb: 'walk_to', params: {to: host.entityId, standoff}}] : [{verb: 'wave', params: {at: host.entityId, seconds: 0.2}}];
    if (inv.kind === 'paired' || inv.kind === 'give') {
      if (inv.kind === 'give' && this.heldBy(soul.soulId)) return {code: 'hands.full', reason: `Your hands are full; put down ${this.heldBy(soul.soulId)!.name} first.`};
      if (this.asleep(soul.entityId)) return {code: 'state.asleep', reason: 'Wake up first.'};
      const seatedTake = inv.kind === 'give' && this.seated(soul.entityId);
      const steps: Steps = [...(seatedTake ? [] : [...this.standFirst(soul.entityId), ...this.meetSteps(soul.entityId, host.entityId)]),
        pose(inv.activity!, inv.seconds!, {group: inv.id, gap: inv.gap, waitSeconds: 30, alone: 'fail', ...(inv.kind === 'give' ? {prop: inv.item!.kind, hold: inv.item!.kind} : {})})];
      return {label: inv.kind === 'give' ? `Take ${inv.item!.name} from ${inv.host.name}` : `${inv.what} with ${inv.host.name}`, steps, capability: 'accept:' + inv.id, commit: receipt => {
        commit(receipt); if (inv.kind === 'give') this.saveOp(receipt, {soulId: soul.soulId, op: 'take', item: inv.item!.id, invite: inv.id});
      }};
    }
    if (inv.kind === 'ride') return {label: 'Join the ride', steps: [], capability: 'accept:' + inv.id, ride: {object: inv.ride!.object}, commit};
    // activity: the same place-bound capability if I have it; walks become walking with the host; poses happen beside them
    const hostCap = inv.capability, verb = hostCap.slice(0, hostCap.indexOf(':'));
    if (['walk', 'stroll', 'wander', 'hang-out'].includes(verb)) return {label: `Walk with ${inv.host.name}`, steps: this.followSteps(soul.entityId, host.entityId), capability: 'accept:' + inv.id, commit: receipt => {
      commit(receipt); this.saveFollow({receipt, soulId: soul.soulId, target: inv.host.soulId, untilTick: this.tick + 3600 * 20, withHost: inv.hostReceipt ?? undefined});
    }};
    if (!hostCap.endsWith(':here') && ownPlans.has(hostCap) && ownCaps.find(c => c.id === hostCap)?.available) {
      const own = ownPlans.get(hostCap)!, steps = structuredClone(own.steps), last = [...steps].reverse().find(s => s.verb === 'mars:pose_v1');
      if (last) {last.params.group = inv.id; last.params.waitSeconds = 20; last.params.alone = 'start';}
      return {label: own.label, steps, capability: 'accept:' + inv.id, commit};
    }
    if (verb === 'sit') {
      // a free seat near them, else the ground beside them
      const seat = ownCaps.filter(c => c.verb === 'sit' && c.available && c.target && c.id !== 'sit:here' && ownPlans.has(c.id)).map(c => {const e = this.w.entities[(this.p.host.kernel.things[c.target!.id]?.traits.entity as string | undefined) ?? c.target!.id]; return e ? {c, d: Math.hypot(e.pose.p[0] - hb.pose.p[0], e.pose.p[2] - hb.pose.p[2])} : null;})
        .filter((x): x is {c: EdgeCapability; d: number} => !!x && x.d <= 5 && x.d > 0.3).sort((a, b) => a.d - b.d || a.c.id.localeCompare(b.c.id))[0];
      if (seat) return {label: `Sit with ${inv.host.name}`, steps: ownPlans.get(seat.c.id)!.steps, capability: 'accept:' + inv.id, commit};
      return {label: `Sit with ${inv.host.name}`, steps: [...this.standFirst(soul.entityId), ...go(1.2), pose('sit-ground', inv.seconds ?? 120)], capability: 'accept:' + inv.id, commit};
    }
    if (inv.activity) {
      const lying = ['lie', 'nap', 'yoga', 'pushups', 'situps'].includes(inv.activity);
      return {label: `${inv.activity} with ${inv.host.name}`, capability: 'accept:' + inv.id, commit,
        steps: [...this.standFirst(soul.entityId), ...go(lying ? 1.8 : 1.4), pose(inv.activity, inv.seconds ?? 60, {group: inv.id, waitSeconds: 20, alone: 'start', ...(inv.prop ? {prop: inv.prop} : {})})]};
    }
    return {label: `Join ${inv.host.name}`, steps: [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: host.entityId, standoff: 1.4}}], capability: 'accept:' + inv.id, commit};
  }
  /** Souls a ride keeps places for (open ride invitations not declined). */
  rideGuests(carrier: string): {soulId: string; name: string}[] {
    return this.pending().filter(i => i.kind === 'ride' && i.ride?.carrier === carrier).flatMap(i => i.guests.filter(g => !i.responses[g.soulId] || i.responses[g.soulId] === 'accepted'));
  }
  /** A pending invitation from `other` to `me` of this paired gesture (doing it back is accepting). */
  reciprocal(me: string, other: string, what: string): Invite | null {return this.invitesFor(me).find(i => i.host.soulId === other && i.what === what) ?? null;}

  // ---------------------------------------------------------------- receipts, follows, time
  /** Receipt phase changes (live): items change hands, invitations close with their host's act, follows end. */
  onReceipt(r: EdgeReceipt) {
    if (r.phase === 'started' || r.phase === 'waiting') return;
    const op = this.takeOp(r.id);
    if (op) this.applyOp(op, r);
    if (this.follows.has(r.id)) this.dropFollow(r.id);
    // the host's act ended: a still-open invitation closes (a ride's stays open while its host sits in the basket)
    for (const inv of this.pending()) if (inv.hostReceipt === r.id && !(inv.kind === 'ride' && r.phase === 'completed')) {
      const open = inv.guests.filter(g => !inv.responses[g.soulId]);
      for (const g of open) {inv.responses[g.soulId] = 'cancelled'; this.p.deliver(g.soulId, 'invite.closed', {invite: {id: inv.id, what: inv.what}, from: inv.host, text: `${inv.host.name}'s invitation (${inv.what}) is no longer open.`, untrusted: true});}
      inv.state = 'closed'; this.saveInvite(inv);
    }
  }
  private dropPlace(soulId: string) {return this.p.innermostPlace(soulId) ?? 'world';}
  private applyOp(op: ItemOp, r: EdgeReceipt) {
    const done = r.phase === 'completed', m = this.mindOf(op.soulId), b = m ? this.p.body(m.entityId) : undefined;
    const it = op.item ? this.item(op.item) : null;
    if (op.op === 'pick-up') {
      if (it && it.claimedBy === op.soulId && it.state === 'placed') {it.claimedBy = null; if (done) {it.state = 'held'; it.holder = op.soulId; it.placeId = null; it.at = null;} this.saveItem(it);}
      else if (!op.item && done && op.kind) this.saveItem({id: 'it_' + randomUUID().slice(0, 12), kind: op.kind, name: ITEM_NAMES[op.kind], holder: op.soulId, placeId: null, at: null, state: 'held', claimedBy: null, by: op.soulId, createdAt: Date.now(), placedAt: null});
      return;
    }
    if (!it || !done) {
      // a hand-over that did not happen: the gift stays with the giver; a take that failed after the giver let go drops it here
      if (op.op === 'take' && it && it.holder === op.soulId && it.state === 'held' && b && !b.human?.holding) this.place(it, op.soulId, b);
      return;
    }
    if (op.op === 'put-down' && it.holder === op.soulId && b) {
      // a book put down by a shelf goes back on the shelf; a cup or plate by its café/kitchen is cleared away
      const at: V2 = [b.pose.p[0], b.pose.p[2]], home = this.sources().find(s => s.kind === it.kind && Math.hypot(s.at[0] - at[0], s.at[1] - at[1]) < (s.id.startsWith('shelf:') ? 3 : 2));
      if (home && (it.kind === 'book' || CONSUMABLE.has(it.kind))) {it.state = 'gone'; it.holder = null; this.saveItem(it); this.p.deliver(op.soulId, 'world', {text: it.kind === 'book' ? 'You put the book back on the shelf.' : `You put ${it.name} back.`}); return;}
      this.place(it, op.soulId, b);
    } else if (op.op === 'consume' && it.holder === op.soulId) {it.state = 'gone'; it.holder = null; this.saveItem(it);}
    else if (op.op === 'give' && it.holder === op.soulId && op.to) {
      const inv = op.invite ? this.invite(op.invite) : null;
      if (inv?.responses[op.to] === 'accepted') {it.holder = op.to; this.saveItem(it); this.p.deliver(op.to, 'world', {text: `${m?.name ?? 'Someone'} gave you ${it.name}.`, untrusted: true});}
    }
  }
  private place(it: Item, soulId: string, b: {pose: {p: number[]; yaw: number}}) {
    const x = b.pose.p[0] + Math.cos(b.pose.yaw) * 0.35, z = b.pose.p[2] + Math.sin(b.pose.yaw) * 0.35;
    it.state = 'placed'; it.holder = null; it.placeId = this.dropPlace(soulId); it.at = [r2(x), r2(z)]; it.placedAt = Date.now(); it.claimedBy = null; it.by = soulId; this.saveItem(it);
  }
  /** onProgram hook: a follow leg finished — walk on (true) or let the receipt end. */
  continueFollow(receiptId: string, soul: EdgeSoul): boolean {
    const f = this.follows.get(receiptId); if (!f) return false;
    const t = this.mindOf(f.target), tb = t ? this.p.body(t.entityId) : undefined, me = this.p.body(soul.entityId);
    if (!t || !tb || !me || this.p.faded(f.target)) {this.endFollow(f, 'completed'); return false;}
    if (this.p.aboard(t.entityId)) {this.endFollow(f, 'completed'); this.p.deliver(f.soulId, 'world', {text: `${t.name} boarded a ride; you stop following.`, untrusted: true}); return false;}
    if (this.arrivedTogether(f)) {this.endFollow(f, 'completed'); return false;}
    if (this.tick >= f.untilTick) {this.endFollow(f, 'completed'); return false;}
    if (Math.hypot(tb.pose.p[0] - me.pose.p[0], tb.pose.p[2] - me.pose.p[2]) > FOLLOW_LOST) {this.endFollow(f, 'failed', 'follow.lost', `You lost sight of ${t.name}.`); return false;}
    void this.p.decide(soul, receiptId, 'follow:' + f.target, `Walk with ${t.name}`, this.followSteps(soul.entityId, t.entityId).filter(s => s.verb !== 'stand')).catch(() => this.p.fail(receiptId, 'ledger.unavailable', 'The world could not record this action.'));
    return true;
  }
  /** Walking together (an accepted walk invitation): the host's walk is over and the guest is beside them. */
  private arrivedTogether(f: Follow) {
    if (!f.withHost || ['started', 'waiting'].includes(this.p.receipt(f.target, f.withHost)?.phase ?? 'gone')) return false;
    const a = this.posOf(f.soulId), b = this.posOf(f.target);
    if (a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) > 3) {f.untilTick = Math.min(f.untilTick, this.tick + 60 * 20); return false;}
    return true;
  }
  private endFollow(f: Follow, phase: 'completed' | 'failed', code?: string, reason?: string) {
    this.dropFollow(f.receipt);
    const running = this.p.running(f.soulId, f.receipt), m = this.mindOf(f.soulId);
    if (phase === 'failed') this.p.fail(f.receipt, code ?? 'follow.ended', reason ?? 'The walk together ended.'); else this.p.complete(f.receipt);
    if (running && m) this.p.stop(f.soulId, m.entityId, f.receipt);
  }
  /** Every second: invitations lapse; follows whose target faded end; placed items are cleared after a while. */
  sweep() {
    const tick = this.tick, carriers = (this.p.host.engine as unknown as {carriers?: () => {id: string; state: {phase: string; hold?: unknown}}[]}).carriers?.() ?? [];
    for (const inv of this.pending()) {
      // a ride invitation closes once the basket has gone (or stopped keeping the place)
      const gone = inv.kind === 'ride' && (() => {
        const c = carriers.find(x => x.id === inv.ride?.carrier), boarding = inv.hostReceipt ? ['started', 'waiting'].includes(this.p.receipt(inv.host.soulId, inv.hostReceipt)?.phase ?? '') : false;
        return !c || c.state.phase === 'aloft' || c.state.phase === 'landed' || (!boarding && !c.state.hold);
      })();
      if (tick <= inv.expiresTick && !gone) continue;
      const open = inv.guests.filter(g => !inv.responses[g.soulId]);
      for (const g of open) {inv.responses[g.soulId] = 'expired'; this.p.deliver(g.soulId, 'invite.expired', {invite: {id: inv.id, what: inv.what}, from: inv.host, text: `${inv.host.name}'s invitation (${inv.what}) lapsed.`, untrusted: true});}
      inv.state = 'closed'; this.saveInvite(inv);
      if (open.length) this.p.deliver(inv.host.soulId, 'invite.expired', {invite: {id: inv.id, what: inv.what}, text: `No answer from ${open.map(g => g.name).join(', ')} (${inv.what}).`, untrusted: true});
      if (!Object.values(inv.responses).includes('accepted') && (inv.kind === 'paired' || inv.kind === 'give')) this.hostAlone(inv, 'invite.expired', `No answer from ${open.map(g => g.name).join(', ')}.`);
    }
    for (const f of [...this.follows.values()]) {
      const r = this.p.receipt(f.soulId, f.receipt); if (!r || !['started', 'waiting'].includes(r.phase)) {this.dropFollow(f.receipt); continue;}
      if (this.p.faded(f.target) || !this.mindOf(f.target)) {this.endFollow(f, 'failed', 'follow.lost', 'They are not here any more.'); continue;}
      // walking together ends once the host's walk has ended and the guest has caught up; a follow ends when its time is up
      if (this.arrivedTogether(f) || tick >= f.untilTick) this.endFollow(f, 'completed');
    }
    if (tick % 600 === 0) {
      // closed invitations are kept an hour for the record, then dropped
      this.p.db.db.prepare("DELETE FROM edge_invites_v1 WHERE world_id=? AND state='closed' AND created_at<?").run(this.p.host.worldId, Date.now() - 3600_000);
      const now = Date.now(), placed = this.placed();
      for (const [i, it] of placed.entries()) {
        const age = (now - (it.placedAt ?? now)) / 60_000;
        if (age > (CONSUMABLE.has(it.kind) ? ITEM_LIMITS.consumableMinutes : ITEM_LIMITS.keepHours * 60) || placed.length - i > ITEM_LIMITS.placedWorld) {it.state = 'gone'; this.saveItem(it);}
      }
    }
  }

  // ---------------------------------------------------------------- perception
  observe(soul: EdgeSoul) {
    const held = this.heldBy(soul.soulId), f = this.followingOf(soul.soulId), here = this.posOf(soul.soulId);
    const items = here ? this.placed().filter(i => i.at && Math.hypot(i.at[0] - here[0], i.at[1] - here[1]) <= ITEM_LIMITS.nearItems).map(i => ({id: i.id, kind: i.kind, name: i.name, distance: Math.round(Math.hypot(i.at![0] - here[0], i.at![1] - here[1]) * 10) / 10, capability: 'pick-up:' + i.id})) : [];
    return {
      holding: held ? {id: held.id, kind: held.kind, name: held.name} : null,
      following: f ? {soulId: f.target, name: this.mindOf(f.target)?.name ?? 'someone', untrusted: true} : null,
      followedBy: this.followersOf(soul.soulId).map(x => ({soulId: x.soulId, name: this.mindOf(x.soulId)?.name ?? 'someone'})),
      invites: this.invitesFor(soul.soulId).map(i => ({id: i.id, what: i.what, from: i.host, label: `${i.host.name} ${i.label}`, expiresInSeconds: Math.max(0, Math.round((i.expiresTick - this.tick) / 20)), accept: 'accept:' + i.id, decline: 'decline:' + i.id, untrusted: true})),
      invited: this.pending().filter(i => i.host.soulId === soul.soulId).map(i => ({id: i.id, what: i.what, guests: i.guests.map(g => ({...g, answer: i.responses[g.soulId] ?? 'pending'})), expiresInSeconds: Math.max(0, Math.round((i.expiresTick - this.tick) / 20))})),
      items,
    };
  }
  /** Public: things lying in the world (viewers draw them). */
  publicItems() {return this.placed().map(i => this.publicItem(i));}

  // ---------------------------------------------------------------- plain words
  /** Social phrasing resolved before the generic vocabulary: accept/decline, gestures with a name or pronoun, follow,
   *  give, pick up / put down / eat / drink, and "<activity> with <names>" / "invite <names> to <activity>". */
  resolve(soul: EdgeSoul, text: string, caps: EdgeCapability[]): {capability: string; params?: Record<string, unknown>; rest?: string; note: string} | {code: string; reason: string; did_you_mean: {id: string; label: string}[]} | null {
    const raw = text.trim(), t = raw.toLowerCase().replace(/[!?.]+$/, '').replace(/^(?:please|ok|okay|sure|yes,?|let'?s|lets|i'?d like to|i want to|go and|go)\s+/, '').trim();
    if (raw.includes(':') && caps.some(c => c.id === raw)) return null;
    const near = this.p.perceived(soul.soulId, INVITE_RADIUS);
    const who = (words: string): NearbyBody | null => {
      const w = words.trim().replace(/^(?:to|with|at|the|my friend)\s+/, '').replace(/['’]s\b.*$/, '').trim(); if (!w) return null;
      if (/^(?:him|her|them|they|she|he|my partner|my friend|back)$/.test(w)) {
        // the nearest Soul I am talking with, else the only one close by
        const talking = this.conversationPartners(soul.soulId), mineNear = near.filter(o => talking.includes(o.soulId));
        return mineNear[0] ?? (near.filter(o => o.distance <= GESTURE_RADIUS).length === 1 ? near[0] : null);
      }
      return near.find(o => o.soulId === w) ?? near.find(o => o.name.toLowerCase() === w) ?? near.find(o => tokens(o.name).length && tokens(o.name).every(x => tokens(w).includes(x))) ?? near.find(o => tokens(w).some(x => x.length > 2 && tokens(o.name).includes(x))) ?? null;
    };
    const capFor = (verb: string, o: NearbyBody) => caps.find(c => c.id === `${verb}:${o.soulId}`);
    const tooFar = (verb: string, o: NearbyBody) => {const g = caps.find(c => c.id === 'go-near:' + o.soulId); return {code: 'gesture.too-far', reason: `${o.name} is ${o.distance} m away; ${verb} needs you within ${GESTURE_RADIUS} m. Go near them first.`, did_you_mean: g ? [{id: g.id, label: g.label}] : []};};
    // invitations to me
    const mine = this.invitesFor(soul.soulId);
    if (/^(?:accept|yes|sure|ok|okay|i accept|accept (?:the |their |his |her )?(?:invitation|invite|offer)|join (?:in|them|him|her)|with pleasure|gladly)$/.test(t) && mine.length) {const i = mine.at(-1)!; return {capability: 'accept:' + i.id, note: `accepting ${i.host.name}'s invitation (${i.what})`};}
    if (/^(?:decline|no|no thanks|no thank you|not now|decline (?:the |their )?(?:invitation|invite|offer)|refuse)$/.test(t) && mine.length) {const i = mine.at(-1)!; return {capability: 'decline:' + i.id, note: `declining ${i.host.name}'s invitation (${i.what})`};}
    if (!mine.length && /^(?:accept|decline|yes|no thanks|no thank you|accept (?:the |their )?(?:invitation|invite|offer)|decline (?:the |their )?(?:invitation|invite|offer))$/.test(t)) return {code: 'invite.none', reason: 'Nobody has invited you to anything right now (observe → invites).', did_you_mean: []};
    const acc = /^(?:accept|join)\s+(.+?)(?:['’]s)?(?:\s+(?:invitation|invite|offer|hug|dance))?$/.exec(t);
    if (acc && mine.length) {const o = who(acc[1]); const i = o ? mine.filter(x => x.host.soulId === o.soulId).at(-1) : undefined; if (i) return {capability: 'accept:' + i.id, note: `accepting ${i.host.name}'s invitation (${i.what})`};}
    // gestures
    const G: [RegExp, string][] = [[/^(?:give\s+(.+?)\s+a\s+hug|hug|embrace|cuddle)\s*(.*)$/, 'hug'], [/^(?:give\s+(.+?)\s+a\s+high[- ]?five|high[- ]?five|hi[- ]?five)\s*(.*)$/, 'high-five'],
      [/^(?:shake\s+hands\s+with|shake\s+(.+?)['’]s\s+hand|handshake(?:\s+with)?|shake\s+hands)\s*(.*)$/, 'handshake'], [/^(?:dance\s+with|ask\s+(.+?)\s+to\s+dance|have\s+a\s+dance\s+with)\s*(.*)$/, 'dance-with']];
    for (const [re, verb] of G) {
      const m = re.exec(t); if (!m) continue;
      const name = (m[1] ?? m[2] ?? '').trim();
      const o = name ? who(name) : near.filter(x => x.distance <= GESTURE_RADIUS).length === 1 ? near[0] : null;
      if (!o) return {code: 'capability.unknown', reason: name ? `Nobody called "${name}" is near you.` : `Say who: "${verb} <name>".`, did_you_mean: caps.filter(c => c.verb === verb).slice(0, 5).map(c => ({id: c.id, label: c.label}))};
      const back = this.reciprocal(soul.soulId, o.soulId, verb); if (back) return {capability: 'accept:' + back.id, note: `${o.name} already offered ${verb}; accepting`};
      const c = capFor(verb, o); if (!c) return tooFar(verb, o);
      return {capability: c.id, note: `${raw} is ${c.id}`};
    }
    const solo = /^(bow|clap|applaud|nod|shake\s+(?:my|your)\s+head|shake[- ]head|cheer|point)(?:\s+(?:to|at|for|towards|toward)\s+(.+))?$/.exec(t);
    if (solo) {
      const verb = solo[1] === 'applaud' ? 'clap' : /shake/.test(solo[1]) ? 'shake-head' : solo[1], target = solo[2]?.trim();
      if (!target) return {capability: verb + ':here', note: `${raw} is ${verb}:here`};
      return {capability: verb + ':here', params: verb === 'point' ? {at: target} : {to: target}, note: `${raw} is ${verb}:here (${verb === 'point' ? 'at' : 'to'} ${target})`};
    }
    // follow / walk with
    const fol = /^(?:follow|walk\s+with|go\s+with|accompany|tag\s+along\s+with|come\s+with)\s+(.+)$/.exec(t);
    if (fol) {
      const o = who(fol[1]); if (!o) return null;
      const back = this.invitesFor(soul.soulId).find(i => i.host.soulId === o.soulId); if (back) return {capability: 'accept:' + back.id, note: `joining ${o.name}'s ${back.what}`};
      const c = capFor('follow', o); if (!c) return {code: 'follow.unavailable', reason: `${o.name} is too far away to walk with (${o.distance} m).`, did_you_mean: []};
      return {capability: c.id, note: `${raw} is ${c.id}`};
    }
    // items
    const held = this.heldBy(soul.soulId);
    const give = /^(?:give|hand|pass|offer)\s+(.+?)\s+(?:the\s+|my\s+|this\s+|a\s+|an\s+)?(?:book|flower|flowers|cup|tea|coffee|food|snack|letter|tool|frisbee|it|this|that|thing)$/.exec(t) ?? /^(?:give|hand|pass|offer)\s+(?:the\s+|my\s+|this\s+|a\s+|an\s+)?(?:\w+\s+)?(?:to)\s+(.+)$/.exec(t) ?? /^(?:give|hand|pass)\s+(?:it|this|that)\s+to\s+(.+)$/.exec(t);
    if (give) {
      if (!held) return {code: 'hands.empty', reason: 'You are not holding anything to give; pick something up first.', did_you_mean: caps.filter(c => c.verb === 'pick-up').slice(0, 5).map(c => ({id: c.id, label: c.label}))};
      const o = who(give[1]); if (!o) return {code: 'capability.unknown', reason: `Nobody called "${give[1]}" is near you.`, did_you_mean: caps.filter(c => c.verb === 'give').slice(0, 5).map(c => ({id: c.id, label: c.label}))};
      const c = capFor('give', o); if (!c) return tooFar('give', o);
      return {capability: c.id, note: `${raw} is ${c.id} (${held.name})`};
    }
    if (/^(?:put\s+(?:it|this|that|the\s+\w+|my\s+\w+)\s+down|put\s+down(?:\s+.*)?|drop(?:\s+.*)?|set\s+(?:it|.+)\s+down|leave\s+(?:it|the\s+\w+)\s+here|put\s+(?:it|the\s+\w+)\s+back)$/.test(t)) {
      if (!held) return {code: 'hands.empty', reason: 'You are not holding anything.', did_you_mean: []};
      return {capability: 'put-down:here', note: `${raw} is put-down:here (${held.name})`};
    }
    if (held && ((held.kind === 'food' && /^(?:eat|have|finish)\b/.test(t) && (/\b(?:it|this|that|food|snack|bread|apple|cake)\b/.test(t) || t === 'eat')) || (held.kind === 'cup' && /^(?:drink|sip|have|finish)\b/.test(t) && (/\b(?:it|this|that|tea|coffee|cup|drink)\b/.test(t) || t === 'drink'))))
      return {capability: (held.kind === 'food' ? 'eat' : 'drink') + ':held', note: `${raw}: ${held.name} you are holding`};
    const pick = /^(?:pick\s+up|take|grab|get|fetch|collect|pluck|borrow)\s+(?:me\s+)?(?:(?:a|an|some|the|one)\s+)?(.+)$/.exec(t);
    if (pick && !/^(?:a\s+)?(?:walk|stroll|nap|seat|rest|break|swim|ride|look|dip|turn|picture)/.test(pick[1]) && !/\b(?:read|reading|write|writing)\b/.test(pick[1])) {
      const what = pick[1], kind = ITEM_WORDS.find(([, re]) => re.test(' ' + what + ' '))?.[0];
      if (kind) {
        if (held) return {code: 'hands.full', reason: `You are holding ${held.name}; put it down or give it away first.`, did_you_mean: caps.filter(c => c.id === 'put-down:here' || c.verb === 'give').slice(0, 4).map(c => ({id: c.id, label: c.label}))};
        const lying = caps.filter(c => c.verb === 'pick-up' && c.target?.kind === 'item' && this.item(c.target.id)?.kind === kind)[0];
        const c = lying ?? caps.find(c => c.id === 'pick-up:' + kind);
        if (!c) return {code: 'item.none-near', reason: `There is no ${kind} to pick up within ${ITEM_LIMITS.pickReach} m.`, did_you_mean: caps.filter(c => c.verb === 'pick-up').slice(0, 5).map(c => ({id: c.id, label: c.label}))};
        return {capability: c.id, note: `${raw} is ${c.id} (${c.label})`};
      }
    }
    // "<activity> with <names>", "invite <names> to <activity>", "go for a balloon ride with X", "join me ..." is said by the host
    const t0 = raw.toLowerCase().replace(/[!?.]+$/, '').replace(/^(?:please|ok|okay|sure)\s+/, '').trim();
    const inv = /^invite\s+(.+?)\s+(?:to|for|on)\s+(.+)$/.exec(t0);
    const withm = inv ? null : /^(.+?)\s+(?:together with|along with|with)\s+(?!me\b)(.+)$/.exec(t0);
    const names = inv ? inv[1] : withm?.[2], activity = inv ? inv[2] : withm?.[1];
    if (names && activity && !/^(?:walk|go|stroll|come)$/.test(activity.trim())) {
      const list = names.split(/\s*(?:,|\band\b|&)\s*/).map(x => x.trim()).filter(Boolean), souls = list.map(n => who(n));
      if (souls.length && souls.every(Boolean)) return {capability: '', rest: activity.replace(/^(?:me\s+)?(?:to\s+)?/, '').replace(/^(?:let'?s|lets)\s+/, '').trim(), params: {with: [...new Set(souls.map(o => o!.soulId))]}, note: `inviting ${souls.map(o => o!.name).join(', ')}`};
    }
    // "come read with me", "let's dance", "join me on the balloon": whoever I am talking with, close by
    const us = /^(?:join me|let'?s|lets|shall we)\s+(.+?)(?:\s+with me)?$/.exec(t0) ?? /^(?:come\s+(?:and\s+)?)?(.+?)\s+with me$/.exec(t0);
    if (us) {
      const partners = this.conversationPartners(soul.soulId).map(id => near.find(o => o.soulId === id)).filter((o): o is NearbyBody => !!o && o.distance <= FOLLOW_RADIUS);
      if (partners.length) return {capability: '', rest: us[1].replace(/^(?:on|to|for|in)\s+/, '').trim(), params: {with: partners.map(o => o.soulId)}, note: `inviting ${partners.map(o => o.name).join(', ')} (you are talking with them)`};
    }
    return null;
  }
  private conversationPartners(soulId: string): string[] {
    try {
      const out: string[] = [];
      for (const r of this.p.db.db.prepare("SELECT body FROM edge_comms_conversations WHERE world_id=? AND state='open'").all(this.p.host.worldId) as {body: string}[]) {
        const ids = (JSON.parse(r.body) as {members?: {soulId: string}[]}).members?.map(m => m.soulId) ?? [];
        if (ids.includes(soulId)) out.push(...ids.filter(x => x !== soulId));
      }
      return out;
    } catch {return [];}
  }
}
