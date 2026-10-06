import {z} from 'zod';
import {intentReferenceV2Schema} from './intent-v2.ts';
const id=z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const intentSleepStopV1Schema=z.strictObject({contract:z.literal('private-intent-sleep-stop/1'),worldId:id,soulId:id,entityId:id,intent:intentReferenceV2Schema,programId:id});
export type IntentSleepStopV1=z.infer<typeof intentSleepStopV1Schema>;
