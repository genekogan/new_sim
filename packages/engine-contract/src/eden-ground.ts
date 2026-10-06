import {z} from 'zod';
const hash=z.string().regex(/^[a-f0-9]{64}$/),base=z.strictObject({campus:z.string().min(1).max(80),staticHash:hash});
export const edenGroundTransitionV1Schema=z.strictObject({contract:z.literal('eden-expansion-ground/1'),tick:z.number().int().nonnegative(),fromRulesVersion:z.string().min(1).max(200),toRulesVersion:z.string().min(1).max(200),fromStateHash:hash,fromBase:base,toBase:base,layoutHash:hash});
export type EdenGroundTransitionV1=z.infer<typeof edenGroundTransitionV1Schema>;
