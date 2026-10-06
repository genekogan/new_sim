import {z} from 'zod';
import {mandateTriggerSchema} from './mandate.ts';
const id=z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),uint=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),seq=uint.positive();
const source=z.strictObject({worldId:id,soulId:id,intentId:id,version:seq,seq,tick:uint});
const contribution=z.strictObject({kind:z.enum(['semantic_card_sequence','native_program_sequence']),completedSteps:uint.max(8),totalSteps:uint.max(8),nextCard:z.string().min(2).max(60).optional()}).refine(p=>p.completedSteps<=p.totalSteps&&(!(p.completedSteps===p.totalSteps)||p.nextCard===undefined),'invalid contribution progress');
const purpose=z.strictObject({words:z.string().min(1).max(2000),strict:z.boolean(),importance:z.number().min(0).max(1),understanding:z.string().min(1).max(2000),status:z.enum(['active','blocked']),source,trigger:mandateTriggerSchema,contribution:contribution.optional(),lastAttempt:z.strictObject({phase:z.enum(['accepted','started','blocked','completed','interrupted']),seq,tick:uint,reason:z.string().max(2000).optional(),evidence:z.strictObject({seq,tick:uint,kind:z.enum(['admission','controller','kernel'])})}).optional()});
const recall=z.strictObject({contract:z.literal('private-purpose-recall/1'),state:z.enum(['ready','overflow']),total:uint,selected:uint.max(12),omitted:uint,bytes:uint.max(16384),omittedSources:z.array(source).max(12),moreOmittedSources:z.boolean(),reason:z.literal('mandatory_context_exceeds_limit').optional()});
export const privatePurposeContextV1Schema=z.strictObject({contract:z.literal('private-purpose-context/1'),visibility:z.literal('current-owner'),worldId:id,soulId:id,entityId:id,observedTick:uint,purposes:z.array(purpose).max(12),recall}).superRefine((p,ctx)=>{
 const size=new TextEncoder().encode(JSON.stringify(p.purposes)).length;
 if(size>16384||size!==p.recall.bytes||p.recall.selected!==p.purposes.length||p.recall.selected+p.recall.omitted!==p.recall.total)ctx.addIssue({code:'custom',message:'private recall bounds/counts differ'});
 if(p.recall.omittedSources.length!==Math.min(12,p.recall.omitted)||p.recall.moreOmittedSources!==(p.recall.omitted>12))ctx.addIssue({code:'custom',message:'private omission references differ'});
 if(p.recall.state==='overflow'?(p.purposes.length!==0||p.recall.reason!=='mandatory_context_exceeds_limit'):p.recall.reason!==undefined)ctx.addIssue({code:'custom',message:'private recall capacity differs'});
 for(const s of [...p.purposes.map(v=>v.source),...p.recall.omittedSources])if(s.worldId!==p.worldId||s.soulId!==p.soulId||s.tick>p.observedTick)ctx.addIssue({code:'custom',message:'private context source scope differs'});
});
export type PrivatePurposeContextV1=z.infer<typeof privatePurposeContextV1Schema>;
