import {z} from 'zod';
export const DEFAULT_SOUL_DESCRIPTION='A new Soul.';
export const soulNameSchema=z.string().trim().min(2).max(32).regex(/^[\p{L}\p{N} _'-]+$/u,'letters, numbers, spaces, apostrophes and hyphens only');
export const soulProfileUpdateSchema=z.strictObject({name:soulNameSchema.optional(),description:z.string().trim().min(3).max(1200).optional(),expectedRevision:z.number().int().nonnegative().optional()}).refine(p=>p.name!==undefined||p.description!==undefined,{message:'name or description required'});
export const soulProfilePhotoSchema=z.strictObject({hash:z.string().regex(/^[a-f0-9]{64}$/),mime:z.literal('image/png'),width:z.number().int().min(1).max(512),height:z.number().int().min(1).max(512),bytes:z.number().int().min(1).max(262144)});
export const soulProfileFactV1Schema=z.strictObject({contract:z.literal('soul-profile/1'),worldId:z.string().min(1),soulId:z.string().min(1),entityId:z.string().min(1),owner:z.string().min(1),fromRevision:z.number().int().nonnegative(),revision:z.number().int().positive(),fromName:soulNameSchema,birthName:soulNameSchema,name:soulNameSchema,description:z.string().min(3).max(1200),photo:soulProfilePhotoSchema.nullable()}).refine(p=>p.revision===p.fromRevision+1,{message:'revision must advance once'});
export type SoulProfileFactV1=z.infer<typeof soulProfileFactV1Schema>;
