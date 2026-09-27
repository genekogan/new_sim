// Sequence templates vs bound plans (spec §14, §21).
//   SequenceTemplate — reusable, parameterised, serialisable step graph; knows no world state.
//   BoundPlan        — template + concrete bindings, validated against one baseline checkpoint
//                      under one rules version. Content-addressed by planHash.
// Steps are explicit registry verbs with typed params; there is no "script anything" escape.
import { z } from 'zod';

export const SEQUENCE_SCHEMA = 'mars-sequence/1';
export const PLAN_SCHEMA = 'mars-plan/1';

/** Kinds a template parameter can take; actor/entity kinds are checked against the baseline world at bind time. */
export type ParamKind = 'actor' | 'actors' | 'entity' | 'entities' | 'number' | 'string' | 'point' | 'any';
export type TemplateParam = { kind: ParamKind; description?: string };

export type StepTrigger = { event: 'completed' | 'started'; step: string };

/**
 * One step. Start condition = all of:
 *   after  — barrier: every listed step has completed
 *   when   — the named step has started / completed
 *   at     — sequence time ≥ at seconds (exact tick cue for cinematic timing)
 * A step with none of these starts immediately. onFail defaults to 'abort'.
 */
export type StepSpec = {
  id: string;
  verb: string;
  /** Values may reference template params: "$crew[0]", "$target.x", "$pile". "$$x" is a literal "$x". */
  params: Record<string, unknown>;
  after?: string[];
  when?: StepTrigger;
  at?: number;
  onFail?: 'abort' | 'continue';
  label?: string;
};

export type SequenceTemplate = {
  schema: typeof SEQUENCE_SCHEMA;
  id: string;
  label?: string;
  params: Record<string, TemplateParam>;
  steps: StepSpec[];
};

/** A step after substitution and schema parsing (params are exactly what the runtime will receive). */
export type BoundStep = StepSpec;

export type BoundPlan = {
  schema: typeof PLAN_SCHEMA;
  template: SequenceTemplate;
  templateHash: string;
  bindings: Record<string, unknown>;
  steps: BoundStep[];
  baselineCheckpoint: string;
  baselinePhysicalHash: string;
  rulesVersion: string;
  planHash: string;
};

const json: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(json), z.record(z.string(), json)]),
);

export const STEP_ID = /^[A-Za-z][\w-]{0,63}$/;

export const stepSchema = z.strictObject({
  id: z.string().regex(STEP_ID),
  verb: z.string().min(1).max(80),
  params: z.record(z.string(), json),
  after: z.array(z.string()).max(64).optional(),
  when: z.strictObject({ event: z.enum(['completed', 'started']), step: z.string() }).optional(),
  at: z.number().min(0).max(24 * 3600).optional(),
  onFail: z.enum(['abort', 'continue']).optional(),
  label: z.string().max(200).optional(),
});

export const templateSchema = z.strictObject({
  schema: z.literal(SEQUENCE_SCHEMA),
  id: z.string().min(1).max(120),
  label: z.string().max(200).optional(),
  params: z.record(
    z.string().regex(/^[A-Za-z_]\w*$/),
    z.strictObject({
      kind: z.enum(['actor', 'actors', 'entity', 'entities', 'number', 'string', 'point', 'any']),
      description: z.string().max(400).optional(),
    }),
  ),
  steps: z.array(stepSchema).min(1).max(2000),
});
