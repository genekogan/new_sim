import {edenGroundTransitionV1Schema,type EdenGroundTransitionV1} from '@sim/engine-contract';
import type {EdenGroundReaderV1} from './eden-ground.ts';
import {readClassroom} from '../../../mars/viewer/engine/activities/classroom.ts';
import {edenLectureV1} from './eden-lecture.ts';
import {edenLectureTransitionV1Schema,type EdenLectureTransitionV1,type EdenLecturePlacementV1} from '@sim/engine-contract';
import {nativeSleepSnapshotPolicyV1Schema,type NativeSleepSnapshotPolicyV1} from '@sim/engine-contract';
import {NATIVE_SLEEP_SNAPSHOT_V1} from '../../../mars/viewer/engine/activities/sleep.ts';
import {commonsNewcomerResourcesV1} from './newcomer-resources.ts';
import {newcomerResourcesPublicV1Schema,commonsNewcomerResourcesV1Schema,type CommonsNewcomerResourcesV1,type NewcomerResourcePlacementV1} from '@sim/engine-contract';
import {existingGreenLandmarkV1} from './green-landmark.ts';
import {existingGreenLandmarkTransitionV1Schema,type ExistingGreenLandmarkTransitionV1} from '@sim/engine-contract';
import {fixtureSlots} from '../../../mars/viewer/engine/social/slots.ts';
import {angleDelta} from '../../../mars/viewer/engine/core/math.ts';
import {commonsFoodDeliveryItemsV1} from './food-delivery.ts';
import {commonsFoodDeliveryV1Schema,type CommonsFoodDeliveryV1} from '@sim/engine-contract';
import {socialEdenV1} from './social-eden.ts';
import {socialEdenTransitionV1Schema,type SocialEdenTransitionV1} from '@sim/engine-contract';
// The Mars engine behind Sim's engine contract.
//
// The shell speaks a small BODY LANGUAGE (walk_to, sit, stand, rest, wave,
// converse, gather, perform, ambient_wander): what one actor's body does. This
// adapter lowers each of those to Mars verbs, runs an actor's steps one after
// another, and reports progress. Raw Mars verbs are also reachable, as
// `mars:<verb>`, for vocabulary that belongs to a Mars world (serve, eat, carry…).
//
// Three rules it enforces, which the Mars runtime leaves to its caller:
//  1. One actor, one program. A step that moves the body first releases whatever
//     held that actor (a seat, a circle); one that only waits keeps it.
//  2. Joint staging is borrowed. A Mars verb that takes several actors (converse)
//     borrows the others' bodies only while they are free; their own program takes
//     them back at any time, and the borrower treats that as the scene ending.
//  3. Feasibility is asked first (verb.plan), because in Mars even a refused
//     instruction pulls a person out of what they were doing.
import { hashOf, physicalView, type ActionRecord, type ActivityOption, type Anchor, type ChangeEvent, type Engine, type EngineFactory, type EngineSnapshot, type PathCommit, type PoseSample, type Program, type ProgramEvent, type RuntimeEvent, type RuntimeView, type Vec3, type VerbInfo, type WorldState } from '@sim/engine-contract';
import { loadMars, type Mars } from './load.ts';
import type {CampExpansionReader} from './camp-expansion.ts';
import {campExpansionV1Schema,type CampExpansionV1,type CampExpansionAdmissionV1} from '@sim/engine-contract';
import { CodecError } from '../../../mars/viewer/engine/runtime/codec.ts';
import { constructionPlan, unsafeConstruction, type BuildPhase } from './construction.ts';
import { disassemblyPlan, DISASSEMBLY_POLICY } from './disassembly.ts';
import { disassemblyRegistry } from '../../../mars/viewer/engine/construction/disassembly.ts';
import { captureRenderScene, commonsSceneMetadataV1Schema, type RenderSceneCaptureV1, type RenderScene } from '@sim/engine-contract';
import {readLocalClassroomV1} from './classroom-observation.ts';
import { readNativeGathering } from './gathering-observation.ts';
import { prepareCommonsTransition } from './commons-transition.ts';
import { commonsTransitionV1Schema,type CommonsTransitionV1,type CommonsTransitionAdmissionV1 } from '@sim/engine-contract';
import {crewRemovalTransitionV1Schema,type CrewRemovalTransitionV1,type CrewRemovalTransitionAdmissionV1} from '@sim/engine-contract';
import {commonsProvisions,COMMONS_PERSONAL_RESOURCES} from './commons-provisions.ts';
import {commonsKitchen,COMMONS_KITCHENS,type CommonsKitchenVersion} from './commons-kitchen.ts';
import type {RetainedCommonsShoreReader} from './retained-shore.ts';
import {retainedCommonsShoreV1Schema,type RetainedCommonsShoreV1,type RetainedCommonsShoreAdmissionV1} from '@sim/engine-contract';
import { decodeSnapshot } from '../../../mars/viewer/engine/runtime/snapshot.ts';
import {encode} from '../../../mars/viewer/engine/runtime/codec.ts';
import { dcos,dsin,hypot } from '../../../mars/viewer/engine/core/math.ts';
import { clearanceAt } from '../../../mars/viewer/engine/spatial/grid.ts';
import { acknowledgeRelocation } from '../../../mars/viewer/engine/runtime/invariants.ts';
import { HUMAN_RADIUS } from '../../../mars/viewer/engine/world/catalog.ts';
import type { Spatial } from '../../../mars/viewer/engine/spatial/service.ts';
import type {NativeBoatControlsV1} from '@sim/engine-contract';
import type {BodyLocationV1} from '@sim/engine-contract';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TPS = 20;
const KEY_EVERY = 5;                       // ticks between broadcast keyframes for a moving body (4 per second)
const SETTLED = new Set(['gathered', 'occupied', 'talking']); // phases in which a Mars hold has arrived and simply continues
const RELEASE_TIMEOUT = 15 * TPS;          // how long a program waits for its actor to be let go
const KEEP_RECORDS = 120 * TPS;            // finished Mars action records are kept this long, then forgotten
const SNAPSHOT_FORMAT = 'sim-mars-snapshot/1';

type Diag = { code: string; message: string };
type Op = { verb: string; params: Record<string, unknown>; settle: 'done' | 'held'; soft?: boolean; raw?: boolean } | { wait: number };
type Prog = {
  id: string; actor: string; label: string; steps: Program['steps'];
  index: number; started: boolean; since: number;
  blockedSince?: number;
  quietHeldSince?: number;
  stairHeldSince?: number;
  spreadWaits?: number;
  walkStopping?: Diag;
  stopping?: Diag;
  ops: Op[]; action?: string; settle?: 'done' | 'held'; soft?: boolean; until?: number;
  controlOf?:string;
  readiedActors?:string[];
  build?: { phase: BuildPhase; crew: string[]; stopping?: Diag; reverse?: true };
};
export type MarsWorldConfig = { disassemblyV1?:boolean; spreadV2?:boolean; yieldTimeoutV1?:boolean; quietStallReleaseV1?:boolean; stairMakeWayV1?:boolean; walkBlockV1?:boolean; safeArrivalV1?:boolean; commonsArrivalV1?:boolean; commonsTransitionV1?:boolean; fixtureGroundGoalsV1?:boolean; nativeArrivalWitnessV1?:boolean; quietLandingCourtesyV1?:boolean; scene: 'proving-ground' | 'meal' | 'eden-camp' | 'littlemartians' | 'greenfield' | 'eden-commons'; clock?: { origin: number; dayTicks: number }; sleepBlockTicks?:number; quietSeatCourtesy?:boolean; safeCrewRemoval?:boolean; arrival: [number, number]; arrivalPlace: string; reference: [number, number]; grounds: { id: string; name: string } };
export const LITTLE_MARTIANS_WORLD: MarsWorldConfig={scene:'littlemartians',arrival:[0,18],arrivalPlace:'garden',reference:[0,16],grounds:{id:'grounds',name:'Ceramic garden'}};
export const GREEN_FIELD_WORLD:MarsWorldConfig={scene:'greenfield',arrival:[0,0],arrivalPlace:'field',reference:[2,0],grounds:{id:'grounds',name:'Green field'}};
export const EDEN_COMMONS_WORLD:MarsWorldConfig={scene:'eden-commons',arrival:[14,4],arrivalPlace:'commons',reference:[9,5],grounds:{id:'grounds',name:'Eden commons'}};
export const EDEN_SAFE_COMMONS_WORLD:MarsWorldConfig={...EDEN_COMMONS_WORLD,safeArrivalV1:true};
const PROVING_GROUND: MarsWorldConfig = { scene: 'proving-ground', arrival: [-24, -10.5], arrivalPlace: 'lawn', reference: [-24, -8], grounds: { id: 'grounds', name: 'the grounds' } };

const secs = (v: unknown, d: number) => Math.round(Math.min(3600, Math.max(0.5, typeof v === 'number' ? v : d)) * TPS);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = { type: 'number' }, str = { type: 'string' };
const ref = { anyOf: [str, { type: 'array', items: num, minItems: 2, maxItems: 2 }] };
/** The body language, as the card grammar and agents see it. The actor is always implied. */
export const BODY_VERBS: VerbInfo[] = [
  {verb:'activity_readiness_v1',description:'My bounded voluntary standing wait for one host and venue; only a matching owned classroom may hand over this wait.',inputSchema:{type:'object',properties:{host:{type:'string'},venue:{type:'string'},activity:{const:'classroom'},seconds:{type:'number',minimum:20,maximum:300}},required:['host','venue','activity','seconds'],additionalProperties:false}},
  {verb:'control_classroom_v1',description:'Apply an owned host control to its actual classroom without replacing its body programme; accepted control is not completed cleanup.',inputSchema:{type:'object',properties:{session:{type:'string',maxLength:80},kind:{enum:['cancel','advance']}},required:['session','kind'],additionalProperties:false}},
  { verb: 'build_lookout', description: 'Choose one finite camp construction job: stage carries rack parts to the build site; frame raises/connects/releases the uprights; deck installs joists/sheets; stairs completes access. Use the exact unprefixed verb build_lookout, target:null, approach:[], and a single during step with phase. The card sets only $actor.doing; physical part progress is maintained by the engine, never invented target states or permission links. The committed crew finishes a safe segment before interruption.', inputSchema: {type:'object',properties:{phase:{type:'string',enum:['stage','frame','deck','stairs']}},required:['phase']} },
  { verb: 'walk_to', description: 'Walk to a thing or a point, stopping `standoff` metres short of it.', inputSchema: { type: 'object', properties: { to: ref, standoff: num }, required: ['to'] } },
  { verb: 'sit', description: 'Go to a free seat of a fixture (a bench, a chair) and sit there for a number of seconds; stays seated afterwards.', inputSchema: { type: 'object', properties: { on: str, seconds: num }, required: ['on'] } },
  { verb: 'stand', description: 'Stand up, leaving a seat or a place in a gathering.', inputSchema: { type: 'object', properties: {} } },
  { verb: 'rest', description: 'Stay as you are (seated if sitting) for a number of seconds.', inputSchema: { type: 'object', properties: { seconds: num, seatedAt:str } } },
  { verb: 'wave', description: 'Turn to face someone or something for a moment.', inputSchema: { type: 'object', properties: { at: str, seconds: num } } },
  { verb: 'converse', description: 'Stand in conversation with a nearby person for a number of seconds.', inputSchema: { type: 'object', properties: { with: str, seconds: num }, required: ['with'] } },
  { verb: 'gather', description: 'Take a place at a fixture (a campfire, a bench) or in a place with an audience layout, and stay for a number of seconds.', inputSchema: { type: 'object', properties: { at: str, seconds: num }, required: ['at'] } },
  { verb: 'perform', description: 'Perform where you stand for a number of seconds.', inputSchema: { type: 'object', properties: { what: str, seconds: num } } },
  { verb: 'ambient_wander', description: 'Stroll between nearby points, pausing, for a number of seconds within a radius in metres.', inputSchema: { type: 'object', properties: { seconds: num, radius: num } } },
];
const BODY = new Set(BODY_VERBS.map((v) => v.verb));
/** Offered only by an engine whose rules include disassembly/1 (never by the legacy body language). */
export const UNBUILD_VERB: VerbInfo = { verb: 'unbuild_lookout', description: 'Choose one finite camp disassembly job, the build in reverse: stairs takes the treads and flight down; deck lifts the sheets and joists off and carries them back to their piles; frame holds the uprights, takes the beams out and lowers the uprights; stage carries the rack parts back to the rack pile. Phases come down latest first (stairs, deck, frame, stage). Use the exact unprefixed verb unbuild_lookout, target:null, approach:[], and a single during step with phase. Refused while anyone is on the lookout. The committed crew finishes a safe segment before interruption.', inputSchema: {type:'object',properties:{phase:{type:'string',enum:['stairs','deck','frame','stage']}},required:['phase']} };
const NEEDS_BODY = new Set(['walk_to', 'sit', 'gather', 'converse', 'ambient_wander']);
/** Mars's meal scenario as a world: the same proving ground, furnished and with its cast of four already there. */
export const MEAL_WORLD: MarsWorldConfig = { scene: 'meal', arrival: [-6, -12], arrivalPlace: 'lawn', reference: [-6, -10.5], grounds: { id: 'grounds', name: 'the grounds' } };

const inPoly = (x: number, z: number, poly: [number, number][]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const bucket = (m: number): 'here' | 'close' | 'near' | 'far' => (m < 2.5 ? 'here' : m < 9 ? 'close' : m < 28 ? 'near' : 'far');

/** Fresh physical bases use an explicit native binding; legacy factories omit it. */
export type MarsPhysicalBinding = {rulesVersion:string;renderScene:()=>RenderScene;restore:(snapshot:any)=>any;services:(world:any)=>any;prepareRemoval?:(runtime:any,id:string)=>boolean;boatControls?:(runtime:any,actor:string)=>NativeBoatControlsV1|null;bodyLocation?:(runtime:any,actor:string)=>BodyLocationV1|null};
export class MarsEngine implements Engine {
  get nativeArrivalWitnessEnabledV1(){return this.cfg.nativeArrivalWitnessV1===true;}
  readonly dt = 1 / TPS;
  readonly schema: string;
  private composedRules(base:string,change?:{provisions?:boolean;kitchen?:CommonsKitchenVersion|null;food?:boolean;social?:boolean;green?:boolean}){const provisions=change?.provisions??this.commonsProvisionsActive,kitchen=change&&'kitchen' in change?change.kitchen:(this.commonsKitchenActive?this.commonsKitchenVersion:null),food=change?.food??!!this.foodDeliveries.length,social=change?.social??this.socialEdenActive,green=change?.green??this.greenLandmarkActive;return base+(provisions?(this.newcomerResources.length?'+cp/2':'+commons-provisions/1'):'')+(kitchen?'+'+kitchen:'')+(food?'+fd/1':'')+(social?'+social-eden/1':'')+(green?'+g/1':'')+(this.lecturePlacement?'+l/1':'')+(this.sleepSnapshotActive?'+ss/1':'');}
  get rulesVersion(){return this.composedRules(nativeRulesVersion(this.physical?.rulesVersion??this.m.rulesVersion,this.cfg));}
  readonly runtime: RuntimeView;
  private m: Mars; private rt: any; private cfg: MarsWorldConfig;
  private physical?:MarsPhysicalBinding;
  private feasibilityRead?:Map<string,Diag|null>;
  private campExpansionReader?:CampExpansionReader;
  private registry: Map<string, any>;
  private programs = new Map<string, Prog>();
  private byActor = new Map<string, string>();
  private nextProg = 1;
  private cursor = 0;
  private keys = new Map<string, PoseSample>();      // last broadcast keyframe per body
  private acts = new Map<string, string>();          // last broadcast activity per body
  private ons = new Map<string, string | null>();
  private leaving: string[] = [];                    // bodies to remove once nothing holds them
  private out: { paths: PathCommit[]; changes: ChangeEvent[]; programs: ProgramEvent[] } = { paths: [], changes: [], programs: [] };
  private recorder: any;
  private readerRecordingDepth=0;
  private recorderScene!: RenderSceneCaptureV1;
  private renderBaseKey = '';
  private takeScenes = new Map<string,RenderSceneCaptureV1>();
  private quiet = false;
  private crewRemovalTransitionReader=false;
  private foodDeliveryReader=false;
  private foodDeliveries:CommonsFoodDeliveryV1[]=[];
  private edenGroundReader?:EdenGroundReaderV1;
  private lectureReader=false;
  private lecturePlacement?:EdenLecturePlacementV1;
  private socialEdenReader=false;
  private socialEdenActive=false;
  private greenLandmarkReader=false;
  private greenLandmarkActive=false;
  private retainedShoreReader?:RetainedCommonsShoreReader;
  private commonsKitchenReaderVersion:CommonsKitchenVersion='commons-kitchen/1';
  private commonsKitchenVersion:CommonsKitchenVersion='commons-kitchen/1';
  private commonsKitchenReader=false;
  private commonsKitchenActive=false;
  private sleepSnapshotReader=false;
  private sleepSnapshotActive=false;
  private newcomerReader=false;
  private newcomerResources:CommonsNewcomerResourcesV1[]=[];
  private commonsProvisionsReader=false;
  private commonsProvisionsActive=false;
  private chunks: { fromTick: number; toTick: number; take: unknown }[] = [];

  constructor(m: Mars, rt: any, cfg: MarsWorldConfig, saved?: { programs: Prog[]; nextProg: number; leaving: string[] }, physical?:MarsPhysicalBinding) {
    this.m = m; this.rt = rt; this.cfg = structuredClone(cfg); this.registry = rt.registry;this.physical=physical;
    this.schema = rt.world.schema;
    if (saved) { for (const p of saved.programs) { this.programs.set(p.id, p); this.byActor.set(p.actor, p.id); } this.nextProg = saved.nextProg; this.leaving = saved.leaving; }
    this.cursor = rt.events.length;
    this.startRecorder();
    const self = this;
    this.runtime = {
      get tick() { return self.rt.tick as number; },
      get records() { return self.rt.records as Map<string, ActionRecord>; },
      get violations() { return self.rt.violations as { tick: number; code: string; message: string }[]; },
      liveIds: () => [...(self.rt.records as Map<string, any>).values()].filter((r) => self.rt.isActive(r.id)).map((r) => r.id as string).sort(),
    };
  }

  get world(): WorldState { return this.rt.world as WorldState; }
  private get ents(): Record<string, any> { return this.rt.world.entities; }
  describeVerbs(): VerbInfo[] {
    return [...BODY_VERBS, ...(this.cfg.disassemblyV1?[UNBUILD_VERB]:[]), ...this.m.describeVerbs(this.registry).map((v) => ({ ...v, verb: `mars:${v.verb}`, description: `[Mars verb] ${v.description}`, scope: 'world' as const }))];
  }
  /** The world plus the adapter's own state (which program each actor is in), since both decide what happens next. */
  stateHash(): string { return hashOf({ ...(this.lecturePlacement?{lecturePolicy:this.lecturePlacement}:{}), ...(this.sleepSnapshotActive?{sleepSnapshotPolicy:NATIVE_SLEEP_SNAPSHOT_V1}:{}), ...(this.newcomerResources.length?{newcomerResources:this.newcomerResources}:{}), w: this.rt.stateHash(), p: [...this.programs.values()], l: this.leaving, clock: this.cfg.clock ?? null, quiet: this.quiet, ...(this.cfg.safeCrewRemoval?{removalPolicy:'crew-removal/1'}:{}), ...(this.cfg.disassemblyV1?{disassemblyPolicy:DISASSEMBLY_POLICY}:{}), ...(this.cfg.fixtureGroundGoalsV1?{fixtureGoalPolicy:'ground-fixture-levels/1'}:{}), ...(this.cfg.nativeArrivalWitnessV1?{arrivalWitnessPolicy:'native-navigation-arrival/1'}:{}), ...(this.cfg.quietLandingCourtesyV1?{quietLandingPolicy:'idle-landing-courtesy/1'}:{}), ...(this.commonsProvisionsActive?{provisionsPolicy:'commons-provisions/1'}:{}), ...(this.commonsKitchenActive?{kitchenPolicy:this.commonsKitchenVersion}:{}), ...(this.greenLandmarkActive?{greenLandmarkPolicy:'existing-green-landmark/1'}:{}), ...(this.socialEdenActive?{socialPolicy:'social-eden/1'}:{}), ...(this.foodDeliveries.length?{foodDeliveryPolicy:'commons-food-delivery/1',foodDeliveries:this.foodDeliveries}:{}), ...(this.cfg.safeArrivalV1?{arrivalPolicy:'arrival-clearance/1'}:{}), ...(this.cfg.walkBlockV1?{walkPolicy:'walk-block/1'}:{}), ...(this.physical?{physicalBinding:this.physical.rulesVersion,physicalPolicy:this.cfg}:{}) }); }
  physicalHash(): string { return hashOf(physicalView(this.world)); }

  // ------------------------------------------------------------------ tick
  step() {
    this.rt.step();
    this.updateClock();
    if (this.rt.tick % 10 === 0) this.updateAttention();
    if (this.quiet) this.advanceQuiet();
    const tick: number = this.rt.tick;
    for (const p of [...this.programs.values()]) this.advance(p);
    if (tick - this.recorder.startTick >= 20) {
      this.finishRecorder();
      this.startRecorder();
    }
    if (this.leaving.length) this.leaving = this.leaving.filter((id) => !this.tryRemove(id));
    // What changed, for broadcast: an activity change is an event; movement is a keyframe every KEY_EVERY ticks.
    for (const id of Object.keys(this.ents)) {
      const e = this.ents[id]; if (e.kind !== 'human') continue;
      const act: string = e.human.activity;
      if (this.acts.get(id) !== act) { this.acts.set(id, act); this.out.changes.push([tick, id, 'activity', act]); }
      const on: string | null = e.human.on ?? null;
      if ((this.ons.get(id) ?? null) !== on) { this.ons.set(id, on); this.out.changes.push([tick, id, 'on', on]); }
      if (tick % KEY_EVERY !== 0 && this.keys.has(id)) continue;
      const now = this.poseSampleOf(id), last = this.keys.get(id);
      if (last && (last[1] !== now[1] || last[3] !== now[3] || last[4] !== now[4])) this.out.paths.push({ entity: id, startTick: last[0], speed: 0, waypoints: [last, now], activity: act, actionId: e.human.task ?? '' });
      this.keys.set(id, now);
    }
    const events = this.rt.events.slice(this.cursor) as RuntimeEvent[];
    const out = { ...this.out, events };
    this.out = { paths: [], changes: [], programs: [] };
    // Bound memory. Mars keeps every event and record for ever, which suits a bounded rehearsal and not a world that never stops.
    if (this.rt.events.length > 20000) this.rt.events.splice(0, this.rt.events.length - 1000);
    this.cursor = this.rt.events.length;
    if (tick % 600 === 0) {
      const parents = new Set<string>(); for (const r of this.rt.records.values()) if (r.parent && this.rt.isActive(r.id)) parents.add(r.parent);
      for (const [id, r] of this.rt.records) if (r.endedTick !== undefined && r.endedTick < tick - KEEP_RECORDS && !parents.has(id)) this.rt.records.delete(id);
    }
    return out;
  }

  private emit(p: Prog, kind: ProgramEvent['kind'], d?: Diag) {
    this.out.programs.push({ tick: this.rt.tick, id: p.id, actor: p.actor, kind, step: kind === 'step' ? p.index : -1, ...(d ? { code: d.code, message: d.message } : {}) });
  }
  private end(p: Prog, kind: 'completed' | 'failed' | 'cancelled', d?: Diag) {
    if (p.build && kind === 'failed' && unsafeConstruction(this.rt.world)) throw new Error(`construction.unsafe-failure: ${d?.code}: ${d?.message}; restore the accepted quiet baseline`);
    if (p.build?.stopping && kind === 'completed') { kind = 'cancelled'; d = p.build.stopping; }
    this.programs.delete(p.id); if (this.byActor.get(p.actor) === p.id) this.byActor.delete(p.actor);
    this.emit(p, kind, d);
  }
  private holders(actor: string): string[] { return this.rt.holder(`actor:${actor}`) as string[]; }
  /** Ask whatever holds this actor to let go. Returns true once nothing does (a seated person takes a moment to stand). */
  private release(actor: string, why: Diag): boolean {
    for (const h of this.holders(actor)) this.rt.cancel(h, { code: why.code, message: why.message });
    return this.holders(actor).length === 0;
  }

  /** Move a program forward as far as it can go this tick. */
  private advance(p: Prog) {
    const tick: number = this.rt.tick;
    if(p.stopping){
      if(p.action&&this.rt.isActive(p.action)){this.rt.cancel(p.action,p.stopping);return;}
      return this.end(p,'cancelled',p.stopping);
    }
    for (let guard = 0; guard < 12; guard++) {
      if (!this.ents[p.actor]) return this.end(p, 'cancelled', { code: 'actor.removed', message: 'the actor is gone' });
      if (!p.started) {
        // A program whose first step moves the body first leaves whatever seat, circle or borrowed conversation holds it.
        // One that only waits, turns, or uses this world's own verbs (eating while seated) keeps what it has.
        if (NEEDS_BODY.has(p.steps[0]?.verb) && !this.release(p.actor, { code: 'program.replaced', message: `replaced by ${p.label}` })) {
          if (tick - p.since > RELEASE_TIMEOUT) return this.end(p, 'failed', { code: 'actor.busy', message: 'the actor was not released in time' });
          return;
        }
        p.started = true; this.emit(p, 'step');
        const ops = this.lower(p, p.steps[0]); if (!Array.isArray(ops)) return this.end(p, 'failed', ops);
        p.ops = ops;
      }
      if (p.until !== undefined) { if (tick < p.until) return; p.until = undefined; }
      if (p.action) {
        const rec = this.rt.records.get(p.action);
        // stairMakeWayV1: a climber held on a flight by an idle person (no task of their own) at the landing
        // asks them to step aside through native make-way (spec §17, as floor walks already do), every 10 s.
        // Without it an idle body at a stair head holds the climber, and so the quiet barrier, forever.
        if (this.cfg.stairMakeWayV1 === true && rec && this.ents[p.actor]?.human?.activity === 'climb-wait' && rec.status === 'blocked') {
          p.stairHeldSince ??= tick;
          if (tick - p.stairHeldSince >= 200 && (tick - p.stairHeldSince) % 200 === 0) {
            const me = this.ents[p.actor]!;
            for (const s of rec.diagnostic?.subjects ?? []) if (s !== p.actor && this.stairYieldable(s)) this.m.makeWay(this.rt, s, [me.pose.p[0], me.pose.p[2]]);
          }
        } else p.stairHeldSince = undefined;
        // A timed-out walk can still own a between-level body. Preserve its
        // program until native cancellation actually reaches a safe landing.
        if (p.walkStopping) {
          if (rec && this.rt.isActive(rec.id)) { this.rt.cancel(rec.id, p.walkStopping); return; }
          return this.end(p, 'failed', p.walkStopping);
        }
        if (rec) {
          const walkBlocked = this.cfg.walkBlockV1 && (rec.verb === 'walk_to'||this.physical&&rec.verb==='commons_shore_travel');
          const routeBlocked = /deadlock\.|walk.goal-occupied/.test(rec.diagnostic?.code ?? '');
          // Native sleep retains a failed/directed-away purpose for an explicit
          // Resume in the finite Lab. A living card must instead report blockage
          // and let the Soul choose again, so it cannot hold the daily barrier.
          const sleepBlocked = this.cfg.sleepBlockTicks !== undefined && rec.verb === 'sleep' && /^sleep\./.test(rec.diagnostic?.code ?? '');
          // Opt-in quiet drain: a walk/seat approach whose body stays held waiting on other
          // people (status running, never 'blocked') would hold the quiet barrier forever.
          // Release it through native cancellation like the blocked-walk timeout.
          // yieldTimeoutV1 (edge reflex floor): the same release outside quiet after 60 s, so a yield never holds a receipt forever.
          const yieldLimit = this.quiet && this.cfg.quietStallReleaseV1 === true ? 600 : this.cfg.yieldTimeoutV1 === true ? 1200 : 0;
          const quietHeld = yieldLimit > 0 && ['walk_to','sit','take_slot','commons_shore_travel'].includes(rec.verb) && rec.status !== 'blocked' && this.rt.isActive(rec.id) && this.ents[p.actor]?.human?.activity === 'wait';
          if (quietHeld) {
            p.quietHeldSince ??= tick;
            if (tick - p.quietHeldSince > yieldLimit) {
              const why = {code:'route.blocked',message:this.quiet?'quiet checkpoint: this walk stayed held waiting on other people for 30 seconds':'this walk stayed held waiting on other people for a minute'};
              this.rt.cancel(rec.id, why);
              if (this.rt.isActive(rec.id)) { p.walkStopping = why; return; }
              if (this.spreadRetry(p, 'route.occupied')) { p.action = undefined; p.settle = undefined; p.soft = undefined; p.quietHeldSince = undefined; return; }
              return this.end(p, 'failed', why);
            }
          } else p.quietHeldSince = undefined;
          if (rec.status === 'blocked' && (walkBlocked || routeBlocked || sleepBlocked)) {
            p.blockedSince ??= tick;
            if (tick-p.blockedSince > (sleepBlocked ? this.cfg.sleepBlockTicks! : 1200)) {
              const why = walkBlocked ? {code:'route.blocked',message:`walking has remained blocked for a minute: ${rec.diagnostic?.code ?? 'action.blocked'}`} : routeBlocked ? {code:'route.blocked',message:'the route has remained blocked for a minute'} : {code:'activity.blocked',message:`sleep has remained blocked for a minute: ${rec.diagnostic?.code}`};
              this.rt.cancel(rec.id,why);
              if (walkBlocked && this.rt.isActive(rec.id)) { p.walkStopping = why; return; }
              if (walkBlocked && this.spreadRetry(p, 'route.occupied')) { p.action = undefined; p.settle = undefined; p.soft = undefined; p.blockedSince = undefined; return; }
              return this.end(p,'failed',why);
            }
          } else p.blockedSince = undefined;
          if (rec.status === 'failed' && this.spreadRetry(p, rec.diagnostic?.code)) { p.action = undefined; p.settle = undefined; p.soft = undefined; continue; }
          if (rec.status === 'failed') { if (!p.soft) return this.end(p, 'failed', { code: rec.diagnostic?.code ?? 'action.failed', message: rec.diagnostic?.message ?? 'failed' }); }
          else if (rec.status === 'cancelled') { if (!p.soft) return this.end(p, 'failed', { code: rec.diagnostic?.code ?? 'action.interrupted', message: rec.diagnostic?.message ?? 'interrupted' }); }
          else if (rec.status !== 'completed' && !(p.settle === 'held' && SETTLED.has(rec.phase))) return; // still under way
        }
        p.action = undefined; p.settle = undefined; p.soft = undefined;
      }
      const op = p.ops.shift();
      if (!op) {
        p.index++;
        if (p.index >= p.steps.length) return this.end(p, 'completed');
        this.emit(p, 'step');
        const ops = this.lower(p, p.steps[p.index]);
        if (!Array.isArray(ops)) {
          // A shared-space spread goal that is momentarily full or crossed by another body waits
          // in place and re-chooses (1 s, at most a minute) rather than failing the programme.
          const spread = String(p.steps[p.index]?.params?.spread ?? '');
          if (['pond/1','region/1','pond-lap/1'].includes(spread) && /occupied|region-full|goal-occupied/.test(ops.code) && (p.spreadWaits = (p.spreadWaits ?? 0) + 1) <= 60) { p.index--; p.ops = [{ wait: 20 }]; continue; }
          return this.end(p, 'failed', ops);
        }
        p.ops = ops; continue;
      }
      if ('wait' in op) { p.until = tick + op.wait; continue; }
      // Anything that needs the body free (all but standing up and raw Mars verbs, which know what they need) first leaves its seat or circle.
      if (op.verb !== 'stand' && !op.raw && this.holders(p.actor).length) {
        if (op.verb === 'face') continue;                                        // not worth standing up for
        if (!this.release(p.actor, { code: 'program.next-step', message: 'moving on' })) { p.ops.unshift(op); return; }
      }
      if (op.verb === 'shared_food_break') {
        for (const participant of (op.params.participants ?? []) as {actor:string}[]) {
          if (participant.actor === p.actor) continue;
          const invitation = this.byActor.get(participant.actor), host = invitation ? this.programs.get(invitation) : undefined;
          if (host?.label.startsWith('host supper ') && this.holders(participant.actor).length === 0) this.stop(host.id);
        }
      }
      const rec = this.rt.submit(op.verb, op.params);
      if (rec.status === 'failed' && !op.soft && this.spreadRetry(p, rec.diagnostic?.code)) continue;
      if (rec.status === 'failed') { if (op.soft) continue; return this.end(p, 'failed', { code: rec.diagnostic?.code ?? 'action.failed', message: rec.diagnostic?.message ?? 'refused' }); }
      p.action = rec.id; p.settle = op.settle; p.soft = op.soft;
    }
  }

  // ------------------------------------------------------------------ lowering
  private pos(id: string): [number, number] | null { const e = this.ents[id]; return e ? [e.pose.p[0], e.pose.p[2]] : null; }
  private pointOf(to: unknown): [number, number] | null {
    if (Array.isArray(to) && typeof to[0] === 'number' && typeof to[1] === 'number') return [to[0], to[1]];
    if (typeof to !== 'string') return null;
    const p = this.pos(to); if (p) return p;
    const r = this.rt.world.regions[to]; if (r) return centroid(r.polygon);
    return null;
  }
  private plan(verb: string, params: unknown): Diag | null {
    const def = this.registry.get(verb); if (!def) return { code: 'action.unknown-verb', message: `no action verb "${verb}"` };
    const parsed = def.schema.safeParse(params); if (!parsed.success) return { code: 'action.invalid-params', message: parsed.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ') };
    const body=this.m.admitFloaters(verb,parsed.data,(id:string)=>this.ents[id]?.body);
    if(body.status==='refuses')return {code:body.reason,message:body.note};
    const r = def.plan(this.rt, parsed.data);
    return r.ok ? null : { code: r.diagnostic.code, message: r.diagnostic.message };
  }
  /** A reachable standing point `standoff` metres from a target, on the side the actor comes from if possible. 'here' if already there. */
  private goalNear(actor: string, to: unknown, standoff: number): { x: number; z: number; level: number } | 'here' | Diag {
    const me = this.pos(actor)!, t = this.pointOf(to);
    if (!t) return { code: 'target.unknown', message: `nothing to walk to: ${JSON.stringify(to)}` };
    const level = typeof to === 'string' ? (this.rt.world.regions[to]?.level ?? this.ents[to]?.human?.level ?? (this.cfg.fixtureGroundGoalsV1&&this.ents[to]?.support?.kind==='ground'?0:this.ents[actor].human.level)) : this.ents[actor].human.level;
    const dx = me[0] - t[0], dz = me[1] - t[1], d = Math.hypot(dx, dz);
    const isBody = typeof to === 'string' && !!this.ents[to];
    const room=this.cfg.scene==='littlemartians'&&typeof to==='string'&&this.rt.world.regions[to]?.kind==='place';
    const off = Math.max(standoff, isBody ? 0.9 : room?1.4:0);
    if (d <= off + 0.4 && level === this.ents[actor].human.level) return 'here';
    const base = Math.atan2(dz, dx);
    let last: Diag = { code: 'route.unreachable', message: 'no reachable standing point near the target' };
    for (const turn of off === 0 ? [0] : [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
      const x = r3(t[0] + Math.cos(base + turn) * off), z = r3(t[1] + Math.sin(base + turn) * off);
      const no = this.plan(this.movementVerb(actor,x), { actor, x, z, level });
      if (!no) return { x, z, level };
      last = no;
    }
    return last;
  }
  /** Opt-in (`spread:'pond/1'`) shared-water goal chosen when the step expands, so every
   * retry re-chooses: a spaced spot inside the region away from other bodies and from
   * other running shore/walk targets, first with a currently plannable native route.
   * Absent the parameter, region goals keep the original single-centroid behaviour. */
  private spreadGoalV1(actor:string,region:string,mode:unknown='pond/1'):{x:number;z:number;level:number}|'here'|Diag{
    const r=this.rt.world.regions[region],e=this.ents[actor];if(!r||!e)return {code:'target.unknown',message:`nothing to walk to: ${region}`};
    const lap=mode==='pond-lap/1'; // pond-lap/1: from inside the water, glide on to a different spaced spot
    if(!lap&&inPoly(e.pose.p[0],e.pose.p[2],r.polygon))return 'here';
    const level=r.level??0,xs=r.polygon.map((p:number[])=>p[0]),zs=r.polygon.map((p:number[])=>p[1]),taken:number[][]=[];
    for(const o of Object.values(this.ents) as any[])if(o.id!==actor&&o.human)taken.push([o.pose.p[0],o.pose.p[2]]);
    for(const rec of this.rt.records.values() as Iterable<any>){const q=rec.params;if(q&&q.actor!==actor&&(rec.verb==='commons_shore_travel'||rec.verb==='shore_travel'||rec.verb==='walk_to')&&typeof q.x==='number'&&typeof q.z==='number'&&this.rt.isActive(rec.id))taken.push([q.x,q.z]);}
    const spots:[number,number][]=[];
    // pond/1: deep-side swimming grid. region/1: any place, spaced standing spots nearest its centre first.
    // spreadV2 (prospective policy): thin/small places (the 10 x 1.4 m commons strip, mats) keep real interior spots.
    const v2=this.cfg.spreadV2===true&&!(mode==='pond/1'||lap),ex=Math.max(...xs)-Math.min(...xs),ez=Math.max(...zs)-Math.min(...zs);
    const pond=mode==='pond/1'||lap,inset=pond?[2,4]:v2?[Math.min(.6,ex/4,ez/4),Math.min(.6,ex/4,ez/4)]:[1,1],step=pond?2.5:v2?1.0:1.5,mid=centroid(r.polygon);
    for(let x=Math.min(...xs)+inset[0];x<=Math.max(...xs)-inset[1];x+=step)for(let z=Math.min(...zs)+inset[0];z<=Math.max(...zs)-inset[0];z+=step){const p:[number,number]=[r3(x),r3(z)];if(inPoly(p[0],p[1],r.polygon)&&taken.every(t=>Math.hypot(t[0]-p[0],t[1]-p[1])>=(pond?1.4:1.0))&&(!lap||Math.hypot(p[0]-e.pose.p[0],p[1]-e.pose.p[2])>=4))spots.push(p);}
    if(!spots.length&&!pond&&taken.every(t=>Math.hypot(t[0]-mid[0],t[1]-mid[1])>=1.0))spots.push(mid); // a place smaller than the grid keeps its single centre
    // spreadV2: when the inside is full (or unreachable) stand just outside it, nearest first, on the ground
    // around a raised place (never mid-air beside a deck). Arriving at a busy place is not a refusal.
    const ring:[number,number][]=[];
    if(v2){const reach=Math.max(ex,ez)/2;for(const rr of [reach+.8,reach+1.6,reach+2.4])for(let k=0;k<12;k++){const a=k/12*Math.PI*2,p:[number,number]=[r3(mid[0]+Math.cos(a)*rr),r3(mid[1]+Math.sin(a)*rr)];if(!inPoly(p[0],p[1],r.polygon)&&taken.every(t=>Math.hypot(t[0]-p[0],t[1]-p[1])>=1.0))ring.push(p);}}
    if(!spots.length&&!ring.length)return {code:'route.region-full',message:`no spaced free spot remains in ${region}`};
    const offset=[...actor].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7)%spots.length;
    const order=[...spots.slice(offset),...spots.slice(0,offset)].map((p,i)=>({p,i,band:lap?Math.round(Math.abs(Math.hypot(p[0]-e.pose.p[0],p[1]-e.pose.p[2])-6)/2):pond?Math.round(Math.hypot(p[0]-e.pose.p[0],p[1]-e.pose.p[2])/8):Math.round(Math.hypot(p[0]-mid[0],p[1]-mid[1])/2)})).sort((a,b)=>a.band-b.band||a.i-b.i).slice(0,24);
    let last:Diag={code:'route.unreachable',message:'no reachable spaced spot'};
    for(const {p} of order){const no=this.plan(this.movementVerb(actor,p[0]),{actor,x:p[0],z:p[1],level});if(!no)return {x:p[0],z:p[1],level};last=no;}
    if(v2&&ring.length){const ground=0;for(const p of ring.sort((a,b)=>Math.hypot(a[0]-e.pose.p[0],a[1]-e.pose.p[2])-Math.hypot(b[0]-e.pose.p[0],b[1]-e.pose.p[2])).slice(0,24)){const no=this.plan(this.movementVerb(actor,p[0]),{actor,x:p[0],z:p[1],level:ground});if(!no)return {x:p[0],z:p[1],level:ground};}
      return {code:'route.region-full',message:`${region} is full and nobody can stand beside it right now`};}
    return last;
  }
  /** Edge reflex floor (yieldTimeoutV1): a shared-space spread step whose movement failed only because another body
   * was in the way waits 1 s and re-chooses its spot (at most a minute) instead of failing the programme. */
  private spreadRetry(p: Prog, code: string | undefined): boolean {
    if (this.cfg.yieldTimeoutV1 !== true || !code || !/occupied/.test(code)) return false;
    const spread = String(p.steps[p.index]?.params?.spread ?? '');
    if (!['pond/1','region/1','pond-lap/1'].includes(spread) || (p.spreadWaits = (p.spreadWaits ?? 0) + 1) > 60) return false;
    p.index--; p.ops = [{ wait: 20 }]; return true;
  }
  private movementVerb(actor:string,x:number){return this.physical&&(x<-29.5||this.ents[actor]?.pose.p[0]<-29.5)?'commons_shore_travel':'walk_to';}
  private free(id: string): boolean { return !!this.ents[id] && this.holders(id).length === 0 && !this.byActor.has(id) && ![...this.programs.values()].some(p=>p.build?.crew.includes(id)); }

  /** A raw Mars verb, with the actor filled in where the verb takes one (`actor`, or `actors` when none are given). */
  private raw(me: string, step: { verb: string; params: Record<string, unknown> }): { verb: string; params: Record<string, unknown> } | Diag {
    const verb = step.verb.slice(5), def = this.registry.get(verb), a = step.params ?? {};
    if (!def) return { code: 'action.unknown-verb', message: `no action verb "${verb}"` };
    const helm=['boat_take_helm','boat_release_helm'].includes(verb);
    // The fresh owned helm binding must also prevent a passenger from naming
    // another body as pilot of an ordinary travel/board/leave program.
    if(((this.physical?.boatControls||this.physical?.bodyLocation)&&verb.startsWith('boat_'))||helm){
      if(a.actor!==undefined&&a.actor!==me)return {code:helm?'boat.helm-self-only':'boat.self-only',message:'A boat activity may act only for the program\u0027s own passenger.'};
    }
    if(helm){
      if(this.leaving.includes(me))return {code:'boat.helm-retiring',message:'A retiring passenger cannot acquire or release control through a new program.'};
    }
    const shape = (this.m.describeVerbs(new Map([[verb, def]]))[0].inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    return { verb, params: { ...a, ...('actor' in shape && !('actor' in a) ? { actor: me } : {}), ...('actors' in shape && !('actors' in a) ? { actors: [me] } : {}) } };
  }

  private seatedAt(actor:string,fixture:string){const body=this.ents[actor],entity=this.ents[fixture];if(!body?.human||body.human.activity!=='sit'||!entity)return false;return fixtureSlots(this.rt,entity).some(slot=>{const r=slot.claimedBy?this.rt.records.get(slot.claimedBy):undefined;return slot.kind==='seat'&&slot.level===body.human.level&&r?.params.actor===actor&&r.phase==='occupied'&&this.rt.isActive(r.id)&&Math.hypot(slot.p[0]-body.pose.p[0],slot.p[1]-body.pose.p[2])<=.001&&Math.abs(angleDelta(slot.yaw,body.pose.yaw))<=.03;});}

  /** One body-language step → the Mars actions and waits that depict it, decided when the step begins. */
  private lower(p: Prog, step: { verb: string; params: Record<string, unknown> }): Op[] | Diag {
    const me = p.actor, a = step.params ?? {};
    if (step.verb === 'mars:take_item') { const it=this.ents[String(a.item)]; if (it?.support?.kind === 'in-hand' && it.support.by === me && (!a.hand || it.support.hand === a.hand)) return []; }
    if (step.verb.startsWith('mars:')) { const r = this.raw(me, step); return 'code' in r ? r : [{ ...r, settle: 'held', raw: true }]; }
    switch (step.verb) {
      case 'activity_readiness_v1': {
        const issue=this.readinessIssue(me,a);if(issue)return issue;
        return [{wait:secs(a.seconds,120)}];
      }
      case 'control_classroom_v1': return [{verb:'classroom_control',params:{session:a.session,intent:{kind:a.kind}},settle:'done',raw:true}];
      case 'walk_to': {
        const g = (a.spread === 'pond/1' || a.spread === 'region/1' || a.spread === 'pond-lap/1') && typeof a.to === 'string' && this.rt.world.regions[a.to] ? this.spreadGoalV1(me, a.to, a.spread) : this.goalNear(me, a.to, typeof a.standoff === 'number' ? a.standoff : 0);
        if (g === 'here') return [];
        if ('code' in g) return g;
        const ops: Op[] = [{ verb: this.movementVerb(me,g.x), params: { actor: me, x: g.x, z: g.z, level:g.level, ...(this.cfg.nativeArrivalWitnessV1&&this.movementVerb(me,g.x)==='walk_to'?{arrivalEvidence:'navigation-arrival/1'}:{}) }, settle: 'done', ...(a.spread === 'pond-lap/1' ? { soft: true } : {}) }];
        if (typeof a.to === 'string' && this.ents[a.to]) ops.push({ verb: 'face', params: { actor: me, target: { entity: a.to } }, settle: 'done', soft: true });
        return ops;
      }
      case 'rest': return typeof a.seatedAt==='string'&&!this.seatedAt(me,a.seatedAt)?{code:'rest.native-seat-required',message:'The requested seat is no longer held by this actor.'}:[{ wait: secs(a.seconds, 60) }];
      case 'perform': return [{ wait: secs(a.seconds, 30) }];
      case 'wave': return [...(typeof a.at === 'string' && this.ents[a.at] ? [{ verb: 'face', params: { actor: me, target: { entity: a.at } }, settle: 'done', soft: true } as Op] : []), { wait: secs(a.seconds, 2) }];
      case 'converse': {
        const other = String(a.with ?? ''), n = secs(a.seconds, 30);
        if (!this.ents[other]) return { code: 'target.unknown', message: `nobody to talk with: ${other}` };
        // A conversation circle borrows the other body only if it is free; otherwise this actor turns to them and talks from where it stands.
        if (this.free(other) && !this.plan('converse', { actors: [me, other], duration: n / TPS })) return [{ verb: 'converse', params: { actors: [me, other], duration: n / TPS }, settle: 'done', soft: true }];
        return [{ verb: 'face', params: { actor: me, target: { entity: other } }, settle: 'done', soft: true }, { wait: n }];
      }
      case 'gather': {
        // `at` may be a fixture, a Mars region, or a point (then the region with an audience layout around that point, if any).
        const n = secs(a.seconds, 120), pt = this.pointOf(a.at);
        const e = typeof a.at === 'string' ? this.ents[a.at] : undefined;
        const region = typeof a.at === 'string' && this.rt.world.regions[a.at] ? a.at : !e && pt ? Object.keys(this.rt.world.regions).sort().find((id) => inPoly(pt[0], pt[1], this.rt.world.regions[id].polygon)) : undefined;
        const tries: Op[] = e ? [...(e.def === 'campfire' ? [{ verb: 'campfire_circle', params: { actors: [me], fire: e.id }, settle: 'held' } as Op] : []), { verb: 'gather', params: { actors: [me], fixture: e.id }, settle: 'held' }]
          : region ? [{ verb: 'gather', params: { actors: [me], region }, settle: 'held' }] : [];
        for (const op of tries) if ('verb' in op && !this.plan(op.verb, op.params)) return [op, { wait: n }];
        // No place to take (a full bench, a spot with no layout): stand near it instead.
        const g = this.goalNear(me, a.at, 2);
        if (g !== 'here' && 'code' in g) return g;
        return [...(g === 'here' ? [] : [{ verb: this.movementVerb(me,g.x), params: { actor: me, x: g.x, z: g.z, level:g.level, ...(this.cfg.nativeArrivalWitnessV1&&this.movementVerb(me,g.x)==='walk_to'?{arrivalEvidence:'navigation-arrival/1'}:{}) }, settle: 'done' } as Op]), { wait: n }];
      }
      case 'sit': return [{ verb: 'sit', params: { actor: me, fixture: String(a.on ?? '') }, settle: 'held' }, { wait: secs(a.seconds, 60) }];
      case 'stand': return this.holders(me).length ? [{ verb: 'stand', params: { actor: me }, settle: 'done', soft: true }] : [];
      case 'ambient_wander': {
        // Mars's own ambient_wander is not resumable from a snapshot, so strolling is built from walks and pauses, which are.
        const total = secs(a.seconds, 60), radius = Math.min(40, Math.max(2, typeof a.radius === 'number' ? a.radius : 12));
        const home = this.pos(me)!, ops: Op[] = []; let spent = 0;
        for (let leg = 0; leg < 6 && spent < total; leg++) {
          for (let tries = 0; tries < 4; tries++) {
            const ang = this.m.nextRandom(this.rt.world.rng) * Math.PI * 2, dist = (0.3 + 0.7 * this.m.nextRandom(this.rt.world.rng)) * radius;
            const x = r3(home[0] + Math.cos(ang) * dist), z = r3(home[1] + Math.sin(ang) * dist);
            if (leg > 0 || !this.plan(this.movementVerb(me,x), { actor: me, x, z })) { ops.push({ verb: this.movementVerb(me,x), params: { actor: me, x, z, ...(this.movementVerb(me,x)==='walk_to'?{speed:0.9}:{}) }, settle: 'done', soft: true }); break; }
          }
          const pause = Math.round((2 + 6 * this.m.nextRandom(this.rt.world.rng)) * TPS); ops.push({ wait: pause });
          spent += pause + Math.round((radius / 0.9) * TPS * 0.6);
        }
        return ops;
      }
      default: return { code: 'action.unknown-verb', message: `no body verb "${step.verb}"` };
    }
  }

  // ------------------------------------------------------------------ programs
  withFeasibilityRead<T>(read:()=>T):T {const previous=this.feasibilityRead;this.feasibilityRead=new Map();try{return read();}finally{this.feasibilityRead=previous;}}
  private physicalReplacementIssue(action:string):Diag|null {
    const record=this.rt.records.get(action),key=this.feasibilityRead?hashOf({action,tick:this.rt.tick,events:this.rt.events.length,native:this.rt.stateHash(),status:record?.status,phase:record?.phase,quiet:this.quiet,cfg:this.cfg}):undefined;
    if(key&&this.feasibilityRead!.has(key))return structuredClone(this.feasibilityRead!.get(key)!);
    let result:Diag|null=null;
    if(!this.canSnapshot())result={code:'program.safe-stop-required',message:'Stop the current non-resumable action safely before replacing it.'};
    else {const copy=this.physical!.restore(this.rt.snapshot());copy.cancel(action,{code:'program.replaced',message:'replaced'});if(copy.isActive(action))result={code:'program.safe-stop-required',message:'Stop the current movement and let it reach safe support before replacing it.'};}
    if(key)this.feasibilityRead!.set(key,structuredClone(result));return result;
  }
  ownedClassroomControlRosterV1(actor:string,session:string){const r=this.rt.records.get(session);if(!r||r.verb!=='classroom_session'||!this.rt.isActive(session)||r.params.host!==actor)return null;const current=readClassroom(this.rt,session);if(!current)return null;return [...new Set(current.participants.map(p=>p.actor))];}
  canPerform(program: Program): Diag | null {
    if(program.steps[0]?.verb==='control_classroom_v1'){const p=program.steps[0].params;if(program.steps.length!==1||!['cancel','advance'].includes(String(p.kind))||typeof p.session!=='string'||!this.ownedClassroomControlRosterV1(program.actor,p.session))return {code:'classroom.owned-host-control-required',message:'Only the active classroom host can apply this control.'};return this.plan('classroom_control',{session:p.session,intent:{kind:p.kind}});}
    if ([...this.programs.values()].some(p=>p.readiedActors?.includes(program.actor)&&!p.action))return {code:'activity.readiness-committed',message:'This body has committed its explicit ready wait to a starting classroom.'};
    if (!this.ents[program.actor]) return { code: 'actor.unknown', message: `no such actor ${program.actor}` };
    if ([...this.programs.values()].some(p=>p.build?.crew.includes(program.actor))) return {code:'construction.committed',message:'This builder is finishing a finite physical construction segment.'};
    if(this.physical){
      const old=this.programs.get(this.byActor.get(program.actor)??'');
      if(old?.stopping)return {code:'program.safe-stop-pending',message:'The previous movement is still reaching a safe supported stop.'};
      if(old?.action&&this.rt.isActive(old.action)){
        const issue=this.physicalReplacementIssue(old.action);if(issue)return issue;
      }
    }
    const first = program.steps[0]; if (!first) return null;
    for(const step of program.steps)if(step.verb==='activity_readiness_v1'){const issue=this.readinessIssue(program.actor,step.params,false);if(issue)return issue;}
    if(first.verb==='rest'&&typeof first.params.seatedAt==='string'&&!this.seatedAt(program.actor,first.params.seatedAt))return {code:'rest.native-seat-required',message:'The requested seat is no longer held by this actor.'};
    if (this.cfg.disassemblyV1 && (first.verb === 'build_lookout' || first.verb === 'unbuild_lookout') && [...this.programs.values()].some(p=>p.build)) return {code:'construction.site-busy',message:'Another crew is building or taking down the lookout; one finite job at a time.'};
    if (first.verb === 'unbuild_lookout' && this.cfg.disassemblyV1) {
      if (program.steps.length !== 1) return {code:'disassembly.one-job',message:'A disassembly card chooses one finite job.'};
      const plan=this.unbuildPlan(program);
      if ('code' in plan) return plan;
      const raw=this.raw(program.actor,plan.steps[0]);
      return 'code' in raw?raw:this.plan(raw.verb,raw.params);
    }
    if (first.verb === 'build_lookout') {
      if (program.steps.length !== 1) return {code:'construction.one-job',message:'A construction card chooses one finite job.'};
      const plan=this.buildPlan(program);
      if ('code' in plan) return plan;
      const raw=this.raw(program.actor,plan.steps[0]);
      return 'code' in raw?raw:this.plan(raw.verb,raw.params);
    }
    if (!program.steps.some(s=>s.verb==='mars:serve')) for (const step of program.steps) if (step.verb==='mars:eat' && !(this.ents[String(step.params.bowl)]?.contents?.fraction > 0)) return {code:'eat.bowl-empty',message:'There is no food left in the bowl'};
    if(this.commonsKitchenActive){
      const services=program.steps.filter(s=>['mars:prepare_food','mars:serve'].includes(s.verb));
      const pots=services.map(s=>s.params.pot);
      if(pots.length&&[...this.programs.values()].some(p=>p.actor!==program.actor&&p.steps.some(s=>['mars:prepare_food','mars:serve'].includes(s.verb)&&pots.includes(s.params.pot))))return {code:'food.service-in-use',message:'Someone is already preparing or serving at this finite pot'};
      if(services.some(s=>s.verb==='mars:serve'&&(this.ents[String(s.params.bowl)]?.contents?.fraction??0)>0))return {code:'serve.bowl-not-empty',message:'Eat the food already in your bowl before serving more'};
    }
    const pots = program.steps.filter(s => ['mars:serve','mars:shared_food_break'].includes(s.verb)).map(s => s.params.pot);
    if (this.cfg.scene === 'eden-camp' && pots.length && [...this.programs.values()].some(p => p.actor !== program.actor && p.steps.some(s => ['mars:serve','mars:shared_food_break'].includes(s.verb) && pots.includes(s.params.pot)))) return {code:'food.service-in-use',message:'Someone is already using this pot and its serving space'};
    for (const step of program.steps) if (step.verb.startsWith('mars:')) {
      const busy = this.jointIssue(step.params, program.actor,step.verb==='mars:classroom_session'); if (busy) return busy;
      if (step.verb === 'mars:serve') {
        const pot = this.ents[String(step.params.pot)];
        if (!pot?.contents || pot.contents.fraction < 0.25 || pot.foodPreparation?.complete === false) return {code: 'food.unavailable', message: 'there is no completed serving left in the pot'};
      }
    }
    if(!this.commonsKitchenActive&&program.steps.some(s=>s.verb==='mars:prepare_food'&&s.params.groundRoutePolicy==='supported-ground/1'))return {code:'commons-kitchen.reader-required',message:'The supported ground preparation policy is not installed'};
    if(this.socialEdenActive){const seats=program.steps.filter(s=>s.verb==='sit'&&String(s.params.on).startsWith('social-eden-'));for(const seat of seats){const issue=this.plan('sit',{actor:program.actor,fixture:String(seat.params.on)});if(issue)return issue;}}
    if (first.verb === 'mars:take_item') { const it=this.ents[String(first.params.item)]; if (it?.support?.kind==='in-hand' && it.support.by===program.actor && (!first.params.hand || it.support.hand===first.params.hand)) return null; }
    if (first.verb.startsWith('mars:')) { const r = this.raw(program.actor, first); return 'code' in r ? r : this.plan(r.verb, r.params); }
    if (!BODY.has(first.verb)) return { code: 'action.unknown-verb', message: `no body verb "${first.verb}"` };
    if (first.verb === 'walk_to') { const g = (first.params.spread === 'pond/1' || first.params.spread === 'region/1' || first.params.spread === 'pond-lap/1') && typeof first.params.to === 'string' && this.rt.world.regions[first.params.to] ? this.spreadGoalV1(program.actor, first.params.to, first.params.spread) : this.goalNear(program.actor, first.params.to, typeof first.params.standoff === 'number' ? first.params.standoff : 0); return g !== 'here' && 'code' in g ? g : null; }
    if (first.verb === 'sit') {
      const fixture = String(first.params.on ?? '');
      if (this.cfg.scene === 'eden-camp' && this.ents[fixture]?.def === 'bench-6ft') {
        for (const r of this.rt.records.values()) if (this.rt.isActive(r.id) && r.params?.actor !== program.actor && (r.params?.fixture === fixture || String(r.params?.slot ?? '').startsWith(fixture+'#'))) return {code:'seat.approach-busy',message:'Someone is using the bench and its narrow entry; wait until they leave.'};
      }
      return this.plan('sit', { actor: program.actor, fixture });
    }
    return null;
  }
  private prepareAdmission(program: Program) {
    const no = this.canPerform(program);
    const id = `p${this.nextProg}`;
    if (no) return {result:{id,ok:false,diagnostic:no},build:null};
    const reverse=program.steps[0]?.verb==='unbuild_lookout'&&this.cfg.disassemblyV1===true;
    const build=program.steps[0]?.verb==='build_lookout'?this.buildPlan(program):reverse?this.unbuildPlan(program):null;
    if (build && 'code' in build) return {result:{id,ok:false,diagnostic:build},build:null,reverse};
    return {result:{id,ok:true},build,reverse};
  }
  previewAdmission(program:Program) { return structuredClone(this.prepareAdmission(program).result); }
  perform(program: Program) {
    const {result,build,reverse}=this.prepareAdmission(program),id=result.id;
    this.nextProg++;
    if (!result.ok) { const old = this.byActor.get(program.actor); if (old&&!this.physical) this.stop(old); return result; }
    if(program.steps[0]?.verb==='control_classroom_v1'){const p:Prog={id,actor:program.actor,label:program.label.slice(0,200),steps:structuredClone(program.steps),index:0,started:false,since:this.rt.tick,ops:[],controlOf:String(program.steps[0].params.session)};this.programs.set(id,p);return result;}
    const commitment=program.steps[0]?.verb==='mars:classroom_session'&&program.steps[0].params.handoverScope==='owned-readiness/1'?[...new Set([program.steps[0].params.host,...(program.steps[0].params.presenters as string[]??[]),...(program.steps[0].params.audience as string[]??[])].filter((id):id is string=>typeof id==='string'&&id!==program.actor))]:[];
    const handover=program.steps[0]?.verb==='mars:classroom_session'&&program.steps[0].params.handoverScope==='owned-readiness/1'?this.classroomReadyActors(program.steps[0].params,program.actor):[];
    for(const actor of handover){const ready=this.programs.get(this.byActor.get(actor)!);if(ready)this.end(ready,'completed',{code:'activity.readiness-handover',message:'The explicitly offered wait joined its matching owned classroom.'});}
    const old = this.byActor.get(program.actor);
    if (old) { const o = this.programs.get(old)!; if (o.action && this.rt.isActive(o.action)) this.rt.cancel(o.action, { code: 'program.replaced', message: 'replaced' }); this.end(o, 'cancelled', { code: 'program.replaced', message: 'replaced by a new program' }); }
    const p: Prog = { ...(commitment.length?{readiedActors:commitment}:{}), id, actor: program.actor, label: program.label.slice(0, 200), steps: build?build.steps:program.steps, index: 0, started: false, since: this.rt.tick, ops: [], ...(build?{build:{phase:program.steps[0].params.phase as BuildPhase,crew:build.crew,...(reverse?{reverse:true as const}:{})}}:{}) };
    this.programs.set(id, p); this.byActor.set(p.actor, id);
    return result;
  }
  stop(programId: string) {
    const p = this.programs.get(programId); if (!p) return;
    if (p.build) { p.build.stopping={code:'program.stopped',message:'Construction interruption requested; finishing the committed segment safely.'}; return; }
    if (p.action && this.rt.isActive(p.action)) {
      this.rt.cancel(p.action, { code: 'program.stopped', message: 'stopped' });
      if(this.physical&&this.rt.isActive(p.action)){p.stopping={code:'program.stopped',message:'Stopped after native movement reaches safe support.'};return;}
    }
    this.end(p, 'cancelled', { code: 'program.stopped', message: 'stopped' });
  }
  programOf(actor: string) { return this.byActor.get(actor) ?? null; }
  programAction(programId:string) {
    const p=this.programs.get(programId),r=p?.action?this.rt.records.get(p.action):undefined;
    if(!p || !r)return null;
    return {tick:this.rt.tick,programId:p.id,actor:p.actor,step:p.index,
      action:{id:r.id as string,verb:r.verb as string,status:r.status as ActionRecord['status'],...(r.phase?{phase:r.phase as string}:{})}};
  }
  bodyResting(actor:string) { const id=this.byActor.get(actor),p=id?this.programs.get(id):undefined; return !!p && p.until!==undefined && p.steps[p.index]?.verb==='rest' && !this.ents[actor]?.human?.task; }
  observeLocalClassroomV1(observer:string){return readLocalClassroomV1(this.rt,observer,this.rulesVersion);}
  gatheringObservation() { return readNativeGathering(this.rt,this.rulesVersion,this.dt); }
  submit(verb: string, params: unknown, opts?: { id?: string; parent?: string; preempt?: boolean }): ActionRecord { return this.rt.submit(verb, params, opts) as ActionRecord; }
  cancel(id: string, reason?: Diag): ActionRecord { return this.rt.cancel(id, reason) as ActionRecord; }

  // ------------------------------------------------------------------ bodies
  /** Mars has no way to add a person to a running world; the adapter does what its world editor does, then restores canonical order. */
  /** Edge reclaim (logged 'edge-relocate'): an idle, unheld body lands on its feet at the nearest free
   * standing spot near `to` (same ring search as arrival). Refuses busy/held/sleeping bodies. */
  relocateHumanV1(id: string, to: [number, number]): boolean {
    const e = this.ents[id];
    if (!e?.human || this.byActor.has(id) || this.holders(id).length || e.human.sleepPose || e.human.on || e.human.riding) return false;
    const people = Object.values(this.ents).filter((o: any) => o.kind === 'human' && o.id !== id).map((o: any) => [o.pose.p[0], o.pose.p[2]] as [number, number]);
    const spatial = this.rt.services.spatial as Spatial; spatial.sync(this.rt.world); const grid = spatial.level(0);
    for (let ring = 0; ring < 8; ring++) for (let k = 0; k < Math.max(1, ring * 6); k++) {
      const ang = (k / Math.max(1, ring * 6)) * Math.PI * 2 + ring * 0.5, x = r3(to[0] + dcos(ang) * ring * 0.9), z = r3(to[1] + dsin(ang) * ring * 0.9);
      if (people.some(([px, pz]) => hypot(px - x, pz - z) < 0.8)) continue;
      if (!grid || clearanceAt(grid, [x, z]) < HUMAN_RADIUS) continue;
      e.pose.p = [x, 0, z]; e.human.level = 0; e.human.activity = 'idle'; e.human.speed = 0; delete e.human.shore; acknowledgeRelocation(this.rt, id); return true;
    }
    return false;
  }
  spawnHuman({ id, label, soul }: { id: string; label: string; soul: string }): string {
    if (this.ents[id]) return id;
    const [ax, az] = this.cfg.arrival;
    const body=this.cfg.scene==='littlemartians'&&['Verdelis','Kalama','Kweku','Mycos','Ada','Shuijing','Nyx'].includes(label)?{family:'floater',model:label.toLowerCase(),radius:.35,hoverHeight:1.45}:undefined;
    const people = Object.values(this.ents).filter((e: any) => e.kind === 'human').map((e: any) => [e.pose.p[0], e.pose.p[2]] as [number, number]);
    let spot: [number, number] | null = null;
    search: for (let ring = 0; ring < 6; ring++) for (let k = 0; k < Math.max(1, ring * 6); k++) {
      const ang = (k / Math.max(1, ring * 6)) * Math.PI * 2 + ring * 0.5;
      // Original history retains its placement math; the explicit new policy
      // uses portable native math and checks the actual standing disc first.
      const x = r3(ax + (this.cfg.safeArrivalV1?dcos(ang):Math.cos(ang)) * ring * 0.9),
        z = r3(az + (this.cfg.safeArrivalV1?dsin(ang):Math.sin(ang)) * ring * 0.9);
      if (people.some(([px, pz]) => (this.cfg.safeArrivalV1?hypot(px-x,pz-z):Math.hypot(px-x,pz-z)) < 0.8)) continue;
      if(this.cfg.safeArrivalV1){
        const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);
        const grid=spatial.level(0),radius=body?.radius??HUMAN_RADIUS;
        if(!grid||clearanceAt(grid,[x,z])<radius)continue;
      }
      this.ents[id] = this.m.human(id, x, z, { label }); if(body)this.ents[id].body=body;
      let ok=false;
      try{ok = !this.plan('walk_to', { actor: id, x: this.cfg.reference[0], z: this.cfg.reference[1] }) || !this.plan('walk_to', { actor: id, x: ax, z: az });}
      finally{delete this.ents[id];}
      if (ok) { spot = [x, z]; break search; }
    }
    if (!spot) throw new Error('no free standing room at the arrival point');
    const e = this.m.human(id, spot[0], spot[1], { label, provenance: { origin: 'simulation', confidence: 'hypothetical' } });
    e.human.soul = soul; if(body)e.body=body;
    this.ents[id] = e; this.m.canonicalEntityOrder(this.rt.world);
    this.out.changes.push([this.rt.tick, id, 'present', e]);
    return id;
  }
  /** Detached admission uses the same native standing-disc geometry as the
   * corrected placer. Legacy replay keeps its original births, but a new
   * admission must never label a known overlapping placement ready. */
  humanBirthIssue(id:string):Diag|null {
    const e=this.ents[id];if(!e?.human)throw new Error('birth body is missing');
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);
    const grid=spatial.level(e.human.level),radius=e.body?.family==='floater'?e.body.radius:HUMAN_RADIUS;
    if(!grid||clearanceAt(grid,[e.pose.p[0],e.pose.p[2]])<radius)
      return {code:'birth.arrival-unavailable',message:'No safe standing room at the arrival point.'};
    return null;
  }
  private tryRemove(id: string): boolean {
    if (!this.ents[id]) return true;
    // A committed build owns its whole crew even between native actions,
    // when no actor reservation exists. Never pull a holder out of the load.
    if(this.cfg.safeCrewRemoval&&[...this.programs.values()].some(p=>p.build?.crew.includes(id)))return false;
    // Fresh physical bases may own occupancy beyond actor reservations. A
    // passenger is still supported by its boat after boarding has completed.
    if(this.physical?.prepareRemoval&&!this.physical.prepareRemoval(this.rt,id))return false;
    if (!this.release(id, { code: 'actor.removed', message: 'actor removed' })) return false;
    delete this.ents[id]; this.keys.delete(id); this.acts.delete(id); this.ons.delete(id);
    this.out.changes.push([this.rt.tick, id, 'present', null]);
    return true;
  }
  removeEntity(id: string) {
    if(this.cfg.safeCrewRemoval)for(const p of this.programs.values())if(p.build?.crew.includes(id))this.stop(p.id);
    const pid = this.byActor.get(id); if (pid) this.stop(pid);
    if (!this.tryRemove(id)&&(!this.cfg.safeCrewRemoval||!this.leaving.includes(id))) this.leaving.push(id); // finish owned obligations first
  }

  // ------------------------------------------------------------------ what the shell reads
  anchors(): Anchor[] {
    return this.anchorsOf(this.rt.world,this.cfg);
  }
  private anchorsOf(w:any,cfg:MarsWorldConfig):Anchor[] {
    const out: Anchor[] = [{ id: cfg.grounds.id, kind: 'region', name: cfg.grounds.name, point: cfg.arrival }];
    for (const id of Object.keys(w.regions).sort()) { const r = w.regions[id]; if (r.kind === 'no-go') continue; out.push({ id, kind: 'place', name: r.label, in: cfg.grounds.id, point: centroid(r.polygon), tags: [r.kind, ...(id === cfg.arrivalPlace ? ['arrival'] : [])] }); }
    for (const id of Object.keys(w.entities).sort()) { const e = w.entities[id]; if (e.kind !== 'fixture') continue; out.push({ id, kind: 'place', name: e.label ?? id, in: cfg.grounds.id, entity: id, tags: [e.def] }); }
    return out;
  }
  regionAt(p: Vec3): string {
    if(this.physical)for(const id of ['shore-water','shore-bank']){const r=this.rt.world.regions[id];if(r&&inPoly(p[0],p[2],r.polygon))return id;}
    return this.cfg.grounds.id;
  }
  poseSampleOf(id: string): PoseSample {
    const e = this.ents[id];
    return [this.rt.tick, Math.round(e.pose.p[0] * 1000), Math.round(e.pose.p[1] * 1000), Math.round(e.pose.p[2] * 1000), Math.round(e.pose.yaw * 1000)];
  }
  currentPath(_id: string): PathCommit | undefined { return undefined; }   // movement is broadcast as keyframes, not as paths decided in advance
  enumerateActivities(): ActivityOption[] { return []; }                    // superseded by cards
  observeBoatControls(actorId:string):NativeBoatControlsV1|null{
    const view=this.physical?.boatControls?.(this.rt,actorId);if(!view)return null;
    if(this.leaving.includes(actorId)){const unavailable={available:false,reason:{code:'boat.helm-retiring',message:'The retiring passenger is completing physical cleanup.'}};view.take=unavailable;view.release=structuredClone(unavailable);}
    return view;
  }
  describeSurroundings(actorId: string) {
    const me = this.pos(actorId) ?? [0, 0];
    const items = Object.keys(this.ents).filter((id) => id !== actorId && (this.ents[id].kind === 'human' || this.ents[id].kind === 'fixture')).map((id) => {
      const e = this.ents[id], d = Math.hypot(e.pose.p[0] - me[0], e.pose.p[2] - me[1]);
      return { id, d, who: (e.label ?? id) as string, what: e.kind === 'human' ? 'a soul' : (e.def as string), doing: e.kind === 'human' ? (e.human.activity as string) : '' };
    }).sort((x, y) => x.d - y.d || (x.id < y.id ? -1 : 1));
    const place = Object.keys(this.rt.world.regions).sort().find((id) => inPoly(me[0], me[1], this.rt.world.regions[id].polygon));
    return { nearby: items.slice(0, 8).map(({ id, who, what, doing, d }) => ({ id, who, what, distance: bucket(d), doing })), region: place ?? this.cfg.grounds.id, happening: 'nothing in particular' };
  }
  observeBodyLocation(actorId:string):BodyLocationV1|null|undefined{return this.physical?.bodyLocation?.(this.rt,actorId);}

  private updateAttention() {
    const people = (Object.values(this.ents) as any[]).filter(e => e.kind === 'human').sort((a,b) => a.id.localeCompare(b.id));
    for (const e of people) {
      delete e.human.attention;
      if (!/talk|converse|listen|watch|warm/.test(e.human.activity)) continue;
      const near = people.filter(o => o !== e).map(o => ({o, d: Math.hypot(o.pose.p[0]-e.pose.p[0], o.pose.p[2]-e.pose.p[2])})).filter(x => x.d < 7).sort((a,b) => a.d-b.d);
      if (near[0]) e.human.attention = [near[0].o.pose.p[0], near[0].o.pose.p[2]];
    }
  }
  renderScene() {
    if(this.physical){
      const visible=structuredClone(this.physical.renderScene()),scene=visible.scene as Record<string,unknown>;
      if(this.newcomerResources.length)scene.newcomerProvisions=newcomerResourcesPublicV1Schema.parse({contract:'commons-newcomer-resources/1',resources:this.newcomerResources.flatMap(f=>commonsNewcomerResourcesV1(f.firstSlot,f.placements).resources),nativeGroundY:0});
      if(this.commonsProvisionsActive)scene.provisions={version:'commons-provisions/1',resources:structuredClone(COMMONS_PERSONAL_RESOURCES),nativeGroundY:0};
      if(this.commonsKitchenActive)scene.kitchen={version:this.commonsKitchenVersion,...(this.commonsKitchenVersion==='commons-kitchen/2'?{slotRow:'r1'}:{}),stations:structuredClone(COMMONS_KITCHENS),ingredientBowlsPerStation:2,servingsPerStation:2,nativeGroundY:0};
      if(this.foodDeliveries.length)scene.foodDeliveries={contract:'commons-food-delivery/1',batches:this.foodDeliveries.map(d=>({deliveryId:d.deliveryId,batch:d.batch,portions:8,resources:commonsFoodDeliveryItemsV1(d.batch).resources}))};
      if(this.socialEdenActive)scene.social={version:'social-eden/1',layoutHash:socialEdenV1().layoutHash,layout:socialEdenV1().layout,nativeGeometry:socialEdenV1().nativeGeometry};
      if(this.greenLandmarkActive)scene.landmarks={contract:'existing-green-landmark/1',sourceProposalHash:existingGreenLandmarkV1().sourceProposalHash,items:[{id:existingGreenLandmarkV1().id,label:'South commons tree',point:existingGreenLandmarkV1().point,visual:existingGreenLandmarkV1().source.visual,visualId:'commons-canopy-tree-16',capabilities:['walk','hang_out']}]};
      if(visible.shore)visible.shore.rulesVersion=this.rulesVersion;
      return {...visible,clock:this.cfg.clock?{origin:this.cfg.clock.origin,dayTicks:this.cfg.clock.dayTicks}:null};
    }
    const scene=structuredClone(this.m.scenes[this.rt.world.base.campus] ?? null);
    if(this.cfg.scene==='eden-commons')scene.commons=commonsSceneMetadataV1Schema.parse({
      version:'commons/1',source:'9b6db72fc2dcf45a762d7ce8e4db0b71d0418ea8',layout:structuredClone(this.m.commonsLayout),
    });
    if(this.foodDeliveries.length)scene.foodDeliveries={contract:'commons-food-delivery/1',batches:this.foodDeliveries.map(d=>({deliveryId:d.deliveryId,batch:d.batch,portions:8,resources:commonsFoodDeliveryItemsV1(d.batch).resources}))};
    if(this.socialEdenActive)scene.social={version:'social-eden/1',layoutHash:socialEdenV1().layoutHash,layout:socialEdenV1().layout,nativeGeometry:socialEdenV1().nativeGeometry};
      if(this.greenLandmarkActive)scene.landmarks={contract:'existing-green-landmark/1',sourceProposalHash:existingGreenLandmarkV1().sourceProposalHash,items:[{id:existingGreenLandmarkV1().id,label:'South commons tree',point:existingGreenLandmarkV1().point,visual:existingGreenLandmarkV1().source.visual,visualId:'commons-canopy-tree-16',capabilities:['walk','hang_out']}]};
    if(this.commonsKitchenActive)scene.kitchen={version:this.commonsKitchenVersion,...(this.commonsKitchenVersion==='commons-kitchen/2'?{slotRow:'r1'}:{}),stations:structuredClone(COMMONS_KITCHENS),ingredientBowlsPerStation:2,servingsPerStation:2,nativeGroundY:0};
    if(this.newcomerResources.length)scene.newcomerProvisions=newcomerResourcesPublicV1Schema.parse({contract:'commons-newcomer-resources/1',resources:this.newcomerResources.flatMap(f=>commonsNewcomerResourcesV1(f.firstSlot,f.placements).resources),nativeGroundY:0});
    if(this.commonsProvisionsActive)scene.provisions={version:'commons-provisions/1',resources:structuredClone(COMMONS_PERSONAL_RESOURCES),nativeGroundY:0};
    return {scene,clock:this.cfg.clock?{origin:this.cfg.clock.origin,dayTicks:this.cfg.clock.dayTicks}:null,
      ...(this.cfg.scene==='littlemartians'?structuredClone(this.m.littleMartiansRender):{}),
      ground:['greenfield','eden-commons'].includes(this.cfg.scene)?'grass' as const:undefined};
  }
  readerSetupWithoutRecordingV1<T>(read:()=>T):T{this.readerRecordingDepth++;try{return read();}finally{this.readerRecordingDepth--;}}
  private startRecorder() {
    if(this.readerRecordingDepth)return;
    // Authored render bases are immutable for this engine instance. Supported
    // campus/clock/config boundaries change this key; actor/object motion is in
    // the take and does not cause repeated hashing of a static render base.
    const key=JSON.stringify([this.rt.world.base.campus,this.cfg.scene,this.cfg.clock??null,this.rulesVersion]);
    if(key!==this.renderBaseKey) {
      this.recorderScene=captureRenderScene(this.rulesVersion,this.renderScene());this.renderBaseKey=key;
    }
    this.takeScenes.set(this.recorderScene.ref.hash,this.recorderScene);
    this.recorder=new this.m.TakeRecorder(this.rt,{rulesVersion:this.rulesVersion,renderSceneRef:structuredClone(this.recorderScene.ref)});
    const retained=new Set([this.recorderScene.ref.hash,...this.chunks.map(c=>(c.take as {renderSceneRef:{hash:string}}).renderSceneRef.hash)]);
    for(const hash of this.takeScenes.keys())if(!retained.has(hash))this.takeScenes.delete(hash);
  }
  private finishRecorder() {
    if(this.readerRecordingDepth)return;
    const take=this.recorder.finish();
    if(this.rt.tick<=take.startTick)return;
    this.chunks.push({fromTick:take.startTick,toTick:this.rt.tick,take});
    if(this.chunks.length>12)this.chunks.shift();
  }
  takeScene(hash:string) { const captured=this.takeScenes.get(hash);return captured?structuredClone(captured):undefined; }
  actorBorrowed(actor: string) {
    return [...this.programs.values()].some(p=>p.readiedActors?.includes(actor)&&!p.action) || !this.byActor.has(actor) && ([...this.programs.values()].some(p=>p.build?.crew.includes(actor)) || this.holders(actor).some(id => ['shared_food_break','converse','classroom_session','computer_music','campfire_circle','group_warmup'].includes(this.rt.records.get(id)?.verb)));
  }
  private buildPlan(program: Program) {
    return constructionPlan(this.rt.world,program.actor,program.steps[0].params.phase,id=>id===program.actor?this.holders(id).length===0:this.free(id));
  }
  private unbuildPlan(program: Program) {
    const walks=[...this.rt.records.values()].filter((r:any)=>r.verb==='walk_to'&&this.rt.isActive(r.id)&&typeof r.params?.x==='number').map((r:any)=>({actor:String(r.params.actor),x:r.params.x,z:r.params.z,level:r.params.level??0}));
    return disassemblyPlan(this.rt.world,program.actor,program.steps[0].params.phase,id=>id===program.actor?this.holders(id).length===0:this.free(id),walks);
  }
  private readinessIssue(actor:string,params:Record<string,unknown>,requireStanding=true):Diag|null{
    const e=this.ents[actor];if(!e?.human||params.activity!=='classroom'||typeof params.host!=='string'||!this.ents[params.host]?.human||typeof params.venue!=='string'||!this.rt.world.regions[params.venue]||typeof params.seconds!=='number'||!Number.isFinite(params.seconds)||params.seconds<20||params.seconds>300)return {code:'activity.readiness-invalid',message:'Readiness needs a current host/venue and a bounded own wait.'};
    if(e.human.grip)return {code:'activity.readiness-load-held',message:'Finish the actual construction/carry phase before offering readiness.'};
    if(requireStanding&&(this.holders(actor).length||e.human.on||e.human.sleepPose))return {code:'activity.readiness-standing-required',message:'Safely finish standing before declaring readiness.'};
    if(requireStanding&&Object.values(this.ents).some((i:any)=>i.support?.kind==='in-hand'&&i.support.by===actor))return {code:'activity.readiness-hands-occupied',message:'Put down held small items through native transfer before declaring readiness.'};
    return null;
  }
  private readyFor(actor:string,host:string,venue:unknown){const p=this.programs.get(this.byActor.get(actor)??''),step=p?.steps[p.index];return !!p&&p.until!==undefined&&!p.action&&!p.stopping&&step?.verb==='activity_readiness_v1'&&step.params.host===host&&step.params.venue===venue&&step.params.activity==='classroom'&&this.holders(actor).length===0&&!this.readinessIssue(actor,step.params);}
  private classroomReadyActors(params:Record<string,unknown>,actor:string){return [...new Set([params.host,...(Array.isArray(params.presenters)?params.presenters:[]),...(Array.isArray(params.audience)?params.audience:[])].filter((a):a is string=>typeof a==='string'&&a!==actor&&this.readyFor(a,actor,params.readinessVenue)))];}
  private jointIssue(params: unknown, actor: string,classroom=false): Diag | null {
    const ids = new Set<string>();
    const visit = (v: unknown) => {
      if (typeof v === 'string' && this.ents[v]?.kind === 'human') ids.add(v);
      else if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') Object.values(v).forEach(visit);
    };
    visit(params);
    const p=params as Record<string,unknown>;if(classroom&&p.handoverScope==='owned-readiness/1'&&p.readinessVenue!==this.lecturePlacement?.id)return {code:'activity.readiness-venue-mismatch',message:'Readiness can join only its actual installed lecture venue.'};const ready=classroom&&p.handoverScope==='owned-readiness/1'&&typeof p.readinessVenue==='string'&&this.rt.world.regions[p.readinessVenue];
    for (const id of ids) if (id !== actor && !this.free(id) && !(ready&&this.readyFor(id,actor,p.readinessVenue)) && !(this.programs.get(this.byActor.get(id) ?? '')?.label.startsWith('host supper ') && this.holders(id).length === 0)) return {code: 'actor.busy', message: `${id} is doing something of their own`};
    return null;
  }
  campAnchors(): Anchor[] {
    const cfg: MarsWorldConfig = {...this.cfg, scene:'eden-camp',arrival:[-3,18],reference:[-1,17],arrivalPlace:'arrival'};
    const w = this.m.edenCampWorld();
    return new MarsEngine(this.m, new this.m.Runtime(w,this.registry,this.m.servicesFor(this.m.scenes)(w),this.m.invariants),cfg).anchors();
  }
  adoptCamp() {
    if(this.physical===this.campExpansionReader&&this.campExpansionReader&&hashOf(this.rt.world.base)===hashOf(this.campExpansionReader.base))return;
    if(this.physical)throw new Error('connected.adoption-unqualified');
    if (this.rt.world.base.campus === 'eden-camp') return;
    if (!this.isQuiet()) throw new Error('camp.adoption-not-quiet');
    const camp = this.m.edenCampWorld();
    for(const id of Object.keys(camp.entities))if(this.ents[id])throw new Error(`camp.entity-collision:${id}`);
    // Seal the old public render base before replacing campus/runtime. Even a
    // partial segment keeps its own geometry; no chunk straddles this boundary.
    this.finishRecorder();
    // Add the camp without deleting the original bodies, fixtures, object progress or regions.
    for (const [id, e] of Object.entries(camp.entities)) {
      this.ents[id] = e;
    }
    for (const [id, r] of Object.entries(camp.regions)) if (!this.rt.world.regions[id]) this.rt.world.regions[id] = r;
    this.rt.world.base = camp.base;
    this.cfg = {...this.cfg, scene: 'eden-camp', arrival: [-3,18], reference: [-1,17], arrivalPlace: 'arrival'};
    const actors = Object.keys(this.ents).filter(id => this.ents[id].kind === 'human').sort();
    if (actors.length >= 2) this.m.bindCampChess(this.rt.world, actors[0], actors[1]);
    this.rt = new this.m.Runtime(this.rt.world, this.registry, this.m.servicesFor(this.m.scenes)(this.rt.world), this.m.invariants);
    this.rt.beginActionEpoch(); this.cursor = 0;
    this.startRecorder();
  }
  previewCommonsTransition():CommonsTransitionAdmissionV1 {
    if(!this.cfg.commonsTransitionV1)return {ok:false,diagnostic:{code:'commons-transition.disabled',message:'this factory has no explicit commons transition reader'}};
    if(this.cfg.scene!=='greenfield'||this.programs.size||this.leaving.length)
      return {ok:false,diagnostic:{code:'commons-transition.not-quiet',message:'the original Greenfield programs and departures must finish first'}};
    const nextCfg={...this.cfg,...EDEN_COMMONS_WORLD,...(this.cfg.commonsArrivalV1?{safeArrivalV1:true}:{})};
    const p=prepareCommonsTransition(this.m,this.rt,this.rulesVersion,nativeRulesVersion(this.m.rulesVersion,nextCfg));
    return p.ok?{ok:true,transition:p.transition,anchors:this.anchorsOf(p.runtime.world,nextCfg)}:p;
  }
  /** Only the explicit dual-history factory enables this prospective reader.
   * Installing the reader itself changes no rules, body, program or hash. */
  enableCrewRemovalTransitionReaderV1(){this.crewRemovalTransitionReader=true;}
  enableCommonsFoodDeliveryReaderV1(recorded:CommonsFoodDeliveryV1[]=[]){this.foodDeliveryReader=true;if(recorded.length){this.finishRecorder();this.foodDeliveries=recorded.map(d=>commonsFoodDeliveryV1Schema.parse(d));if(this.foodDeliveries.length>4||this.foodDeliveries.some((d,i)=>d.batch!==i+1))throw Error('food-delivery.snapshot-sequence');this.renderBaseKey='';this.startRecorder();}}
  commonsFoodDeliveriesV1(){return structuredClone(this.foodDeliveries);}
  previewCommonsFoodDeliveryV1(deliveryId:string){
    const no=(code:string)=>({ok:false as const,diagnostic:{code:'food-delivery.'+code}});
    if(!this.foodDeliveryReader||!this.commonsProvisionsActive||this.cfg.scene!=='eden-commons')return no('reader-required');if(this.foodDeliveries.some(d=>d.deliveryId===deliveryId))return no('already-delivered');if(this.foodDeliveries.length>=4)return no('capacity');if(!this.canSnapshot())return no('resumable-boundary-required');
    const add=commonsFoodDeliveryItemsV1(this.foodDeliveries.length+1);if(Object.keys(add.entities).some(id=>this.ents[id]))return no('identity-collision');
    const snap=this.rt.snapshot(),graph=decodeSnapshot(snap);Object.assign(graph.world.entities,structuredClone(add.entities));const next={...snap,data:encode(graph),stateHash:hashOf(graph.world)};delete next.spatialEpoch;
    const detached=this.physical?this.physical.restore(next):this.m.Runtime.restore(next,this.registry,this.m.servicesFor(this.m.scenes)(graph.world),this.m.invariants);if(detached.invariants.some((inv:any)=>inv(detached).length))return no('physical-conflict');
    return {ok:true as const,transition:commonsFoodDeliveryV1Schema.parse({contract:'commons-food-delivery/1',deliveryId,batch:this.foodDeliveries.length+1,portions:8,tick:this.world.tick,fromRulesVersion:this.rulesVersion,toRulesVersion:this.composedRules(nativeRulesVersion(this.physical?.rulesVersion??this.m.rulesVersion,this.cfg),{food:true}),fromStateHash:this.stateHash(),additionsHash:add.hash,base:this.world.base})};
  }
  adoptCommonsFoodDeliveryV1(raw:CommonsFoodDeliveryV1){const fact=commonsFoodDeliveryV1Schema.parse(raw),p=this.previewCommonsFoodDeliveryV1(fact.deliveryId);if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(fact)!==hashOf(p.transition))throw Error('food-delivery.stale-or-forged');this.finishRecorder();Object.assign(this.ents,structuredClone(commonsFoodDeliveryItemsV1(fact.batch).entities));this.foodDeliveries.push(fact);this.renderBaseKey='';this.startRecorder();}
  enableExistingGreenLandmarkReaderV1(active=false){this.greenLandmarkReader=true;if(active){this.finishRecorder();this.greenLandmarkActive=true;this.renderBaseKey='';this.startRecorder();}}
  previewExistingGreenLandmarkV1(){
    const no=(code:string)=>({ok:false as const,diagnostic:{code:'green-landmark.'+code}});
    if(!this.greenLandmarkReader||this.cfg.scene!=='eden-commons')return no('reader-required');if(this.greenLandmarkActive)return no('already-installed');if(!this.canSnapshot())return no('resumable-boundary-required');
    const add=existingGreenLandmarkV1();if(this.ents[add.id]||this.world.regions[add.id])return no('identity-collision');
    const snap=this.rt.snapshot(),graph=decodeSnapshot(snap);Object.assign(graph.world.regions,structuredClone(add.regions));const next={...snap,data:encode(graph),stateHash:hashOf(graph.world)};delete next.spatialEpoch;
    const detached=this.physical?this.physical.restore(next):this.m.Runtime.restore(next,this.registry,this.m.servicesFor(this.m.scenes)(graph.world),this.m.invariants);if(detached.invariants.some((inv:any)=>inv(detached).length))return no('physical-conflict');
    const spatial=detached.services.spatial as Spatial;spatial.sync(detached.world);const grid=spatial.level(0);if(!grid||clearanceAt(grid,add.point)<HUMAN_RADIUS+.02)return no('unsupported-approach');
    return {ok:true as const,transition:existingGreenLandmarkTransitionV1Schema.parse({contract:'existing-green-landmark/1',tick:this.world.tick,fromRulesVersion:this.rulesVersion,toRulesVersion:this.composedRules(nativeRulesVersion(this.physical?.rulesVersion??this.m.rulesVersion,this.cfg),{green:true}),fromStateHash:this.stateHash(),additionsHash:add.hash,sourceProposalHash:add.sourceProposalHash,base:this.world.base})};
  }
  adoptExistingGreenLandmarkV1(raw:ExistingGreenLandmarkTransitionV1){const fact=existingGreenLandmarkTransitionV1Schema.parse(raw),p=this.previewExistingGreenLandmarkV1();if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(fact)!==hashOf(p.transition))throw Error('green-landmark.stale-or-forged');this.finishRecorder();Object.assign(this.world.regions,structuredClone(existingGreenLandmarkV1().regions));this.greenLandmarkActive=true;this.renderBaseKey='';this.startRecorder();}
  installEdenGroundReaderV1(reader:EdenGroundReaderV1){this.edenGroundReader=reader;}
  previewEdenGroundV1(){const reader=this.edenGroundReader;if(!reader)return {ok:false as const,diagnostic:{code:'eden-ground.reader-required'}};if(this.physical?.rulesVersion===reader.rulesVersion)return {ok:false as const,diagnostic:{code:'eden-ground.already-installed'}};if(!this.physical||this.cfg.scene!=='eden-commons'||!this.canSnapshot())return {ok:false as const,diagnostic:{code:'eden-ground.resumable-retained-world-required'}};const target=this.composedRules(nativeRulesVersion(reader.rulesVersion,this.cfg));if(target.length>200)return {ok:false as const,diagnostic:{code:'eden-ground.header-capacity'}};const p=reader.prepare(this.rt,this.rulesVersion,target,this.stateHash());return p.ok?{ok:true as const,transition:edenGroundTransitionV1Schema.parse(p.transition)}:p;}
  adoptEdenGroundV1(raw:EdenGroundTransitionV1){const fact=edenGroundTransitionV1Schema.parse(raw),reader=this.edenGroundReader!,p=this.previewEdenGroundV1();if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(p.transition)!==hashOf(fact))throw Error('eden-ground.stale-or-forged');const prepared=reader.prepare(this.rt,this.rulesVersion,fact.toRulesVersion,this.stateHash());if(!prepared.ok)throw Error(prepared.diagnostic.code);this.finishRecorder();this.rt=prepared.runtime;this.registry=this.rt.registry;this.physical=reader;this.cursor=0;this.renderBaseKey='';this.startRecorder();}
  lectureReadout(session:string){const read=readClassroom(this.rt,session);if(!read)return undefined;return {...read,physicalParticipants:read.participants.map(p=>{const body=this.ents[p.actor],fixture=this.ents[p.seat.split('#')[0]],slot=fixture?fixtureSlots(this.rt,fixture).find(s=>s.id===p.seat):undefined,seat=[...this.rt.records.values()].find((r:any)=>r.verb==='sit'&&r.params.actor===p.actor&&r.params.slot===p.seat&&r.phase==='occupied'&&this.rt.isActive(r.id));return {actor:p.actor,seat:p.seat,occupied:!!seat,seatActionId:seat?.id,claimHolders:this.rt.holder('slot:'+p.seat),slot:slot?{position:slot.p,yaw:slot.yaw,level:slot.level}:null,pose:body?structuredClone(body.pose):null,activity:body?.human?.activity};}),display:readClassroom(this.rt,session)?structuredClone(this.lecturePlacement?this.ents[edenLectureV1(this.lecturePlacement).displayId]?.equipment:undefined):undefined};}
  enableEdenLectureReaderV1(placement?:EdenLecturePlacementV1){this.lectureReader=true;if(placement){this.finishRecorder();this.lecturePlacement=structuredClone(placement);this.renderBaseKey='';this.startRecorder();}}
  previewEdenLectureV1(placement:EdenLecturePlacementV1){
    const no=(code:string)=>({ok:false as const,diagnostic:{code:'eden-lecture.'+code}});
    if(!this.lectureReader||this.cfg.scene!=='eden-commons')return no('reader-required');if(this.lecturePlacement)return no('already-installed');if(!this.canSnapshot())return no('resumable-boundary-required');if(this.rulesVersion.length+5>200)return no('header-capacity');
    let add;try{add=edenLectureV1(placement);}catch{return no('invalid-placement');}if(Object.keys(add.entities).some(id=>this.ents[id])||Object.keys(add.regions).some(id=>this.world.regions[id]))return no('identity-collision');
    const snap=this.rt.snapshot(),graph=decodeSnapshot(snap);Object.assign(graph.world.entities,structuredClone(add.entities));Object.assign(graph.world.regions,structuredClone(add.regions));const next={...snap,data:encode(graph),stateHash:hashOf(graph.world)};delete next.spatialEpoch;
    const copy=this.physical?this.physical.restore(next):this.m.Runtime.restore(next,this.registry,this.m.servicesFor(this.m.scenes)(graph.world),this.m.invariants);if(copy.invariants.some((inv:any)=>inv(copy).length))return no('physical-conflict');
    const spatial=copy.services.spatial as Spatial;spatial.sync(copy.world);const grid=spatial.level(0);if(!grid)return no('ground-required');for(const point of [add.entrance,...add.sideAisles])if(clearanceAt(grid,point)<HUMAN_RADIUS+.02)return no('access-blocked');
    const toRulesVersion=this.rulesVersion.replace(/\+ss\/1$/,'')+'+l/1'+(this.sleepSnapshotActive?'+ss/1':'');
    return {ok:true as const,transition:edenLectureTransitionV1Schema.parse({contract:'eden-lecture-transition/1',placement:add.placement,tick:this.world.tick,fromRulesVersion:this.rulesVersion,toRulesVersion,fromStateHash:this.stateHash(),layoutHash:add.layoutHash})};
  }
  adoptEdenLectureV1(raw:EdenLectureTransitionV1){const fact=edenLectureTransitionV1Schema.parse(raw),p=this.previewEdenLectureV1(fact.placement);if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(fact)!==hashOf(p.transition))throw Error('eden-lecture.stale-or-forged');const add=edenLectureV1(fact.placement);this.finishRecorder();Object.assign(this.ents,structuredClone(add.entities));Object.assign(this.world.regions,structuredClone(add.regions));this.lecturePlacement=structuredClone(fact.placement);this.renderBaseKey='';this.startRecorder();}
  private lectureBaseStateHash(){const saved=this.lecturePlacement,sleep=this.sleepSnapshotActive;try{this.lecturePlacement=undefined;this.sleepSnapshotActive=false;return this.stateHash();}finally{this.lecturePlacement=saved;this.sleepSnapshotActive=sleep;}}
  enableSocialEdenReaderV1(active=false){this.socialEdenReader=true;if(active){this.finishRecorder();this.socialEdenActive=true;this.renderBaseKey='';this.startRecorder();}}
  previewSocialEdenV1(){
    const no=(code:string)=>({ok:false as const,diagnostic:{code:'social-eden.'+code}});
    if(!this.socialEdenReader||this.cfg.scene!=='eden-commons')return no('reader-required');if(this.socialEdenActive)return no('already-installed');if(!this.canSnapshot())return no('resumable-boundary-required');
    const p=socialEdenV1();if(Object.keys(p.entities).some(id=>this.ents[id])||Object.keys(p.regions).some(id=>this.world.regions[id]))return no('identity-collision');
    const snap=this.rt.snapshot(),graph=decodeSnapshot(snap);Object.assign(graph.world.entities,structuredClone(p.entities));Object.assign(graph.world.regions,structuredClone(p.regions));
    const next={...snap,data:encode(graph),stateHash:hashOf(graph.world)};delete next.spatialEpoch;
    const detached=this.physical?this.physical.restore(next):this.m.Runtime.restore(next,this.registry,this.m.servicesFor(this.m.scenes)(graph.world),this.m.invariants);
    if(detached.invariants.some((inv:any)=>inv(detached).length))return no('physical-conflict');
    return {ok:true as const,transition:socialEdenTransitionV1Schema.parse({contract:'social-eden/1',tick:this.world.tick,fromRulesVersion:this.rulesVersion,toRulesVersion:this.composedRules(nativeRulesVersion(this.physical?.rulesVersion??this.m.rulesVersion,this.cfg),{social:true}),fromStateHash:this.stateHash(),additionsHash:p.hash,layoutHash:p.layoutHash,base:this.world.base})};
  }
  adoptSocialEdenV1(raw:SocialEdenTransitionV1){
    const fact=socialEdenTransitionV1Schema.parse(raw),p=this.previewSocialEdenV1();if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(fact)!==hashOf(p.transition))throw Error('social-eden.stale-or-forged');
    const add=socialEdenV1();this.finishRecorder();Object.assign(this.ents,structuredClone(add.entities));Object.assign(this.world.regions,structuredClone(add.regions));this.socialEdenActive=true;this.renderBaseKey='';this.startRecorder();
  }
  installRetainedCommonsShoreReader(reader:RetainedCommonsShoreReader){this.retainedShoreReader=reader;}
  previewRetainedCommonsShoreV1():RetainedCommonsShoreAdmissionV1{
    const reader=this.retainedShoreReader;
    if(!reader)return {ok:false,diagnostic:{code:'retained-shore.reader-required',message:'An explicit retained-world reader is required.'}};
    if(this.physical||this.cfg.scene!=='eden-commons'||this.programs.size||this.leaving.length||!this.isQuiet())return {ok:false,diagnostic:{code:'retained-shore.not-quiet-commons',message:'Finish programmes and departures at an exact quiet commons boundary.'}};
    const cfg={...this.cfg,walkBlockV1:true},target=this.composedRules(nativeRulesVersion(reader.rulesVersion,cfg));
    const prepared=reader.prepare(this.rt,this.rulesVersion,target,this.stateHash());return prepared.ok?{ok:true,transition:prepared.transition}:prepared;
  }
  adoptRetainedCommonsShoreV1(raw:RetainedCommonsShoreV1){
    const fact=retainedCommonsShoreV1Schema.parse(raw),preview=this.previewRetainedCommonsShoreV1();if(!preview.ok)throw Error(preview.diagnostic.code);
    if(hashOf(fact)!==hashOf(preview.transition))throw Error('retained-shore.stale-or-forged');
    const reader=this.retainedShoreReader!,prepared=reader.prepare(this.rt,fact.fromRulesVersion,fact.toRulesVersion,fact.fromStateHash);if(!prepared.ok)throw Error(prepared.diagnostic.code);
    this.finishRecorder();this.rt=prepared.runtime;this.registry=this.rt.registry;this.physical=reader;this.cfg={...this.cfg,walkBlockV1:true};
    this.cursor=this.rt.events.length;this.renderBaseKey='';this.keys.clear();this.acts.clear();this.ons.clear();this.startRecorder();
  }
  enableCommonsKitchenReaderV1(active=false,version:CommonsKitchenVersion='commons-kitchen/1'){this.commonsKitchenReader=true;this.commonsKitchenReaderVersion=version;if(active){this.commonsKitchenVersion=version;this.finishRecorder();this.commonsKitchenActive=true;this.renderBaseKey='';this.startRecorder();}}
  previewCommonsKitchenV1(version=this.commonsKitchenReaderVersion){
    if(!this.commonsKitchenReader||!this.commonsProvisionsActive||this.cfg.scene!=='eden-commons')return {ok:false as const,diagnostic:{code:'commons-kitchen.reader-unavailable'}};
    if(this.commonsKitchenActive)return {ok:false as const,diagnostic:{code:'commons-kitchen.already-installed'}};
    if(!this.canSnapshot())return {ok:false as const,diagnostic:{code:'commons-kitchen.resumable-boundary-required'}};
    const additions=commonsKitchen(version);if(Object.keys(additions.entities).some(id=>this.ents[id]))return {ok:false as const,diagnostic:{code:'commons-kitchen.identity-collision'}};
    // Validate the actual retained bodies, supports and reservations against
    // the new obstacles on a detached exact graph, never move them to fit.
    const snapshot=this.rt.snapshot(),graph=decodeSnapshot(snapshot);
    Object.assign(graph.world.entities,structuredClone(additions.entities));
    const next={...snapshot,data:encode(graph),stateHash:hashOf(graph.world)};delete next.spatialEpoch;
    const detached=this.m.Runtime.restore(next,this.registry,this.m.servicesFor(this.m.scenes)(graph.world),this.m.invariants);
    if(this.m.invariants.some(inv=>inv(detached).length))return {ok:false as const,diagnostic:{code:'commons-kitchen.physical-conflict'}};
    return {ok:true as const,transition:{contract:version,tick:this.world.tick,fromRulesVersion:this.rulesVersion,toRulesVersion:this.composedRules(nativeRulesVersion(this.physical?.rulesVersion??this.m.rulesVersion,this.cfg),{kitchen:version}),fromStateHash:this.stateHash(),additionsHash:additions.hash,base:structuredClone(this.world.base)}};
  }
  adoptCommonsKitchenV1(raw:unknown){
    const version=(raw as {contract?:unknown})?.contract;if(version!=='commons-kitchen/1'&&version!=='commons-kitchen/2')throw Error('commons-kitchen.version');
    const p=this.previewCommonsKitchenV1(version);if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(raw)!==hashOf(p.transition))throw Error('commons-kitchen.stale-or-forged');
    this.finishRecorder();Object.assign(this.ents,structuredClone(commonsKitchen(version).entities));this.commonsKitchenVersion=version;this.commonsKitchenActive=true;this.renderBaseKey='';this.startRecorder();
  }
  enableNativeSleepSnapshotReaderV1(active=false){this.sleepSnapshotReader=true;this.sleepSnapshotActive=active;if(active)this.rt.services.nativeSleepSnapshotV1=NATIVE_SLEEP_SNAPSHOT_V1;}
  previewNativeSleepSnapshotV1(){const no=(code:string)=>({ok:false as const,diagnostic:{code:'sleep-snapshot.'+code}});if(!this.sleepSnapshotReader)return no('reader-required');if(this.sleepSnapshotActive)return no('already-installed');if(!this.canSnapshot())return no('resumable-boundary-required');if(this.rulesVersion.length+5>200)return no('header-capacity');return {ok:true as const,transition:nativeSleepSnapshotPolicyV1Schema.parse({contract:NATIVE_SLEEP_SNAPSHOT_V1,tick:this.world.tick,fromRulesVersion:this.rulesVersion,toRulesVersion:this.rulesVersion+'+ss/1',fromStateHash:this.stateHash()})};}
  adoptNativeSleepSnapshotV1(raw:NativeSleepSnapshotPolicyV1){const fact=nativeSleepSnapshotPolicyV1Schema.parse(raw),p=this.previewNativeSleepSnapshotV1();if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(fact)!==hashOf(p.transition))throw Error('sleep-snapshot.stale-or-forged');this.finishRecorder();this.enableNativeSleepSnapshotReaderV1(true);this.renderBaseKey='';this.startRecorder();}
  private sleepSnapshotBaseStateHash(){const saved=this.sleepSnapshotActive;try{this.sleepSnapshotActive=false;return this.stateHash();}finally{this.sleepSnapshotActive=saved;}}
  enableCommonsNewcomerReaderV1(recorded:CommonsNewcomerResourcesV1[]=[]){this.newcomerReader=true;let next=9;const facts=recorded.map(f=>commonsNewcomerResourcesV1Schema.parse(f));for(const f of facts){if(f.firstSlot!==next)throw Error('newcomer-resources.snapshot-sequence');next+=f.placements.length;}this.newcomerResources=structuredClone(facts);}
  commonsNewcomerResourcesV1(){return this.newcomerResources.flatMap(f=>commonsNewcomerResourcesV1(f.firstSlot,f.placements).resources);}
  previewCommonsNewcomerResourcesV1(placements:readonly NewcomerResourcePlacementV1[]){
    const no=(code:string)=>({ok:false as const,diagnostic:{code:'newcomer-resources.'+code}});
    if(!this.newcomerReader||!this.commonsProvisionsActive||this.cfg.scene!=='eden-commons')return no('reader-required');if(!this.canSnapshot())return no('resumable-boundary-required');
    const firstSlot=9+this.newcomerResources.reduce((n,f)=>n+f.placements.length,0);let add;try{add=commonsNewcomerResourcesV1(firstSlot,placements);}catch{return no('capacity-or-layout');}
    if(Object.keys(add.entities).some(id=>this.ents[id])||Object.keys(add.regions).some(id=>this.world.regions[id]))return no('identity-collision');
    const allMats=[...Object.values(add.regions),...Object.values(this.world.regions).filter(r=>r.id.startsWith('commons-mat-'))];
    for(const r of Object.values(add.regions)){const p=r.polygon;for(const other of allMats){if(other.id===r.id)continue;const q=other.polygon;if(Math.max(...p.map(v=>v[0]))>=Math.min(...q.map(v=>v[0]))&&Math.min(...p.map(v=>v[0]))<=Math.max(...q.map(v=>v[0]))&&Math.max(...p.map(v=>v[1]))>=Math.min(...q.map(v=>v[1]))&&Math.min(...p.map(v=>v[1]))<=Math.max(...q.map(v=>v[1])))return no('overlapping-rest');}}
    const snap=this.rt.snapshot(),graph=decodeSnapshot(snap);Object.assign(graph.world.entities,structuredClone(add.entities));Object.assign(graph.world.regions,structuredClone(add.regions));const next={...snap,data:encode(graph),stateHash:hashOf(graph.world)};delete next.spatialEpoch;
    const detached=this.physical?this.physical.restore(next):this.m.Runtime.restore(next,this.registry,this.m.servicesFor(this.m.scenes)(graph.world),this.m.invariants);if(detached.invariants.some((inv:any)=>inv(detached).length))return no('physical-conflict');
    const spatial=detached.services.spatial as Spatial;spatial.sync(detached.world);const grid=spatial.level(0);if(!grid)return no('ground-required');
    for(const resource of add.resources){const mat=add.regions[resource.mat],points:[number,number][]=[...mat.polygon,resource.sleepReturn,[resource.bowlHome[0],resource.bowlHome[2]],[resource.spoonHome[0],resource.spoonHome[2]]];for(let x=mat.polygon[0][0];x<=mat.polygon[1][0];x+=.25)for(let z=mat.polygon[0][1];z<=mat.polygon[2][1];z+=.25)points.push([x,z]);for(const point of points){if(clearanceAt(grid,point)<HUMAN_RADIUS+.02)return no('unsupported-envelope');}}
    const toRulesVersion=this.rulesVersion.replace('+commons-provisions/1','+cp/2');
    return {ok:true as const,transition:commonsNewcomerResourcesV1Schema.parse({contract:'commons-newcomer-resources/1',firstSlot,placements,tick:this.world.tick,fromRulesVersion:this.rulesVersion,toRulesVersion,fromStateHash:this.stateHash(),additionsHash:add.hash,base:this.world.base})};
  }
  adoptCommonsNewcomerResourcesV1(raw:CommonsNewcomerResourcesV1){const fact=commonsNewcomerResourcesV1Schema.parse(raw),p=this.previewCommonsNewcomerResourcesV1(fact.placements);if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(fact)!==hashOf(p.transition))throw Error('newcomer-resources.stale-or-forged');const add=commonsNewcomerResourcesV1(fact.firstSlot,fact.placements);this.finishRecorder();Object.assign(this.ents,structuredClone(add.entities));Object.assign(this.world.regions,structuredClone(add.regions));this.newcomerResources.push(fact);this.renderBaseKey='';this.startRecorder();}
  private newcomerBaseStateHash(){const saved=this.newcomerResources,sleep=this.sleepSnapshotActive,lecture=this.lecturePlacement;try{this.newcomerResources=[];this.sleepSnapshotActive=false;this.lecturePlacement=undefined;return this.stateHash();}finally{this.newcomerResources=saved;this.sleepSnapshotActive=sleep;this.lecturePlacement=lecture;}}
  enableCommonsProvisionsReaderV1(active=false){this.commonsProvisionsReader=true;if(active){this.finishRecorder();this.commonsProvisionsActive=true;this.renderBaseKey='';this.startRecorder();}}
  previewCommonsProvisionsV1(){
    if(!this.commonsProvisionsReader||this.cfg.scene!=='eden-commons')return {ok:false as const,diagnostic:{code:'commons-provisions.reader-unavailable'}};
    if(this.commonsProvisionsActive)return {ok:false as const,diagnostic:{code:'commons-provisions.already-installed'}};
    if(!this.canSnapshot())return {ok:false as const,diagnostic:{code:'commons-provisions.resumable-boundary-required'}};
    const p=commonsProvisions();
    if(Object.keys(p.entities).some(id=>this.ents[id])||Object.keys(p.regions).some(id=>this.world.regions[id]))return {ok:false as const,diagnostic:{code:'commons-provisions.identity-collision'}};
    return {ok:true as const,transition:{contract:'commons-provisions/1' as const,tick:this.world.tick,fromRulesVersion:this.rulesVersion,toRulesVersion:this.composedRules(nativeRulesVersion(this.physical?.rulesVersion??this.m.rulesVersion,this.cfg),{provisions:true}),fromStateHash:this.stateHash(),additionsHash:p.hash,base:structuredClone(this.world.base)}};
  }
  adoptCommonsProvisionsV1(raw:unknown){
    const p=this.previewCommonsProvisionsV1();if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(raw)!==hashOf(p.transition))throw Error('commons-provisions.stale-or-forged');
    const additions=commonsProvisions();this.finishRecorder();Object.assign(this.ents,structuredClone(additions.entities));Object.assign(this.world.regions,structuredClone(additions.regions));
    this.commonsProvisionsActive=true;this.renderBaseKey='';this.startRecorder();
  }
  previewCrewRemovalTransitionV1():CrewRemovalTransitionAdmissionV1 {
    const no=(code:string,message:string)=>({ok:false as const,diagnostic:{code:'crew-removal-transition.'+code,message}});
    if(!this.crewRemovalTransitionReader)return no('reader-unavailable','an explicit legacy native dual-policy reader is required');
    if(this.cfg.safeCrewRemoval)return no('already-adopted','crew-removal/1 is already active');
    if(!this.isQuiet()||this.leaving.length||!this.canSnapshot())return no('not-quiet','programs, borrowed crews and departures must finish at a resumable native boundary');
    return {ok:true,transition:crewRemovalTransitionV1Schema.parse({contract:'crew-removal-transition/1',tick:this.world.tick,
      fromRulesVersion:this.rulesVersion,toRulesVersion:nativeRulesVersion(this.m.rulesVersion,{...this.cfg,safeCrewRemoval:true}),
      fromStateHash:this.stateHash(),nativeWorldHash:this.rt.stateHash(),base:this.world.base})};
  }
  adoptCrewRemovalTransitionV1(raw:CrewRemovalTransitionV1){
    const fact=crewRemovalTransitionV1Schema.parse(raw),preview=this.previewCrewRemovalTransitionV1();
    if(!preview.ok)throw Error(preview.diagnostic.code+': '+preview.diagnostic.message);
    if(hashOf(fact)!==hashOf(preview.transition))throw Error('crew-removal-transition.stale-or-forged');
    this.finishRecorder();this.cfg={...this.cfg,safeCrewRemoval:true};this.startRecorder();
  }
  adoptCommons(raw:CommonsTransitionV1) {
    const expected=commonsTransitionV1Schema.parse(raw),preview=this.previewCommonsTransition();
    if(!preview.ok)throw new Error(`${preview.diagnostic.code}: ${preview.diagnostic.message}`);
    if(hashOf(expected)!==hashOf(preview.transition))throw new Error('commons-transition.stale-or-forged');
    const prepared=prepareCommonsTransition(this.m,this.rt,expected.fromRulesVersion,expected.toRulesVersion);
    if(!prepared.ok)throw new Error(`${prepared.diagnostic.code}: ${prepared.diagnostic.message}`);
    this.finishRecorder();this.rt=prepared.runtime;this.cursor=0;
    this.cfg={...this.cfg,...EDEN_COMMONS_WORLD,...(this.cfg.commonsArrivalV1?{safeArrivalV1:true}:{})};
    this.startRecorder();
  }
  restockCamp() {
    const expanded=this.physical===this.campExpansionReader&&this.campExpansionReader&&hashOf(this.rt.world.base)===hashOf(this.campExpansionReader.base);
    if ((this.rt.world.base.campus !== 'eden-camp'&&!expanded) || !this.isQuiet()) return;
    // A logged practical supply edit; no trade/economy and no object progress reset.
    const camp = this.m.edenCampWorld();
    for (const id of ['stew-pot', 'beans-bowl', 'greens-bowl', 'water-bowl', 'seed-bowl',...(expanded?['camp-eight-stew']:[])]) {
      const e = this.ents[id], initial = camp.entities[id]??(expanded?this.campExpansionReader!.initialEntity(id):undefined);
      if (e?.contents && initial?.contents && !e.foodPreparation) e.contents = structuredClone(initial.contents);
    }
  }
  /** The explicit factory installs a reader without altering legacy state or
   * history identity. Installation alone grants no scene change. */
  installCampExpansionReader(reader:CampExpansionReader){this.campExpansionReader=reader;}
  previewCampExpansionV1():CampExpansionAdmissionV1{
    const reader=this.campExpansionReader;
    if(!reader)return {ok:false,diagnostic:{code:'camp-expansion.disabled',message:'No explicit camp expansion reader is installed.'}};
    if(this.cfg.scene!=='eden-camp'||this.physical||this.programs.size||this.leaving.length)
      return {ok:false,diagnostic:{code:'camp-expansion.not-idle-camp',message:'The original camp must have finished all programs and physical departures.'}};
    const prepared=reader.prepare(this.rt,this.rulesVersion,nativeRulesVersion(reader.rulesVersion,this.cfg));
    if(!prepared.ok)return prepared;
    const e=new MarsEngine(this.m,prepared.runtime,this.cfg,undefined,reader);
    return {ok:true,transition:prepared.transition,anchors:e.anchors()};
  }
  adoptCampExpansionV1(raw:CampExpansionV1){
    const expected=campExpansionV1Schema.parse(raw),preview=this.previewCampExpansionV1();
    if(!preview.ok||hashOf(preview.transition)!==hashOf(expected))throw new Error('camp-expansion.stale-or-forged');
    const prepared=this.campExpansionReader!.prepare(this.rt,expected.fromRulesVersion,expected.toRulesVersion);
    if(!prepared.ok)throw new Error(prepared.diagnostic.code+': '+prepared.diagnostic.message);
    this.finishRecorder();this.rt=prepared.runtime;this.registry=this.rt.registry;this.physical=this.campExpansionReader;
    this.cursor=this.rt.events.length;this.renderBaseKey='';this.startRecorder();
  }

  configureRuntimePolicy(policy: {sleepBlockTicks:number;quietSeatCourtesy?:boolean;fixtureGroundGoalsV1?:boolean;nativeArrivalWitnessV1?:boolean;quietLandingCourtesyV1?:boolean;quietStallReleaseV1?:boolean;stairMakeWayV1?:boolean;yieldTimeoutV1?:boolean;spreadV2?:boolean}) {
    if(policy.stairMakeWayV1===true)this.cfg={...this.cfg,stairMakeWayV1:true};
    if(policy.spreadV2===true)this.cfg={...this.cfg,spreadV2:true};
    if(policy.yieldTimeoutV1===true)this.cfg={...this.cfg,yieldTimeoutV1:true};
    if(policy.quietStallReleaseV1===true)this.cfg={...this.cfg,quietStallReleaseV1:true};
    if(policy.quietLandingCourtesyV1===true)this.cfg={...this.cfg,quietLandingCourtesyV1:true};
    if(policy.nativeArrivalWitnessV1===true)this.cfg={...this.cfg,nativeArrivalWitnessV1:true};
    if(policy.fixtureGroundGoalsV1===true)this.cfg={...this.cfg,fixtureGroundGoalsV1:true};
    if (!Number.isInteger(policy.sleepBlockTicks) || policy.sleepBlockTicks < 20 || policy.sleepBlockTicks > 72000) throw new Error('runtime-policy.sleep-limit');
    if(policy.quietSeatCourtesy !== undefined && typeof policy.quietSeatCourtesy !== "boolean") throw new Error("runtime-policy.quiet-seat-courtesy");
    this.cfg.sleepBlockTicks = policy.sleepBlockTicks;
    this.cfg.quietSeatCourtesy = policy.quietSeatCourtesy;
  }
  configureClock(clock: { origin: number; dayTicks: number }) {
    if(!Number.isSafeInteger(clock.origin)||clock.origin<0||!Number.isSafeInteger(clock.dayTicks)||clock.dayTicks<=0)
      throw new TypeError('invalid render clock');
    if(this.cfg.clock?.origin===clock.origin&&this.cfg.clock?.dayTicks===clock.dayTicks){this.updateClock();return;}
    this.finishRecorder();this.cfg.clock={...clock};this.updateClock();this.startRecorder();
  }
  private updateClock() {
    const c = this.cfg.clock; if (!c) return;
    this.rt.world.env.datetime = new Date(Date.UTC(2026, 9, 3, 6) + Math.max(0, this.rt.tick - c.origin) / c.dayTicks * 86400_000).toISOString();
    if (this.rt.tick % 10 === 0) this.out.changes.push([this.rt.tick, '$env', 'datetime', this.rt.world.env.datetime]);
  }
  beginQuiet() { this.quiet = true; }
  private advanceQuiet() {
    if(this.cfg.quietLandingCourtesyV1)this.clearQuietWalkLandings();
    if (this.cfg.quietSeatCourtesy) this.clearQuietSeatExits();
    if (this.programs.size) return;
    // Cancel only roots: their ordinary exits own and drain their child controllers.
    for (const r of this.rt.records.values()) if (this.rt.isActive(r.id) && !r.parent && r.internalCause !== 'traffic.make-way' && !['put_item','hold_items','face'].includes(r.verb)) this.rt.cancel(r.id, {code:'world.quiet-point',message:'quiet checkpoint after the activity finished'});
    const initial = this.cfg.scene === 'eden-camp' ? this.m.edenCampWorld().entities : {};
    for (const e of Object.values(this.ents) as any[]) if (e.support?.kind === 'in-hand') {
      const actor = e.support.by;
      if (this.holders(actor).length || this.rt.holder(`entity:${e.id}`).length) continue;
      const home = initial[e.id]?.support??(this.physical===this.campExpansionReader?this.campExpansionReader?.initialEntity(e.id)?.support:undefined);
      const slot = home?.kind === 'resting-on' && home.slot ? `${home.on}#${home.slot}` : 'ground';
      const params = {actor,item:e.id,surfaceSlot:slot};
      if (!this.plan('put_item',params)) this.rt.submit('put_item',params);
      else if (!this.plan('put_item',{...params,surfaceSlot:'ground'})) this.rt.submit('put_item',{...params,surfaceSlot:'ground'});
      else {
        // A held item in front of a fixture needs a different facing before it can be set down.
        const a = this.ents[actor], yaw = a.pose.yaw + Math.PI/2;
        this.rt.submit('face',{actor,target:{point:[a.pose.p[0]+Math.cos(yaw)*2,a.pose.p[2]+Math.sin(yaw)*2]}});
      }
    }
  }
  /** A free idle bystander: no programme, task, grip, seat, ride, sleep pose, borrow or hold (as quiet landing courtesy). */
  private stairYieldable(id:string){const o=this.ents[id] as any;return !!o?.human&&!o.human.task&&!o.human.grip&&!o.human.on&&!o.human.riding&&!o.human.sleepPose&&!o.human.boatPassenger&&!o.human.boatTransit&&!this.byActor.has(id)&&!this.actorBorrowed(id)&&!this.holders(id).length&&['idle','wait'].includes(o.human.activity);}
  private clearQuietWalkLandings(){
    for(const live of this.rt.live.values()){
      const ex=live.exec,leg=ex?.route?.legs?.[ex.leg];
      if(live.rec.verb!=='walk_to'||!ex.cancelTo||leg?.kind!=='link'||live.rec.status!=='blocked')continue;
      const entry=leg.ascending?leg.link.from:leg.link.to,exit=leg.ascending?leg.link.to:leg.link.from,landing=ex.cancelTo==='exit'?exit:entry;
      for(const other of Object.values(this.ents) as any[]){
        if(other.id===ex.actor||!other.human||other.human.level!==landing.level||other.human.task||other.human.grip||other.human.on||other.human.riding||other.human.sleepPose||other.human.boatPassenger||other.human.boatTransit||this.byActor.has(other.id)||this.actorBorrowed(other.id)||this.holders(other.id).length)continue;
        if(!['idle','wait'].includes(other.human.activity)||Math.hypot(other.pose.p[0]-landing.p[0],other.pose.p[2]-landing.p[1])>2*HUMAN_RADIUS+.1)continue;
        // Existing autonomous traffic controller plans a supported ordinary
        // step. It never teleports or takes over an owned active programme.
        this.m.makeWay(this.rt,other.id,landing.p);
      }
    }
  }
  private clearQuietSeatExits() {
    // Completed social cards can retain physical holds while another card is
    // still draining. Release only those idle holds, retaining every program's
    // actor/crew, then let native makeWay find a legal courtesy step for a free
    // bystander obstructing a seat's ordinary stand-up path.
    for (const live of this.rt.live.values()) {
      const r=live.rec;
      if (r.parent || !['gather','converse','take_slot','sit'].includes(r.verb)) continue;
      if ([...this.programs.values()].some(p=>p.action===r.id || [p.actor,...(p.build?.crew??[])].some(a=>this.holders(a).includes(r.id)))) continue;
      this.rt.cancel(r.id,{code:'world.quiet-point',message:'release a completed social hold while remaining work drains'});
    }
    for (const live of this.rt.live.values()) {
      if (!['sit','take_slot'].includes(live.rec.verb) || live.exec?.phase!=='stand-up' || !live.exec.approach) continue;
      const actor=this.ents[live.exec.actor],from=live.exec.from ?? [actor.pose.p[0],actor.pose.p[2]],to=live.exec.approach;
      const dx=to[0]-from[0],dz=to[1]-from[1],len=dx*dx+dz*dz;
      for(const other of Object.values(this.ents) as any[]) {
        if(other.id===actor.id || !other.human || other.human.level!==actor.human.level || this.byActor.has(other.id)||this.actorBorrowed(other.id)) continue;
        const t=len ? Math.max(0,Math.min(1,((other.pose.p[0]-from[0])*dx+(other.pose.p[2]-from[1])*dz)/len)):0;
        if(Math.hypot(other.pose.p[0]-from[0]-t*dx,other.pose.p[2]-from[1]-t*dz)<0.7) this.m.makeWay(this.rt,other.id,to);
      }
    }
  }
  isQuiet() { return this.programs.size === 0 && this.m.compactionIssue(this.rt) === null; }
  compact() {
    if (!this.isQuiet()) throw new Error('compaction.not-quiet');
    this.finishRecorder();
    this.rt = this.m.compactRuntime(this.rt, this.physical?.services??this.m.servicesFor(this.m.scenes));
    this.registry = this.rt.registry; this.cursor = 0; this.quiet = false;
    if(this.sleepSnapshotActive)this.rt.services.nativeSleepSnapshotV1=NATIVE_SLEEP_SNAPSHOT_V1;
    this.startRecorder();
  }

  // ------------------------------------------------------------------ checkpoints
  /** Mars's own resumable snapshot, plus which program each actor is in. Body-language steps lower only to verbs Mars can resume exactly. */
  snapshot(): EngineSnapshot {
    const mars = this.rt.snapshot();
    return structuredClone({ ...(this.lecturePlacement?{edenLectureV1:this.lecturePlacement,lectureBaseStateHash:this.lectureBaseStateHash()}:{}), ...(this.sleepSnapshotActive?{nativeSleepSnapshotV1:true,sleepSnapshotBaseStateHash:this.sleepSnapshotBaseStateHash()}:{}), ...(this.newcomerResources.length?{commonsNewcomerResourcesV1:structuredClone(this.newcomerResources),newcomerBaseStateHash:this.newcomerBaseStateHash()}:{}), format: SNAPSHOT_FORMAT, tick: this.rt.tick as number, stateHash: this.stateHash(), mars, dropped: mars.dropped?.length ?? 0, programs: [...this.programs.values()], nextProg: this.nextProg, leaving: this.leaving, cfg: this.cfg, ...(this.cfg.scene==='eden-commons'?{commonsVersion:'commons/1'}:{}), quiet: this.quiet, ...(this.commonsProvisionsActive?{commonsProvisionsV1:true}:{}), ...(this.commonsKitchenActive?{commonsKitchenV1:true}:{}), ...(this.socialEdenActive?{socialEdenV1:true}:{}), ...(this.greenLandmarkActive?{greenLandmarkV1:true}:{}), ...(this.foodDeliveries.length?{foodDeliveriesV1:structuredClone(this.foodDeliveries)}:{}), ...(this.commonsKitchenActive&&this.commonsKitchenVersion==='commons-kitchen/2'?{commonsKitchenVersion:this.commonsKitchenVersion}:{}), ...(this.physical?{physicalBinding:this.physical.rulesVersion}:{}) });
  }
  canSnapshot(): boolean {
    // A legacy formation callback is not data and must wait for a quiet point.
    for (const live of this.rt.live.values()) {
      if (typeof live.exec?.detour?.clearOf === 'function') return false;
      // Some codecs admit only a safe execution phase (raise permits lowering).
      // A serializer's presence alone does not establish resumability.
      if (live.def.serializeExec) {
        try { live.def.serializeExec(this.rt, live.exec); }
        catch (error) { if (error instanceof CodecError) return false; throw error; }
      }
    }
    for (const r of this.rt.records.values()) if (this.rt.isActive(r.id) && this.m.nonResumableReason(this.registry.get(r.verb))) return false;
    return true;
  }
  takeChunks(afterTick: number) { return this.chunks.filter(c => c.toTick > afterTick); }
}

function centroid(poly: [number, number][]): [number, number] { let x = 0, z = 0; for (const p of poly) { x += p[0]; z += p[1]; } return [r3(x / poly.length), r3(z / poly.length)]; }
function nativeRulesVersion(version:string,cfg:MarsWorldConfig){return `sim-mars/1+${version}${cfg.safeCrewRemoval?'+crew-removal/1':''}${cfg.scene==='eden-commons'?'+commons/1':''}${cfg.safeArrivalV1?'+arrival-clearance/1':''}${cfg.walkBlockV1?'+walk-block/1':''}${cfg.disassemblyV1?'+'+DISASSEMBLY_POLICY:''}`;}

/** The factory is made once the Mars engine has been loaded (an async import); after that everything is synchronous. */
export async function marsFactory(cfg: MarsWorldConfig = PROVING_GROUND): Promise<EngineFactory> {
  const m = await loadMars();
  // disassembly/1 adds its reverse verbs to this engine's registry only; the default registry is unchanged.
  const registry = cfg.disassemblyV1 ? disassemblyRegistry(m.createRegistry) : m.createRegistry(), services = m.servicesFor(m.scenes);
  return {
    rulesVersion: nativeRulesVersion(m.rulesVersion,cfg),
    // A failed cross-policy checkpoint restore must not turn into replay under
    // another removal policy. An explicit, qualified transition is separate.
    canReplayHistory: version => {
      if((cfg.walkBlockV1||cfg.safeArrivalV1||cfg.scene==='eden-commons'||cfg.disassemblyV1)&&version!==nativeRulesVersion(m.rulesVersion,cfg))return false;
      if(!cfg.disassemblyV1&&/\+disassembly\//.test(version))return false;
      const walk=version.match(/\+walk-block\/[^+]+/g)??[];
      if(cfg.walkBlockV1?walk.length!==1||walk[0]!=='+walk-block/1':walk.length!==0)return false;
      const arrival=version.match(/\+arrival-clearance\/[^+]+/g)??[];
      if(cfg.safeArrivalV1?arrival.length!==1||arrival[0]!=='+arrival-clearance/1':arrival.length!==0)return false;
      const commons=version.match(/\+commons\/[^+]+/g)??[];
      if(cfg.scene==='eden-commons'?commons.length!==1||commons[0]!=='+commons/1':commons.length!==0)return false;
      const policies=version.match(/\+crew-removal\/[^+]+/g)??[];
      return cfg.safeCrewRemoval?policies.length===1&&policies[0]==='+crew-removal/1':policies.length===0;
    },
    // Candidate removal changes controller behavior: restore only its exact
    // policy/version. Legacy activities31 compatibility remains unchanged.
    canRestoreSnapshot: version => cfg.walkBlockV1||cfg.safeArrivalV1||cfg.safeCrewRemoval||cfg.disassemblyV1||cfg.scene==='eden-commons'?version===nativeRulesVersion(m.rulesVersion,cfg):[m.rulesVersion,m.rulesVersion.replace('+bodies/1',''),m.rulesVersion.replace('+bodies/1','').replace('activities/31','activities/29')].some(v=>version===nativeRulesVersion(v,cfg)),
    /** The synthetic proving ground (a campfire, two benches, a lawn), emptied of its test people: Souls arrive by being born. */
    genesis(seed: string): WorldState {
      if (cfg.scene === 'littlemartians') return m.littleMartiansWorld(seed);
      if (cfg.scene === 'eden-commons') return m.edenCommonsWorld(seed);
      if (cfg.scene === 'greenfield') return m.greenFieldWorld(seed);
      if (cfg.scene === 'eden-camp') return m.edenCampWorld(seed);
      if (cfg.scene === 'meal') { const w = m.mealWorld(); w.rng = m.seedRng(seed); return w as WorldState; }
      const w = m.provingGroundWorld();
      for (const id of Object.keys(w.entities)) if (w.entities[id].kind === 'human') delete w.entities[id];
      w.rng = m.seedRng(seed);
      return w as WorldState;
    },
    create: (world) => {
      if(cfg.scene==='eden-commons'&&(world.base.campus!=='eden-commons'||world.base.staticHash!==m.edenCommonsWorld().base.staticHash))throw new Error('world commons physical base differs from the native factory');
      return new MarsEngine(m, new m.Runtime(world, registry, services(world), m.invariants), cfg);
    },
    restore(snap: EngineSnapshot) {
      if('nativeSleepSnapshotV1' in snap)throw Error('sleep-snapshot.reader-required');
      if('commonsNewcomerResourcesV1' in snap)throw Error('newcomer-resources.reader-required');
      if('commonsKitchenV1' in snap)throw Error('commons-kitchen.reader-required');
      if('commonsProvisionsV1' in snap)throw Error('commons-provisions.reader-required');
      const s = structuredClone(snap) as EngineSnapshot & { mars: any; programs: Prog[]; nextProg: number; leaving: string[]; cfg: MarsWorldConfig; commonsVersion?:string; quiet?: boolean };
      if ('physicalBinding' in s)throw new Error('snapshot physical binding differs from the legacy factory');
      if (s.format !== SNAPSHOT_FORMAT) throw new Error(`bad snapshot format ${s.format}`);
      if(!!s.cfg?.walkBlockV1!==!!cfg.walkBlockV1)throw new Error('snapshot walk policy differs from the native factory');
      if(!!s.cfg?.safeArrivalV1!==!!cfg.safeArrivalV1)throw new Error('snapshot arrival policy differs from the native factory');
      if(!!s.cfg?.safeCrewRemoval!==!!cfg.safeCrewRemoval)throw new Error('snapshot removal policy differs from the native factory');
      if(!!s.cfg?.disassemblyV1!==!!cfg.disassemblyV1)throw new Error('snapshot disassembly policy differs from the native factory');
      if((s.cfg?.scene==='eden-commons'||cfg.scene==='eden-commons')&&s.cfg?.scene!==cfg.scene)throw new Error('snapshot commons layout differs from the native factory');
      if(cfg.scene==='eden-commons'&&s.commonsVersion!=='commons/1')throw new Error('snapshot commons rules differ from the native factory');
      // Spatial services are rebuilt for the same base scene; the snapshot carries the rest.
      const scene = (s.cfg ?? cfg).scene;
      const base = scene === 'eden-commons' ? m.edenCommonsWorld() : scene === 'littlemartians' ? m.littleMartiansWorld() : scene === 'greenfield' ? m.greenFieldWorld() : scene === 'eden-camp' ? m.edenCampWorld() : scene === 'meal' ? m.mealWorld() : m.provingGroundWorld();
      const rt = m.Runtime.restore(s.mars, registry, services(base), m.invariants);
      if(cfg.scene==='eden-commons'&&(rt.world.base.campus!=='eden-commons'||rt.world.base.staticHash!==base.base.staticHash))throw new Error('snapshot commons physical base differs from the native factory');
      const engine = new MarsEngine(m, rt, s.cfg ?? cfg, { programs: s.programs, nextProg: s.nextProg, leaving: s.leaving });
      if (s.quiet) engine.beginQuiet();
      return engine;
    },
  };
}

/** Explicit reader for a logged Greenfield -> commons physical checkpoint.
 * Genesis stays Greenfield. A newly constructed commons world is not a replay
 * substitute; only its validated checkpoint can enter this history reader. */
export async function marsCommonsTransitionFactory(cfg:MarsWorldConfig=GREEN_FIELD_WORLD,options?:{safeArrivalV1?:boolean}):Promise<EngineFactory> {
  if(cfg.scene!=='greenfield')throw new Error('commons-transition.factory-origin');
  const target=options?.safeArrivalV1?{commonsArrivalV1:true,safeArrivalV1:true}:{};
  const old=await marsFactory({...cfg,commonsTransitionV1:true,...(options?.safeArrivalV1?{commonsArrivalV1:true}:{})}),
    next=await marsFactory({...cfg,...EDEN_COMMONS_WORLD,commonsTransitionV1:true,...target});
  const allowed=(v:string)=>v===old.rulesVersion||v===next.rulesVersion;
  return {rulesVersion:old.rulesVersion,canReplayHistory:allowed,canRestoreSnapshot:allowed,
    genesis:old.genesis,
    create(world){if(hashOf(world.base)!==hashOf(old.genesis('base').base))throw new Error('commons-transition.genesis-base');return old.create(world);},
    restore(snapshot){
      const s=structuredClone(snapshot) as EngineSnapshot&{cfg:MarsWorldConfig;mars:any};
      const scene=s.cfg?.scene;
      if(scene!=='greenfield'&&scene!=='eden-commons')throw new Error('commons-transition.snapshot-origin');
      if(scene==='eden-commons'&&!s.cfg.commonsTransitionV1)throw new Error('commons-transition.snapshot-without-reader');
      const expected=(scene==='greenfield'?old:next).genesis('base').base;
      if(hashOf(decodeSnapshot(s.mars).world.base)!==hashOf(expected))throw new Error('commons-transition.snapshot-base');
      s.cfg.commonsTransitionV1=true;
      if(options?.safeArrivalV1)s.cfg.commonsArrivalV1=true;
      return (scene==='greenfield'?old:next).restore(s);
    },
    validateHistoryHead(engine,recorded){if(engine.rulesVersion!==recorded)throw new Error('commons-transition.history-head-differs');},
  };
}
