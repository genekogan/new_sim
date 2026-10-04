// G-001 current receipts. These are accepted-rule receipts, not claims that an
// actor physically completed its plan. New G-002 lifecycle semantics are separate.
import { z } from 'zod';
import { mandateTriggerSchema } from './mandate.ts';

const agenda = z.array(z.object({ card: z.string(), target: z.string().nullable().optional(), of: z.string().nullable().optional() }).passthrough());
export const mandateRuleViewSchema = z.object({
  id: z.string(), words: z.string(), strict: z.boolean(), understanding: z.string(), agenda,
  trigger: mandateTriggerSchema, status: z.enum(['active', 'done', 'blocked']), report: z.string().nullable(),
  lastFiredDay: z.number().int().optional(), conditionMatched: z.boolean().optional(), lastReportDay: z.number().int().optional(),
}).passthrough();
export const steerReceiptSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), rule: mandateRuleViewSchema, text: z.string(), tick: z.number().int().nonnegative(),
    seq: z.number().int().positive(), via: z.literal('align'), minted: z.array(z.string()) }).passthrough(),
  z.object({ ok: z.literal(false), reason: z.string(), via: z.literal('align') }).passthrough(),
]);
export type SteerReceipt = z.infer<typeof steerReceiptSchema>;

export const ownerSoulStatusSchema = z.discriminatedUnion('in_world', [
  z.object({ id: z.string(), name: z.string(), description: z.string(), in_world: z.literal(false) }).passthrough(),
  z.object({
    id: z.string(), name: z.string(), description: z.string(), in_world: z.literal(true), tick: z.number().int().nonnegative(), time: z.string(),
    position: z.object({ x: z.number().finite(), z: z.number().finite(), region: z.string() }), activity: z.string(), doing: z.string(),
    mood: z.string(), energy: z.string(), wants_company: z.number().finite(),
    needs: z.object({ energy: z.number().finite(), hunger: z.number().finite(), company: z.number().finite(), restlessness: z.number().finite() }).optional(),
    journal: z.string().optional(), reflected_day: z.number().int().optional(), customs: z.array(z.string()).optional(),
    mandate: z.array(mandateRuleViewSchema),
  }).passthrough(),
]);
export const ownerSoulDashboardSchema = z.object({
  status: ownerSoulStatusSchema,
  agent: z.object({ attached: z.boolean(), label: z.string().nullable(), since: z.number().nullable(), last_used: z.number().nullable() }),
  spend: z.object({ calls: z.number().int().nonnegative(), cost: z.number().finite().nonnegative() }), created_at: z.number(),
}).passthrough();
export type OwnerSoulDashboard = z.infer<typeof ownerSoulDashboardSchema>;
