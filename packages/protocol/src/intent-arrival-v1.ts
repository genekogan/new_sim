import {z} from 'zod';
import {intentReferenceV2Schema} from './intent-v2.ts';
export const INTENT_ARRIVAL_V1='private-intent-arrival/1' as const;
const id=z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),uint=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),seq=uint.positive(),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const intentArrivalPayloadV1Schema=z.strictObject({
  contract:z.literal(INTENT_ARRIVAL_V1),worldId:id,soulId:id,ownerId:id,entityId:id,intent:intentReferenceV2Schema,attemptId:id,activityId:id,
  admissionSeq:seq,admissionHash:digest,decisionSeq:seq,decisionHash:digest,controllerStartSeq:seq,controllerStartHash:digest,
  play:z.strictObject({seq,tick:uint,hash:digest,card:z.literal('go to'),target:id}),
  navigation:z.strictObject({id:z.string().min(1).max(200),verb:z.enum(['walk_to','commons_shore_travel']),status:z.literal('completed'),endedTick:uint,requestedGoal:z.strictObject({x:z.number().finite(),z:z.number().finite(),level:uint}),goal:z.strictObject({x:z.number().finite(),z:z.number().finite(),level:uint})}),
  observation:z.strictObject({tick:uint,position:z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]),level:uint,rulesVersion:z.string().min(1).max(200)}),
}).superRefine((p,ctx)=>{
  if(!(p.decisionSeq<p.admissionSeq&&p.admissionSeq<p.controllerStartSeq&&p.controllerStartSeq<p.play.seq))ctx.addIssue({code:'custom',message:'arrival source order differs'});
  if(p.navigation.endedTick>p.observation.tick||p.play.tick!==p.observation.tick||p.navigation.goal.level!==p.observation.level)ctx.addIssue({code:'custom',message:'arrival observation scope differs'});
  if(Math.hypot(p.observation.position[0]-p.navigation.goal.x,p.observation.position[2]-p.navigation.goal.z)>.002)ctx.addIssue({code:'custom',message:'arrival does not observe the completed endpoint'});
});
export type IntentArrivalPayloadV1=z.infer<typeof intentArrivalPayloadV1Schema>;
export function intentArrivalFactV1(e:{kind:string;seq:number;tick:number;author:string;payload:unknown}){
  if(e.kind!=='intent-arrival-v1'||e.author!=='world:intent-arrival')throw Error('arrival fact origin differs');
  const p=intentArrivalPayloadV1Schema.parse(e.payload);if(p.play.seq+1!==e.seq||e.tick!==p.observation.tick)throw Error('arrival fact must be paired with its canonical play');
  return {...p,seq:e.seq,tick:e.tick};
}
const querySeq=z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).refine(Number.isSafeInteger);
export const intentArrivalQueryV1Schema=z.strictObject({afterSeq:querySeq.optional(),throughSeq:querySeq.optional()});
export const intentArrivalPageV1Schema=z.strictObject({contract:z.literal(INTENT_ARRIVAL_V1),worldId:id,soulId:id,ownerId:id,
  frontier:z.strictObject({seq:uint,tick:uint}),afterSeq:uint,throughSeq:uint,complete:z.boolean(),nextAfterSeq:uint.nullable(),visibility:z.literal('current-owner'),
  arrivals:z.array(intentArrivalPayloadV1Schema.safeExtend({seq,tick:uint})).max(50),
}).superRefine((p,ctx)=>{
  if(p.afterSeq>p.throughSeq||p.throughSeq>p.frontier.seq||p.complete!==(p.throughSeq===p.frontier.seq)||p.complete!==(p.nextAfterSeq===null)||!p.complete&&p.nextAfterSeq!==p.throughSeq)ctx.addIssue({code:'custom',message:'arrival page frontier differs'});
  let previous=p.afterSeq;for(const a of p.arrivals){if(a.worldId!==p.worldId||a.soulId!==p.soulId||a.ownerId!==p.ownerId||a.seq<=previous||a.seq>p.throughSeq||a.tick>p.frontier.tick||a.seq!==a.play.seq+1||a.tick!==a.observation.tick)ctx.addIssue({code:'custom',message:'arrival page scope/order differs'});previous=a.seq;}
});
