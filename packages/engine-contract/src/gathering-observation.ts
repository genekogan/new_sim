// Candidate public physical observation, not a station cue or social classifier.
import { z } from 'zod';
export const nativeGatheringObservationV1Schema=z.object({
  contract:z.literal('native-gathering-observation/1'),
  sourceRevision:z.literal('settled-native-gather-fixtures/1'),
  tick:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  dtSeconds:z.number().finite().positive().max(1),
  rulesVersion:z.string().min(1).max(200),
  situation:z.enum(['ordinary','gathering']),
  largestCommonTargetMembers:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((p,ctx)=>{
  if((p.situation==='gathering')!==(p.largestCommonTargetMembers>=2))
    ctx.addIssue({code:'custom',message:'gathering requires at least two observed common-target participants'});
});
export type NativeGatheringObservationV1=z.infer<typeof nativeGatheringObservationV1Schema>;
