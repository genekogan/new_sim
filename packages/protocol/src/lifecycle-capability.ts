import {z} from 'zod';
const id=z.string().min(1).max(128);
/** An available response protocol, never admission, readiness or a write grant. */
export const ownerLifecycleCapabilitySchema=z.object({
  contract:z.literal('owner-lifecycle-capability/1'),worldId:id,userId:id,
  receiptContract:z.literal('soul-lifecycle/1'),historyContract:z.literal('owner-lifecycle-list/1'),
  optIn:z.object({header:z.literal('X-Sim-Lifecycle'),value:z.literal('1')}).strict(),
}).strict();
export type OwnerLifecycleCapability=z.infer<typeof ownerLifecycleCapabilitySchema>;
