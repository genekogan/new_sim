import {z} from 'zod';
const id=z.string().min(1).max(160);
/** Public physical metadata at bounded local distance. No owner words, lesson
 * text, private purpose or requested controls. Distance is not line of sight. */
export const localClassroomObservationV1Schema=z.strictObject({
 contract:z.literal('local-classroom-observation/1'),
 scope:z.literal('local-distance-only'),
 tick:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
 rulesVersion:z.string().min(1).max(200),
 observer:id,
 radiusMetres:z.literal(20),
 sessions:z.array(z.strictObject({
  session:id,
  phase:z.enum(['arriving','releasing','presenting','question','rotating','conversation-release','conversing','departing','cleanup','ended']),
  participants:z.array(z.strictObject({actor:id,role:z.enum(['host','presenter','audience']),occupiedSeat:z.boolean()})).max(31),
  seatedAttendees:z.number().int().nonnegative().max(30),
  presenter:id.optional(),
  floorHolder:id.optional(),
  attentionActor:id.optional(),
 }).superRefine((v,ctx)=>{const actors=new Set(v.participants.map(p=>p.actor));if(actors.size!==v.participants.length)ctx.addIssue({code:'custom',message:'visible participants must be distinct'});if([v.presenter,v.floorHolder,v.attentionActor].some(a=>a!==undefined&&!actors.has(a)))ctx.addIssue({code:'custom',message:'role references must be locally visible'});if(v.seatedAttendees!==v.participants.filter(p=>p.actor!==v.presenter&&p.occupiedSeat).length)ctx.addIssue({code:'custom',message:'seated attendees require observed occupied seats'});})).max(16),
});
export type LocalClassroomObservationV1=z.infer<typeof localClassroomObservationV1Schema>;
