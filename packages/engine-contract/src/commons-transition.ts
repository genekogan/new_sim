import { z } from 'zod';
import type { Anchor } from './engine.ts';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const base=z.object({campus:z.string().min(1),staticHash:digest}).strict();
export const commonsTransitionV1Schema=z.object({
  contract:z.literal('commons-transition/1'),tick:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  fromRulesVersion:z.string().min(1),toRulesVersion:z.string().min(1),
  fromBase:base,toBase:base,fromWorldHash:digest,
}).strict();
export type CommonsTransitionV1=z.infer<typeof commonsTransitionV1Schema>;
export type CommonsTransitionAdmissionV1={ok:true;transition:CommonsTransitionV1;anchors:Anchor[]}|{ok:false;diagnostic:{code:string;message:string}};
