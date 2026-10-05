import {z} from 'zod';
import type {Anchor} from './engine.ts';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const base=z.object({campus:z.string().min(1),staticHash:digest}).strict();
export const campExpansionV1Schema=z.object({contract:z.literal('camp-ground-expansion/1'),
  tick:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),fromRulesVersion:z.string().min(1),toRulesVersion:z.string().min(1),
  fromBase:base,toBase:base,fromNativeHash:digest,additionsHash:digest}).strict();
export type CampExpansionV1=z.infer<typeof campExpansionV1Schema>;
export type CampExpansionAdmissionV1={ok:true;transition:CampExpansionV1;anchors:Anchor[]}|{ok:false;diagnostic:{code:string;message:string}};
