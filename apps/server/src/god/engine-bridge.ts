// The engine bridge (spec eden4/31 B2/B3, plan 33 §3.5, lane L9): Souls live among god-built things.
//
//  entity world ──GodMode.onCommit──▶ derive physics per changed entity ──host.enqueue('world-edit')──▶ engine fold
//  engine items (take/put by a Soul) ──afterTick──▶ trusted compiler `move` (by 'engine', not undoable) ──▶ journal + viewers
//  birth / retire ──onApplied──▶ the Soul's body entity (core/humanoid, the engine's own `h_…` id) in the entity world
//
// The derived physics is plain data in the logged event, so the engine's replay never reads the entity model.
// Fastest working path on the engine's existing structures (nav/1-style static scene re-base, CATALOG fixtures);
// the per-tile patch follows L8's tiled Spatial.
import { deckRaised, railGaps } from '@sim/generators';
import { applyBatch, obbOverlap, type Diff, type Entity, type Failure, type Op, type Result, type StoredDef, type ResidentMove, type WorldModel } from '@sim/world-compiler';
import { assetFromDef, assetIdFor, isFixtureDef, isFloatingDef, nearestSurfaceSlot, nextEntityPhysics, withLinkApproaches, type DefFacts, type EntityPhysicsV1, type FixtureSpecV1, type WorldEditV1 } from '@sim/engine-mars';
import type { WorldHost } from '../world.ts';
import type { EdgeLedger } from '../edge/ledger/ledger.ts';
import type { EdgeCapability, EdgeSoul } from '../edge/contract.ts';
import type { GodMode } from './god.ts';
import { reachProviders, seatProviders, syncProviders, usesProviders, type ReachEnd, type ReachEndpoint } from './query.ts';
import { GodNav } from './nav.ts';
import { doorInGap, freeDoorOpening, isDoorDef, isShut } from './doors.ts';
import { GodPerceive } from './perceive.ts';
import { GodPlaces, inPoly } from './places.ts';
import { GodLayers } from './layers.ts';
import { GodActivitySpots } from './activity-spots.ts';
import { GodMeals } from './meals.ts';
import { installGodRides } from './rides.ts';
import { releaseBigScratch } from '../../../../mars/viewer/engine/spatial/path.ts';
import { installWorldLore } from './world-lore.ts';
import { installHeld } from './held.ts';
import { installWorldClock } from './world-clock.ts';
import { config, KNOWN_WORLD_KEYS } from '../config.ts';
import { seatFitProblem } from '../../../../mars/viewer/engine/bodies/humanoid.ts';
import { isVerificationProbe } from '../verification-probe.ts';
import { planWalkouts, dropReleased, unhand, stuckWarning, type StuckResident } from './walkout.ts';
import { GodNotices } from './notices.ts';
import { MapNotices, mapChanges, mapNoticeText, nearSite, planMapNotices, type MapChange, type MapPlan, type MapResident } from './map-notices.ts';
import type { ApplyContext, WalkoutPrep } from './god.ts';
import type { BuildNotice } from './builds.ts';
import { arrivalNote } from '../arrival-placement.ts';
/** arrival-search/1: the upserts whose geometry (def, place, size, shape, params) differs from the before-model. */
const geometryOf = (e: Entity) => JSON.stringify([e.def, e.in, e.p, e.r, e.s, e.shape, e.anchor, e.params, e.seed]);
function shapedIds(before: WorldModel, diff: Diff): Set<string> {
  const out = new Set<string>();
  for (const e of diff.upserts) { const b = before.entities.get(e.id); if (!b || geometryOf(b) !== geometryOf(e)) out.add(e.id); }
  return out;
}
/** Where a refused body placement points: people as scenery (harvest fix 'figures'). core/figure@1 has no body component,
 *  so it is never a Soul, never simulated or counted as a resident; it places like any prop. */
export const PEOPLE_AS_SCENERY = 'for people as scenery (a crowd, waiters, stallholders, a choir) place core/figure@1 instead: `place figure --at x,z --param pose=stand|walk|sit|carry|serve|wave --param hat=none|cap|sunhat|chef|scarf --param top=#hex` (one figure per placement; children --scale 0.6); it is a prop, never a resident';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
type Level = { id: number; y: number; label: string };
type Part = NonNullable<WorldEditV1['set'][string]>;
/** door-raster/1: wall pieces at least this thick (m, one 0.1 m raster cell) raster by cell centres (never lost between them). */
const WALL_RASTER_MIN = 0.1;
/** What the engine side of a MarsEngine offers the bridge (world-edit/1 methods; packages/engine-mars/src/engine.ts). */
type EngineV1 = {
  world: { tick: number; entities: Record<string, any>; entityPhysicsV1?: EntityPhysicsV1 };
  applyWorldEditV1(p: WorldEditV1): { hash: string };
  bodyUsesV1(id: string): { body: string; how: 'occupied' | 'held' } | null;
  reachV1(from: { p: Vec2; level?: number }, to: { p: Vec2; level?: number }): { ok: true; length: number; legs: number; levels: number[] } | { ok: false; code: string; message: string };
  standableNearV1(at: Vec2, level?: number, except?: string, minClear?: number, maxRing?: number): Vec2 | null;
  programOf(id: string): string | null;
  godWalkoutRouteV1(id: string, to: Vec2, level?: number): boolean;
  godWalkoutLandableV1(id: string, to: Vec2, level?: number): boolean;
  walkGoalV1(id: string): { level: number; p: Vec2 } | null;
  levelsV1(): { id: number; y: number }[];
};

const EVACUATE_RETRY_TICKS = 400; // a closure walk-out the engine could not land is retried after this many ticks
/** `sent` marker for a thing a walk-out took out of a resident's hands: whatever the entity world says next (a place on
 *  the ground, or nothing: removed) differs from it, so it is always sent. */
const RELEASED = '"released"';
const GROUND_BAND = 0.35;      // a floor within this of the ground is level 0 (the engine's ground is flat at y 0 until L8's tiles)
const LEVEL_MATCH = 0.12;      // floors this close in height share an engine level
const MAX_LEVEL = 20;          // walk_to's level schema
const NEAR = 60;               // capabilities: god things within this many metres
const BODY_DEF = 'core/humanoid@1';
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** A helix flight (lighthouse, tower) bakes as a landing, ~17 points round the stair well and a landing; a straight
 *  flight is a 2-4 point line. The planner treats a flight as the chord between its two landings and looks for the
 *  place to stand 0.7 m back along that chord: for a helix that is inside a wall, a rail or the next flight's treads
 *  (the flight into floor 3 or 4 had no standable approach, so the floor could not be reached or left). The way on
 *  and off a helix is straight in from the well's axis, so the landings are nudged 0.2 m that way (off the first
 *  tread) and the planner is told to stand 0.7 m further in. Null for a straight flight. */
const HELIX_INSET = 0.2, HELIX_STAND = 0.7;
export function helixEnds(path: Vec2[]): { foot: Vec2; head: Vec2; stepFrom: Vec2; stepTo: Vec2 } | null {
  const n = path.length;
  if (n < 5) return null;
  const [a, b] = [path[0], path[n - 1]], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  if (!path.some((p) => Math.abs(((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len) > 0.25)) return null;
  const into = (from: Vec2, to: Vec2, by: number): Vec2 => { const d = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1; return [to[0] + ((to[0] - from[0]) / d) * by, to[1] + ((to[1] - from[1]) / d) * by]; };
  const foot = into(path[1], path[0], HELIX_INSET), head = into(path[n - 2], path[n - 1], HELIX_INSET);
  return { foot, head, stepFrom: into(path[1], foot, HELIX_STAND), stepTo: into(path[n - 2], head, HELIX_STAND) };
}

export type BridgeOptions = { host: WorldHost; god: GodMode; edge?: EdgeLedger; log?: (m: string) => void; /** F3: new-world lore (default: any world key but eden/mars/littlemartians/toy) */ worldLore?: boolean; /** F3: the world clock from the god's time.dayTicks (default: a god world without ENABLE_LIVING_WORLD) */ worldClock?: boolean };

export const engineBridges = new WeakMap<WorldModel, EngineBridge>();

/** G1: the most a tick spends catching Souls' perception up with god edits (perceive.ts `step`). */
const PERCEIVE_SLICE_MS = Number(process.env.PERCEIVE_SLICE_MS ?? 8);

export class EngineBridge {
  readonly host: WorldHost; readonly god: GodMode; readonly edge?: EdgeLedger;
  /** What the engine was last told, per entity (JSON of its part), and the physics state that produced. */
  private sent = new Map<string, string>();
  private physics: EntityPhysicsV1 | undefined;
  private levels: Level[] = [];
  private reconciled = false;
  private writeBackBusy = false;
  private refusedPose = new Set<string>();
  /** Bumped by every god edit and by engine edits of things other than bodies (a Soul moving a bowl), not by a body's
   *  pose: what nav and perceive re-derive on. */
  private version = 0;
  private log: (m: string) => void;
  stats = { edits: 0, entities: 0, writeBacks: 0, refusals: 0, bodies: 0, lastMs: 0 };
  /** P4: Souls walk to god-built named things (nav.ts). */
  readonly nav: GodNav;
  /** F1: god-built things Souls can see, look at and read (perceive.ts). */
  readonly perceive: GodPerceive;
  /** R4-INFO: god-built places (areas, waters, buildings and their rooms, landmarks) in the Souls' map (places.ts). */
  readonly places: GodPlaces;
  /** LAYERS: schedules, ownership, zones, relationships, economy for Souls (layers.ts). */
  readonly layers: GodLayers;
  /** G1/R8: what residents perceive about god edits (the walk-out reason; later "the god changed something near you"). */
  readonly notices: GodNotices;
  /** R8: "the god changed something near you", one per request, rate-limited per resident (map-notices.ts). */
  readonly mapNotices: MapNotices;
  /** E-life: the old worlds' activity spots, derived from what the god built (activity-spots.ts). */
  readonly activitySpots: GodActivitySpots;
  /** E-life B2: finite meals (meals.ts). */
  meals?: GodMeals;
  /** E-life B7: god balloons as native rides (rides.ts). */
  rides?: ReturnType<typeof installGodRides>;
  private godEdits = 0;
  /** G1: terrain or defs changed (nav's per-thing descriptions are re-derived). */
  private describeEpoch = 0;

  constructor(o: BridgeOptions) {
    this.host = o.host; this.god = o.god; this.edge = o.edge; this.log = o.log ?? ((m) => console.log(`[bridge] ${m}`));
    engineBridges.set(this.god.model, this);
    this.nav = new GodNav({ model: this.god.model, version: () => this.version, staticVersion: () => this.godEdits, engine: this.host.engine as never, levelAt: (x, z, y) => this.levelAt(x, z, y), engineOwned: (e) => this.engineOwned(e), placeOf: (ref) => (this.edge ? this.places.forRef(ref)?.id : undefined), describeStamp: () => `${this.describeEpoch}:${this.levels.length}` });
    this.layers = new GodLayers({ model: this.god.model, edge: this.edge, get engine() { return o.host.engine as never; }, living: () => this.host.living, engineAct: (ops, note) => this.god.engineAct(ops, note), placeOf: (e) => this.layerPlace(e), building: id => this.god.builds.closing(id, this.model), buildingActive: () => this.god.builds.hasClosure(), closingSites: () => this.god.builds.closingSites(), log: (m) => this.log(m) });
    (this.god as unknown as { layers?: GodLayers }).layers = this.layers;
    // P3 (E-life): places follow the god's edits, not the engine's (a carried cup, a duck, a lamp switched on move no place);
    // descriptions that list the things in a place catch up once a minute (1200 ticks)
    this.places = new GodPlaces({ model: this.god.model, nav: this.nav, edge: this.edge, version: () => `${this.godEdits}:${Math.floor(this.host.engine.world.tick / 1200)}` as never, deferred: () => this.perceiveRunning || !!this.perceive?.pending(), engineOwned: (e) => this.engineOwned(e), levelAt: (x, z, y) => this.levelAt(x, z, y), log: (m) => this.log(m), layers: this.layers });
    this.god.builds.inventoryContext = () => {
      this.places.sync(true);
      return {
        occupied: id => this.seatTakers(id).length > 0,
        places: [...(this.edge?.places.byId.values() ?? [])].filter(p => p.parent !== null && !p.carrier).map(p => ({ id: p.id, name: p.name, polygon: p.polygon })),
        bodies: [...this.host.minds.values()].flatMap(m => { const b = this.engine.world.entities[m.entityId]; return b && !isVerificationProbe(m.soulId) ? [{ name: m.name, soulId: m.soulId, at: [b.pose.p[0], b.pose.p[2]] as Vec2 }] : []; }),
      };
    };
    this.perceive = new GodPerceive({ model: this.god.model, version: () => this.version, edge: this.edge, engine: this.host.engine as never, engineOwned: (e) => this.engineOwned(e), namesNear: (at, except) => this.nav.namesNear(at, except), things: () => this.nav.things(), places: this.places, levelAt: (x, z, y) => this.levelAt(x, z, y), log: (m) => this.log(m), commit: (ops, note) => this.god.engineAct(ops as never, note), layers: this.layers });
    this.god.onCommit((c) => { this.version++; if (c.diff.tiles.length || c.diff.defs.length) this.describeEpoch++; this.notePerceive([...c.diff.upserts.map((e) => e.id), ...c.diff.removes], c.diff.tiles.length > 0); if (c.by !== 'engine') { this.godEdits++; this.editTick = this.host.engine.world.tick; this.onCommit(c.diff); } });
    this.god.onBuild(e => { if (e.kind === 'started' || e.kind === 'resumed') this.editTick = this.host.engine.world.tick; });
    // LAYERS: "under construction (step)" is part of what an owned or scheduled thing is seen as
    this.god.onBuild(() => { if (this.layers.active()) this.notePerceive([], true); });
    this.host.listeners.push({
      afterTick: (tick) => { if (!this.reconciled) this.reconcile(); else { this.flush(); if (tick % 10 === 0) this.writeBack(); this.perceiveStep(tick); if (tick % 40 === 7) this.layersStep(); if (tick % 20 === 13) this.flushMapNotices(); if (this.evacuatedEdit !== this.editTick && tick - this.editTick >= 10) { this.evacuatedEdit = this.editTick; this.evacuateSites(); } if (this.rescued !== this.editTick && tick - this.editTick >= 10 && (tick - this.editTick >= 20 || tick - this.rescuedAt >= 40)) { this.rescuedAt = tick; this.rescueTrapped(); } } },
      onApplied: (e) => { if (e.kind === 'birth') this.bodyBorn(e.payload as { entityId: string; soulId: string; name: string }); if (e.kind === 'retire') this.bodyRetired(e.payload as { entityId: string }); },
    });
    reachProviders.set(this.god.model, (from, to) => this.reach(from, to));
    syncProviders.set(this.god.model, () => { this.flush(); return this.physics?.hash === this.engine.world.entityPhysicsV1?.hash; });
    seatProviders.set(this.god.model, (id) => { const f = (this.engine as unknown as { seatOccupantsV1?: (id: string) => { slot: string; body: string }[] }).seatOccupantsV1; return f ? f.call(this.engine, id).map((x) => ({ slot: x.slot, soul: this.soulName(x.body) })) : []; });
    usesProviders.set(this.god.model, (id) => { const u = this.usesOf(id); return u ? { soul: u.soul, body: u.body, how: u.how, thing: this.model.pathOf(u.id) } : null; });
    // G1 "god rules": god edits are never refused for residents; the ones in the way are walked out (walkout.ts).
    // prepare plans on the would-be world before the commit and moves nobody, so a refused batch, a failed SQL write,
    // a preview or a receipt retry never moves a resident; apply logs and folds the planned moves after the commit,
    // before the new geometry reaches the engine, in the same request. Only body entities themselves are refused.
    this.notices = new GodNotices(this.god.db, this.host.worldId, () => this.god.now());
    this.notices.streams = () => this.edge?.comms?.streams;
    // A native mind hears a notice through the log (folded into its recent memory, deterministic on replay).
    this.notices.native = (soulId, text) => { try { void this.host.enqueue('rules', 'god:notice', { godNoticeV1: { soulId, text } }).catch(() => { /* best effort */ }); } catch { /* clock not ready */ } };
    this.god.bodies = {
      uses: id => this.usesOne(id),
      refuse: (after, diff, ops, o) => this.protectedBody(after, diff, ops, o?.undo === true),
      prepare: (before, after, diff, _ops, o) => { if (o?.dry !== true) try { this.arrivalShaped = shapedIds(before, diff); } catch { this.arrivalShaped = null; } return this.prepareWalkouts(before, after, diff, o?.dry === true); },
      apply: (moved, o) => { const late = this.applyWalkouts(moved, this.stuckPlanned.splice(0)); this.stageMapNotices(o); return late; },
      arrivalNote: diff => this.arrivalNoteFor(diff),
    };
    // R8: residents near a visible map change hear of it once per request; a build near them, at start and at done.
    this.mapNotices = new MapNotices((soulId, text, place) => this.notices.notify(soulId, { text, tick: this.engine.world.tick, native: true, ...(place ? { place } : {}) }), () => this.god.now());
    this.god.onBuild(e => this.buildNotice(e));
    this.activitySpots = new GodActivitySpots({ model: this.god.model, engine: this.host.engine as never, version: () => `${this.godEdits}|${this.engine.world.entityPhysicsV1?.hash ?? ''}`, levelAt: (x, z, y) => this.levelAt(x, z, y),
      placeAt: (at, level) => this.places.placeAt(at, level), placeLocator: () => this.places.placeLocator(), prepare: () => this.places.sync(true), catchingUp: () => this.perceiveRunning || !!this.perceive?.pending(), placeName: (id) => this.edge?.places.byId.get(id)?.name ?? null });
    if (this.edge) this.edge.spotsProvider = () => { if (!this.reconciled) return null; this.flush(); const n = this.activitySpots.stats.derives, d = this.activitySpots.data(); if (this.activitySpots.stats.derives !== n) this.log(`activity spots: ${d.spots.length} spots, ${d.shelves.length} shelves in ${this.activitySpots.stats.ms} ms`); return d; };
    if (this.edge) {
      const edge = this.edge;
      this.meals = new GodMeals({ db: this.god.db, worldId: this.host.worldId, spots: () => edge.spots, place: (id) => edge.places.byId.get(id) as never, day: () => this.layers.dayKey() });
      edge.onReceipt((r) => { try { this.meals!.onReceipt(r); } catch (e) { this.log(`meals: ${(e as Error).message}`); } });
      this.rides = installGodRides({ host: this.host, edge, model: this.god.model, log: (m) => this.log(m) });
    }
    if (this.edge) this.hookEdge(this.edge);
    // F3: a god thing in a Soul's hand shows as held (observe, receipts) and can be put down (held.ts)
    if (this.edge) installHeld(this.edge, { engine: this.host.engine as never, model: this.model, minds: this.host.minds });
    // F3: a god's world keeps time like the live worlds (a logged dayConfig; world-clock.ts)
    if (o.worldClock ?? (!config.livingWorld && !(KNOWN_WORLD_KEYS as readonly string[]).includes(config.worldKey))) installWorldClock(this.host, this.god, this.log);
    // F3: a god's new world serves its constitution (or a neutral line) as lore, never Eden's (world-lore.ts)
    if (this.edge && (o.worldLore ?? !(KNOWN_WORLD_KEYS as readonly string[]).includes(config.worldKey))) installWorldLore(this.edge, this.god);
  }
  private get engine(): EngineV1 { return this.host.engine as unknown as EngineV1; }
  private get model(): WorldModel { return this.god.model; }

  // ------------------------------------------------------------------ entity world → engine

  /** Boot: tell the engine about every entity whose physics differs from what its log already holds. */
  reconcile() {
    this.reconciled = true;
    const ep = this.engine.world.entityPhysicsV1;
    // G1: shared, not cloned: a physics value is never mutated (nextEntityPhysics makes a new one), so the bridge and the
    // engine share its parts and their cached hash texts (a clone made the first edit after boot stringify every part twice)
    this.physics = ep; this.levels = ep ? structuredClone(ep.levels) : [];
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
    // doorblock: a door put into, moved out of or taken from a wall's gate gap changes whether that gate yields to it
    if (diff.upserts.some((e) => this.doorIds.has(e.id) || this.isDoor(e)) || diff.removes.some((id) => this.doorIds.has(id))) for (const id of this.gated) this.pending.add(id);
    // terrain moved under things (pads, landforms): re-derive everything (each entity is only sent if it changed)
    if (diff.tiles.length) for (const id of this.model.entities.keys()) this.pending.add(id);
  }
  /** Send what the commits since the last tick changed (also called by tests and `reach`, so reads see the latest edit). */
  flush() { if (!this.pending.size) return; const ids = this.pending; this.pending = new Set(); this.send(ids, this.model.editSeq, 'commit'); }

  /** Derive the changed entities and enqueue one world-edit carrying exactly what differs. */
  private send(ids: Set<string>, seq: number, why: string) {
    const t0 = performance.now();
    this.doorSpotsCache = null;
    const set: WorldEditV1['set'] = {}, assets: Record<string, unknown> = {};
    const known = this.physics?.assets ?? {};
    let linksMoved = false;
    for (const id of [...ids].sort()) {
      const e = this.model.entities.get(id);
      if (e && this.engineOwned(e)) continue;            // bodies and what they carry belong to the engine
      const part = e ? this.derive(e, assets, known) : null;
      const key = part ? JSON.stringify(normPart(part)) : null;
      // A removed thing the engine still has (one a Soul held when it went: `sent` forgot it) is removed there too.
      const lingering = !e && (this.engine.world.entities[id]?.tags?.includes('entity-world') || !!this.physics?.byEntity[id]);
      if ((this.sent.get(id) ?? null) === key && !lingering) continue;
      if (this.sent.get(id)?.includes('"links"') || part?.links?.length) linksMoved = true;
      set[id] = part;
      if (key) this.sent.set(id, key); else this.sent.delete(id);
    }
    // a raised deck opens its rails where a stair, ramp or ladder of another thing lands on it (deckAccess): when any link
    // came, went or moved, every raised deck is derived again (only the changed ones are sent)
    if (linksMoved) for (const e of this.model.entities.values()) {
      if (set[e.id] !== undefined || !this.isRaisedDeck(e)) continue;
      const part = this.derive(e, assets, known), key = part ? JSON.stringify(normPart(part)) : null;
      if ((this.sent.get(e.id) ?? null) === key) continue;
      set[e.id] = part;
      if (key) this.sent.set(e.id, key); else this.sent.delete(e.id);
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

  /** doorblock: door entities (ids), walls/fences with gates (re-derived when a door comes or goes), door spots per send. */
  private doorIds = new Set<string>();
  private gated = new Set<string>();
  private doorSpotsCache: { id: string; p: Vec2 }[] | null = null;
  private isDoor(e: Entity): boolean { const d = this.model.resolvedDef(e.def); return !!d && isDoorDef(d); }
  private doorSpots(): { id: string; p: Vec2 }[] {
    if (this.doorSpotsCache) return this.doorSpotsCache;
    const out: { id: string; p: Vec2 }[] = [];
    for (const e of this.model.entities.values()) { if (!this.isDoor(e)) continue; const wp = this.model.worldPose(e); out.push({ id: e.id, p: [wp.x, wp.z] }); }
    return (this.doorSpotsCache = out);
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
    const walkableKit = def.make.kind === 'gen' && def.make.gen === 'kit/2' && !!def.make.args?.footprint; // XP5 hook
    if (isFixtureDef(def)) {
      const facts = factsOf(def, baked, wp.s);
      // a floating boat's asset carries no obstacle (catalog-adapter isFloatingDef): a new id, so worlds that registered
      // the old one (an obstacle) are sent the new one
      const aid = assetIdFor(facts, JSON.stringify(e.params ?? {}) + (isFloatingDef(def) ? '|afloat' : '') + (walkableKit ? '|ground-kit/1' : ''));
      if (!known[aid] && !assets[aid]) { const asset = assetFromDef(aid, facts); if (walkableKit) { delete asset.obstacle; asset.seatApproach = 'slot'; for (const slot of asset.slots ?? []) delete slot.approachPolicy; } assets[aid] = asset; } // XP5: seats retain slots; kit solids supply the obstacle geometry. Their exact slot approach stays (lane walk's
      // reachable/1 sweep would cross the kit's own solids).
      part.fixture = this.fixtureSpec(e, def, aid, (assets[aid] ?? known[aid]) as any, wp);
      if (!walkableKit) return part;
    }
    // solids: wall segments and blocks (solid layer only; a def's own stair treads are walked by its links)
    if ((def.layer === 'solid' || def.layer === 'surface') && baked.colliders.length) {
      const fp = this.model.footprint(e, def);
      const solids = fp.map((o, i) => ({ o, local: baked.colliders[i] })).filter(({ local }) => !(baked.links?.length && local.y1 - local.y0 <= 0.5));
      // E-life B7: a god balloon is depiction; its body on the ground is the native ride installed at its spot (rides.ts)
      const nativeRide = !!(def.components as Record<string, unknown>).carrier && def.tags.includes('balloon');
      // door-raster/1 (lane RT): a building/1 wall piece at least a raster cell thick rasters by its cell centres, so its
      // doorways keep their width on the walk raster at any yaw (spatial/types.ts Obstacle.raster)
      if (solids.length && !nativeRide) part.solids = solids.map(({ o, local }, i) => ({ id: `${e.id}#c${i}`, obb: { c: [r3(o.c[0]), r3(o.c[1])] as Vec2, half: [r3(o.half[0]), r3(o.half[1])] as Vec2, yaw: r3(-o.yaw) }, y0: r3(o.y0), y1: r3(o.y1), kind: 'fixture' as const, label: `${this.model.pathOf(e.id)}${local.tag ? ' ' + local.tag : ''}`.slice(0, 100),
        ...(/^wall:f\d/.test(local.tag ?? '') && 2 * Math.min(o.half[0], o.half[1]) >= WALL_RASTER_MIN ? { raster: 'centre' as const } : {}) }));
    }
    // closed doors block their gap; a free-standing door (no doorway of its own) blocks its own width (doorblock)
    const doorState = (e.state?.doors ?? {}) as Record<string, unknown>;
    if (isDoorDef(def)) this.doorIds.add(e.id); else this.doorIds.delete(e.id);
    const free = freeDoorOpening(def, baked), openings = free ? [...(baked.openings ?? []), free] : baked.openings ?? [];
    const gates = worldFrame ? openings.filter((o) => o.kind === 'gate') : [];
    if (gates.length) this.gated.add(e.id); else this.gated.delete(e.id);
    const shut = isShut(e, def);
    for (const o of openings) {
      // a wall's or fence's gate with a door standing in it yields to the door (the door blocks or passes by its state)
      if (worldFrame && o.kind === 'gate' && doorInGap(toWorld(o.at[0], o.at[1]), o.width, this.doorSpots())) continue;
      const closed = doorState[o.id] === 'closed' || (doorState[o.id] === undefined && o.state === 'closed') || shut;
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
    const raisedDeck = this.isRaisedDeck(e, def);
    if (floors.length) part.surfaces = floors.map((s, i) => {
      const r = rectOf(s.polygon), abs = (s as { abs?: boolean }).abs;
      const c = toWorld(r.c[0], r.c[1]), y = heightAt(s.y, c, abs);
      // decks and bridges of world-frame shapes are walked from the ground: level 0 at their own height (L8 slabs); a
      // raised deck (deck/1 with rails, DECK_RAISED up) is an upper floor of its own that stairs, ramps and ladders reach
      const level = worldFrame && abs && s.level === 0 && !raisedDeck ? 0 : this.levelFor(y, c);
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
      const helix = helixEnds(l.path);
      const a = toWorld(...(helix?.foot ?? l.path[0])), b = toWorld(...(helix?.head ?? l.path[l.path.length - 1]));
      const ya = heightAt(l.y0, a), yb = heightAt(l.y1, b);
      const n = Math.max(2, Math.ceil(Math.abs(yb - ya) / 0.18) + 1), path: [number, number, number][] = [];
      for (let k = 0; k < n; k++) { const t = k / (n - 1); path.push([r3(a[0] + (b[0] - a[0]) * t), r3(ya + (yb - ya) * t), r3(a[1] + (b[1] - a[1]) * t)]); }
      const kind = l.kind === 'float' ? 'climb' : l.kind;
      const la = this.levelFor(ya, a), lb = this.levelFor(yb, b);
      return { id: `${e.id}#${l.id}`, kind: kind as 'stairs' | 'ramp' | 'ladder' | 'climb', from: { level: la, p: a, y: la === 0 && Math.abs(ya) <= GROUND_BAND ? 0 : ya }, to: { level: lb, p: b, y: lb === 0 && Math.abs(yb) <= GROUND_BAND ? 0 : yb }, width: r3(l.width * wp.s), heading: r3(Math.atan2(b[1] - a[1], b[0] - a[0])), path, usable: true,
        ...(helix ? { approach: { from: toWorld(...helix.stepFrom), to: toWorld(...helix.stepTo) } } : {}) };
    });
    // each flight's ends: its under-stair block stops short of the foot (the first tread is stepped onto, not walked
    // under) and a head tread on the upper level bridges the stairwell edge, so both ends have standing room
    for (const l of part.links ?? []) {
      if (l.kind !== 'stairs' && l.kind !== 'ramp') continue;
      const lid = l.id.slice(e.id.length + 1), d: Vec2 = [Math.cos(l.heading), Math.sin(l.heading)], T = 0.4;
      for (const o of part.solids ?? []) {
        if (!o.label?.endsWith(` stairs:${lid}`)) continue;
        const along = Math.abs(Math.cos(o.obb.yaw - l.heading)) > 0.7 ? 0 : 1;
        if (o.obb.half[along] <= T) continue;
        o.obb.half[along] = r3(o.obb.half[along] - T / 2); o.obb.c = [r3(o.obb.c[0] + d[0] * T / 2), r3(o.obb.c[1] + d[1] * T / 2)];
      }
      if (l.to.level > 0) (part.surfaces ??= []).push({ id: `${l.id}:head`, level: l.to.level, y: l.to.y, obb: { c: [r3(l.to.p[0] - d[0] * 0.25), r3(l.to.p[1] - d[1] * 0.25)], half: [0.35, r3(l.width / 2)], yaw: l.heading }, label: `${this.model.pathOf(e.id)} ${lid} head`.slice(0, 100) });
    }
    if (raisedDeck) this.deckAccess(e, part);
    // F1: a decoration (a fountain, a lamp, a sign, a statue, a house) is also a fixture Souls perceive: views list it,
    // `look` finds it. No slots and no obstacle of its own: its solids above are what blocks, exactly as before.
    if (this.seenOnly(e, def)) {
      const facts = factsOf(def, baked, wp.s), aid = assetIdFor(facts, JSON.stringify(e.params ?? {}) + '|seen');
      if (!known[aid] && !assets[aid]) assets[aid] = assetFromDef(aid, facts, { seen: true });
      part.fixture = { def: aid, kind: 'fixture', label: (e.name ?? def.name.replace(/^core-/, '')).replace(/-/g, ' '), p: [r3(wp.x), r3(wp.y), r3(wp.z)], yaw: r3(-wp.yaw), support: { kind: 'ground' } };
    }
    if (part.solids || part.surfaces || part.links) withLinkApproaches(part);
    return part.solids || part.surfaces || part.links || part.fixture ? part : null;
  }
  /** A deck/1 at the root, high enough to have rails (generators DECK_RAISED): its floor is a level of its own. */
  private isRaisedDeck(e: Entity, def = this.model.resolvedDef(e.def)): boolean {
    return !!def && def.make.kind === 'gen' && def.make.gen === 'deck/1' && def.form !== 'point' && e.in.parent === 'world' && deckRaised(e.params ?? {});
  }
  /** Stair, ramp and ladder ends of god things within `pad` metres of a world box: world point, height, width (as derive)
   *  and where the link's other end is. */
  private linkEndsNear(box: [number, number, number, number], pad: number, except: string): { p: Vec2; y: number; width: number; other: Vec2 }[] {
    const out: { p: Vec2; y: number; width: number; other: Vec2 }[] = [];
    for (const o of this.model.entities.values()) {
      if (o.id === except) continue;
      const def = this.model.resolvedDef(o.def); if (!def || this.engineOwned(o)) continue;
      const worldFrame = def.form !== 'point' && o.in.parent === 'world', wp = this.model.worldPose(o);
      if (!worldFrame && (wp.x < box[0] - pad || wp.x > box[2] + pad || wp.z < box[1] - pad || wp.z > box[3] + pad)) continue;
      let baked; try { baked = this.model.bake(def, o.params ?? {}, o.seed ?? 0, o.shape); } catch { continue; }
      if (!baked.links?.length) continue;
      const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw);
      const toWorld = (x: number, z: number): Vec2 => (worldFrame ? [r3(x), r3(z)] : [r3(wp.x + (x * c + z * s) * wp.s), r3(wp.z + (-x * s + z * c) * wp.s)]);
      const heightAt = (y: number, at: Vec2) => r3(worldFrame ? this.model.terrain.sample(at[0], at[1]) + y : wp.y + y * wp.s);
      for (const l of baked.links) {
        if (l.path.length < 2) continue;
        const helix = helixEnds(l.path), a = toWorld(...(helix?.foot ?? l.path[0])), b = toWorld(...(helix?.head ?? l.path[l.path.length - 1]));
        const width = r3(l.width * (worldFrame ? 1 : wp.s));
        out.push({ p: a, y: heightAt(l.y0, a), width, other: b }, { p: b, y: heightAt(l.y1, b), width, other: a });
      }
    }
    return out;
  }
  /** A raised deck is walked onto from its stairs: where another thing's stair, ramp or ladder ends at the deck's height
   *  on its edge, the rail opens for it (generators railGaps; the picture opens the same gap). A deck too low to walk
   *  under (head room under 2.1 m) is solid below its floor on the ground, so nobody is routed underneath it. */
  private deckAccess(e: Entity, part: Part) {
    const floor = part.surfaces?.find((s) => s.id === `${e.id}#f0`); if (!floor || floor.level === 0) return;
    const area = (e.shape as { area?: Vec2[] } | undefined)?.area; if (!area?.length) return;
    const xs = area.map((p) => p[0]), zs = area.map((p) => p[1]), box: [number, number, number, number] = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
    // ends at the deck's height whose flight comes from off the deck (a stair starting on the deck leaves its rail alone)
    const ends = this.linkEndsNear(box, 24, e.id).filter((x) => Math.abs(x.y - floor.y) <= 0.3 && !inPoly(x.other[0], x.other[1], area));
    if (ends.length && part.solids?.length) {
      const solids: NonNullable<Part['solids']> = [];
      for (const o of part.solids) {
        if (!o.label?.endsWith(' rail')) { solids.push(o); continue; }
        const u: Vec2 = [Math.cos(o.obb.yaw), Math.sin(o.obb.yaw)], hl = o.obb.half[0];
        const a: Vec2 = [o.obb.c[0] - u[0] * hl, o.obb.c[1] - u[1] * hl], b: Vec2 = [o.obb.c[0] + u[0] * hl, o.obb.c[1] + u[1] * hl];
        const gaps = railGaps(a, b, ends);
        if (!gaps.length) { solids.push(o); continue; }
        let t = 0, k = 0;
        for (const [g0, g1] of [...gaps, [2 * hl, 2 * hl] as [number, number]]) {
          if (g0 - t > 0.05) { const m = (t + g0) / 2; solids.push({ ...o, id: `${o.id}.${k++}`, obb: { ...o.obb, c: [r3(a[0] + u[0] * m), r3(a[1] + u[1] * m)], half: [r3((g0 - t) / 2), o.obb.half[1]] } }); }
          t = g1;
        }
      }
      part.solids = solids.length ? solids : undefined;
    }
    let ground = Infinity; for (const [x, z] of [...area, [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] as Vec2]) ground = Math.min(ground, this.model.terrain.sample(x, z));
    if (floor.y - ground < 2.1) (part.solids ??= []).push({ id: `${e.id}#under`, obb: structuredClone(floor.obb), y0: r3(ground - 0.5), y1: r3(floor.y - 0.1), kind: 'fixture' as const, label: `${this.model.pathOf(e.id)} under the deck`.slice(0, 100) });
  }
  /** A god-built point thing that is not otherwise an engine fixture or item, and not a creature, a body or a flag. */
  seenOnly(e: Entity, def: StoredDef): boolean {
    const c = def.components as Record<string, unknown>;
    return def.form === 'point' && !isFixtureDef(def) && !c.body && !c.behavior && !c.hover && !/^core[-/]flag@/.test(def.ref) && e.in.parent !== undefined && !this.engineOwned(e);
  }

  private fixtureSpec(e: Entity, def: StoredDef, asset: string, a: { surfaceSlots?: { id: string; local: [number, number, number] }[]; category: string }, wp: { x: number; y: number; z: number; yaw: number }): FixtureSpecV1 {
    const label = (e.name ?? def.name.replace(/^core-/, '')).replace(/-/g, ' ');
    const spec: FixtureSpecV1 = { def: asset, kind: a.category === 'item' ? 'item' : 'fixture', label, p: [r3(wp.x), r3(wp.y), r3(wp.z)], yaw: r3(-wp.yaw) };
    if (spec.kind !== 'item') {
      // E2 (2026-10-19): a fixture standing on raised ground (a hillside, an alpine terrace, or the ground floor of a
      // building on its pad up there) is logged as on the ground, so its seats are on level 0 there (the engine otherwise
      // takes the floor level nearest its height: the alpine station's benches got an upper floor elsewhere and no
      // resident could reach them). Only those: fixtures on the y-0 plain, and upper floors, keep their spec byte for byte.
      if (Math.abs(wp.y) > GROUND_BAND && Math.abs(wp.y - this.model.terrain.sample(wp.x, wp.z)) <= GROUND_BAND) return { ...spec, support: { kind: 'ground' } };
      return spec;
    }
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

  /** R4-INFO: a god edit can close furniture round a Soul standing in a room (a house turned to face a moved fountain,
   *  a sofa moved): from where it stands no walk reaches the room's door any more, so every act refuses
   *  route.unreachable. Once the edit is in the engine, each idle Soul standing in a room it cannot leave steps to the
   *  room's open floor (the standing room its front door reaches; nav.ts roomGoal) — a logged edge-relocate, as the
   *  ledger steps bodies out of solids. Only after god edits, only Souls inside rooms. */
  private editTick = -1;
  private rescued = -1;
  rescueTrapped() {
    this.rescued = this.editTick;
    const E = this.engine as EngineV1 & { world: { entities: Record<string, any> } };
    const rooms = this.nav.things().filter((t) => t.kind === 'room' && t.level === 0 && t.poly && t.entry);
    if (!rooms.length) return;
    for (const m of this.host.minds.values()) {
      const b = E.world.entities[m.entityId], h = b?.human;
      if (!h || (h.level ?? 0) !== 0 || h.activity === 'sit' || h.baseActivity === 'sit' || h.sleepPose || h.carrier || E.programOf(m.entityId)) continue;
      const p: Vec2 = [b.pose.p[0], b.pose.p[2]], room = rooms.find((t) => inPoly(p[0], p[1], t.poly!)); if (!room) continue;
      if (E.reachV1({ p, level: 0 }, { p: room.entry!.p, level: room.entry!.level }).ok) continue;
      const goal = this.nav.goal(room, p, m.entityId); if (!goal || goal.level !== 0) continue;
      this.log(`${m.name} was closed in by furniture in ${room.ref}: steps to open floor at (${goal.p.join(', ')})`);
      try { void this.host.enqueue('edge-relocate', `edge:${m.soulId}`, { soulId: m.soulId, entityId: m.entityId, to: goal.p, why: `the god rearranged ${room.ref} around them: stepped to open floor` }).catch(() => { /* best effort */ }); } catch { /* clock not ready */ }
    }
  }

  private perceiveSync(now = false) { try { if (now) this.perceive.sync(); else this.perceive.ensure(); } catch (e) { this.log(`perceive: ${(e as Error).message}`); } }
  /** G1 (tranche 2026-10-19): what Souls perceive of god edits (built objects, the places layer) catches up off the
   *  request path. An edit only notes what changed; the catch-up starts a second after the last edit, or ~2 s after the
   *  first one not yet seen while a god keeps editing, and then runs a slice of at most PERCEIVE_SLICE_MS per tick
   *  (was: a whole pass, ~0.7 s at 4,900 entities, inside the tick after every edit). Souls see an edit ≤ ~2 s late. */
  private perceiveFirst = 0;
  private perceiveLast = 0;
  private perceiveRunning = false;
  /** Tick the last catch-up began (at most one start a second; a world without comms objects retries at that pace). */
  private perceiveStarted = -Infinity;
  /** G1: a trapped-Soul check (it lists every named thing) runs a second after the last edit, or every ~2 s while a
   *  god keeps editing; a closing site's walk-out still follows each edit within 10 ticks. */
  private rescuedAt = -1;
  private evacuatedEdit = -1;
  private notePerceive(ids: string[], all: boolean) {
    const tick = this.host.engine.world.tick;
    this.perceive.note(ids, all);
    if (this.perceiveFirst < 0) this.perceiveFirst = tick; this.perceiveLast = tick;
  }
  private perceiveStep(tick: number) {
    if (!this.perceiveRunning) {
      if (!this.perceive.pending() || tick - this.perceiveStarted < 20) return;
      // boot: the first catch-up is a whole pass (~0.4 s at 4,900 entities). A served world runs it in slices too (lane P5):
      // at once it held a cold-booted world's first visitor. A Soul's read before it ends catches up at once (perceive.ensure).
      // A world stepped by hand (tests, tools) runs it at once, as before.
      if (!this.perceive.stats.runs && !this.host.running) { this.perceiveStarted = tick; this.perceiveFirst = -1; this.perceiveSync(true); return; }
      if (this.perceive.stats.runs && tick - this.perceiveLast < 20 && tick - this.perceiveFirst < 40) return;
      this.perceiveRunning = true; this.perceiveStarted = tick; this.perceiveFirst = -1; this.catchUp = { slices: 0, maxMs: 0, t0: performance.now() };
    }
    const t0 = performance.now();
    try { if (this.perceive.step(PERCEIVE_SLICE_MS)) this.perceiveRunning = false; }
    catch (e) { this.perceiveRunning = false; this.log(`perceive: ${(e as Error).message}`); }   // retried on the next catch-up, never every tick
    const c = this.catchUp, ms = performance.now() - t0; c.slices++; if (ms > c.maxMs) c.maxMs = ms;
    // a slice that ran long (one place or the named things re-derived at once) is worth a line in the world's log
    if (!this.perceiveRunning && c.maxMs > 40) this.log(`perceive catch-up: ${this.perceive.stats.lastIds} things${this.perceive.stats.lastFull ? ' (whole pass)' : ''}, ${c.slices} slices, longest ${Math.round(c.maxMs)} ms, ${Math.round(performance.now() - c.t0)} ms in all`);
  }
  /** The current catch-up: slices run, the longest (ms), when it began. */
  catchUp = { slices: 0, maxMs: 0, t0: 0 };
  /** Construction closure (C1): residents inside a closing zone get the same polite walk-out as an edit, seated,
   *  asleep or busy included (verification probes may enter closures and are left alone). Runs after each god edit
   *  and on the 40-tick cadence. */
  private evacuated = new Map<string, { tick: number; from: Vec2 }>();
  evacuateSites() {
    const sites = this.god.builds.closingSites(); if (!sites.length) return;
    const diff: Diff = { upserts: [], removes: [], defs: [], tiles: [], answers: [] }, avoid = sites.flatMap(s => s.zones), done = new Set<string>(), tick = this.engine.world.tick;
    // A resident the engine could not land at its exit (still where it stood) is retried after a while, not told again
    // every cadence; one that did move and is inside a closure again is walked out at once.
    const waiting = (soulId: string, entityId: string) => {
      const last = this.evacuated.get(soulId), p = this.engine.world.entities[entityId]?.pose?.p;
      if (!last || tick - last.tick >= EVACUATE_RETRY_TICKS || !p) { this.evacuated.delete(soulId); return false; }
      return Math.hypot(p[0] - last.from[0], p[2] - last.from[1]) < .5;
    };
    // Each resident hears about the site it stands in; every exit is clear of all closing sites.
    for (const site of sites) try {
      const residents = [...this.host.minds.values()].filter(m => !isVerificationProbe(m.soulId) && !done.has(m.soulId) && !waiting(m.soulId, m.entityId));
      const { moved, stuck } = planWalkouts(this.engine, this.model, this.model, diff, residents, { zones: site.zones, avoid, title: this.god.builds.body(site.id)?.title ?? site.id });
      for (const m of moved) { done.add(m.soulId); this.evacuated.set(m.soulId, { tick, from: m.from }); }
      for (const x of stuck) { done.add(x.soulId); this.evacuated.set(x.soulId, { tick, from: this.posOf(x.body) }); this.log(`evacuate: ${x.name} stays inside ${site.id}: no clear ground to step to`); }
      this.applyWalkouts(moved);
    } catch (e) { this.log(`evacuate: ${(e as Error).message}`); }
  }
  /** Plan who walks out of an accepted edit's way (pure). A planning fault never refuses the edit: it is logged, and
   *  the engine's own step-clear of buried bodies still applies. `dry` (dry run, preview): plan only, nothing rewritten. */
  /** arrival-search/1: the god's note when an edit blocks the arrival point ("new Souls will arrive nearby at x, z"),
   *  said again only when it changes. Checked (which brings the engine up to date inside the request) only when an
   *  edit places, moves, resizes or reshapes something whose footprint covers the arrival point within 1 m (or a
   *  footprint-less ground edit, a lake or landform, within 80 m), or a note already stands and the edit touches within
   *  80 m. A state-only change (a door opened) is never checked; every unchecked edit stays "pending" in the engine until
   *  the next tick, as before. */
  private arrivalNoted: string | null = null;
  /** Ids whose geometry the edit being applied changed (set by `prepare` from the before-model); null = unknown, all. */
  private arrivalShaped: Set<string> | null = null;
  private arrivalNoteFor(diff: Diff): string[] {
    try {
      const a = this.host.engine.anchors?.()[0]?.point as unknown;
      const at = Array.isArray(a) && a.length === 2 && a.every(v => typeof v === 'number') ? a as [number, number] : null;
      const near = (e: Entity) => { if (!at) return true; const p = this.model.worldPose(e); return Math.hypot(p.x - at[0], p.z - at[1]) <= 80; };
      const spot = at ? { c: at, half: [1, 1] as [number, number], yaw: 0, y0: -1e3, y1: 1e3 } : null;
      const covers = (e: Entity) => {
        if (!spot) return true;
        const fs = e.in.parent === 'world' ? this.model.footprintsOf(e.id) : this.model.footprint(e);
        return fs.length ? fs.some(f => obbOverlap(f, spot)) : diff.tiles.length > 0 && near(e);
      };
      const shaped = this.arrivalShaped, moved = diff.upserts.filter(e => !shaped || shaped.has(e.id)); this.arrivalShaped = null;
      if (this.arrivalNoted ? !diff.tiles.length && !diff.removes.length && !moved.some(near) : !moved.some(covers)) return [];
      this.flush(); this.host.drainInputs();
      const text = arrivalNote(this.host);
      if (text === this.arrivalNoted) return [];
      this.arrivalNoted = text; return text ? [text] : [];
    } catch (e) { this.log(`arrival note: ${(e as Error).message}`); return []; }
  }
  private prepareWalkouts(before: WorldModel, after: WorldModel, diff: Diff, dry = false): WalkoutPrep {
    try {
      if (!dry) { this.flush(); this.host.drainInputs(); this.stuckPlanned = []; this.mapPlanned = null; }
      // Nothing goes into a resident's hands (an undo of a take): set down first, so the plan sees where it lands.
      const kept = dry ? { warnings: [], touched: [] } : unhand(this.engine, before, after, diff);
      const { moved, stuck } = planWalkouts(this.engine, before, after, diff, this.host.minds.values());
      const warnings = [...kept.warnings, ...stuck.map(stuckWarning)], touched = [...kept.touched];
      if (!dry) { this.stuckPlanned = stuck; touched.push(...dropReleased(after, diff, moved)); this.mapPlanned = this.planMap(before, after, diff, new Set([...moved, ...stuck].map(x => x.soulId)), touched); }
      return { moved, warnings, touched };
    } catch (e) { this.log(`walk-out planning: ${(e as Error).message}`); return { moved: [], warnings: [], touched: [] }; }
  }
  /** Log and fold each planned move now (no tick, no animation wait), interrupt the resident's act, tell it why. A
   *  resident the engine could not land at its planned exit is told so and named in the returned warnings. */
  // ---- R8 map-change notices (map-notices.ts)
  /** The last prepared edit's map notice (who hears of it), delivered only once that edit has committed. */
  private mapPlanned: MapPlan | null = null;
  private residents(): MapResident[] {
    const out: MapResident[] = [];
    for (const m of this.host.minds.values()) { const p = this.engine.world.entities[m.entityId]?.pose?.p; if (p && !isVerificationProbe(m.soulId)) out.push({ soulId: m.soulId, name: m.name, p: [p[0], p[2]] }); }
    return out;
  }
  /** Planned in the request (pure, bounded); a planning fault never refuses or delays the edit. */
  private planMap(before: WorldModel, after: WorldModel, diff: Diff, told: Set<string>, touched: string[]): MapPlan | null {
    try {
      if (!this.host.minds.size) return null;
      const changes = mapChanges(before, after, diff, touched); if (!changes.length) return null;
      const relations = this.layers.relations().filter(r => r.rel === 'works-at' || r.rel === 'lives-at');
      const mine = (r: MapResident, c: MapChange) => { const soul = { soulId: r.soulId, name: r.name }; return c.owners.some(o => this.layers.isOf(o, soul)) || relations.some(x => c.things.includes(x.b) && this.layers.isOf(x.a, soul)); };
      return planMapNotices(changes, this.residents(), { exclude: told, mine });
    } catch (e) { this.log(`map notices: ${(e as Error).message}`); return null; }
  }
  /** After the commit: stage the request's notice; it is delivered when the request has finished (a build done in the
   *  same request tells its own sentence instead). A closing build's edits are covered by its start and done notices. */
  private stageMapNotices(o?: ApplyContext) {
    const plan = this.mapPlanned; this.mapPlanned = null; if (!plan) return;
    try {
      const build = o?.kind === 'edit' && o.build ? this.god.builds.body(o.build) : undefined;
      if (build && this.god.builds.closingSites().some(s => s.id === o!.build)) return;
      const label = o?.kind === 'edit' ? (build ? { title: build.title, say: build.say?.text } : { note: o.note }) : {};
      const text = mapNoticeText(plan.changes, label, this.whereOf(plan.at, plan.changes[0].id));
      this.mapNotices.stage(plan.souls, text, build?.title ?? (plan.changes.length === 1 ? plan.changes[0].name : undefined));
      queueMicrotask(() => { try { this.mapNotices.deliverStaged(); } catch (e) { this.log(`map notices: ${(e as Error).message}`); } });
    } catch (e) { this.log(`map notices: ${(e as Error).message}`); }
  }
  /** " at the harbour" (the place around it, not itself), " by the fountain" (a named thing near it), else " near you". */
  private whereOf(at: Vec2, except: string): string {
    const places = this.edge?.places, own = this.places.ofEntity(except)?.id;
    const place = places?.containing(at[0], at[1], 0).find(p => p.parent !== null && !p.carrier && p.id !== own);
    const say = (name: string) => /^[A-Z]/.test(name) || name.startsWith('the ') ? name : `the ${name}`;
    if (place?.name) return ` at ${say(place.name)}`;
    const by = this.nav.namesNear(at, except, 1, 12)[0];
    return by ? ` by ${say(by.split('/').at(-1)!.replace(/[-_]+/g, ' '))}` : ' near you';
  }
  /** Construction: a build started near a resident (one inside a closing site is walked out and told by G1), and done. */
  private buildNotice(e: BuildNotice) {
    if (e.kind !== 'started' && e.kind !== 'done') return;
    try {
      const body = this.god.builds.body(e.id); if (!body || !this.host.minds.size) return;
      const title = body.title, closing = this.god.builds.closingSites().find(s => s.id === e.id), residents = this.residents();
      if (e.kind === 'started') this.mapNotices.construction(nearSite(body.site, residents, { skipInside: closing?.zones }), `The god started building ${title} nearby${closing ? '; it is closed until finished' : ''}.`, title);
      else this.mapNotices.construction(nearSite(body.site, residents), `${title[0].toUpperCase()}${title.slice(1)} is finished and open.`, title);
    } catch (err) { this.log(`map notices: ${(err as Error).message}`); }
  }
  private flushMapNotices() { try { this.mapNotices.flush(); } catch (e) { this.log(`map notices: ${(e as Error).message}`); } }
  /** Residents the last edit's plan found no clear ground for (told why when that edit applies). */
  private stuckPlanned: StuckResident[] = [];
  private applyWalkouts(moved: ResidentMove[], stuck: StuckResident[] = []): string[] {
    const late: string[] = [];
    // Residents in the way with nowhere clear to go: they stay, and are told why.
    for (const x of stuck) this.notices.notify(x.soulId, { text: x.reason, tick: this.engine.world.tick, salience: 3, ...(x.place ? { place: x.place } : {}) });
    for (const m of moved) {
      try {
        const carried = m.released.filter(id => ['in-hand', 'held'].includes(this.engine.world.entities[id]?.support?.kind));
        if (m.how === 'stopped') {
          void this.host.enqueue('edge-stop', 'god:walkout', { soulId: m.soulId, entityId: m.body, why: m.reason }).catch(() => { /* best effort */ });
        } else {
          const payload = { soulId: m.soulId, entityId: m.body, to: m.to, ...(m.level ? { level: m.level } : {}), released: m.released, ...(m.dropAt ? { dropAt: m.dropAt } : {}), why: m.reason, ...(m.how === 'relocated' ? { godWalkout: true } : {}) };
          void this.host.enqueue(m.how === 'walked' ? 'edge-god-walkout' : 'edge-relocate', 'god:walkout', payload).catch(() => { /* logged or refused: the notice still stands */ });
        }
        this.host.drainInputs();
        const b = this.engine.world.entities[m.body], at = b?.pose?.p, landed = m.how === 'stopped' || (!!at && Math.hypot(at[0] - m.to[0], at[2] - m.to[1]) < .05 && (b.human?.level ?? 0) === (m.level ?? 0));
        if (landed) {
          // What it carried re-enters the engine from the entity world at the next flush (or leaves it, if removed).
          for (const id of carried) this.sent.set(id, RELEASED);
          this.edge?.godInterrupted(m.soulId, m.reason);
          this.notices.notify(m.soulId, { text: m.reason, tick: this.engine.world.tick, ...(m.how === 'stopped' ? { salience: 3 as const } : { moved: m.how }), ...(m.place ? { place: m.place } : {}) });
          this.log(`${m.name} ${m.how} out of the god's way: ${m.reason}`);
        } else {
          const text = m.reason.replace(/;.*$/, '; you could not step clear, so you stayed where you were.');
          this.notices.notify(m.soulId, { text, tick: this.engine.world.tick, salience: 3, ...(m.place ? { place: m.place } : {}) });
          late.push(`body.stuck: ${m.name} (${m.body}) could not be ${m.how === 'walked' ? 'walked' : 'moved'} to (${m.to.join(', ')}): the engine refused the landing; still at (${at ? `${r3(at[0])}, ${r3(at[2])}` : '?'})`);
          this.log(`walk-out of ${m.name} refused by the engine at (${m.to.join(', ')})`);
        }
      } catch (e) { this.log(`walk-out of ${m.name}: ${(e as Error).message}`); }
    }
    return late;
  }
  private posOf(body: string): Vec2 { const p = this.engine.world.entities[body]?.pose?.p; return p ? [p[0], p[2]] : [0, 0]; }
  /** Only a resident's body is protected from god edits: never removed, edited or re-made as a thing, and nothing is put
   *  into its hands (an undo that would is set down at its feet instead: walkout.ts unhand). */
  private protectedBody(after: WorldModel, diff: Diff, ops: Op[], undo = false): Failure | null {
    for (const [i, op] of ops.entries()) {
      const raw = op as { id?: string; entity?: Entity };
      const e = raw.id ? this.model.get(raw.id) : raw.entity;
      if (e && this.model.resolvedDef(e.def)?.components.body) return { op: i, code: 'body.protected', entity: e.id, detail: `${this.model.pathOf(e.id)} is a resident's body; bodies move themselves` };
    }
    for (const id of diff.removes) {
      const e = this.model.entities.get(id);
      if (e && this.model.resolvedDef(e.def)?.components.body) return { op: 0, code: 'body.protected', entity: id, detail: 'A god edit cannot remove a resident body.' };
    }
    for (const e of diff.upserts) if (after.resolvedDef(e.def)?.components.body && (!this.model.entities.has(e.id) || diff.defs.some(d => d.ref === after.resolvedDef(e.def)?.ref))) {
      const ref = after.resolvedDef(e.def)?.ref, i = ops.findIndex(o => { const x = o as { op?: string; def?: string }; try { return x.op === 'place' && !!x.def && after.resolvedDef(x.def)?.ref === ref; } catch { return false; } });
      return { op: Math.max(0, i), code: 'body.protected', entity: e.id, detail: `${ref?.replace(/^core-/, 'core/') ?? e.def} is a resident's body: residents (Souls) come only by joining, never by placing, and their bodies are managed by their Souls`, fix: PEOPLE_AS_SCENERY };
    }
    if (!undo) for (const e of diff.upserts) {
      const holder = e.in.parent !== 'world' ? after.entities.get(e.in.parent) : undefined;
      if (!holder || !after.resolvedDef(holder.def)?.components.body || this.model.entities.get(e.id)?.in.parent === holder.id) continue;
      const i = ops.findIndex(o => { const x = o as { id?: string; tmp?: string; in?: { parent?: string } }; return x.id === e.id || (typeof x.id === 'string' && this.model.get(x.id)?.id === e.id) || !!x.in?.parent && (x.in.parent === holder.id || this.model.get(x.in.parent)?.id === holder.id); });
      return { op: Math.max(0, i), code: 'body.protected', entity: e.id, field: 'in.parent', detail: `${this.soulName(holder.id)}'s hands are theirs: a god edit cannot put ${after.pathOf(e.id) || e.id} into them`, fix: 'Place it beside the resident instead; residents pick things up themselves.' };
    }
    return null;
  }
  /** LAYERS: the world clock drives schedules (states that follow them, calendar items); a new day re-derives places. */
  private layerDay = '';
  private layersStep() {
    try {
      this.god.builds.sweep();
      if (this.god.builds.hasClosure()) this.evacuateSites();
      if (!this.layers.active()) return;
      const day = this.layers.dayKey(); if (day !== this.layerDay) { this.layerDay = day; this.places.sync(true); }
      this.layers.step();
    } catch (e) { this.log(`layers: ${(e as Error).message}`); }
  }
  /** The place a thing is in: its own place (a café building, a market plaza), else the innermost holding it. */
  private layerPlace(e: Entity): { id: string; name: string } | null {
    if (!this.edge) return null;
    const own = this.places.ofEntity(e.id); if (own) return { id: own.id, name: own.name };
    const wp = this.model.worldPose(e), id = this.places.placeAt([wp.x, wp.z], this.levelAt(wp.x, wp.z, wp.y)); if (!id) return null;
    return { id, name: this.edge.places.byId.get(id)?.name ?? id };
  }

  // ------------------------------------------------------------------ engine → entity world

  /** Trusted engine edit: journaled (by 'engine', never undone by the god), published to viewers, not echoed back. */
  engineAct(ops: Op[], note: string): Result {
    const god = this.god as any;
    if ((ops as { id?: string }[]).some((o) => !o.id || !this.model.resolvedDef(this.model.entities.get(o.id)?.def ?? '')?.components.body)) this.version++;
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
      // A thing in a body's hands is the engine's: forget what it was last told, so the god placing it again is sent.
      if (this.engineOwned(e)) { this.sent.delete(e.id); continue; }
      this.sent.set(e.id, JSON.stringify(normPart(this.derive(e, {}, this.physics?.assets ?? {}) ?? {})));
    }
  }

  /** Items the Souls moved: write their new support back as entity-world moves. */
  /** S1 V7d: the model key and engine entities of the last write-back that found nothing to write with no body in the
   *  engine world. Without bodies nothing moves a god thing in the engine (Souls carry, rides seat bodies) except an
   *  edit flushed from the model, which changes the key, so the next pass would find nothing again. */
  private writeBackQuiet: { key: object; ents: object } | null = null;
  writeBack() {
    if (this.writeBackBusy) return;
    if (this.writeBackQuiet) {
      const ents = this.engine.world.entities as Record<string, any>;
      let body = false;
      for (const id in ents) if (ents[id]?.human) { body = true; break; }
      if (!body && this.writeBackQuiet.key === this.model.safetyCacheKey() && this.writeBackQuiet.ents === ents) return;
      this.writeBackQuiet = null;
    }
    this.writeBackBusy = true;
    try {
      const ops: Op[] = [], bodies = new Set<string>(), holders = new Set<string>();
      // S1 V7d: one allocation-free walk (Object.entries' order) collects the god things and the bodies; the cheap kind
      // test goes first. Eden 2026 lists ~4,900 engine entities twice a second here.
      const ents = this.engine.world.entities as Record<string, any>, humans: string[] = [];
      for (const id in ents) {
        if (!Object.hasOwn(ents, id)) continue;
        const x = ents[id];
        if (x?.human) humans.push(id);
        if (x.kind !== 'component' || !x.tags?.includes('entity-world')) continue;
        const e = this.model.entities.get(id); if (!e) continue;
        const s = x.support;
        if (s?.kind === 'in-hand') {
          if (e.in.parent === s.by && e.in.slot === 'carry') { holders.add(s.by); continue; }
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
          // a thing the god stood in a room, on a pier's end or a balcony stays in it until a Soul moves it away
          else { const wp = this.model.worldPose(e); if (Math.hypot(wp.x - x.pose.p[0], wp.z - x.pose.p[2]) < 0.05) continue; }
          ops.push({ op: 'move', id, in: { parent: 'world' }, p: [r3(x.pose.p[0]), r3(x.pose.p[2])], r: r3(-x.pose.yaw), mode: 'strict' } as Op);
        }
      }
      // a body carrying god things: keep its entity's pose near the engine's, so what it holds is drawn in its hands
      // (coarsely while it walks, exactly once it stops; viewer B7 would follow the hand from the takes instead)
      for (const id of holders) {
        const b = this.engine.world.entities[id], e = this.model.entities.get(id); if (!b?.human || !e || bodies.has(id)) continue;
        const have = e.p ?? [0, 0, 0], d = Math.hypot((have[0] ?? 0) - b.pose.p[0], (have.length === 3 ? have[1] : 0) - b.pose.p[1], (have[have.length - 1] ?? 0) - b.pose.p[2]);
        const moving = (b.human.speed ?? 0) > 0.05 || b.human.activity === 'walk';
        if (d > (moving ? 2 : 0.15)) ops.push({ op: 'move', id, p: [r3(b.pose.p[0]), r3(b.pose.p[1]), r3(b.pose.p[2])], r: r3(-b.pose.yaw), mode: 'strict' } as Op);
      }
      // F1: every Soul's body entity follows its engine body once it comes to rest (a walk's end, a seat), so the god's
      // map and snapshot show where Souls are and what they sit on (one engine edit per stop, none while walking)
      for (const id of humans) {
        const b = ents[id];
        if (!b?.human || bodies.has(id) || holders.has(id)) continue;
        const e = this.model.entities.get(id); if (!e || e.in.parent !== 'world') continue;
        if ((b.human.speed ?? 0) > 0.05 || ['walk', 'wade', 'swim', 'tread', 'sit-down', 'stand-up'].includes(b.human.activity)) continue;
        const have = e.p ?? [0, 0, 0], d = Math.hypot((have[0] ?? 0) - b.pose.p[0], (have.length === 3 ? have[1] : 0) - b.pose.p[1], (have[have.length - 1] ?? 0) - b.pose.p[2]);
        if (d > 0.4) ops.push({ op: 'move', id, p: [r3(b.pose.p[0]), r3(b.pose.p[1]), r3(b.pose.p[2])], r: r3(-b.pose.yaw), mode: 'strict' } as Op);
      }
      if (!ops.length) { if (!humans.length) this.writeBackQuiet = { key: this.model.safetyCacheKey(), ents }; return; }
      for (const op of ops) {
        { const o = op as { id: string; p?: number[] }; if (this.refusedPose.has(`${o.id}@${o.p?.join(',')}`)) continue; }
        const r = this.engineAct([op], `engine: ${describeOp(op, this.model)}`);
        if (r.accepted) this.stats.writeBacks++;
        else {
          // a body's pose refused (it sits inside a bench's footprint): try once more letting the compiler nudge it, and
          // never retry the same refused pose
          const o = op as { id: string; p?: number[]; mode?: string }, key = `${o.id}@${o.p?.join(',')}`;
          if (this.model.resolvedDef(this.model.entities.get(o.id)?.def ?? '')?.components.body) {
            const r2 = this.engineAct([{ ...(op as object), mode: 'nudge' } as Op], `engine: ${describeOp(op, this.model)}`);
            if (r2.accepted) { this.stats.writeBacks++; continue; }
            this.refusedPose.add(key); if (this.refusedPose.size > 500) this.refusedPose.clear();
          }
          this.log(`write-back refused for ${o.id}: ${JSON.stringify(r.failures).slice(0, 200)}`);
        }
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
    const r = this.engineAct(ops, p.entityId.startsWith('h_vp') ? `retire: verifier probe ${p.entityId} body removed` : 'retire: body removed');
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
  usesOne(id: string): { code: 'body.protected'; detail: string } | null {
    const e = this.model.entities.get(id);
    return e && this.model.resolvedDef(e.def)?.components.body ? { code: 'body.protected', detail: `${this.model.pathOf(id)} is ${this.soulName(id)}'s body; bodies move themselves` } : null;
  }
  private soulName(body: string) { return String(this.engine.world.entities[body]?.label ?? body); }

  // ------------------------------------------------------------------ reach

  /** Where an end was looked for when the engine has nowhere to stand there: the point, its height, the engine level that
   *  height resolves to and that level's own height (a room floor at y 3.1 resolving to level 0 at y 0 = no engine floor). */
  private endpoint(what: string, at: Vec2, y: number, level: number): ReachEndpoint {
    const levelY = level === 0 ? 0 : this.levels.find((l) => l.id === level)?.y ?? 0;
    return { what, at: [r3(at[0]), r3(at[1])], y: r3(y), level, levelY: r3(levelY) };
  }
  private endOf(x: ReachEnd): { p: Vec2; level: number; what: string } | { error: string; endpoint?: ReachEndpoint } {
    if (Array.isArray(x)) { const y = x.length === 3 ? x[1] : 0; const p: Vec2 = [x[0], x[x.length - 1]]; return { p, level: this.levelOfY(y as number), what: `(${p.join(', ')})` }; }
    const [path, room] = String(x).split(':');
    const e = this.model.get(path);
    if (!e) return { error: `no such entity or point ${x}` };
    if (room) {
      const slot = this.model.slotsOf(e).find((s) => s.id === room && (s.kind === 'room' || s.kind === 'floor'));
      if (!slot) return { error: `${path} has no room ${room}` };
      const wp = this.model.worldPose(e), c = Math.cos(wp.yaw), s = Math.sin(wp.yaw);
      const at: Vec2 = [wp.x + (slot.p[0] * c + slot.p[2] * s) * wp.s, wp.z + (-slot.p[0] * s + slot.p[2] * c) * wp.s];
      const y = wp.y + slot.p[1] * wp.s, level = this.levelOfY(y);
      const p = this.engine.standableNearV1(at, level, undefined, 0.4, 40);
      return p ? { p, level, what: `${path}:${room}` } : { error: `no standing room in ${path}:${room}`, endpoint: this.endpoint(`${path}:${room}`, at, y, level) };
    }
    const body = this.engine.world.entities[e.id];
    if (body?.human) return { p: [body.pose.p[0], body.pose.p[2]], level: body.human.level ?? 0, what: this.model.pathOf(e.id) };
    // an area or path at the root (a deck, a plaza, a pier) has no pose of its own (0, 0): its end is where a Soul walking
    // to it goes (nav: the deck's middle on its own floor, a pier's end platform, a plaza's centre)
    const sdef = this.model.resolvedDef(e.def), t = sdef && sdef.form !== 'point' && e.in.parent === 'world' && e.shape ? this.nav.thing(this.model.pathOf(e.id)) : undefined;
    if (t && t.kind !== 'water') {
      const g = this.nav.goal(t, t.at);
      return g ? { p: g.p, level: g.level, what: this.model.pathOf(e.id) } : { error: `no standing room on ${this.model.pathOf(e.id)}`, endpoint: this.endpoint(this.model.pathOf(e.id), t.at, t.level ? this.levels.find((l) => l.id === t.level)?.y ?? 0 : this.model.terrain.sample(t.at[0], t.at[1]), t.level) };
    }
    const wp = this.model.worldPose(e), level = body ? this.levelOfY(body.pose.p[1]) : this.levelOfY(wp.y);
    const p = this.engine.standableNearV1([wp.x, wp.z], level, undefined, 0.4, 40);
    return p ? { p, level, what: this.model.pathOf(e.id) } : { error: `no standing room near ${this.model.pathOf(e.id)}`, endpoint: this.endpoint(this.model.pathOf(e.id), [wp.x, wp.z], body ? body.pose.p[1] : wp.y, level) };
  }
  /** Engine level of a standing height at (x, z): 0 within reach of the terrain there (hills too), else a floor's level. */
  levelAt(x: number, z: number, y: number): number {
    // a registered floor at this height wins over the generous ground band: a raised floor 0.35–0.85 m up (the Mars
    // bays' 0.53 m plywood, lane MARS) is its own level, not the ground under it
    const g = this.model.terrain.sample(x, z);
    if (Math.abs(y - g) > GROUND_BAND) { const exact = this.levels.find((l) => Math.abs(l.y - y) <= LEVEL_MATCH); if (exact) return exact.id; }
    if (Math.abs(y - g) <= GROUND_BAND + 0.5) return 0;
    const hit = this.levels.find((l) => Math.abs(l.y - y) <= 0.6); if (hit) return hit.id;
    const below = this.levels.filter((l) => l.y <= y + 0.5).sort((a, b) => b.y - a.y)[0];
    return below?.id ?? 0;
  }
  private levelOfY(y: number) { if (Math.abs(y) > GROUND_BAND) { const exact = this.levels.find((l) => Math.abs(l.y - y) <= LEVEL_MATCH); if (exact) return exact.id; } if (Math.abs(y) <= GROUND_BAND + 0.5) return 0; const l = this.levels.reduce<Level | null>((b, l) => (l.y <= y + 0.5 && (!b || l.y > b.y) ? l : b), null); return l?.id ?? 0; }
  reach(from: ReachEnd, to: ReachEnd) {
    const a = this.endOf(from), b = this.endOf(to);
    if ('error' in a) return { reachable: false, code: 'reach.bad-from', detail: a.error, ...(a.endpoint ? { endpoint: { side: 'from', ...a.endpoint } } : {}) };
    if ('error' in b) return { reachable: false, code: 'reach.bad-to', detail: b.error, ...(b.endpoint ? { endpoint: { side: 'to', ...b.endpoint } } : {}) };
    const r = this.engine.reachV1({ p: a.p, level: a.level }, { p: b.p, level: b.level });
    return r.ok ? { reachable: true, from: { ...a }, to: { ...b }, length: r.length, legs: r.legs, levels: r.levels }
      : { reachable: false, from: { ...a }, to: { ...b }, code: r.code, detail: r.message };
  }

  // ------------------------------------------------------------------ Souls: capabilities on god things, prayers

  private hookEdge(L: EdgeLedger) {
    // G1/R8: a resident's next observation carries what the god just did around it (newest first).
    const observe = L.observe.bind(L);
    L.observe = (soul, include) => {
      const out = observe(soul, include), notices = this.notices.recent(soul.soulId);
      if (notices.length) out.notices = notices;
      return out;
    };
    L.intents.planRefusal = (soul, steps, target) => this.layers.constructionRefusal(soul, steps, target);
    const priorUseRefusal = L.nativeUseRefusal;
    L.nativeUseRefusal = (capability, steps) => priorUseRefusal?.(capability, steps) ?? this.bedUseRefusal(capability, steps);
    // R4-INFO: god-built places are walkable (map, plain-words resolution, `via`), and the map follows the god's edits
    L.placeWalkable = (id) => this.places.walkable(id);
    // a far named place asked for by name ("go to the big top" from across town): its walk, offered for that act only
    L.gaitOnDemand = (soul, id, gait, caps, plans) => { let added = false; try { const go = () => { added = this.nav.gaitOnDemand(soul, id, gait, caps, plans); }, eng = this.engine as unknown as { readPassV1?: (f: () => void) => void }; if (eng.readPassV1) eng.readPassV1(go); else go(); } catch (e) { this.log(`gait on demand: ${(e as Error).message}`); } releaseBigScratch(); return added; };
    L.walkOnDemand = (soul, id, caps, plans) => { let added = false; try { const go = () => { added = this.nav.walkOnDemand(soul, id, caps, plans); }, eng = this.engine as unknown as { readPassV1?: (f: () => void) => void }; if (eng.readPassV1) eng.readPassV1(go); else go(); } catch (e) { this.log(`walk on demand: ${(e as Error).message}`); } releaseBigScratch(); return added; };
    L.beforeMap = () => { this.flush(); this.perceiveSync(); };
    const prev = L.worldProfile;
    L.worldProfile = (soul, caps, plans) => { prev?.(soul, caps, plans); try { this.capabilities(soul, caps, plans as never); } catch (e) { this.log(`capabilities: ${(e as Error).message}`); } };
    const act = L.act.bind(L), self = this;
    (L as any).act = async function (soul: EdgeSoul, input: { capability?: unknown; params?: unknown; clientRef?: unknown }) {
      if (input?.capability === 'pray' || (typeof input?.capability === 'string' && /^pray(\s|:|$)/.test(input.capability))) return self.pray(L, soul, input);
      if (typeof input?.capability === 'string' && /^(buy|pay|sell):/.test(input.capability)) return self.trade(L, soul, input as { capability: string; params?: unknown; clientRef?: unknown });
      const res: any = await act(soul, input as never);
      // E-life B2: an accepted eat takes its portion from the kitchen now; the receipt says which meal it is
      if (res?.accepted && res.receipt?.id && typeof input?.capability === 'string' && self.meals) {
        const meal = self.meals.reserve(input.capability, res.receipt.id);
        if (meal) { const row = L.db.db.prepare('SELECT detail FROM edge_receipts_v1 WHERE world_id=? AND receipt_id=?').get(L.host.worldId, res.receipt.id) as { detail: string | null } | undefined;
          const d = row?.detail ? JSON.parse(row.detail) : {}; L.db.db.prepare('UPDATE edge_receipts_v1 SET detail=? WHERE world_id=? AND receipt_id=?').run(JSON.stringify({ ...d, meal }), L.host.worldId, res.receipt.id);
          res.receipt = L.receipt(soul.soulId, res.receipt.id) ?? res.receipt; }
      }
      return res;
    };
  }
  /** beds/1: a bed is lain on through its engine asset's native berths (catalog-adapter berthSlots: an adult fits on it).
   * A bed without one (a crib, a pram, a bathtub, a bunk's upper berth only) is refused by name and never offered;
   * a generic floor pose is never substituted for use of a named bed. */
  private bedUseRefusal(capability: string, steps?: { verb: string; params: Record<string, unknown> }[]): {code: string; reason: string} | null {
    const target = /^(?:lie|sleep):(.+)$/.exec(capability)?.[1];
    if (!target) return null;
    const e = this.model.entities.get(target);
    if (!e || !this.isBed(target)) return null;
    if (this.berthsOf(target)) {
      // a plan for this bed (an older server's queued bedside floor pose included) must lie on the bed's own berth
      if (!steps || steps.some((s) => s.verb === 'mars:take_slot' && (s.params.owner === target || String(s.params.slot ?? '').startsWith(`${target}#`)))) return null;
      return {code: 'bed.native-berth-required', reason: `${this.model.pathOf(target)} is used by lying on its berth (${capability}), not by a pose beside it.`};
    }
    return {code: 'bed.attachment-unavailable', reason: `${this.model.pathOf(target)} has no berth an adult can lie on (it is too short, or its mattress too high or too low); your body cannot lie or sleep on it.`};
  }
  private isBed(id: string): boolean {
    const e = this.model.entities.get(id);
    return !!e && (!!this.model.resolvedDef(e.def)?.components.bed || this.model.slotsOf(e).some(s => s.kind === 'bed'));
  }
  /** beds/1: how many native berths the engine asset of god-built thing `id` has (0 when none qualified). */
  private berthsOf(id: string): number {
    const x = this.engine.world.entities[id];
    const asset = (x ? this.physics?.assets[x.def] : undefined) as { slots?: { kind: string }[] } | undefined;
    return asset?.slots?.filter((s) => s.kind === 'berth').length ?? 0;
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

  /** LAYERS: buy:<id>, pay:<soul>, sell:<id> — validated by the world (layers.ts), a completed receipt like pray. */
  private trade(L: EdgeLedger, soul: EdgeSoul, input: { capability: string; params?: unknown; clientRef?: unknown }) {
    const me = this.engine.world.entities[soul.entityId], here: Vec2 | null = me?.pose?.p ? [me.pose.p[0], me.pose.p[2]] : null;
    const r = this.layers.act(soul, input.capability, (input.params ?? {}) as Record<string, unknown>, here);
    if (!r.accepted) return { accepted: false as const, capability: input.capability, code: r.code, reason: r.reason };
    const row = (L as any).insert(soul, input.capability.split(':')[0], 'completed', typeof input.clientRef === 'string' ? input.clientRef : undefined, true, r.result);
    return { accepted: true as const, receipt: (L as any).receipt(soul.soulId, row.id), result: r.result };
  }

  /** Capabilities on god-placed things near this Soul: sit on chairs, pick up items, put them on tables; and pray. */
  capabilities(soul: EdgeSoul, caps: EdgeCapability[], plans: Map<string, { label: string; steps: { verb: string; params: Record<string, unknown> }[]; seconds?: boolean }>) {
    // L1: the walk listing only reads the world; the engine's planner syncs once for all of it (readPassV1). S2: so does
    // the rest of this listing (the standing points beside near items, seats, layers): one sync and one list of bodies.
    const list = () => this.listCapabilities(soul, caps, plans), eng = this.engine as unknown as { readPassV1?: (f: () => void) => void };
    if (eng.readPassV1) eng.readPassV1(list); else list();
  }
  private listCapabilities(soul: EdgeSoul, caps: EdgeCapability[], plans: Map<string, { label: string; steps: { verb: string; params: Record<string, unknown> }[]; seconds?: boolean }>) {
    try { this.nav.capabilities(soul, caps, plans); } catch (e) { this.log(`nav capabilities: ${(e as Error).message}`); }
    releaseBigScratch();   // L1: room-reach searches inside a multi-storey house share one ~110 MB workspace; not kept after
    try { this.perceive.capabilities(soul, caps, plans); } catch (e) { this.log(`perceive capabilities: ${(e as Error).message}`); }
    caps.push({ id: 'pray', verb: 'pray', label: 'Pray to the god of this world (params: {"text": "…"}); answers come back under GET /v1/god/prayers/mine', available: true, params: { text: { type: 'string', maxLength: 2000 } } });
    const ents = this.engine.world.entities, me = ents[soul.entityId]; if (!me?.human) return;
    const here: Vec2 = [me.pose.p[0], me.pose.p[2]];
    const held = Object.values(ents).find((x: any) => x.tags?.includes('entity-world') && x.support?.kind === 'in-hand' && x.support.by === soul.entityId) as any;
    const name = (id: string) => (this.model.entities.has(id) ? this.model.pathOf(id) : String(ents[id]?.label ?? id));
    // MARSLIVED: a thing resting on a table is reached from the table's floor (its top's height matched Mimos's 0.53 m
    // raised floor, so a cup on the ground-floor tea table read "floor 1" and Souls were sent up there for it)
    const levelOf = (x: any) => { let s = x; for (let i = 0; i < 4 && s.support?.kind === 'resting-on' && ents[s.support.on]; i++) s = ents[s.support.on]; return this.levelOfY(s.pose.p[1]); };
    const near = Object.values(ents).filter((x: any) => x.tags?.includes('entity-world') && Math.hypot(x.pose.p[0] - here[0], x.pose.p[2] - here[1]) <= NEAR) as any[];
    near.sort((a, b) => Math.hypot(a.pose.p[0] - here[0], a.pose.p[2] - here[1]) - Math.hypot(b.pose.p[0] - here[0], b.pose.p[2] - here[1]) || (a.id < b.id ? -1 : 1));
    const approach = (x: any): { verb: string; params: Record<string, unknown> }[] => {
      const level = levelOf(x); if (level === (me.human.level ?? 0) && Math.hypot(x.pose.p[0] - here[0], x.pose.p[2] - here[1]) < 3) return [];
      const at = this.engine.standableNearV1([x.pose.p[0], x.pose.p[2]], level, soul.entityId, 0.4, 16);
      return at ? [{ verb: 'mars:walk_to', params: { x: at[0], z: at[1], level } }] : [];
    };
    const stand = me.human.activity === 'sit' || me.human.baseActivity === 'sit' || me.human.berth ? [{ verb: 'stand', params: {} }] : [];
    for (const x of near) {
      const asset = (this.physics?.assets[x.def] ?? {}) as { slots?: { kind: string }[]; surfaceSlots?: { id: string }[]; category?: string };
      const d = Math.round(Math.hypot(x.pose.p[0] - here[0], x.pose.p[2] - here[1]));
      if (asset.slots?.some((s) => s.kind === 'seat')) {
        const u = this.engine.bodyUsesV1(x.id), mine = u?.body === soul.entityId;
        const seats = asset.slots.filter((s) => s.kind === 'seat').length, taken = this.seatTakers(x.id), others = taken.filter((b) => b !== soul.entityId);
        // what it is and what it is by (P4): "Sit on e_… (a bench, by pond; 12 m)" — so "sit on the bench by the pond"
        // resolves through the ledger's vocabulary (every word in the label) to this seat and not another bench
        const ent = this.model.entities.get(x.id), kind = ent ? this.model.resolvedDef(ent.def)?.name.replace(/^core-/, '') : undefined;
        const by = ent ? this.nav.namesNear([x.pose.p[0], x.pose.p[2]], x.id) : [];
        const id = `sit:${x.id}`, label = `${name(x.id)} (${kind && !name(x.id).split('/').pop()!.includes(kind) ? `a ${kind}, ` : ''}${by.length ? `by ${by.join(' and ')}; ` : ''}${d} m${levelOf(x) ? `, ${this.floorWord(x)}` : ''})`;
        // F1: a bench for two stays free while one of its seats is; the seat a Soul sits on is not free to itself
        const full = others.length >= seats || (!!u && !mine && seats <= 1);
        // seat fit (engine bodies/humanoid.ts): a body whose look sets its height sits only on seats whose top suits it
        const tops = (asset.slots as { kind: string; p?: number[] }[]).filter((s) => s.kind === 'seat').map((s) => s.p?.[1]).filter((y): y is number => typeof y === 'number' && Number.isFinite(y));
        const misfit = tops.length && tops.every((y) => seatFitProblem(me.body, y)) ? seatFitProblem(me.body, tops[0]) : null;
        const block = mine ? { code: 'seat.yours', reason: `You are sitting on ${name(x.id)} already; stand:here to get up.` } : full ? { code: 'seat.taken', reason: `${(others.length ? others : [u!.body]).map((b) => this.soulName(b)).join(' and ')} ${others.length > 1 ? 'are' : 'is'} sitting there.` } : misfit ? { code: misfit.code, reason: `${name(x.id)} does not fit your body: ${misfit.message}.` } : null;
        caps.push({ id, verb: 'sit', label, target: { id: x.id, kind: 'object' }, available: !block, ...(block ? { blocked: block } : {}), params: { seconds: { type: 'integer', min: 1, max: 600, default: 60 } } });
        plans.set(id, { label, steps: [{ verb: 'sit', params: { on: x.id, seconds: 60 } }], seconds: true });
      }
      // beds/1: a bed with native berths is lain on through the engine's take_slot (walk to its side, lie down on the
      // mattress, rest, get up); a bed no adult fits on is not offered at all (bedUseRefusal names it if asked by id)
      const berths = x.support?.kind !== 'in-hand' && this.isBed(x.id) ? this.berthsOf(x.id) : 0;
      if (berths) {
        const occ = (this.engine as unknown as { seatOccupantsV1?: (id: string, kind?: string) => { body: string }[] }).seatOccupantsV1?.call(this.engine, x.id, 'berth') ?? [];
        const mine = occ.some((o) => o.body === soul.entityId), others = occ.filter((o) => o.body !== soul.entityId).map((o) => o.body);
        const block = mine ? { code: 'bed.yours', reason: `You are lying on ${name(x.id)} already; stand:here to get up.` }
          : others.length >= berths ? { code: 'bed.taken', reason: `${others.map((b) => this.soulName(b)).join(' and ')} ${others.length > 1 ? 'are' : 'is'} lying there.` } : null;
        for (const [verb, activity, sec] of [['lie', 'lie', 120], ['sleep', 'nap', 600]] as const) {
          const id = `${verb}:${x.id}`, label = `${verb === 'lie' ? 'Lie down on' : 'Sleep in'} ${name(x.id)} (${d} m${levelOf(x) ? `, ${this.floorWord(x)}` : ''})`;
          caps.push({ id, verb, label, target: { id: x.id, kind: 'object' }, available: !block, ...(block ? { blocked: block } : {}), params: { seconds: { type: 'integer', min: 1, max: 600, default: sec } } });
          plans.set(id, { label, steps: [...stand, { verb: 'mars:take_slot', params: { owner: x.id, activity } }, { verb: 'rest', params: { seconds: sec } }, { verb: 'stand', params: {} }], seconds: true });
        }
      }
      if (asset.category === 'item' && x.support?.kind !== 'in-hand' && !held) {
        const id = `pick-up:${x.id}`, label = `Pick up ${name(x.id)} (${d} m${levelOf(x) ? `, ${this.floorWord(x)}` : ''})`;
        caps.push({ id, verb: 'pick-up', label, target: { id: x.id, kind: 'item' }, available: true });
        plans.set(id, { label, steps: [...stand, ...approach(x), { verb: 'mars:take_item', params: { item: x.id, hand: 'right' } }] });
      }
      if (held && asset.surfaceSlots?.length) {
        const taken = new Set(Object.values(ents).filter((o: any) => o.support?.kind === 'resting-on' && o.support.on === x.id).map((o: any) => o.support.slot));
        // MARSLIVED: the free place nearest the Soul (the first free one was often on a table's far side, against a
        // counter: "put the cup on the prep table" failed as unreachable while the near end was free)
        // MARSLAND: engine poses carry the negated three.js yaw (fixtureSpec registers yaw: −wp.yaw); turn the slot's local
        // offset with the entity's own (three.js) yaw, or a turned table's places are mirrored and the far one is chosen
        const yw = -(x.pose.yaw ?? 0), at = (sl: { local?: number[] }) => { const l = sl.local ?? [0, 0, 0]; return [x.pose.p[0] + l[0] * Math.cos(yw) + l[2] * Math.sin(yw), x.pose.p[2] - l[0] * Math.sin(yw) + l[2] * Math.cos(yw)]; };
        const free = (asset.surfaceSlots as { id: string; local?: number[] }[]).filter((s) => !taken.has(s.id)).sort((a, b) => { const pa = at(a), pb = at(b); return Math.hypot(pa[0] - here[0], pa[1] - here[1]) - Math.hypot(pb[0] - here[0], pb[1] - here[1]); })[0];
        const id = `put-on:${x.id}`, label = `Put ${name(held.id)} on ${name(x.id)} (${d} m)`;
        caps.push({ id, verb: 'put-on', label, target: { id: x.id, kind: 'object' }, available: !!free, ...(free ? {} : { blocked: { code: 'surface.full', reason: `${name(x.id)} has no free place.` } }) });
        if (free) plans.set(id, { label, steps: [...stand, ...approach(x), { verb: 'mars:put_item', params: { item: held.id, surfaceSlot: `${x.id}#${free.id}` } }] });
      }
    }
    if (this.layers.active()) try { this.layers.capabilities(soul, caps, plans as never, here); } catch (e) { this.log(`layers capabilities: ${(e as Error).message}`); }
    this.sitHere(caps, plans, here);
    this.fireLit(caps);
    try { this.meals?.capabilities(caps); } catch (e) { this.log(`meals capabilities: ${(e as Error).message}`); }
  }
  /** B6: a god-built campfire that has been put out warms nobody: warm-by-fire there is refused until someone lights it. */
  private fireLit(caps: EdgeCapability[]) {
    for (const c of caps) {
      if (c.verb !== 'warm-by-fire' || !c.target) continue;
      const e = this.model.entities.get(c.target.id), def = e ? this.model.resolvedDef(e.def) : undefined;
      const lit = e?.state?.lit ?? (def?.state as Record<string, { default?: unknown }> | undefined)?.lit?.default;
      if (lit !== false) continue;
      c.available = false; c.blocked = { code: 'fire.out', reason: `${this.model.pathOf(e!.id)} is not lit; light it first (object:${e!.id}:light), then warm up by it.` };
    }
  }
  /** SOULFIX: which storey of its building a thing upstairs stands on ("floor 1" = the first floor above the ground),
   *  from the building's own floor height (engine level ids are not storeys). */
  private floorWord(x: any): string {
    let e = this.model.entities.get(x.id);
    while (e && e.in?.parent && e.in.parent !== 'world') {
      const p = this.model.entities.get(e.in.parent); if (!p) break;
      const def = this.model.resolvedDef(p.def) as any;
      if (def?.components?.building || def?.params?.floorHeight) {
        const fh = Number((p as any).params?.floorHeight ?? def.params?.floorHeight?.default ?? 3) || 3;
        const n = Math.round((x.pose.p[1] - this.model.worldPose(p).y) / fh);
        if (n > 0) return `floor ${n}`;
        break;
      }
      e = p;
    }
    return `floor ${this.levelOfY(x.pose.p[1])}`;
  }
  /** Bodies sitting on a god-built seat fixture (any of its seat slots). */
  seatTakers(id: string): string[] {
    const e = this.engine as unknown as { seatOccupantsV1?: (id: string) => { slot: string; body: string }[] };
    if (e.seatOccupantsV1) return e.seatOccupantsV1.call(this.engine, id).map((x) => x.body);
    const u = this.engine.bodyUsesV1(id); return u?.how === 'occupied' ? [u.body] : [];
  }
  /** F1: the ledger lists `sit:here` before the world profile adds god-built seats, so it says "no free seat within
   *  30 m" beside free benches. Point it at the nearest free god-built seat instead (the same plan as its sit:<id>). */
  private sitHere(caps: EdgeCapability[], plans: Map<string, { label: string; steps: { verb: string; params: Record<string, unknown> }[]; seconds?: boolean }>, here: Vec2) {
    const i = caps.findIndex((c) => c.id === 'sit:here'); if (i < 0 || caps[i].target && caps[i].available) return;
    const ents = this.engine.world.entities;
    const best = caps.filter((c) => c.verb === 'sit' && c.id !== 'sit:here' && c.available && c.target && ents[c.target.id]?.tags?.includes('entity-world') && plans.has(c.id))
      .map((c) => ({ c, d: Math.hypot(ents[c.target!.id].pose.p[0] - here[0], ents[c.target!.id].pose.p[2] - here[1]) })).filter((x) => x.d <= 30).sort((a, b) => a.d - b.d || (a.c.id < b.c.id ? -1 : 1))[0];
    if (!best) return;
    const plan = plans.get(best.c.id)!;
    const { blocked: _blocked, ...hereCap } = caps[i];
    caps[i] = { ...hereCap, label: `Sit down on the nearest free seat (${best.c.label.replace(/^Sit on /, '')})`, target: best.c.target, available: true };
    plans.set('sit:here', { label: 'Sit down', steps: structuredClone(plan.steps), seconds: true });
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
