import { z } from 'zod';
import type { Vec3 } from './world.ts';

// Internal Core/native boundary. A probe result is neither owner authority nor
// a public admission receipt; its exact base must be rechecked by the sequencer.
export const humanBirthRequestSchema = z.object({
  id:z.string().min(1).max(96), label:z.string().min(1).max(80), soul:z.string().min(1).max(96),
}).strict();
export type HumanBirthRequest = z.infer<typeof humanBirthRequestSchema>;
export type HumanBirthProbe = {
  contract:'detached-native-birth/1';
  base:{schema:string;rulesVersion:string;tick:number;stateHash:string};
  request:HumanBirthRequest;
} & (
  | {outcome:'ready'|'existing';position:Vec3}
  | {outcome:'deferred'|'unavailable';diagnostic:{code:string;message:string}}
);
