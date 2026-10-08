import {z} from 'zod';

const id=z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const url=z.string().regex(/^\/(?:w\/[a-z0-9-]+\/)?(?:v1\/edge\/body\/assets\/body_[a-f0-9]{64}\.glb|world-assets\/littlemartians\/characters\/[a-z0-9-]+\.glb)$/);
export const bodyV1Schema=z.strictObject({
  family:z.enum(['humanoid','floater']),type:z.enum(['humanoid','ceramic','floater']).optional(),
  model:z.string().regex(/^(?:[a-z0-9-]{1,64}|body_[a-f0-9]{64})$/).optional(),modelUrl:url.optional(),
  avatar:z.strictObject({kind:z.literal('body'),modelUrl:url,bodyType:z.enum(['humanoid','ceramic','floater'])}).optional(),
  radius:z.number().min(.15).max(.9).optional(),hoverHeight:z.number().min(.4).max(3).optional(),
}).refine(b=>b.type===undefined||(b.family==='humanoid'?b.type==='humanoid':b.type==='ceramic'||b.type==='floater'))
 .refine(b=>b.family!=='humanoid'||(b.radius===undefined&&b.hoverHeight===undefined&&(b.model===undefined||b.modelUrl!==undefined)))
 .refine(b=>b.avatar===undefined||(b.avatar.modelUrl===b.modelUrl&&b.avatar.bodyType===(b.type??b.family)));
/** A durable body assignment contains the resolved admitted body, never a path from the upload form. */
export const bodyAssignmentV1Schema=z.strictObject({contract:z.literal('body-assignment/1'),worldId:id,soulId:id,entityId:id,body:bodyV1Schema.nullable()});
export type BodyAssignmentV1=z.infer<typeof bodyAssignmentV1Schema>;
