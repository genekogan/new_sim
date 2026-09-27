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
  rehearse: z.strictObject({ plan_id: id, workspace: wsId.describe('staleness is reported against this workspace (default: the one bound)').optional() }),
  execute: z.strictObject({ plan_id: id, workspace: wsId, label: z.string().max(200).optional() }),
  fork: z.strictObject({ from: z.string().max(120), name: wsId, label: z.string().max(200).optional(), at: z.string().max(64).describe('checkpoint id (default: head of `from`)').optional() }),
  log: z.strictObject({ workspace: wsId.optional(), limit: z.number().int().min(1).max(500).optional() }),
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
  rehearse: { readOnly: true, description: 'Run a bound plan privately from its baseline (never mutates any workspace). Returns report (status, per-step diagnostics, invariant violations, metrics), a take summary (take_id playable via get_take) and `stale` if executing now would be refused.' },
  execute: {
    readOnly: false,
    description:
      'Officially run a bound plan in an editable workspace and commit the successor checkpoint (cause simulation-run). Refuses protected canonical workspaces (fork first), stale plans (physical change since binding — returns a diff) and runs with violations (take still stored).',
  },
  fork: { readOnly: false, description: 'Create an editable workspace from another workspace head or a checkpoint. Canonical workspaces are protected: fork before executing.' },
  log: { readOnly: true, description: 'Checkpoint history of a workspace (newest first: id, parent, cause, label). Without `workspace` lists all workspaces.' },
  get_take: { readOnly: true, description: 'Compact slice of a take: header, quantised pose tracks [tick, x_mm, y_mm, z_mm, yaw_mrad…] within [from, to] (bracketing samples included for interpolation), discrete changes, events; optional final state and camera tracks.' },
  attach_camera_track: { readOnly: false, description: 'Plan a camera track (shot spec → collision-aware, readability-scored samples with explained cuts) against a recorded take and store it beside the take. Never changes the take or its hash.' },
};
