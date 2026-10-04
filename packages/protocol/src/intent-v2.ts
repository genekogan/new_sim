// G-002 candidate. Named private log handlers support isolated backend producers;
// no route/capability activation until the agreed behavioral checkpoint.
import { z } from 'zod';
import { mandateTriggerSchema } from './mandate.ts';

export const INTENT_V2 = 'soul-intent/2' as const;
const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const tick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const seq = tick.positive();
const version = tick.positive();
const words = z.string().min(1).max(2000).refine(s => !!s.trim());
export const intentReferenceV2Schema = z.strictObject({ intentId: id, version });
const edit = z.strictObject({ intentId: id, expectedVersion: version });

/** Identity, source, authority and interpretation are supplied by the server. */
export const intentRequestV2Schema = z.discriminatedUnion('op', [
  z.strictObject({ contract: z.literal(INTENT_V2), requestId: id, op: z.literal('upsert'), words,
    strict: z.boolean().default(false), importance: z.number().finite().min(0).max(1).default(0.5), edit: edit.optional() }),
  z.strictObject({ contract: z.literal(INTENT_V2), requestId: id, op: z.literal('withdraw'), edit }),
]);
export type IntentRequestV2 = z.infer<typeof intentRequestV2Schema>;

export const intentSourceV2Schema = z.strictObject({
  kind: z.enum(['owner', 'owner-agent', 'operator']), ownerId: id, principalId: id,
  channel: z.enum(['web', 'api', 'mcp']),
});
const evidence = z.strictObject({ seq, tick, kind: z.enum(['admission', 'controller', 'kernel']) });
const agenda = z.array(z.strictObject({ card: z.string().min(2).max(60), target: z.string().max(80).nullable().optional(), of: z.string().max(80).nullable().optional() })).max(8);
export const intentRevisionV2Schema = z.strictObject({
  ...intentReferenceV2Schema.shape, worldId: id, soulId: id, requestId: id, source: intentSourceV2Schema,
  submitted: z.strictObject({ seq, tick }), words, strict: z.boolean(), importance: z.number().finite().min(0).max(1),
  interpretation: z.strictObject({ summary: z.string().min(1).max(2000), agenda, trigger: mandateTriggerSchema }),
});
export type IntentRevisionV2 = z.infer<typeof intentRevisionV2Schema>;

const scope = { contract: z.literal(INTENT_V2), worldId: id, soulId: id, seq, tick };
const outcomeBase = { ...scope, intent: intentReferenceV2Schema, attemptId: id, evidence };
/** A completed attempt does not imply that its owner's broader purpose is fulfilled. */
export const intentOutcomeV2Schema = z.discriminatedUnion('phase', [
  z.strictObject({ ...outcomeBase, phase: z.literal('accepted'), activityId: id }),
  z.strictObject({ ...outcomeBase, phase: z.literal('started'), activityId: id }),
  z.strictObject({ ...outcomeBase, phase: z.literal('blocked'), activityId: id.optional(), reason: z.string().min(1).max(2000) }),
  z.strictObject({ ...outcomeBase, phase: z.literal('completed'), activityId: id }),
  z.strictObject({ ...outcomeBase, phase: z.literal('interrupted'), activityId: id, reason: z.string().min(1).max(2000) }),
]).superRefine((out, ctx) => {
  if (out.phase === 'accepted' && out.evidence.kind !== 'admission') ctx.addIssue({ code: 'custom', message: 'acceptance requires admission evidence' });
  if (out.evidence.seq > out.seq || out.evidence.tick > out.tick) ctx.addIssue({ code: 'custom', message: 'outcome evidence cannot come from the future' });
  if (['started', 'completed', 'interrupted'].includes(out.phase) && out.evidence.kind !== 'controller') {
    ctx.addIssue({ code: 'custom', message: 'physical progress requires controller evidence' });
  }
  if (out.phase === 'blocked' && out.evidence.kind === 'controller' && !out.activityId) ctx.addIssue({ code: 'custom', message: 'controller block needs its activity identity' });
});
export type IntentOutcomeV2 = z.infer<typeof intentOutcomeV2Schema>;

export const intentHistoryEventV2Schema = z.discriminatedUnion('op', [
  z.strictObject({ ...scope, op: z.literal('upsert'), revision: intentRevisionV2Schema }),
  z.strictObject({ ...scope, op: z.literal('withdraw'), intent: intentReferenceV2Schema, requestId: id, source: intentSourceV2Schema }),
  z.strictObject({ ...scope, op: z.literal('outcome'), outcome: intentOutcomeV2Schema }),
  z.strictObject({ ...scope, op: z.literal('resolve'), intent: intentReferenceV2Schema,
    status: z.enum(['active', 'blocked', 'fulfilled']), reason: z.string().min(1).max(2000), evidence }),
]);
export type IntentHistoryEventV2 = z.infer<typeof intentHistoryEventV2Schema>;

/** Canonical payloads omit sequence/tick origins: the accepted log envelope
 * supplies them. A worker cannot predict its queue position or forge an origin. */
export const intentReceivedPayloadV2Schema = z.strictObject({
  contract: z.literal(INTENT_V2), worldId: id, soulId: id,
  request: intentRequestV2Schema, source: intentSourceV2Schema,
});
const publicationScope = { contract: z.literal(INTENT_V2), worldId: id, soulId: id };
export const intentPublicationPayloadV2Schema = z.discriminatedUnion('op', [
  z.strictObject({ ...publicationScope, op: z.literal('upsert'), revision: intentRevisionV2Schema.omit({ submitted: true }) }),
  z.strictObject({ ...publicationScope, op: z.literal('withdraw'), intent: intentReferenceV2Schema, requestId: id, source: intentSourceV2Schema }),
]);
export type IntentPublicationPayloadV2 = z.infer<typeof intentPublicationPayloadV2Schema>;
export function intentHistoryFactV2(e: { kind: string; seq: number; tick: number; payload: unknown }): Extract<IntentHistoryEventV2, { op: 'upsert' | 'withdraw' }> {
  if (e.kind !== 'intent-v2') throw new Error('not an accepted intent-v2 fact');
  const p = intentPublicationPayloadV2Schema.parse(e.payload);
  const fact = intentHistoryEventV2Schema.parse({ ...p, seq: e.seq, tick: e.tick,
    ...(p.op === 'upsert' ? { revision: { ...p.revision, submitted: { seq: e.seq, tick: e.tick } } } : {}) });
  if (fact.op !== 'upsert' && fact.op !== 'withdraw') throw new Error('unsupported canonical publication');
  return fact;
}

/** Explicit public whitelist. The private event must never reach the old generic
 * publicEvent fallback; its integration needs a named new event-kind handler. */
export function publicIntentHistoryEventV2(raw: unknown) {
  const e = intentHistoryEventV2Schema.parse(raw);
  return { worldId: e.worldId, soulId: e.soulId, seq: e.seq, tick: e.tick, op: e.op, privateUpdate: true as const };
}

/** No generated interpretation, scope or physical status is accepted from a client. */
export const intentReceiptV2Schema = z.discriminatedUnion('phase', [
  z.strictObject({ contract: z.literal(INTENT_V2), requestId: id, phase: z.literal('received'), worldId: id, soulId: id, seq, tick }),
  z.strictObject({ contract: z.literal(INTENT_V2), requestId: id, phase: z.literal('understood'), revision: intentRevisionV2Schema }),
  z.strictObject({ contract: z.literal(INTENT_V2), requestId: id, phase: z.literal('refused'), code: id, reason: z.string().min(1).max(2000) }),
  z.strictObject({ contract: z.literal(INTENT_V2), requestId: id, phase: z.literal('withdrawn'), worldId: id, soulId: id, intent: intentReferenceV2Schema, seq, tick }),
]).superRefine((receipt, ctx) => {
  if (receipt.phase === 'understood' && receipt.requestId !== receipt.revision.requestId) ctx.addIssue({ code: 'custom', message: 'receipt must name the accepted request' });
});
export type IntentReceiptV2 = z.infer<typeof intentReceiptV2Schema>;
