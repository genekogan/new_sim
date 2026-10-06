import {z} from 'zod';
const id=z.string().min(1).max(100),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const existingGreenLandmarkTransitionV1Schema=z.strictObject({contract:z.literal('existing-green-landmark/1'),tick:z.number().int().nonnegative(),fromRulesVersion:z.string().min(1).max(200),toRulesVersion:z.string().min(1).max(200),fromStateHash:digest,additionsHash:digest,sourceProposalHash:digest,base:z.strictObject({campus:id,staticHash:digest})});
export type ExistingGreenLandmarkTransitionV1=z.infer<typeof existingGreenLandmarkTransitionV1Schema>;
