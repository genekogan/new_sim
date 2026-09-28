// Controller operation contracts. These zod schemas are the single source for
// in-process calls (controller.call), MCP tool input schemas (engine_* tools in
// the Durable Object) and the JSON Schemas returned by list_verbs.
import { z } from 'zod';
import { templateSchema } from '../sequence/types.ts';
import { cameraDirectionSchema } from '../camera/direct.ts';

const id = z.string().min(1).max(120);
const wsId = z.string().regex(/^[A-Za-z0-9][\w.-]{0,63}$/, 'workspace ids: letters, digits, _ . - (≤ 64)');
const coord = z.number().min(-500).max(500);
const vec3 = z.tuple([coord, z.number().min(-50).max(300), coord]);
const vec2 = z.tuple([coord, coord]);
const angle = z.number().min(-7).max(7);
const levelId = z.number().int().min(0).max(20);
const newId = z.string().regex(/^[A-Za-z][\w.-]{0,63}$/, 'entity/region ids: a letter, then letters, digits, _ . - (≤ 64)');

const poseSchema = z.strictObject({ p: vec3, yaw: angle, pitch: angle.optional(), roll: angle.optional() }).describe('explicit pose: base-centre p [x, y, z] (m), yaw/pitch/roll (rad)');
const lyingSchema = z
  .strictObject({ x: coord, z: coord, yaw: angle })
  .describe('lay a carriable component flat on the level floor exactly as the carry verb sets loads down: box centre (x, z), long axis along yaw');
/** One design edit (spec §21 "design-edit"): validated in order against the progressively edited world; all-or-nothing. */
export const worldEditSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('spawn'),
    id: newId,
    def: id.describe("catalog def id: upright-8ft…19ft, beam-8ft…12ft, 2x4-4ft…12ft, plywood-4x6/4x8, stair-flight-10, stair-tread, bench-6ft, camp-chair, campfire, human"),
    pose: poseSchema.optional(),
    lying: lyingSchema.optional(),
    level: levelId.describe('walkable level (default 0)').optional(),
    phase: z.enum(['stored', 'staged']).describe("components only (default 'staged' when lying, else 'stored')").optional(),
    label: z.string().max(80).optional(),
  }),
  z.strictObject({ op: z.literal('move'), id, pose: poseSchema.optional(), lying: lyingSchema.optional(), level: levelId.describe('default: the level it is on').optional() }),
  z.strictObject({ op: z.literal('remove'), id }),
  z.strictObject({
    op: z.literal('region'),
    id: newId,
    kind: z.enum(['place', 'staging', 'material-pile', 'work-area', 'walkable', 'no-go']),
    polygon: z.array(vec2).min(3).max(64).describe('ground polygon [x, z], counter-clockwise'),
    label: z.string().max(80).optional(),
    level: levelId.optional(),
    layout: z
      .strictObject({ focus: vec2, spacing: z.number().min(0.7).max(3).optional(), rowGap: z.number().min(0.7).max(3).optional(), kind: z.enum(['audience', 'stand', 'seat']).optional() })
      .describe("'place' regions: audience slots facing focus (gather/take_slot targets)")
      .optional(),
  }),
]);

const shotCommon = { fov: z.number().min(5).max(120).optional(), cutaway: z.boolean().optional(), subjects: z.array(id).max(16).optional() };
export const shotSpecSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fixed'), position: vec3, target: vec3, ...shotCommon }),
  z.strictObject({ kind: z.literal('follow'), subject: id, offset: vec3, frame: z.enum(['subject', 'world']).optional(), lookHeight: z.number().optional(), damping: z.number().optional(), ...shotCommon }),
  z.strictObject({ kind: z.literal('orbit'), center: vec3.optional(), subject: id.optional(), radius: z.number().min(0.5).max(200), height: z.number().min(0).max(200), period: z.number().min(1).max(3600), phase: z.number().optional(), lookHeight: z.number().optional(), ...shotCommon }),
  z.strictObject({ kind: z.literal('frameGroup'), subjects: z.array(id).min(1).max(16), padding: z.number().optional(), azimuth: z.number(), elevation: z.number(), aspect: z.number().optional(), fov: shotCommon.fov, cutaway: shotCommon.cutaway }),
  z.strictObject({ kind: z.literal('path'), keys: z.array(z.strictObject({ t: z.number().min(0), position: vec3, target: vec3 })).min(2).max(64), ...shotCommon }),
  z.strictObject({
    kind: z.literal('reveal'),
    subject: id.optional(),
    center: vec3.optional(),
    azimuth: z.number(),
    from: z.strictObject({ distance: z.number().min(0.5), elevation: z.number() }),
    to: z.strictObject({ distance: z.number().min(0.5), elevation: z.number() }),
    t0: z.number().min(0),
    t1: z.number().min(0),
    lookHeight: z.number().optional(),
    ...shotCommon,
  }),
  z.strictObject({ kind: z.literal('establishing'), region: z.strictObject({ min: vec2, max: vec2, y: z.number().optional() }), azimuth: z.number().optional(), elevation: z.number().optional(), aspect: z.number().optional(), ...shotCommon }),
]);

const stepId = z.string().regex(/^[A-Za-z0-9][\w.-]{0,63}$/, 'step ids: letters, digits, _ . - (≤ 64)');
/** Where a run pauses: seconds from the plan's start (the clock `at` cues use), or a step lifecycle event. */
export const pausePointSchema = z.union([
  z.number().positive().max(3600).describe("seconds from the plan's start (same clock as `at` cues; rounded to the 1/20 s tick)"),
  z.strictObject({ step: stepId, event: z.enum(['started', 'completed']) }).describe('pause on the tick a step starts / right after it completes'),
]);
const rebind = z
  .enum(['auto', 'refuse'])
  .describe(
    "'auto': if the plan is stale against the workspace head (a physical change inside a step's route/footprint, or a rules change), bind the same template + bindings against the head first (new plan_id, returned with a `rebound` event: the diff and the steps it reached); a binding that no longer holds is refused with plan.rebind-failed naming the step. Default 'refuse': a stale plan is refused with plan.stale.",
  )
  .optional();
const allowDrop = z
  .boolean()
  .describe('leave non-resumable live actions (carry, lifts, vehicles, ambient_wander) out of the pause; they finish as cancelled (snapshot.dropped) on resume. Still refused while one holds a load.')
  .optional();

export const opSchemas = {
  list_verbs: z.strictObject({}),
  query_world: z.strictObject({
    workspace: z.string().max(120).describe('workspace id or checkpoint id (default: every workspace is listed, no entities)').optional(),
    ids: z.array(id).max(200).optional(),
    kind: z.enum(['human', 'component', 'vehicle', 'fixture', 'marker']).optional(),
    label: z.string().max(80).describe('case-insensitive substring of id, label or def').optional(),
    region: z.strictObject({ min: vec2, max: vec2 }).describe('ground-plane box [x, z]').optional(),
    include: z.array(z.enum(['regions', 'levels', 'stability', 'links'])).max(4).optional(),
    route: z.strictObject({ actor: id, x: coord, z: coord, level: z.number().int().min(0).max(20).optional() }).describe('route preview for an actor → point (same planner walk_to uses)').optional(),
    carry: z
      .strictObject({ crew: z.array(id).min(1).max(8), item: id, to: z.strictObject({ x: coord, z: coord, yaw: z.number().min(-7).max(7), level: z.number().int().min(0).max(20).optional() }) })
      .describe('carry preview (same validation + SE(2) planner the carry verb uses)')
      .optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  bind_plan: z.strictObject({
    template: templateSchema,
    bindings: z.record(z.string(), z.unknown()),
    workspace: z.string().max(120).describe('workspace (its head) or checkpoint the plan is validated against'),
  }),
  rehearse: z.strictObject({
    plan_id: id,
    workspace: wsId.describe('staleness is reported against this workspace (default: the one bound)').optional(),
    keep: z.boolean().describe('store the take durably (default false: held in memory only, playable via get_take until evicted)').optional(),
    rebind,
  }),
  execute: z.strictObject({
    plan_id: id,
    workspace: wsId,
    label: z.string().max(200).optional(),
    pauseAt: pausePointSchema.describe('stop mid-run there and commit a resumable `pause` checkpoint instead of finishing (engine_resume continues it)').optional(),
    allowDrop,
    rebind,
  }),
  resume: z.strictObject({
    workspace: wsId,
    until: pausePointSchema.describe("pause again there (another `pause` checkpoint); seconds count from the plan's start, not from the resume").optional(),
    commands: z
      .array(z.strictObject({ verb: id, params: z.record(z.string(), z.unknown()), id: stepId.describe('step id (default resume<n>-<i>); usable as a later `until` step').optional() }))
      .max(16)
      .describe('extra verb calls submitted on the resume tick as new steps of the run (params validated with the verb schema; a failing one aborts the run like any plan step)')
      .optional(),
    allowDrop,
    label: z.string().max(200).optional(),
  }),
  fork: z.strictObject({
    from: z.string().max(120),
    name: wsId,
    label: z.string().max(200).optional(),
    at: z.string().max(64).describe('checkpoint id (default: head of `from`)').optional(),
    inventory: z.enum(['finite', 'unlimited']).describe("'unlimited' lets engine_edit_world spawn from the catalog (commits a design-edit checkpoint on the new workspace)").optional(),
  }),
  edit_world: z.strictObject({
    workspace: wsId,
    edits: z.array(worldEditSchema).min(1).max(32),
    note: z.string().min(1).max(200).describe('why (recorded in the design-edit cause)'),
    label: z.string().max(200).optional(),
  }),
  log: z.strictObject({ workspace: wsId.optional(), limit: z.number().int().min(1).max(500).optional() }),
  list: z.strictObject({
    include: z.array(z.enum(['plans', 'takes', 'workspaces'])).max(3).describe('default: all three').optional(),
    take_id: id.describe("also list this take's camera tracks").optional(),
  }),
  delete_workspace: z.strictObject({ workspace: wsId }),
  get_take: z.strictObject({
    take_id: id,
    from: z.number().min(0).describe('seconds from take start').optional(),
    to: z.number().min(0).optional(),
    entities: z.array(id).max(200).optional(),
    include: z.array(z.enum(['final', 'cameras', 'events', 'changes'])).max(4).describe("default ['events','changes']").optional(),
  }),
  attach_camera_track: z.strictObject({
    take_id: id,
    track_id: z.string().regex(/^[\w.-]{1,64}$/).optional(),
    shot: shotSpecSchema,
    hz: z.number().min(1).max(30).optional(),
  }),
  store_camera_track: z.strictObject({
    take_id: id,
    track: z
      .strictObject({
        id: z.string().regex(/^[\w.-]{1,64}$/),
        takeId: id.describe('must equal take_id'),
        kind: z.string().min(1).max(40).describe("'directed' for a compiled direct_camera / studio Direct-panel track"),
        data: z.record(z.string(), z.unknown()).describe('mars-camera-track/1 payload: { schema, hz, duration, samples[{t, position, target, fov, cut?}], … }'),
      })
      .describe('a compiled CameraTrack (e.g. a directed track downloaded from the studio) to store beside its take'),
  }),
  parse_camera: z.strictObject({
    take_id: id.describe("resolve names in this take's world (who-does-what from the take); give this or workspace").optional(),
    workspace: z.string().max(120).describe('or: resolve names in this workspace / checkpoint state').optional(),
    sentences: z.array(z.string().min(1).max(400)).min(1).max(24).describe('camera sentences, one direction each, e.g. "do a 270° revolution around the main pallet racks over 2 minutes"'),
  }),
  direct_camera: z.strictObject({
    take_id: id,
    directions: z.array(cameraDirectionSchema).min(1).max(24).describe('camera directions in order (each starts when the previous ends unless `at` is given); give this or `sentences`').optional(),
    sentences: z
      .array(z.string().min(1).max(400))
      .min(1)
      .max(24)
      .describe('or: camera sentences, parsed and resolved exactly as engine_parse_camera does (any refusal refuses the call, nothing is compiled), then compiled as those directions')
      .optional(),
    track_id: z.string().regex(/^[\w.-]{1,64}$/).optional(),
    hz: z.number().min(1).max(30).optional(),
    correct: z.boolean().describe('self-correction (default true): simulate every shot against the take and apply ranked corrections (raise, widen, swing, re-route, shorten, split, cut), recorded per shot; false = the computed move as is').optional(),
  }),
} as const;

export type OpName = keyof typeof opSchemas;
export type OpInput<N extends OpName> = z.infer<(typeof opSchemas)[N]>;

export const opDescriptions: Record<OpName, { description: string; readOnly: boolean }> = {
  list_verbs: { readOnly: true, description: 'List every action verb in the engine registry with its JSON Schema (the exact params a plan step must supply), plus rules version, DT and plan/template schema ids.' },
  query_world: {
    readOnly: true,
    description:
      'Inspect a workspace/checkpoint: entities (filter by ids/kind/label/region), regions, walkable levels, stair/link state, rack stability reports, and previews — route for actor→point and carry feasibility — using the same planners the verbs use. Without `workspace` lists workspaces.',
  },
  bind_plan: {
    readOnly: false,
    description:
      'Bind a mars-sequence/1 template to concrete actors/entities and a baseline workspace. Validates the step graph and every step against the verb schemas; returns plan_id (content hash) or all diagnostics at once. Stores the plan; does not run anything.',
  },
  rehearse: { readOnly: true, description: 'Run a bound plan privately from its baseline (never mutates any workspace). Returns report (status, per-step diagnostics, invariant violations, metrics), a take summary (take_id playable via get_take; `kept` says whether it is stored) and `stale` if executing now would be refused. Stores nothing unless `keep: true` (then only the take); an unkept take lives in memory for the last few rehearsals — execute or attach a camera to keep it. Staleness is region-scoped: a physical change outside every step\'s route/footprint envelope is reported as `outsideEnvelope` and does not stale the plan; one inside names the steps (`stale.affected`). `rebind: \'auto\'` re-binds a stale plan against the workspace head first and rehearses that (`plan_id`, `rebound`).' },
  execute: {
    readOnly: false,
    description:
      'Officially run a bound plan in an editable workspace and commit the successor checkpoint (cause simulation-run). Refuses protected canonical workspaces (fork first), stale plans (a physical change since binding inside a step route/footprint envelope — returns the diff and `affected` steps; a change outside every envelope is ignored and reported as `outsideEnvelope`) and runs with violations (take still stored). `rebind: \'auto\'` re-binds a stale plan against the head (new plan_id + a `plan.rebound` event with the diff) instead of refusing, or refuses with plan.rebind-failed naming the step. With `pauseAt` (seconds or {step, event}) it stops there and commits a resumable `pause` checkpoint (returns checkpoint, live actions, the take so far); refused with snapshot.non-resumable naming the action if a carry / lift / vehicle is live then, unless `allowDrop`.',
  },
  resume: {
    readOnly: false,
    description:
      "Continue a paused run from the workspace head (a `pause` checkpoint; else resume.not-resumable), optionally submitting extra `commands` [{verb, params}] on the resume tick, to completion (commits simulation-run, same rules as execute) or to `until` (another pause). Records a take for the segment. Resuming without commands ends in exactly the state an unpaused execute reaches.",
  },
  fork: { readOnly: false, description: "Create an editable workspace from another workspace head or a checkpoint. Canonical workspaces are protected: fork before executing or editing. `inventory: 'unlimited'` lets engine_edit_world spawn catalog items there. Forking at a `pause` checkpoint gives an independent, resumable copy of the paused run (engine_resume each branch with different commands)." },
  edit_world: {
    readOnly: false,
    description:
      "Design-edit an editable workspace (never a protected canonical one): spawn catalog items (only with inventory 'unlimited'; provenance design-edit/hypothetical), move idle people / loose components / fixtures / parked vehicles to a pose or `lying` set-down (refused when the footprint would overlap static geometry, components or people, or leave the floor), remove stored/staged components (or anything a design edit spawned), add/replace regions. A ridden vehicle is refused with edit.vehicle-ridden (dismount first). All-or-nothing; commits one checkpoint (cause design-edit + note) and returns the physical diff.",
  },
  list: {
    readOnly: true,
    description:
      "Ledger of the room: stored plans (plan_id, template id, workspace, baseline), takes (take_id, kept, bytes, cameras) — both oldest first with `order` and `referencedByCheckpoint` (checkpoints of live workspaces whose simulation-run cause names them; unreferenced ones are evicted first past the room caps) — and workspaces (head, protected, forkedFrom, forks). With `take_id` also that take's camera tracks.",
  },
  delete_workspace: {
    readOnly: false,
    description: 'Delete an editable workspace (never a protected canonical one, never one another live workspace was forked from — delete those forks first). Its checkpoints stay addressable by id, but plans/takes referenced only from it become evictable.',
  },
  log: { readOnly: true, description: 'Checkpoint history of a workspace (newest first: id, parent, cause, label). Without `workspace` lists all workspaces.' },
  get_take: { readOnly: true, description: 'Compact slice of a take: header, quantised pose tracks [tick, x_mm, y_mm, z_mm, yaw_mrad…] within [from, to] (bracketing samples included for interpolation), discrete changes, events; optional final state and camera tracks.' },
  attach_camera_track: { readOnly: false, description: 'Plan a camera track (shot spec → collision-aware, readability-scored samples with explained cuts) against a recorded take and store it beside the take. Never changes the take or its hash.' },
  store_camera_track: {
    readOnly: false,
    description:
      'Store an already-compiled camera track (mars-camera-track/1, e.g. a directed track from the studio Direct panel) beside its take, like attach_camera_track / direct_camera do for tracks they compute. Validated with the take-file camera rules (schema, hz, samples, track.takeId = take_id, duration within the take). Refuses a track of another take (camera.track-take-mismatch), an id already used by a different track (camera.track-exists; re-storing the identical track is a no-op) and a take whose stored camera tracks would exceed the per-take byte cap (camera.store-full). Never changes the take or its hash; get_take lists it under `cameras`.',
  },
  parse_camera: {
    readOnly: true,
    description:
      "Parse camera sentences into camera directions (the engine_direct_camera `directions` schema) with the bounded, deterministic sentence grammar, using the names of the take's (or workspace's) world: regions, scene assemblies, fixtures, the activities people do, and an alias table ('the main pallet racks' → the take's rack bay structure). Each subject, interior and look-at is resolved in that world; returns { directions: [{ index, sentence, direction, notes, subject }], refusals: [{ index, sentence, code, message, question?, candidates?, span? }] } — ambiguous names are a question with candidates, unknown ones list what is known, unsupported phrasing (e.g. 'zoom in', an orbit with no angle, a deictic 'this') is refused by the grammar. Nothing is stored.",
  },
  direct_camera: {
    readOnly: false,
    description:
      "Direct the camera in words-as-data: each direction names a subject (entity, assembly e.g. 'rack bay' / a building, region, or group = the people in an action/activity), a motion (pan, tilt, dolly, orbit {degrees}, crane, push_in, pull_out, fly_through, hold), duration or speed, framing (wide/medium/close, headroom, thirds, side) and context (sunBehind, interior room, lookAt fixture e.g. 'sink'). Names are resolved in the take's world; an ambiguous name returns camera.direct.ambiguous with the candidates (ask, don't guess), an unknown one camera.direct.unknown with what is known. The trajectory is computed (orbit radius from extent + lens, sun-behind heading/pitch window from the sun model, interior routes through a camera navmesh), validated by the camera planner, and stored beside the take. Every shot is then simulated against the take (people and parts per tick, the sun, the motion caps) and self-corrected: failures (collision, squeeze between sheets / in a slot, a person in the foreground, sun flare on axis, subject leaving frame, horizon, motion caps) trigger ranked strategies — raise, widen, swing, re-route, shorten, split (two shots with a cut), cut — the first valid one wins and is recorded in the shot's corrections [{ failure, samples, strategy, before, after, reason, tried }]; if none works the direction is refused with everything tried. Returns track_id, 1 Hz keyframes and a per-shot report (resolved subject, computed parameters, validation, simulation, corrections). Never changes the take.",
  },
};
