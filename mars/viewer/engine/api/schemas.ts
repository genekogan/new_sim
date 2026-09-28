// Controller operation contracts. These zod schemas are the single source for
// in-process calls (controller.call), MCP tool input schemas (engine_* tools in
// the Durable Object) and the JSON Schemas returned by list_verbs.
import { z } from 'zod';
import { templateSchema } from '../sequence/types.ts';

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
  }),
  execute: z.strictObject({ plan_id: id, workspace: wsId, label: z.string().max(200).optional() }),
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
  rehearse: { readOnly: true, description: 'Run a bound plan privately from its baseline (never mutates any workspace). Returns report (status, per-step diagnostics, invariant violations, metrics), a take summary (take_id playable via get_take; `kept` says whether it is stored) and `stale` if executing now would be refused. Stores nothing unless `keep: true` (then only the take); an unkept take lives in memory for the last few rehearsals — execute or attach a camera to keep it.' },
  execute: {
    readOnly: false,
    description:
      'Officially run a bound plan in an editable workspace and commit the successor checkpoint (cause simulation-run). Refuses protected canonical workspaces (fork first), stale plans (physical change since binding — returns a diff) and runs with violations (take still stored).',
  },
  fork: { readOnly: false, description: "Create an editable workspace from another workspace head or a checkpoint. Canonical workspaces are protected: fork before executing or editing. `inventory: 'unlimited'` lets engine_edit_world spawn catalog items there." },
  edit_world: {
    readOnly: false,
    description:
      "Design-edit an editable workspace (never a protected canonical one): spawn catalog items (only with inventory 'unlimited'; provenance design-edit/hypothetical), move idle people / loose components / fixtures to a pose or `lying` set-down (refused when the footprint would overlap static geometry, components or people, or leave the floor), remove stored/staged components (or anything a design edit spawned), add/replace regions. All-or-nothing; commits one checkpoint (cause design-edit + note) and returns the physical diff.",
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
};
