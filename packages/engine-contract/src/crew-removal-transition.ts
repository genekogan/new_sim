import {z} from 'zod';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const crewRemovalTransitionV1Schema=z.object({
  contract:z.literal('crew-removal-transition/1'),tick:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  fromRulesVersion:z.string().min(1),toRulesVersion:z.string().min(1),
  fromStateHash:digest,nativeWorldHash:digest,
  base:z.object({campus:z.string().min(1),staticHash:digest}).strict(),
}).strict();
export type CrewRemovalTransitionV1=z.infer<typeof crewRemovalTransitionV1Schema>;
export type CrewRemovalTransitionAdmissionV1={ok:true;transition:CrewRemovalTransitionV1}|{ok:false;diagnostic:{code:string;message:string}};
