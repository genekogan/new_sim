// Stage B (lane B-facade, item 6): the read worker's world. Fed the same WorldInit / WorldDelta stream as B-delta's
// Replica (plus this lane's `menu` section, split/verdict-pump.ts), it holds (a) the replicated plain state, (b) B-spatial's
// SpatialReplica built from the engine's static scene export and the replicated bodies, (c) the verdict table, and
// answers the Soul read code as a `ReplicaMenuWorld` (split/menu-world.ts). Never touches an engine.
import type {ProgramAction, RuntimeView} from '@sim/engine-contract';
import type {WorldState as NativeWorld} from '../../../../mars/viewer/engine/world/types.ts';
import type {StaticExportV1} from '../../../../mars/viewer/engine/spatial/service.ts';
import type {TileRect} from '../../../../mars/viewer/engine/spatial/tiled.ts';
import {Replica, type Ent, type WorldDelta, type WorldInit} from './read-model.ts';
import {SpatialReplica, type FixtureRow, type ReplicaBody} from './spatial-replica.ts';
import {ReplicaMenuWorld, VerdictTable, type ActionRow, type MenuDelta, type MenuInit, type MenuStatics, type RecordRow} from './menu-world.ts';

type MenuWire = {menu?: MenuInit};
type MenuDeltaWire = {menu?: MenuDelta};
const bodyOf = (e: Ent): ReplicaBody => ({id: e.id, x: e.pose.p[0], y: e.pose.p[1], z: e.pose.p[2], level: (e.human?.level as number | undefined) ?? 0, human: true});

export class ReplicaWorld {
  readonly R = new Replica();
  readonly verdicts = new VerdictTable();
  spatial: SpatialReplica | null = null;
  readonly mw: ReplicaMenuWorld;
  private ents: Record<string, Ent> = {};
  private actions = new Map<string, ActionRow>();
  private records = new Map<string, RecordRow & {params: Record<string, unknown>; history?: {tick: number; status: string}[]}>();
  private statics: MenuStatics = {regions: {}, navV1: null, rulesVersion: '', verbs: [], anchors: []};
  kernel: unknown = null;
  /** a pump's menu section has been seen (main runs a VerdictPump) */
  private pumped = false;
  private sceneKey = '';
  private worldView: NativeWorld;
  private runtimeView: RuntimeView;
  /** One per init/apply: the time and what changed (cost in the worker). */
  readonly cost = {inits: 0, applies: 0, refused: 0, spatialBuilds: 0, spatialRebuilds: 0};

  constructor() {
    const self = this;
    this.worldView = {get tick() {return self.R.pos.tick;}, get entities() {return self.ents;}, get regions() {return self.statics.regions;},
      get navV1() {return self.statics.navV1;}, get env() {return self.R.env;}} as unknown as NativeWorld;
    const records = this.records as unknown as RuntimeView['records'];
    this.runtimeView = {get tick() {return self.R.pos.tick;}, records, violations: [], liveIds: () => [...this.records.values()].filter(r => r.live).map(r => r.id)};
    // the spatial reads are bound late (the replica is rebuilt when the static scene moves): forward through `this.spatial`
    const sp = new Proxy({}, {get: (_t, k) => {const s = this.spatial as unknown as Record<string | symbol, unknown> | null; const f = s?.[k]; return typeof f === 'function' ? (f as (...a: unknown[]) => unknown).bind(s) : undefined;}});
    const spatialNames = ['readPassV1', 'staticEpochV1', 'navEpochV1', 'navWarmV1', 'navCheckV1', 'navNearestMainV1', 'clearanceAtV1', 'clearanceUpToV1', 'nearestStandableV1',
      'standableNearV1', 'clearSpotsV1', 'dryGroundAtV1', 'lyingRoomAtV1', 'standYAtV1', 'nativeSeatLevelsV1'] as const;
    const spatial: Record<string, unknown> = {};
    for (const k of spatialNames) spatial[k] = (...a: unknown[]) => {const f = (sp as Record<string, unknown>)[k]; if (typeof f !== 'function') throw new Error(`replica: no spatial service yet (${k})`); return (f as (...x: unknown[]) => unknown)(...a);};
    this.mw = new ReplicaMenuWorld({
      world: () => this.worldView, runtime: () => this.runtimeView,
      // the pump's action rows are complete every tick (B-delta's ProgramRow is re-read only when a tick names the body)
      programOf: actor => this.pumped ? this.actions.get(actor)?.programId ?? null : this.R.programs.get(actor)?.[1] ?? null,
      programAction: pid => this.programAction(pid),
      statics: {get rulesVersion() {return self.statics.rulesVersion;}, get verbs() {return self.statics.verbs;}, anchors: () => structuredClone(this.statics.anchors),
        get newcomer() {return self.statics.newcomer;}, get deliveries() {return self.statics.deliveries;}},
      carriers: () => this.R.carrierRows().map(c => {const e = this.ents[c.id]; return {...c, pose: {p: [...e.pose.p], yaw: e.pose.yaw}};}),
      spatial: spatial as never, verdicts: this.verdicts,
    });
  }
  private programAction(pid: string): ProgramAction | null {
    for (const a of this.actions.values()) if (a.programId === pid && a.action) return {tick: a.tick, programId: a.programId, actor: a.actor, step: a.step, action: {...a.action} as ProgramAction['action']};
    return null;
  }
  private fixture = (id: string): FixtureRow | undefined => {const o = this.ents[id] as (Ent & {support?: {kind?: string}; level?: number}) | undefined; return o ? {id, def: String(o.def), kind: String(o.kind), ...(o.support?.kind ? {support: o.support.kind} : {}), ...(typeof o.level === 'number' ? {level: o.level} : {}), y: o.pose.p[1]} : undefined;};
  private humans(): ReplicaBody[] {const out: ReplicaBody[] = []; for (const e of Object.values(this.ents)) if (e.kind === 'human') out.push(bodyOf(e)); return out;}
  private syncSpatial() {
    const R = this.R;
    if (R.sceneKey !== this.sceneKey && R.scene) {
      this.sceneKey = R.sceneKey;
      if (!this.spatial) {this.spatial = SpatialReplica.fromStaticScene(R.scene as StaticExportV1, this.humans(), {fixture: this.fixture}); this.cost.spatialBuilds++;}
      else {this.spatial.rebuild(R.scene as StaticExportV1); this.cost.spatialRebuilds++;}
    }
    if (this.spatial) {this.spatial.applyPages((R.pages as TileRect[] | null) ?? null); this.spatial.applyNavReady(R.navReady);}
  }
  private setRecord(r: RecordRow) {const history = r.runningTick !== undefined ? [{tick: r.runningTick, status: 'running'}] : []; this.records.set(r.id, {...r, history});}
  private applyMenu(m: MenuDelta | MenuInit | undefined, whole: boolean) {
    if (!m) return;
    this.pumped = true;
    if (whole) {this.actions.clear(); this.records.clear(); this.verdicts.clear();}
    for (const a of m.actions ?? []) this.actions.set(a.actor, a);
    for (const id of (m as MenuDelta).actionsGone ?? []) this.actions.delete(id);
    for (const r of m.records ?? []) this.setRecord(r);
    for (const id of (m as MenuDelta).recordsGone ?? []) this.records.delete(id);
    if (m.verdicts?.length) this.verdicts.apply(m.verdicts);
    if (m.statics) this.statics = {...m.statics};
    const k = whole ? (m as MenuInit).statics.kernel : (m as MenuDelta).kernel;
    if (k !== undefined) this.kernel = k;
  }
  init(w: WorldInit & MenuWire) {
    this.R.init(w); this.ents = Object.fromEntries(this.R.entities); this.cost.inits++;
    this.applyMenu(w.menu, true);
    this.sceneKey = ''; this.spatial = null; this.syncSpatial();
  }
  /** False (nothing applied): not the next delta; re-init. */
  apply(d: WorldDelta & MenuDeltaWire): boolean {
    if (!this.R.apply(d)) {this.cost.refused++; return false;}
    this.cost.applies++;
    for (const e of d.ents ?? []) this.ents[e.id] = this.R.entities.get(e.id)!;
    for (const id of d.gone ?? []) delete this.ents[id];
    this.applyMenu(d.menu, false);
    if (this.spatial) {
      const changed: ReplicaBody[] = [];
      for (const b of d.bodies ?? []) {const e = this.ents[b[0]]; if (e?.kind === 'human') changed.push(bodyOf(e));}
      for (const e of d.ents ?? []) if (e.kind === 'human') changed.push(bodyOf(e));
      this.spatial.applyBodies({bodies: changed, gone: d.gone});
    }
    this.syncSpatial();
    return true;
  }
}
