// The engine adapter: what the wrapper (server, brain, clients) needs from ANY
// engine. The toy engine implements it now; the Mars engine gets an adapter later.
import type { ActionRecord } from './actions.ts';
import type { RuntimeEvent } from './runtime.ts';
import type { WorldState, Vec3 } from './world.ts';
import type { VerbInfo } from './registry.ts';

/** A feasible activity for an actor, params already bound. The brain picks by id only. */
export type ActivityOption = {
  id: string;            // e.g. 'attend:campfire'
  template: string;      // activity template name, e.g. 'attend'
  label: string;         // human readable: 'Walk to the campfire and join the gathering'
  servesIntent?: boolean; // code-known fact: this option is what the standing intent asks for
  goodWhen?: string;     // when this is the right choice (feeds Jev criteria)
  notFor?: string;       // when this is a bad choice (feeds Jev criteria)
  target?: string;       // entity/region id
  steps: { verb: string; params: Record<string, unknown> }[];
  durationHint: 'seconds' | 'minute' | 'minutes' | 'long';
};

/** Standing intent (doc 11). Closed goal list; params bounded. */
export type Intent = {
  goal: 'wander' | 'go' | 'follow' | 'attend' | 'gather' | 'converse' | 'rest' | 'perform' | 'build' | 'place';
  target?: string | null;
  params?: Record<string, string | number | boolean>;
  until?: { tick: number } | { event: string } | null;
  fallback?: Intent | null;
};

/** A path decision as broadcast to clients (Mars PoseSample keyframe format: [tick, x mm, y mm, z mm, yaw mrad]). */
export type PoseSample = number[];
export type PathCommit = { entity: string; startTick: number; speed: number; waypoints: PoseSample[]; activity: string; actionId: string };
export type ChangeEvent = [number, string, string, unknown]; // [tick, entityId, field, value|null]

/**
 * A physical anchor: something in the engine's world that meaning can refer to
 * (a region, a named place, a usable fixture). The kernel mirrors anchors as
 * place Things; depiction programs refer back to them by `entity` or `point`.
 */
export type Anchor = { id: string; kind: 'region' | 'place'; name: string; in?: string; entity?: string; point?: [number, number]; tags?: string[] };

/** A depiction program for one actor: an ordered list of engine verbs. */
export type Program = { actor: string; label: string; steps: { verb: string; params: Record<string, unknown> }[] };
/** Progress of a program, reported by the engine each tick. `step` is the index now running (or that ended it). */
export type ProgramEvent = { tick: number; id: string; actor: string; kind: 'step' | 'completed' | 'failed' | 'cancelled'; step: number; code?: string; message?: string };

/** What the shell reads of an engine's runtime: never its internals. */
export interface RuntimeView { readonly tick: number; readonly records: Map<string, ActionRecord>; readonly violations: { tick: number; code: string; message: string }[]; liveIds(): string[] }
/** An engine's resumable checkpoint. Only these three fields are read by the shell; the rest is the engine's own. */
export type EngineSnapshot = { format: string; tick: number; stateHash: string };

export interface Engine {
  readonly rulesVersion: string;
  readonly dt: number;
  readonly schema: string;
  readonly runtime: RuntimeView;
  readonly world: WorldState;
  describeVerbs(): VerbInfo[];
  stateHash(): string;
  physicalHash(): string;
  /** Advance one tick. Returns what changed for broadcast. */
  step(): { paths: PathCommit[]; changes: ChangeEvent[]; events: RuntimeEvent[]; programs: ProgramEvent[] };
  /** Start a depiction program for an actor, replacing whatever that actor was doing. */
  perform(program: Program): { id: string; ok: boolean; diagnostic?: { code: string; message: string } };
  /** Stop a running program (the actor is left idle where it is). */
  stop(programId: string): void;
  /** Physical feasibility of a program's first step right now, without running it (Mars: `verb.plan`). Null = feasible. */
  canPerform(program: Program): { code: string; message: string } | null;
  /** The program an actor is running, if any. */
  programOf(actor: string): string | null;
  submit(verb: string, params: unknown, opts?: { id?: string; parent?: string; preempt?: boolean }): ActionRecord;
  cancel(id: string, reason?: { code: string; message: string }): ActionRecord;
  snapshot(): EngineSnapshot;
  /** Spawn a human entity for a Soul at the arrival point; returns the entity id. */
  spawnHuman(args: { id: string; label: string; soul: string }): string;
  removeEntity(id: string): void;
  /** Feasible activities for an actor right now, cheap (no rehearsal). */
  enumerateActivities(actorId: string, intent: Intent | null): ActivityOption[];
  /** Word-bucketed local context for the brain: never numbers. */
  describeSurroundings(actorId: string): { nearby: { id: string; who: string; what: string; distance: 'here' | 'close' | 'near' | 'far'; doing: string }[]; region: string; happening: string };
  /** Regions and named places/fixtures that meaning can refer to. Stable ids. */
  anchors(): Anchor[];
  /** Region id containing a point (for per-region narration). */
  regionAt(p: Vec3): string;
  /** Kinematic position of an entity at a tick (for keyframes and clients). */
  poseSampleOf(entityId: string): PoseSample;
  /** The timed path an entity is currently on, if any (for snapshots sent to joining clients). */
  currentPath(entityId: string): PathCommit | undefined;
}

export interface EngineFactory {
  rulesVersion: string;
  genesis(seed: string): WorldState;
  create(world: WorldState): Engine;
  restore(snap: EngineSnapshot): Engine;
}
