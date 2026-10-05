// Private current authority, scoped to one actual hello on one socket/world.
// It is not a public roster, transferable credential or historical permission.
import {z} from 'zod';
const id=z.string().min(1).max(256),revision=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const currentMeV1Schema=z.object({userId:id,short:z.string().min(1).max(160),email:z.string().max(320).nullable(),wallet:z.string().max(256).nullable(),
  role:z.enum(['user','admin']),souls:z.array(z.string().min(1).max(96)).max(1000),invited:z.boolean(),
}).strict().refine(v=>new Set(v.souls).size===v.souls.length,'Owned Soul IDs must be unique');
const scope={contract:z.literal('me-live/1'),connectionId:z.uuid(),userId:id.nullable()};
export const meLiveDescriptorV1Schema=z.object({...scope,revision:z.literal(1)}).strict();
export const meLiveViewV1Schema=z.object({...scope,worldId:id,epoch:z.string().min(1).max(80),revision,me:currentMeV1Schema.nullable()}).strict()
  .refine(v=>v.me===null||v.me.userId===v.userId,'Current Me must belong to the bound subject');
export const meLiveMessageV1Schema=z.object({t:z.literal('me'),view:meLiveViewV1Schema}).strict();
export type MeLiveDescriptorV1=z.infer<typeof meLiveDescriptorV1Schema>;
export type MeLiveViewV1=z.infer<typeof meLiveViewV1Schema>;
