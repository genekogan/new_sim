// The engine bridge (spec eden4/31 B2/B3, plan 33 §3.5, lane L9): Souls live among god-built things.
//
//  entity world ──GodMode.onCommit──▶ derive physics per changed entity ──host.enqueue('world-edit')──▶ engine fold
//  engine items (take/put by a Soul) ──afterTick──▶ trusted compiler `move` (by 'engine', not undoable) ──▶ journal + viewers
//  birth / retire ──onApplied──▶ the Soul's body entity (core/humanoid, the engine's own `h_…` id) in the entity world
//
// The derived physics is plain data in the logged event, so the engine's replay never reads the entity model.
// Fastest working path on the engine's existing structures (nav/1-style static scene re-base, CATALOG fixtures);
// the per-tile patch follows L8's tiled Spatial.
import { applyBatch, type Diff, type Entity, type Op, type Result, type StoredDef, type WorldModel } from '@sim/world-compiler';
import { assetFromDef, assetIdFor, isFixtureDef, nearestSurfaceSlot, nextEntityPhysics, withLinkApproaches, type DefFacts, type EntityPhysicsV1, type FixtureSpecV1, type WorldEditV1 } from '@sim/engine-mars';
import type { WorldHost } from '../world.ts';
import type { EdgeLedger } from '../edge/ledger/ledger.ts';
import type { EdgeCapability, EdgeSoul } from '../edge/contract.ts';
import type { GodMode } from './god.ts';
import { reachProviders, usesProviders, type ReachEnd } from './query.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
type Level = { id: number; y: number; label: string };
type Part = NonNullable<WorldEditV1['set'][string]>;
/** What the engine side of a MarsEngine offers the bridge (world-edit/1 methods; packages/engine-mars/src/engine.ts). */
type EngineV1 = {
  world: { tick: number; entities: Record<string, any>; entityPhysicsV1?: EntityPhysicsV1 };
  applyWorldEditV1(p: WorldEditV1): { hash: string };
  bodyUsesV1(id: string): { body: string; how: 'occupied' | 'held' } | null;
  reachV1(from: { p: Vec2; level?: number }, to: { p: Vec2; level?: number }): { ok: true; length: number; legs: number; levels: number[] } | { ok: false; code: string; message: string };
  standableNearV1(at: Vec2, level?: number, except?: string, minClear?: number, maxRing?: number): Vec2 | null;
  programOf(id: string): string | null;
};

const GROUND_BAND = 0.35;      // a floor within this of the ground is level 0 (the engine's ground is flat at y 0 until L8's tiles)
const LEVEL_MATCH = 0.12;      // floors this close in height share an engine level
const MAX_LEVEL = 20;          // walk_to's level schema
const NEAR = 60;               // capabilities: god things within this many metres
const BODY_DEF = 'core/humanoid@1';
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export type BridgeOptions = { host: WorldHost; god: GodMode; edge?: EdgeLedger; log?: (m: string) => void };

export class EngineBridge {
  readonly host: WorldHost; readonly god: GodMode; readonly edge?: EdgeLedger;
  /** What the engine was last told, per entity (JSON of its part), and the physics state that produced. */
  private sent = new Map<string, string>();
  private physics: EntityPhysicsV1 | undefined;
  private levels: Level[] = [];
  private reconciled = false;
  private writeBackBusy = false;
  private log: (m: string) => void;
  stats = { edits: 0, entities: 0, writeBacks: 0, refusals: 0, bodies: 0, lastMs: 0 };

  constructor(o: BridgeOptions) {
    this.host = o.host; this.god = o.god; this.edge = o.edge; this.log = o.log ?? ((m) => console.log(`[bridge] ${m}`));
    this.god.onCommit((c) => { if (c.by !== 'engine') this.onCommit(c.diff); });
    this.host.listeners.push({
      afterTick: (tick) => { if (!this.reconciled) this.reconcile(); else { this.flush(); if (tick % 10 === 0) this.writeBack(); } },
      onApplied: (e) => { if (e.kind === 'birth') this.bodyBorn(e.payload as { entityId: string; soulId: string; name: string }); if (e.kind === 'retire') this.bodyRetired(e.payload as { entityId: string }); },
    });
    reachProviders.set(this.god.model, (from, to) => this.reach(from, to));
    usesProviders.set(this.god.model, (id) => { const u = this.usesOf(id); return u ? { soul: u.soul, body: u.body, how: u.how, thing: this.model.pathOf(u.id) } : null; });
    // body-aware edits: the compiler hook when GodMode has it (lead patch 5), else wrap its entry points
    if ('bodies' in (this.god as object)) (this.god as unknown as { bodies: unknown }).bodies = { uses: (id: string) => this.usesOne(id), lifted: (ids: string[]) => this.buried(ids) };
    else this.guardGod();
    if (this.edge) this.hookEdge(this.edge);
  }
  private get engine(): EngineV1 { return this.host.engine as unknown as EngineV1; }
  private get model(): WorldModel { return this.god.model; }

  // ------------------------------------------------------------------ entity world → engine

  /** Boot: tell the engine about every entity whose physics differs from what its log already holds. */
  reconcile() {
    this.reconciled = true;
    const ep = this.engine.world.entityPhysicsV1;
    this.physics = ep ? structuredClone(ep) : undefined; this.levels = ep ? structuredClone(ep.levels) : [];
    // seed `sent` from the engine's own state so only real differences are sent
    for (const [id, part] of Object.entries(ep?.byEntity ?? {})) this.sent.set(id, JSON.stringify(normPart(part as Part)));
    for (const [id, e] of Object.entries(this.engine.world.entities)) if (e.tags?.includes('entity-world')) this.sent.set(id, JSON.stringify(normPart({ ...(ep?.byEntity[id] ?? {}), fixture: fixtureOfEngine(e) } as Part)));
    const all = new Set<string>([...this.model.entities.keys(), ...this.sent.keys()]);
    this.send(all, 0, 'boot');
  }

  /** Commits between two ticks coalesce into one world-edit (one Spatial re-base per tick at most). */
  private pending = new Set<string>();
  private onCommit(diff: Diff) {
    if (!this.reconciled) return; // the first tick reconciles everything
    for (const e of diff.upserts) for (const id of this.model.subtree(e.id)) this.pending.add(id);
    for (const id of diff.removes) this.pending.add(id);
    // terrain moved under things (pads, landforms): re-derive everything (each entity is only sent if it changed)
    if (diff.tiles.length) for (const id of this.model.entities.keys()) this.pending.add(id);
  }
  /** Send what the commits since the last tick changed (also called by tests and `reach`, so reads see the latest edit). */
  flush() { if (!this.pending.size) return; const ids = this.pending; this.pending = new Set(); this.send(ids, this.model.editSeq, 'commit'); }

  /** Derive the changed entities and enqueue one world-edit carrying exactly what differs. */
  private send(ids: Set<string>, seq: number, why: string) {
    const t0 = performance.now();
    const set: WorldEditV1['set'] = {}, assets: Record<string, unknown> = {};
    const known = this.physics?.assets ?? {};
    for (const id of [...ids].sort()) {
      const e = this.model.entities.get(id);
      if (e && this.engineOwned(e)) continue;            // bodies and what they carry belong to the engine
      const part = e ? this.derive(e, assets, known) : null;
      const key = part ? JSON.stringify(normPart(part)) : null;
      if ((this.sent.get(id) ?? null) === key) continue;
      set[id] = part;
      if (key) this.sent.set(id, key); else this.sent.delete(id);
    }
    if (!Object.keys(set).length) return;
    const draft: WorldEditV1 = { contract: 'world-edit/1', seq, hash: '', levels: structuredClone(this.levels), set, ...(Object.keys(assets).length ? { assets } : {}) };
    this.physics = nextEntityPhysics(this.physics, draft);
    draft.hash = this.physics.hash;
    this.stats.edits++; this.stats.entities += Object.keys(set).length; this.stats.lastMs = Math.round((performance.now() - t0) * 10) / 10;
    void this.host.enqueue('world-edit', 'god', draft).catch((err) => this.log(`world-edit ${seq} not logged: ${err?.message ?? err}`));
    if (why !== 'commit' || Object.keys(set).length > 8) this.log(`${why}: world-edit seq ${seq}, ${Object.keys(set).length} entities, ${this.stats.lastMs} ms`);
  }

  /** A body entity, or anything whose ancestor is a body (a carried bowl): the engine owns its physical state. */
  private engineOwned(e: Entity): boolean {
    for (let cur: Entity | undefined = e; cur; cur = cur.in.parent === 'world' ? undefined : this.model.entities.get(cur.in.parent)) if (this.model.resolvedDef(cur.def)?.components.body) return true;
    return false;
  }

  /** Level id for a floor at world height y (allocated in height order of first appearance, logged in the event). */
  private levelFor(y: number, at?: Vec2): number {
    // level 0 is the ground itself: a floor within the band of the terrain under it (L8 makes level 0 follow the tiles)
    const ground = at ? this.model.terrain.sample(at[0], at[1]) : 0;
    if (Math.abs(y - ground) <= GROUND_BAND) return 0;
    const hit = this.levels.find((l) => Math.abs(l.y - y) <= LEVEL_MATCH);
    if (hit) return hit.id;
    const used = new Set(this.levels.map((l) => l.id));
    let id = 1; while (used.has(id) && id < MAX_LEVEL) id++;
    if (used.has(id)) return this.levels.reduce((b, l) => (Math.abs(l.y - y) < Math.abs(b.y - y) ? l : b)).id; // out of level ids: nearest
    this.levels.push({ id, y: r3(y), label: `floor at ${r3(y)} m` });
    return id;
  }

  /** The engine physics of one entity: its solids, floors and stairs, or its fixture registration. */
  derive(e: Entity, assets: Record<string, unknown>, known: Record<string, unknown>): Part | null {
    const def = this.model.resolvedDef(e.def); if (!def) return null;
    const baked = this.model.bake(def, e.params ?? {}, e.seed ?? 0, e.shape);
    const wp = this.model.worldPose(e);
    // path/area forms at the root carry world-frame geometry (L3): heights ground-relative unless `abs`
    const worldFrame = def.form !== 'point' && e.in.parent === 'world';
    const toWorld = (x: number, z: number): Vec2 => { if (worldFrame) return [r3(x), r3(z)]; const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw); return [r3(wp.x + (x * c + z * s) * wp.s), r3(wp.z + (-x * s + z * c) * wp.s)]; };
    const heightAt = (y: number, at: Vec2, abs?: boolean) => r3(worldFrame ? (abs ? y : this.model.terrain.sample(at[0], at[1]) + y) : wp.y + y * wp.s);
    const part: Part = {};
    if (isFixtureDef(def)) {
      const facts = factsOf(def, baked, wp.s);
      const aid = assetIdFor(facts, JSON.stringify(e.params ?? {}));
      if (!known[aid] && !assets[aid]) assets[aid] = assetFromDef(aid, facts);
      part.fixture = this.fixtureSpec(e, def, aid, (assets[aid] ?? known[aid]) as any, wp);
      return part;
    }
    // solids: wall segments and blocks (solid layer only; a def's own stair treads are walked by its links)
    if ((def.layer === 'solid' || def.layer === 'surface') && baked.colliders.length) {
      const fp = this.model.footprint(e, def);
      const solids = fp.map((o, i) => ({ o, local: baked.colliders[i] })).filter(({ local }) => !(baked.links?.length && local.y1 - local.y0 <= 0.5));
      if (solids.length) part.solids = solids.map(({ o, local }, i) => ({ id: `${e.id}#c${i}`, obb: { c: [r3(o.c[0]), r3(o.c[1])] as Vec2, half: [r3(o.half[0]), r3(o.half[1])] as Vec2, yaw: r3(-o.yaw) }, y0: r3(o.y0), y1: r3(o.y1), kind: 'fixture' as const, label: `${this.model.pathOf(e.id)}${local.tag ? ' ' + local.tag : ''}`.slice(0, 100) }));
    }
    // closed doors block their gap
    const doorState = (e.state?.doors ?? {}) as Record<string, unknown>;
    for (const o of baked.openings ?? []) {
      const closed = doorState[o.id] === 'closed' || (doorState[o.id] === undefined && o.state === 'closed') || (def.components.opening && e.state?.open === false);
      if (!closed) continue;
      // a gate of a world-frame wall/fence sits on the ground under it (sill and height are ground-relative)
      const c = toWorld(o.at[0], o.at[1]), sc = worldFrame ? 1 : wp.s;
      (part.solids ??= []).push({ id: `${e.id}#door:${o.id}`, obb: { c, half: [r3((o.width / 2) * sc), r3(0.08 * sc)], yaw: r3(-((worldFrame ? 0 : wp.yaw) + o.yaw)) }, y0: heightAt(o.sill ?? 0, c), y1: heightAt((o.sill ?? 0) + o.height, c), kind: 'fixture' as const, label: `${this.model.pathOf(e.id)} ${o.id} (closed)` });
    }
    // floors: polygons → oriented rectangles on levels
    const surfaces = [...(baked.surfaces ?? [])];
    if (!surfaces.length && def.components.floor) { const [w, , d] = baked.box; surfaces.push({ level: 0, y: def.components.floor.y ?? baked.box[1], polygon: [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] }); }
    // ground cover (roads, lawns, plazas: ground-relative level-0 surfaces of world-frame shapes) is the ground itself
    const floors = surfaces.filter((x) => !(worldFrame && !(x as { abs?: boolean }).abs && x.level === 0));
    if (floors.length) part.surfaces = floors.map((s, i) => {
      const r = rectOf(s.polygon), abs = (s as { abs?: boolean }).abs;
      const c = toWorld(r.c[0], r.c[1]), y = heightAt(s.y, c, abs);
      // decks and bridges of world-frame shapes are walked from the ground: level 0 at their own height (L8 slabs)
      const level = worldFrame && abs && s.level === 0 ? 0 : this.levelFor(y, c);
      const sc = worldFrame ? 1 : wp.s, yaw = worldFrame ? r.yaw : wp.yaw + r.yaw;
      return { id: `${e.id}#f${i}`, level, y: level === 0 && Math.abs(y) <= GROUND_BAND ? 0 : y, obb: { c, half: [r3(r.half[0] * sc), r3(r.half[1] * sc)] as Vec2, yaw: r3(-yaw) }, label: `${this.model.pathOf(e.id)} ${s.tag ?? 'floor'}`.slice(0, 100) };
    });
    // doorways of upper storeys: the wall's thickness has no floor polygon under it, so lay a threshold strip
    for (const o of baked.openings ?? []) {
      if (o.kind === 'window' || worldFrame) continue;
      const storey = surfaces.filter((x) => x.level === o.level);
      if (!o.level || !storey.length) continue;
      const c = toWorld(o.at[0], o.at[1]), y = heightAt(storey[0].y, c), level = this.levelFor(y, c);
      if (level === 0) continue;
      (part.surfaces ??= []).push({ id: `${e.id}#t:${o.id}`, level, y, obb: { c, half: [r3((o.width / 2) * wp.s), r3(0.3 * wp.s)], yaw: r3(-(wp.yaw + o.yaw)) }, label: `${this.model.pathOf(e.id)} ${o.id} threshold`.slice(0, 100) });
    }
    // stairs, ramps, ladders: links between levels
    if (baked.links?.length) part.links = baked.links.filter((l) => l.path.length >= 2).map((l) => {
      const a = toWorld(l.path[0][0], l.path[0][1]), b = toWorld(l.path[l.path.length - 1][0], l.path[l.path.length - 1][1]);
      const ya = heightAt(l.y0, a), yb = heightAt(l.y1, b);
      const n = Math.max(2, Math.ceil(Math.abs(yb - ya) / 0.18) + 1), path: [number, number, number][] = [];
      for (let k = 0; k < n; k++) { const t = k / (n - 1); path.push([r3(a[0] + (b[0] - a[0]) * t), r3(ya + (yb - ya) * t), r3(a[1] + (b[1] - a[1]) * t)]); }
      const kind = l.kind === 'float' ? 'climb' : l.kind;
      const la = this.levelFor(ya, a), lb = this.levelFor(yb, b);
      return { id: `${e.id}#${l.id}`, kind: kind as 'stairs' | 'ramp' | 'ladder' | 'climb', from: { level: la, p: a, y: la === 0 && Math.abs(ya) <= GROUND_BAND ? 0 : ya }, to: { level: lb, p: b, y: lb === 0 && Math.abs(yb) <= GROUND_BAND ? 0 : yb }, width: r3(l.width * wp.s), heading: r3(Math.atan2(b[1] - a[1], b[0] - a[0])), path, usable: true };
    });
    return part.solids || part.surfaces || part.links ? withLinkApproaches(part) : null;
  }

  private fixtureSpec(e: Entity, def: StoredDef, asset: string, a: { surfaceSlots?: { id: string; local: [number, number, number] }[]; category: string }, wp: { x: number; y: number; z: number; yaw: number }): FixtureSpecV1 {
    const label = (e.name ?? def.name.replace(/^core-/, '')).replace(/-/g, ' ');
    const spec: FixtureSpecV1 = { def: asset, kind: a.category === 'item' ? 'item' : 'fixture', label, p: [r3(wp.x), r3(wp.y), r3(wp.z)], yaw: r3(-wp.yaw) };
    if (spec.kind !== 'item') return spec;
    const parent = e.in.parent !== 'world' ? this.model.entities.get(e.in.parent) : undefined;
    const pdef = parent ? this.model.resolvedDef(parent.def) : undefined;
    if (parent && pdef && isFixtureDef(pdef)) {
      const pfacts = factsOf(pdef, this.model.bake(pdef, parent.params ?? {}, parent.seed ?? 0, parent.shape), this.model.worldPose(parent).s);
      const passet = assetFromDef(assetIdFor(pfacts, JSON.stringify(parent.params ?? {})), pfacts);
      const pp = this.model.worldPose(parent), c = Math.cos(pp.yaw), s = Math.sin(pp.yaw), dx = wp.x - pp.x, dz = wp.z - pp.z;
      const local: [number, number, number] = [dx * c - dz * s, wp.y - pp.y, dx * s + dz * c];
      const slot = nearestSurfaceSlot(passet, local);
      if (slot) {
        const sl = passet.surfaceSlots!.find((x) => x.id === slot)!;
        const wx = pp.x + sl.local[0] * c + sl.local[2] * s, wz = pp.z - sl.local[0] * s + sl.local[2] * c;
        return { ...spec, p: [r3(wx), r3(pp.y + sl.local[1]), r3(wz)], support: { kind: 'resting-on', on: parent.id, slot } };
      }
    }
    return { ...spec, support: { kind: 'ground' } };
  }

  // ------------------------------------------------------------------ engine → entity world

  /** Trusted engine edit: journaled (by 'engine', never undone by the god), published to viewers, not echoed back. */
  engineAct(ops: Op[], note: string): Result {
    const god = this.god as any;
    if (typeof god.engineAct === 'function') {
      const r = god.engineAct(ops, note) as Result;
      if (r.accepted) this.noteSent(ops);
      return r;
    }
    const tick = this.god.opts.tick();
    const r = applyBatch(this.model, { ops }, 'engine', tick, { trusted: true });
    if (!r.result.accepted) return r.result;
    this.god.store.commit(this.model, this.god.owner, r.diff!, { seq: r.result.seq, by: 'engine', at: Date.now(), note, ops, inverse: [], kind: 'engine' as never });
    this.god.db.db.prepare('UPDATE world_edits_v1 SET undone=1 WHERE world_id=? AND seq=?').run(this.god.opts.worldId, r.result.seq);
    god.publish?.(r.result.seq, tick, r.diff!, 'engine');
    this.noteSent(ops);
    return r.result;
  }
  /** After an engine edit: what the engine already knows about the touched entities (no echo back to it). */
  private noteSent(ops: Op[]) {
    const ids = new Set<string>();
    for (const op of ops as any[]) { if (typeof op.id === 'string') ids.add(op.id); if (op.entity?.id) ids.add(op.entity.id); }
    for (const id of ids) for (const sid of this.model.entities.has(id) ? this.model.subtree(id) : []) {
      const e = this.model.entities.get(sid)!;
      const part = this.engineOwned(e) ? undefined : this.derive(e, {}, this.physics?.assets ?? {});
      if (part !== undefined) this.sent.set(e.id, JSON.stringify(normPart(part ?? {})));
    }
  }

  /** Items the Souls moved: write their new support back as entity-world moves. */
  writeBack() {
    if (this.writeBackBusy) return;
    this.writeBackBusy = true;
    try {
      const ops: Op[] = [], bodies = new Set<string>();
      for (const [id, x] of Object.entries(this.engine.world.entities)) {
        if (!x.tags?.includes('entity-world') || x.kind !== 'component') continue;
        const e = this.model.entities.get(id); if (!e) continue;
        const s = x.support;
        if (s?.kind === 'in-hand') {
          if (e.in.parent === s.by && e.in.slot === 'carry') continue;
          if (!this.model.entities.has(s.by)) continue; // the body entity is not in the entity world (pre-bridge Soul)
          if (!bodies.has(s.by)) { const b = this.engine.world.entities[s.by]; if (b) { ops.push({ op: 'move', id: s.by, p: [r3(b.pose.p[0]), r3(b.pose.p[1]), r3(b.pose.p[2])], r: r3(-b.pose.yaw), mode: 'strict' } as Op); bodies.add(s.by); } }
          ops.push({ op: 'move', id, in: { parent: s.by, slot: 'carry' }, p: [0, 0, 0], r: 0, mode: 'strict' } as Op);
        } else if (s?.kind === 'resting-on') {
          const parent = this.model.entities.get(s.on); if (!parent) continue;
          const slotId = String(s.slot).replace(/-r\d+c\d+$/, '');
          const pp = this.model.worldPose(parent), c = Math.cos(pp.yaw), sn = Math.sin(pp.yaw), dx = x.pose.p[0] - pp.x, dz = x.pose.p[2] - pp.z;
          const slot = this.model.slotsOf(parent).find((q) => q.id === slotId);
          const lx = dx * c - dz * sn - (slot?.p[0] ?? 0), lz = dx * sn + dz * c - (slot?.p[2] ?? 0);
          const want: [number, number, number] = [r3(lx), 0, r3(lz)];
          const have = e.p ?? [0, 0, 0];
          if (e.in.parent === s.on && (e.in.slot ?? '') === (slot ? slotId : '') && Math.hypot((have[0] ?? 0) - want[0], (have[have.length - 1] ?? 0) - want[2]) < 0.05) continue;
          ops.push({ op: 'move', id, in: { parent: s.on, ...(slot ? { slot: slotId } : {}) }, p: want, r: r3(-(x.pose.yaw) - pp.yaw), mode: 'strict' } as Op);
        } else if (s?.kind === 'ground') {
          if (e.in.parent === 'world') { const p = e.p ?? [0, 0]; if (Math.hypot(p[0] - x.pose.p[0], p[p.length - 1] - x.pose.p[2]) < 0.05) continue; }
          ops.push({ op: 'move', id, in: { parent: 'world' }, p: [r3(x.pose.p[0]), r3(x.pose.p[2])], r: r3(-x.pose.yaw), mode: 'strict' } as Op);
        }
      }
      if (!ops.length) return;
      for (const op of ops) {
        const r = this.engineAct([op], `engine: ${describeOp(op, this.model)}`);
        if (r.accepted) this.stats.writeBacks++;
        else this.log(`write-back refused for ${(op as { id: string }).id}: ${JSON.stringify(r.failures).slice(0, 200)}`);
      }
    } finally { this.writeBackBusy = false; }
  }

  /** Birth: the Soul's body becomes an entity (core/humanoid) with the engine's own id (spec 31 §3 rule 3). */
  bodyBorn(p: { entityId: string; soulId: string; name: string }) {
    if (this.model.entities.has(p.entityId) || !this.model.def(BODY_DEF)) return;
    const b = this.engine.world.entities[p.entityId];
    const pos: [number, number, number] = b ? [r3(b.pose.p[0]), r3(b.pose.p[1]), r3(b.pose.p[2])] : [0, 0, 0];
    const slug = (p.name ?? 'soul').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'soul';
    const name = this.model.names.has(`world/${slug}`) ? `${slug}-${p.entityId.slice(2, 6)}` : slug;
    const entity = { id: p.entityId, name, def: BODY_DEF, in: { parent: 'world' }, p: pos, r: 0, anchor: 'center', state: {}, by: 'engine', born: this.god.opts.tick(), v: 1 } as unknown as Entity;
    const r = this.engineAct([{ op: 'restore', entity } as Op], `birth: ${p.name}'s body`);
    if (r.accepted) this.stats.bodies++; else this.log(`body entity for ${p.entityId} refused: ${JSON.stringify(r.failures).slice(0, 300)}`);
  }
  bodyRetired(p: { entityId: string }) {
    if (!this.model.entities.has(p.entityId)) return;
    const ops: Op[] = [...(this.model.children.get(p.entityId) ?? [])].map((c) => ({ op: 'move', id: c, in: { parent: 'world' }, p: [r3(this.model.worldPose(this.model.entities.get(c)!).x), r3(this.model.worldPose(this.model.entities.get(c)!).z)], mode: 'nudge' } as Op));
    ops.push({ op: 'remove', id: p.entityId, cascade: true } as Op);
    const r = this.engineAct(ops, 'retire: body removed');
    if (!r.accepted) this.log(`retire ${p.entityId}: ${JSON.stringify(r.failures).slice(0, 200)}`);
  }

  // ------------------------------------------------------------------ god edits respect bodies

  /** Who uses an entity (or anything in its subtree): a seated Soul, a holding Soul. */
  usesOf(id: string): { id: string; body: string; how: 'occupied' | 'held'; soul: string } | null {
    for (const sid of this.model.subtree(id)) {
      const e = this.model.entities.get(sid);
      // a thing in a body's hands (its entity-world parent is the body)
      if (e && e.in.parent !== 'world' && this.model.resolvedDef(this.model.entities.get(e.in.parent)?.def ?? '')?.components.body) return { id: sid, body: e.in.parent, how: 'held', soul: this.soulName(e.in.parent) };
      const u = this.engine.bodyUsesV1(sid);
      if (u) return { id: sid, ...u, soul: this.soulName(u.body) };
    }
    return null;
  }
  /** The compiler hook (one entity, no subtree walk): a body, a thing in a body's hands, a seat or item in use. */
  usesOne(id: string): { code: 'occupied.by-body' | 'held.by-body'; detail: string } | null {
    const e = this.model.entities.get(id); if (!e) return null;
    if (this.model.resolvedDef(e.def)?.components.body) { this.stats.refusals++; return { code: 'occupied.by-body', detail: `${this.model.pathOf(id)} is ${this.soulName(id)}'s body; bodies move themselves` }; }
    const holder = e.in.parent !== 'world' && this.model.resolvedDef(this.model.entities.get(e.in.parent)?.def ?? '')?.components.body ? e.in.parent : null;
    const u = holder ? { body: holder, how: 'held' as const } : this.engine.bodyUsesV1(id);
    if (!u) return null;
    this.stats.refusals++;
    const soul = this.soulName(u.body), what = this.model.pathOf(id);
    return { code: u.how === 'held' ? 'held.by-body' : 'occupied.by-body', detail: `${soul} (${u.body}) is ${u.how === 'held' ? 'holding' : 'sitting on'} ${what}; wait until they are done (or ask them in a prayer answer)` };
  }
  private soulName(body: string) { return String(this.engine.world.entities[body]?.label ?? body); }

  /** Refusals for a batch whose ops would move or remove something a Soul is using (null = fine). */
  bodyRefusal(ops: unknown[]): Result | null {
    if (!Array.isArray(ops)) return null;
    for (const [i, raw] of ops.entries()) {
      const op = raw as { op?: string; id?: string; params?: unknown; entity?: Entity };
      if (!op || (op.op !== 'remove' && op.op !== 'move' && !(op.op === 'set' && op.params))) continue;
      const target = typeof op.id === 'string' && !op.id.startsWith('$') ? this.model.get(op.id) : undefined;
      if (!target) continue;
      if (this.model.resolvedDef(target.def)?.components.body) { this.stats.refusals++; return { accepted: false, failures: [{ op: i, code: 'occupied.by-body', detail: `${this.model.pathOf(target.id)} is ${this.soulName(target.id)}'s body; bodies move themselves` }] }; }
      const u = this.usesOf(target.id);
      if (!u) continue;
      this.stats.refusals++;
      const what = this.model.pathOf(u.id);
      const detail = u.how === 'held' ? `${u.soul} (${u.body}) is holding ${what}` : `${u.soul} (${u.body}) is sitting on ${what}${u.id !== target.id ? ` inside ${this.model.pathOf(target.id)}` : ''}`;
      return { accepted: false, failures: [{ op: i, code: u.how === 'held' ? 'held.by-body' : 'occupied.by-body', detail: `${detail}; wait until they are done (or ask them in a prayer answer)` }] };
    }
    return null;
  }

  /** Bodies standing where newly placed/moved solids now are: the engine lifts them clear (warned, never refused). */
  private buried(ids: string[]): string[] {
    const out: string[] = [], seen = new Set<string>();
    for (const id of new Set(ids)) for (const sid of this.model.entities.has(id) ? this.model.subtree(id) : []) for (const o of this.model.footprintsOf(sid)) {
      for (const b of Object.values(this.engine.world.entities) as any[]) {
        if (!b.human || seen.has(b.id)) continue;
        const y = b.pose.p[1]; if (o.y1 <= y + 0.22 || o.y0 >= y + 1.8) continue;
        const c = Math.cos(o.yaw), s = Math.sin(o.yaw), dx = b.pose.p[0] - o.c[0], dz = b.pose.p[2] - o.c[1];
        const lx = dx * c - dz * s, lz = dx * s + dz * c; // into the box frame (entity convention)
        if (Math.abs(lx) <= o.half[0] + 0.28 && Math.abs(lz) <= o.half[1] + 0.28) { seen.add(b.id); out.push(`body.lifted: ${this.soulName(b.id)} (${b.id}) stood where ${this.model.pathOf(sid)} now is; they step clear to the nearest open ground`); }
      }
    }
    return out;
  }

  /** Wrap the god's edit entry points with body-aware refusals (L1: replace with a compiler hook, see status file). */
  private guardGod() {
    const g = this.god as any;
    const act = g.act.bind(g), dryrun = g.dryrun.bind(g), preview = g.preview.bind(g), undo = g.undo.bind(g), redo = g.redo.bind(g);
    const opsOf = (b: unknown) => (b && typeof b === 'object' ? (b as { ops?: unknown[] }).ops ?? [] : []);
    g.act = (batch: unknown, note?: string) => {
      const no = this.bodyRefusal(opsOf(batch)); if (no) return no;
      const r = act(batch, note) as Result;
      if (r.accepted) for (const w of this.buried(Object.values(r.ids))) r.warnings.push(w);
      return r;
    };
    g.dryrun = (batch: unknown) => { const r = this.bodyRefusal(opsOf(batch)); return r ? { accepted: false, failures: (r as { failures: unknown }).failures } : dryrun(batch); };
    g.preview = (batch: unknown) => { const r = this.bodyRefusal(opsOf(batch)); return r ? { id: null, accepted: false, failures: (r as { failures: unknown }).failures } : preview(batch); };
    g.undo = () => { const t = this.god.store.undoable(); const r = t ? this.bodyRefusal(t.inverse) : null; return r ?? undo(); };
    g.redo = () => { const t = this.god.store.redoable(); const r = t ? this.bodyRefusal(t.inverse) : null; return r ?? redo(); };
  }

  // ------------------------------------------------------------------ reach

  private endOf(x: ReachEnd): { p: Vec2; level: number; what: string } | { error: string } {
    if (Array.isArray(x)) { const y = x.length === 3 ? x[1] : 0; const p: Vec2 = [x[0], x[x.length - 1]]; return { p, level: this.levelOfY(y as number), what: `(${p.join(', ')})` }; }
    const [path, room] = String(x).split(':');
    const e = this.model.get(path);
    if (!e) return { error: `no such entity or point ${x}` };
    if (room) {
      const slot = this.model.slotsOf(e).find((s) => s.id === room && (s.kind === 'room' || s.kind === 'floor'));
      if (!slot) return { error: `${path} has no room ${room}` };
      const wp = this.model.worldPose(e), c = Math.cos(wp.yaw), s = Math.sin(wp.yaw);
      const at: Vec2 = [wp.x + (slot.p[0] * c + slot.p[2] * s) * wp.s, wp.z + (-slot.p[0] * s + slot.p[2] * c) * wp.s];
      const level = this.levelOfY(wp.y + slot.p[1] * wp.s);
      const p = this.engine.standableNearV1(at, level, undefined, 0.4, 40);
      return p ? { p, level, what: `${path}:${room}` } : { error: `no standing room in ${path}:${room}` };
    }
    const body = this.engine.world.entities[e.id];
    if (body?.human) return { p: [body.pose.p[0], body.pose.p[2]], level: body.human.level ?? 0, what: this.model.pathOf(e.id) };
    const wp = this.model.worldPose(e), level = body ? this.levelOfY(body.pose.p[1]) : this.levelOfY(wp.y);
    const p = this.engine.standableNearV1([wp.x, wp.z], level, undefined, 0.4, 40);
    return p ? { p, level, what: this.model.pathOf(e.id) } : { error: `no standing room near ${this.model.pathOf(e.id)}` };
  }
  private levelOfY(y: number) { if (Math.abs(y) <= GROUND_BAND + 0.5) return 0; const l = this.levels.reduce<Level | null>((b, l) => (l.y <= y + 0.5 && (!b || l.y > b.y) ? l : b), null); return l?.id ?? 0; }
  reach(from: ReachEnd, to: ReachEnd) {
    const a = this.endOf(from), b = this.endOf(to);
    if ('error' in a) return { reachable: false, code: 'reach.bad-from', detail: a.error };
    if ('error' in b) return { reachable: false, code: 'reach.bad-to', detail: b.error };
    const r = this.engine.reachV1({ p: a.p, level: a.level }, { p: b.p, level: b.level });
    return r.ok ? { reachable: true, from: { ...a }, to: { ...b }, length: r.length, legs: r.legs, levels: r.levels }
      : { reachable: false, from: { ...a }, to: { ...b }, code: r.code, detail: r.message };
  }

  // ------------------------------------------------------------------ Souls: capabilities on god things, prayers

  private hookEdge(L: EdgeLedger) {
    const prev = L.worldProfile;
    L.worldProfile = (soul, caps, plans) => { prev?.(soul, caps, plans); try { this.capabilities(soul, caps, plans as never); } catch (e) { this.log(`capabilities: ${(e as Error).message}`); } };
    const act = L.act.bind(L), self = this;
    (L as any).act = async function (soul: EdgeSoul, input: { capability?: unknown; params?: unknown; clientRef?: unknown }) {
      if (input?.capability === 'pray' || (typeof input?.capability === 'string' && /^pray(\s|:|$)/.test(input.capability))) return self.pray(L, soul, input);
      return act(soul, input as never);
    };
  }
  private pray(L: EdgeLedger, soul: EdgeSoul, input: { capability?: unknown; params?: unknown; clientRef?: unknown }) {
    const params = (input.params ?? {}) as { text?: unknown };
    const text = typeof params.text === 'string' ? params.text.trim() : typeof input.capability === 'string' ? input.capability.replace(/^pray[:\s]*/, '').trim() : '';
    if (!text) return { accepted: false as const, capability: 'pray', code: 'capability.params', reason: 'pray needs {"text": "…"} (what you ask of the god of this world)' };
    try {
      const p = this.god.pray({ id: soul.soulId, name: soul.name }, text);
      const r = (L as any).insert(soul, 'pray', 'completed', typeof input.clientRef === 'string' ? input.clientRef : undefined, true, { prayer: p.id });
      return { accepted: true as const, receipt: (L as any).receipt(soul.soulId, r.id), result: { prayer: p.id, note: 'The god reads prayers when present; answers appear in GET /v1/god/prayers/mine.' } };
    } catch (e) { const err = e as { code?: string; message?: string }; return { accepted: false as const, capability: 'pray', code: err.code ?? 'pray.refused', reason: err.message ?? 'the prayer was not heard' }; }
  }

  /** Capabilities on god-placed things near this Soul: sit on chairs, pick up items, put them on tables; and pray. */
  capabilities(soul: EdgeSoul, caps: EdgeCapability[], plans: Map<string, { label: string; steps: { verb: string; params: Record<string, unknown> }[]; seconds?: boolean }>) {
    caps.push({ id: 'pray', verb: 'pray', label: 'Pray to the god of this world (params: {"text": "…"}); answers come back under GET /v1/god/prayers/mine', available: true, params: { text: { type: 'string', maxLength: 2000 } } });
    const ents = this.engine.world.entities, me = ents[soul.entityId]; if (!me?.human) return;
    const here: Vec2 = [me.pose.p[0], me.pose.p[2]];
    const held = Object.values(ents).find((x: any) => x.tags?.includes('entity-world') && x.support?.kind === 'in-hand' && x.support.by === soul.entityId) as any;
    const name = (id: string) => (this.model.entities.has(id) ? this.model.pathOf(id) : String(ents[id]?.label ?? id));
    const levelOf = (x: any) => this.levelOfY(x.pose.p[1]);
    const near = Object.values(ents).filter((x: any) => x.tags?.includes('entity-world') && Math.hypot(x.pose.p[0] - here[0], x.pose.p[2] - here[1]) <= NEAR) as any[];
    near.sort((a, b) => Math.hypot(a.pose.p[0] - here[0], a.pose.p[2] - here[1]) - Math.hypot(b.pose.p[0] - here[0], b.pose.p[2] - here[1]) || (a.id < b.id ? -1 : 1));
    const approach = (x: any): { verb: string; params: Record<string, unknown> }[] => {
      const level = levelOf(x); if (level === (me.human.level ?? 0) && Math.hypot(x.pose.p[0] - here[0], x.pose.p[2] - here[1]) < 3) return [];
      const at = this.engine.standableNearV1([x.pose.p[0], x.pose.p[2]], level, soul.entityId, 0.4, 16);
      return at ? [{ verb: 'mars:walk_to', params: { x: at[0], z: at[1], level } }] : [];
    };
    const stand = me.human.activity === 'sit' || me.human.baseActivity === 'sit' ? [{ verb: 'stand', params: {} }] : [];
    for (const x of near) {
      const asset = (this.physics?.assets[x.def] ?? {}) as { slots?: { kind: string }[]; surfaceSlots?: { id: string }[]; category?: string };
      const d = Math.round(Math.hypot(x.pose.p[0] - here[0], x.pose.p[2] - here[1]));
      if (asset.slots?.some((s) => s.kind === 'seat')) {
        const u = this.engine.bodyUsesV1(x.id), mine = u?.body === soul.entityId;
        const id = `sit:${x.id}`, label = `Sit on ${name(x.id)} (${d} m${levelOf(x) ? `, floor ${levelOf(x)}` : ''})`;
        caps.push({ id, verb: 'sit', label, target: { id: x.id, kind: 'object' }, available: !u || mine, ...(u && !mine ? { blocked: { code: 'seat.taken', reason: `${this.soulName(u.body)} is sitting there.` } } : {}), params: { seconds: { type: 'integer', min: 1, max: 600, default: 60 } } });
        plans.set(id, { label, steps: [{ verb: 'sit', params: { on: x.id, seconds: 60 } }], seconds: true });
      }
      if (asset.category === 'item' && x.support?.kind !== 'in-hand' && !held) {
        const id = `pick-up:${x.id}`, label = `Pick up ${name(x.id)} (${d} m${levelOf(x) ? `, floor ${levelOf(x)}` : ''})`;
        caps.push({ id, verb: 'pick-up', label, target: { id: x.id, kind: 'item' }, available: true });
        plans.set(id, { label, steps: [...stand, ...approach(x), { verb: 'mars:take_item', params: { item: x.id, hand: 'right' } }] });
      }
      if (held && asset.surfaceSlots?.length) {
        const taken = new Set(Object.values(ents).filter((o: any) => o.support?.kind === 'resting-on' && o.support.on === x.id).map((o: any) => o.support.slot));
        const free = asset.surfaceSlots.find((s) => !taken.has(s.id));
        const id = `put-on:${x.id}`, label = `Put ${name(held.id)} on ${name(x.id)} (${d} m)`;
        caps.push({ id, verb: 'put-on', label, target: { id: x.id, kind: 'object' }, available: !!free, ...(free ? {} : { blocked: { code: 'surface.full', reason: `${name(x.id)} has no free place.` } }) });
        if (free) plans.set(id, { label, steps: [...stand, ...approach(x), { verb: 'mars:put_item', params: { item: held.id, surfaceSlot: `${x.id}#${free.id}` } }] });
      }
    }
  }
}

// ---------- helpers

/** Adapter facts of a def at an entity's scale. */
function factsOf(def: StoredDef, baked: ReturnType<WorldModel['bake']>, scale: number): DefFacts {
  return {
    ref: def.ref, hash: def.hash, name: def.name, description: def.description, tags: def.tags, layer: def.layer,
    components: def.components as DefFacts['components'],
    slots: baked.slots.map((s) => ({ id: s.id, kind: s.kind, p: [s.p[0] * scale, s.p[1] * scale, s.p[2] * scale] as [number, number, number], yaw: s.yaw, ...(s.height !== undefined ? { height: s.height * scale } : {}), capacity: s.capacity })),
    box: [baked.box[0] * scale, baked.box[1] * scale, baked.box[2] * scale],
    ...(def.palette ? { palette: def.palette } : {}),
  };
}

/** A polygon as an oriented rectangle in its own frame (exact for rectangles; the bounding box of its longest edge's frame otherwise). */
export function rectOf(poly: Vec2[]): { c: Vec2; half: Vec2; yaw: number } {
  if (poly.length < 3) return { c: poly[0] ?? [0, 0], half: [0.05, 0.05], yaw: 0 };
  let best = 0, bl = -1;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > bl + 1e-9) { bl = l; best = i; } }
  const a = poly[best], b = poly[(best + 1) % poly.length], ux = (b[0] - a[0]) / bl, uz = (b[1] - a[1]) / bl;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of poly) { const u = x * ux + z * uz, v = -x * uz + z * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  // three.js-convention yaw of the frame (u along x): x = u·cos + v·sin… the frame rotates local +x onto (ux, uz)
  const yaw = Math.atan2(-uz, ux);
  return { c: [r3(cu * ux - cv * uz), r3(cu * uz + cv * ux)], half: [r3((u1 - u0) / 2), r3((v1 - v0) / 2)], yaw: Math.abs(yaw) < 1e-9 ? 0 : r3(yaw) };
}

function normPart(p: Part): Part { const o: Part = {}; if (p.surfaces?.length) o.surfaces = p.surfaces; if (p.solids?.length) o.solids = p.solids; if (p.links?.length) o.links = p.links; if (p.fixture) o.fixture = p.fixture; return o; }
function fixtureOfEngine(e: any): FixtureSpecV1 { return { def: e.def, kind: e.kind === 'component' ? 'item' : 'fixture', label: e.label, p: [e.pose.p[0], e.pose.p[1], e.pose.p[2]], yaw: e.pose.yaw, ...(e.support ? { support: e.support } : {}) }; }
function describeOp(op: Op, w: WorldModel): string {
  const o = op as { op: string; id?: string; in?: { parent: string; slot?: string } };
  const who = o.id ? w.pathOf(o.id) || o.id : '';
  if (o.op === 'move' && o.in) return `${who} → ${o.in.parent === 'world' ? 'the ground' : `${w.pathOf(o.in.parent) || o.in.parent}${o.in.slot ? '/' + o.in.slot : ''}`}`;
  return `${o.op} ${who}`;
}

/** Install the bridge on an entity world (main.ts). */
export function installEngineBridge(o: BridgeOptions): EngineBridge { return new EngineBridge(o); }
