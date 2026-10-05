import {z} from 'zod';
const digest=z.string().regex(/^[a-f0-9]{64}$/),base=z.strictObject({campus:z.string().min(1),staticHash:digest});
export const retainedCommonsShoreV1Schema=z.strictObject({
  contract:z.literal('retained-commons-shore/1'),tick:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  fromRulesVersion:z.string().min(1),toRulesVersion:z.string().min(1),fromStateHash:digest,fromNativeHash:digest,
  fromBase:base,toBase:base,additionsHash:digest,geometrySourceHash:digest,
});
export type RetainedCommonsShoreV1=z.infer<typeof retainedCommonsShoreV1Schema>;
export type RetainedCommonsShoreAdmissionV1={ok:true;transition:RetainedCommonsShoreV1}|{ok:false;diagnostic:{code:string;message:string}};
